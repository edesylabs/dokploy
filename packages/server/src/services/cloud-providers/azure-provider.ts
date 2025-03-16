import { ComputeManagementClient, VirtualMachinesGetResponse } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { MonitorClient } from '@azure/arm-monitor';
import { ClientSecretCredential } from '@azure/identity';
import { CloudProviderService, InstanceTypeInfo, RegionInfo, ServerProvisioningRequest, ServerResource } from './types';
import { logger } from '@dokploy/server/utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export class AzureCloudProvider implements CloudProviderService {
  private computeClient: ComputeManagementClient;
  private networkClient: NetworkManagementClient;
  private monitorClient: MonitorClient;
  private subscriptionId: string;
  private resourceGroupName: string;
  private location: string;
  private config: {
    id: string;
    name: string;
    credentials: Record<string, string>;
    region: string;
    defaultInstanceType?: string;
    tags?: Record<string, string>;
  };

  constructor(config: {
    id: string;
    name: string;
    credentials: Record<string, string>;
    region: string;
    defaultInstanceType?: string;
    tags?: Record<string, string>;
  }) {
    this.config = config;
    
    // Extract credentials
    const { subscriptionId, tenantId, clientId, clientSecret } = config.credentials;
    
    if (!subscriptionId || !tenantId || !clientId || !clientSecret) {
      throw new Error('Azure credentials must include subscriptionId, tenantId, clientId, and clientSecret');
    }
    
    this.subscriptionId = subscriptionId;
    this.location = config.region;
    this.resourceGroupName = `dokploy-${config.id.substring(0, 8)}`;
    
    // Create Azure credential
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    
    // Initialize Azure clients
    this.computeClient = new ComputeManagementClient(credential, subscriptionId);
    this.networkClient = new NetworkManagementClient(credential, subscriptionId);
    this.monitorClient = new MonitorClient(credential, subscriptionId);
    
    logger.info(`Initialized Azure cloud provider: ${config.name} (${config.id})`);
  }

  /**
   * List available Azure regions
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    try {
      logger.info('Listing available Azure regions');
      
      const locations = await this.computeClient.locations.list();
      
      return locations.map(location => ({
        id: location.name || '',
        name: location.displayName || location.name || '',
        description: this.getRegionLocation(location.displayName || ''),
        zones: location.availabilityZones?.length ? location.availabilityZones : undefined
      }));
    } catch (error) {
      logger.error('Error listing Azure regions:', error);
      throw new Error(`Failed to list Azure regions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a human-readable location for a region
   */
  private getRegionLocation(regionName: string): string {
    // Extract location from region display name
    const parts = regionName.split(' ');
    if (parts.length > 1) {
      return parts.slice(1).join(' ');
    }
    return regionName;
  }

  /**
   * List available instance types in a region
   */
  async listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]> {
    try {
      logger.info(`Listing available Azure VM sizes in ${region}`);
      
      const vmSizes = await this.computeClient.virtualMachineSizes.list(region);
      
      return vmSizes.map(size => {
        const hourlyPrice = this.getEstimatedHourlyPrice(size.name || '', region);
        
        return {
          name: size.name || '',
          description: `${size.name} (${size.numberOfCores} vCPU, ${size.memoryInMB} MB RAM)`,
          cpuCount: size.numberOfCores || 1,
          memoryGb: (size.memoryInMB || 0) / 1024,
          hourlyPrice: hourlyPrice,
        };
      });
    } catch (error) {
      logger.error(`Error listing Azure VM sizes in ${region}:`, error);
      throw new Error(`Failed to list Azure VM sizes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get estimated hourly price for an instance type
   * Note: This is a simplified pricing model and should be replaced with actual Azure pricing API
   */
  private getEstimatedHourlyPrice(vmSize: string, region: string): number {
    // This is a simplified pricing model based on VM size
    // In a production environment, you would use the Azure Retail Prices API or a pricing database
    
    // Basic pricing tiers (very approximate)
    if (vmSize.startsWith('Standard_B1')) return 0.0104;
    if (vmSize.startsWith('Standard_B2')) return 0.0416;
    if (vmSize.startsWith('Standard_B4')) return 0.0832;
    if (vmSize.startsWith('Standard_D2')) return 0.0953;
    if (vmSize.startsWith('Standard_D4')) return 0.1906;
    if (vmSize.startsWith('Standard_F2')) return 0.0952;
    if (vmSize.startsWith('Standard_F4')) return 0.1904;
    
    // Default price for unknown sizes
    return 0.05;
  }

  /**
   * Provision a new server
   */
  async provisionServer(request: ServerProvisioningRequest): Promise<ServerResource> {
    try {
      logger.info(`Provisioning Azure VM: ${request.name}`);
      
      // Generate unique names for resources
      const vmName = `dokploy-${request.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const networkName = `${vmName}-vnet`;
      const subnetName = `${vmName}-subnet`;
      const publicIpName = `${vmName}-ip`;
      const nsgName = `${vmName}-nsg`;
      const nicName = `${vmName}-nic`;
      
      // Ensure resource group exists
      await this.ensureResourceGroup();
      
      // Create network security group with SSH access
      logger.info(`Creating network security group: ${nsgName}`);
      const nsg = await this.networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait(
        this.resourceGroupName,
        nsgName,
        {
          location: this.location,
          securityRules: [
            {
              name: 'SSH',
              properties: {
                protocol: 'Tcp',
                sourcePortRange: '*',
                destinationPortRange: '22',
                sourceAddressPrefix: '*',
                destinationAddressPrefix: '*',
                access: 'Allow',
                priority: 1000,
                direction: 'Inbound',
              },
            },
          ],
          tags: this.getTags(request.tags),
        }
      );
      
      // Create virtual network and subnet
      logger.info(`Creating virtual network: ${networkName}`);
      const vnet = await this.networkClient.virtualNetworks.beginCreateOrUpdateAndWait(
        this.resourceGroupName,
        networkName,
        {
          location: this.location,
          addressSpace: {
            addressPrefixes: ['10.0.0.0/16'],
          },
          tags: this.getTags(request.tags),
        }
      );
      
      logger.info(`Creating subnet: ${subnetName}`);
      const subnet = await this.networkClient.subnets.beginCreateOrUpdateAndWait(
        this.resourceGroupName,
        networkName,
        subnetName,
        {
          addressPrefix: '10.0.0.0/24',
          networkSecurityGroup: {
            id: nsg.id,
          },
        }
      );
      
      // Create public IP address
      logger.info(`Creating public IP address: ${publicIpName}`);
      const publicIp = await this.networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(
        this.resourceGroupName,
        publicIpName,
        {
          location: this.location,
          publicIPAllocationMethod: 'Dynamic',
          tags: this.getTags(request.tags),
        }
      );
      
      // Create network interface
      logger.info(`Creating network interface: ${nicName}`);
      const nic = await this.networkClient.networkInterfaces.beginCreateOrUpdateAndWait(
        this.resourceGroupName,
        nicName,
        {
          location: this.location,
          ipConfigurations: [
            {
              name: 'ipconfig1',
              properties: {
                subnet: {
                  id: subnet.id,
                },
                privateIPAllocationMethod: 'Dynamic',
                publicIPAddress: {
                  id: publicIp.id,
                },
              },
            },
          ],
          tags: this.getTags(request.tags),
        }
      );
      
      // Generate SSH key pair
      const sshKeyPair = await this.generateSshKeyPair(vmName);
      
      // Determine VM size (instance type)
      const vmSize = request.instanceType || this.config.defaultInstanceType || 'Standard_B2s';
      
      // Create virtual machine
      logger.info(`Creating virtual machine: ${vmName}`);
      const vm = await this.computeClient.virtualMachines.beginCreateOrUpdateAndWait(
        this.resourceGroupName,
        vmName,
        {
          location: this.location,
          hardwareProfile: {
            vmSize: vmSize,
          },
          storageProfile: {
            imageReference: {
              publisher: 'Canonical',
              offer: 'UbuntuServer',
              sku: '18.04-LTS',
              version: 'latest',
            },
            osDisk: {
              createOption: 'FromImage',
              managedDisk: {
                storageAccountType: 'Premium_LRS',
              },
              diskSizeGB: request.diskSize || 30,
            },
          },
          osProfile: {
            computerName: vmName,
            adminUsername: 'dokploy',
            linuxConfiguration: {
              disablePasswordAuthentication: true,
              ssh: {
                publicKeys: [
                  {
                    path: '/home/dokploy/.ssh/authorized_keys',
                    keyData: sshKeyPair.publicKey,
                  },
                ],
              },
            },
          },
          networkProfile: {
            networkInterfaces: [
              {
                id: nic.id,
              },
            ],
          },
          tags: this.getTags(request.tags),
        }
      );
      
      // Get the VM details
      const vmDetails = await this.computeClient.virtualMachines.get(
        this.resourceGroupName,
        vmName
      );
      
      // Get the public IP address
      const updatedPublicIp = await this.networkClient.publicIPAddresses.get(
        this.resourceGroupName,
        publicIpName
      );
      
      // Calculate hourly rate
      const hourlyRate = this.getEstimatedHourlyPrice(vmSize, this.location);
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: vmName,
        name: request.name,
        cloudProviderId: this.config.id,
        provider: 'azure',
        region: this.location,
        instanceType: vmSize,
        status: this.mapVmStatusToServerStatus(vmDetails),
        publicIp: updatedPublicIp.ipAddress || undefined,
        privateIp: nic.ipConfigurations?.[0]?.properties?.privateIPAddress,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        tags: this.getTags(request.tags),
        cost: {
          hourlyRate: hourlyRate,
          currentBilling: 0,
        },
        sshKeyPath: sshKeyPair.privateKeyPath,
      };
      
      logger.info(`Azure VM provisioned successfully: ${vmName}`);
      
      return serverResource;
    } catch (error) {
      logger.error(`Error provisioning Azure VM:`, error);
      throw new Error(`Failed to provision Azure VM: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Ensure the resource group exists
   */
  private async ensureResourceGroup(): Promise<void> {
    try {
      // Check if resource group exists
      const resourceGroups = await this.computeClient.resourceGroups.list();
      const exists = resourceGroups.some(rg => rg.name === this.resourceGroupName);
      
      if (!exists) {
        logger.info(`Creating resource group: ${this.resourceGroupName}`);
        await this.computeClient.resourceGroups.createOrUpdate(this.resourceGroupName, {
          location: this.location,
          tags: this.config.tags,
        });
      }
    } catch (error) {
      logger.error(`Error ensuring resource group exists:`, error);
      throw new Error(`Failed to ensure resource group: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate SSH key pair for VM access
   */
  private async generateSshKeyPair(vmName: string): Promise<{ publicKey: string; privateKeyPath: string }> {
    try {
      // Create .ssh directory if it doesn't exist
      const sshDir = path.join(os.homedir(), '.ssh', 'dokploy');
      if (!fs.existsSync(sshDir)) {
        fs.mkdirSync(sshDir, { recursive: true });
      }
      
      // Generate key file paths
      const privateKeyPath = path.join(sshDir, `${vmName}`);
      const publicKeyPath = `${privateKeyPath}.pub`;
      
      // Generate SSH key pair
      await execAsync(`ssh-keygen -t rsa -b 2048 -f ${privateKeyPath} -N ""`);
      
      // Set permissions
      fs.chmodSync(privateKeyPath, 0o600);
      
      // Read public key
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
      
      return {
        publicKey,
        privateKeyPath,
      };
    } catch (error) {
      logger.error(`Error generating SSH key pair:`, error);
      throw new Error(`Failed to generate SSH key pair: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Map Azure VM status to server status
   */
  private mapVmStatusToServerStatus(vm: VirtualMachinesGetResponse): string {
    if (!vm.provisioningState) {
      return 'unknown';
    }
    
    if (vm.provisioningState === 'Creating' || vm.provisioningState === 'Updating') {
      return 'provisioning';
    }
    
    if (vm.provisioningState === 'Failed') {
      return 'error';
    }
    
    if (vm.provisioningState === 'Succeeded') {
      const powerState = vm.instanceView?.statuses?.find(s => s.code?.startsWith('PowerState/'));
      
      if (powerState) {
        if (powerState.code?.includes('running')) return 'running';
        if (powerState.code?.includes('deallocated') || powerState.code?.includes('stopped')) return 'stopped';
      }
      
      return 'running'; // Default to running if we can't determine power state
    }
    
    return 'unknown';
  }

  /**
   * Terminate a server
   */
  async terminateServer(serverId: string): Promise<boolean> {
    try {
      logger.info(`Terminating Azure VM: ${serverId}`);
      
      // Delete the VM
      await this.computeClient.virtualMachines.beginDeleteAndWait(
        this.resourceGroupName,
        serverId
      );
      
      // Clean up associated resources
      const nicName = `${serverId}-nic`;
      const publicIpName = `${serverId}-ip`;
      const nsgName = `${serverId}-nsg`;
      const vnetName = `${serverId}-vnet`;
      
      // Delete network interface
      try {
        await this.networkClient.networkInterfaces.beginDeleteAndWait(
          this.resourceGroupName,
          nicName
        );
      } catch (error) {
        logger.warn(`Error deleting network interface ${nicName}:`, error);
      }
      
      // Delete public IP
      try {
        await this.networkClient.publicIPAddresses.beginDeleteAndWait(
          this.resourceGroupName,
          publicIpName
        );
      } catch (error) {
        logger.warn(`Error deleting public IP ${publicIpName}:`, error);
      }
      
      // Delete network security group
      try {
        await this.networkClient.networkSecurityGroups.beginDeleteAndWait(
          this.resourceGroupName,
          nsgName
        );
      } catch (error) {
        logger.warn(`Error deleting network security group ${nsgName}:`, error);
      }
      
      // Delete virtual network
      try {
        await this.networkClient.virtualNetworks.beginDeleteAndWait(
          this.resourceGroupName,
          vnetName
        );
      } catch (error) {
        logger.warn(`Error deleting virtual network ${vnetName}:`, error);
      }
      
      logger.info(`Azure VM terminated successfully: ${serverId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error terminating Azure VM:`, error);
      throw new Error(`Failed to terminate Azure VM: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server status
   */
  async getServerStatus(serverId: string): Promise<ServerResource> {
    try {
      logger.info(`Getting status for Azure VM: ${serverId}`);
      
      // Get VM details
      const vm = await this.computeClient.virtualMachines.get(
        this.resourceGroupName,
        serverId,
        { expand: 'instanceView' }
      );
      
      // Get network interface
      const nicName = `${serverId}-nic`;
      const nic = await this.networkClient.networkInterfaces.get(
        this.resourceGroupName,
        nicName
      );
      
      // Get public IP
      const publicIpName = `${serverId}-ip`;
      const publicIp = await this.networkClient.publicIPAddresses.get(
        this.resourceGroupName,
        publicIpName
      );
      
      // Get metrics
      const metrics = await this.getServerMetrics(serverId);
      
      // Calculate current billing
      const creationTime = new Date(vm.timeCreated || new Date());
      const hourlyRate = this.getEstimatedHourlyPrice(vm.hardwareProfile?.vmSize || '', this.location);
      const currentBilling = this.calculateCurrentBilling(creationTime, hourlyRate);
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: serverId,
        name: vm.tags?.['Name'] || serverId,
        cloudProviderId: this.config.id,
        provider: 'azure',
        region: this.location,
        instanceType: vm.hardwareProfile?.vmSize || '',
        status: this.mapVmStatusToServerStatus(vm),
        publicIp: publicIp.ipAddress || undefined,
        privateIp: nic.ipConfigurations?.[0]?.properties?.privateIPAddress,
        createdAt: new Date(vm.timeCreated || new Date()),
        lastActiveAt: new Date(),
        tags: vm.tags || {},
        cost: {
          hourlyRate: hourlyRate,
          currentBilling: currentBilling,
        },
        metrics,
      };
      
      return serverResource;
    } catch (error) {
      logger.error(`Error getting Azure VM status:`, error);
      throw new Error(`Failed to get Azure VM status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Calculate current billing based on creation time and hourly rate
   */
  private calculateCurrentBilling(creationTime: Date, hourlyRate: number): number {
    const now = new Date();
    const hoursElapsed = (now.getTime() - creationTime.getTime()) / (1000 * 60 * 60);
    return hoursElapsed * hourlyRate;
  }

  /**
   * List all servers
   */
  async listServers(): Promise<ServerResource[]> {
    try {
      logger.info(`Listing Azure VMs in resource group: ${this.resourceGroupName}`);
      
      // Get all VMs in the resource group
      const vms = await this.computeClient.virtualMachines.list(this.resourceGroupName);
      
      // Map VMs to server resources
      const serverResources: ServerResource[] = [];
      
      for (const vm of vms) {
        if (!vm.name) continue;
        
        try {
          const serverResource = await this.getServerStatus(vm.name);
          serverResources.push(serverResource);
        } catch (error) {
          logger.error(`Error getting status for VM ${vm.name}:`, error);
        }
      }
      
      return serverResources;
    } catch (error) {
      logger.error(`Error listing Azure VMs:`, error);
      throw new Error(`Failed to list Azure VMs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Install Kubernetes on a server
   */
  async installKubernetes(serverId: string): Promise<{ kubeconfig: string }> {
    try {
      logger.info(`Installing Kubernetes on Azure VM: ${serverId}`);
      
      // Get server details
      const server = await this.getServerStatus(serverId);
      
      if (server.status !== 'running') {
        throw new Error(`Server must be in running state to install Kubernetes. Current state: ${server.status}`);
      }
      
      if (!server.publicIp) {
        throw new Error('Server must have a public IP address to install Kubernetes');
      }
      
      // Find SSH key path
      const sshKeyPath = path.join(os.homedir(), '.ssh', 'dokploy', serverId);
      
      if (!fs.existsSync(sshKeyPath)) {
        throw new Error(`SSH key not found at ${sshKeyPath}`);
      }
      
      // Install Kubernetes using k3s
      const installScript = `
        set -e
        export INSTALL_K3S_EXEC="--disable=traefik"
        curl -sfL https://get.k3s.io | sh -
        sudo kubectl -n kube-system wait --for=condition=available --timeout=600s deployment/coredns
        sudo cat /etc/rancher/k3s/k3s.yaml
      `;
      
      logger.info(`Running Kubernetes installation script on ${server.publicIp}`);
      
      const { stdout } = await execAsync(`
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${sshKeyPath} dokploy@${server.publicIp} '${installScript}'
      `);
      
      // Extract kubeconfig from output
      const kubeconfig = stdout.trim();
      
      // Replace localhost with server IP
      const updatedKubeconfig = kubeconfig.replace(/server: https:\/\/127.0.0.1:6443/g, `server: https://${server.publicIp}:6443`);
      
      logger.info(`Kubernetes installed successfully on ${serverId}`);
      
      return { kubeconfig: updatedKubeconfig };
    } catch (error) {
      logger.error(`Error installing Kubernetes on Azure VM:`, error);
      throw new Error(`Failed to install Kubernetes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server metrics
   */
  async getServerMetrics(serverId: string): Promise<ServerResource['metrics']> {
    try {
      logger.info(`Getting metrics for Azure VM: ${serverId}`);
      
      // Get VM details
      const vm = await this.computeClient.virtualMachines.get(
        this.resourceGroupName,
        serverId
      );
      
      if (!vm.id) {
        throw new Error(`VM ID not found for ${serverId}`);
      }
      
      const now = new Date();
      const startTime = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago
      
      // Get CPU metrics
      const cpuMetrics = await this.monitorClient.metrics.list(
        vm.id,
        {
          timespan: `${startTime.toISOString()}/${now.toISOString()}`,
          interval: 'PT5M',
          metricnames: 'Percentage CPU',
          aggregation: 'Average',
        }
      );
      
      // Get network metrics
      const networkInMetrics = await this.monitorClient.metrics.list(
        vm.id,
        {
          timespan: `${startTime.toISOString()}/${now.toISOString()}`,
          interval: 'PT5M',
          metricnames: 'Network In',
          aggregation: 'Average',
        }
      );
      
      const networkOutMetrics = await this.monitorClient.metrics.list(
        vm.id,
        {
          timespan: `${startTime.toISOString()}/${now.toISOString()}`,
          interval: 'PT5M',
          metricnames: 'Network Out',
          aggregation: 'Average',
        }
      );
      
      // Extract values
      const cpuUtilization = cpuMetrics.value?.[0]?.timeseries?.[0]?.data?.slice(-1)[0]?.average || 0;
      const networkIn = networkInMetrics.value?.[0]?.timeseries?.[0]?.data?.slice(-1)[0]?.average || 0;
      const networkOut = networkOutMetrics.value?.[0]?.timeseries?.[0]?.data?.slice(-1)[0]?.average || 0;
      
      return {
        cpuUtilization,
        networkIn,
        networkOut,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error(`Error getting Azure VM metrics:`, error);
      // Return default metrics on error
      return {
        cpuUtilization: 0,
        networkIn: 0,
        networkOut: 0,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Combine default tags with request tags
   */
  private getTags(requestTags?: Record<string, string>): Record<string, string> {
    const defaultTags = this.config.tags || {};
    const combinedTags = { ...defaultTags, ...requestTags };
    
    // Add Name tag if not present
    if (!combinedTags['Name']) {
      combinedTags['Name'] = this.config.name;
    }
    
    // Add managed-by tag
    combinedTags['managed-by'] = 'dokploy';
    
    return combinedTags;
  }
} 