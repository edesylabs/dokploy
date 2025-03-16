import { 
  CloudProviderService, 
  ServerProvisioningRequest, 
  ServerResource, 
  InstanceTypeInfo,
  RegionInfo
} from './types';
import { nanoid } from 'nanoid';
import { execAsync } from '@dokploy/server/utils/process/execAsync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Compute } from '@google-cloud/compute';
import { Monitoring } from '@google-cloud/monitoring';

/**
 * GCP Cloud Provider implementation
 */
export class GCPCloudProvider implements CloudProviderService {
  private compute: Compute;
  private monitoring: Monitoring;
  private projectId: string;
  private region: string;
  private zone: string;
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
    this.projectId = config.credentials.projectId;
    this.region = config.region;
    
    // GCP uses zones, which are subdivisions of regions
    // We'll use the first zone in the region
    this.zone = `${this.region}-a`;
    
    // Create a credentials object from the provided JSON
    const credentials = JSON.parse(config.credentials.serviceAccountKey);
    
    // Initialize GCP clients
    this.compute = new Compute({
      projectId: this.projectId,
      credentials
    });
    
    this.monitoring = new Monitoring({
      projectId: this.projectId,
      credentials
    });
  }

  /**
   * List available GCP regions
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    try {
      const [regions] = await this.compute.getRegions();
      
      return regions.map(region => ({
        id: region.id || '',
        name: region.name || '',
        location: this.getRegionLocation(region.name || ''),
        available: region.status === 'UP'
      }));
    } catch (error) {
      console.error('Error listing GCP regions:', error);
      throw error;
    }
  }

  /**
   * Get a human-readable location for a GCP region
   */
  private getRegionLocation(regionCode: string): string {
    const regionMap: Record<string, string> = {
      'us-central1': 'Iowa, North America',
      'us-east1': 'South Carolina, North America',
      'us-east4': 'Northern Virginia, North America',
      'us-west1': 'Oregon, North America',
      'us-west2': 'Los Angeles, North America',
      'us-west3': 'Salt Lake City, North America',
      'us-west4': 'Las Vegas, North America',
      'northamerica-northeast1': 'Montreal, North America',
      'southamerica-east1': 'São Paulo, South America',
      'europe-north1': 'Finland, Europe',
      'europe-west1': 'Belgium, Europe',
      'europe-west2': 'London, Europe',
      'europe-west3': 'Frankfurt, Europe',
      'europe-west4': 'Netherlands, Europe',
      'europe-west6': 'Zurich, Europe',
      'asia-east1': 'Taiwan, Asia',
      'asia-east2': 'Hong Kong, Asia',
      'asia-northeast1': 'Tokyo, Asia',
      'asia-northeast2': 'Osaka, Asia',
      'asia-northeast3': 'Seoul, Asia',
      'asia-south1': 'Mumbai, Asia',
      'asia-southeast1': 'Singapore, Asia',
      'asia-southeast2': 'Jakarta, Asia',
      'australia-southeast1': 'Sydney, Australia',
      'australia-southeast2': 'Melbourne, Australia'
    };

    return regionMap[regionCode] || regionCode;
  }

  /**
   * List available GCP machine types in a region
   */
  async listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]> {
    try {
      // GCP uses zones, which are subdivisions of regions
      // We'll use the first zone in the region
      const zone = `${region}-a`;
      
      // Get the zone object
      const zoneObj = this.compute.zone(zone);
      
      // Get available machine types
      const [machineTypes] = await zoneObj.getMachineTypes();
      
      // Filter to common machine types to avoid overwhelming the user
      const commonTypes = [
        'e2-micro', 'e2-small', 'e2-medium', 
        'n1-standard-1', 'n1-standard-2', 'n1-standard-4',
        'n2-standard-2', 'n2-standard-4',
        'c2-standard-4'
      ];
      
      return machineTypes
        .filter(type => commonTypes.includes(type.name || ''))
        .map(type => ({
          name: type.name || '',
          cpuCount: type.guestCpus || 0,
          memoryGb: (type.memoryMb || 0) / 1024,
          storageGb: 10, // Default boot disk size
          hourlyPrice: this.getEstimatedHourlyPrice(type.name || '', region),
          description: `${type.name} (${type.guestCpus} vCPUs, ${((type.memoryMb || 0) / 1024).toFixed(1)} GB RAM)`
        }));
    } catch (error) {
      console.error('Error listing GCP machine types:', error);
      throw error;
    }
  }

  /**
   * Get an estimated hourly price for a machine type
   * Note: These are rough estimates and should be replaced with actual pricing API calls
   */
  private getEstimatedHourlyPrice(machineType: string, region: string): number {
    // Base prices for us-central1 region
    const basePriceMap: Record<string, number> = {
      'e2-micro': 0.0083,
      'e2-small': 0.0166,
      'e2-medium': 0.0332,
      'n1-standard-1': 0.0475,
      'n1-standard-2': 0.095,
      'n1-standard-4': 0.19,
      'n2-standard-2': 0.0971,
      'n2-standard-4': 0.1942,
      'c2-standard-4': 0.2088
    };
    
    // Regional price multipliers (approximate)
    const regionMultiplier: Record<string, number> = {
      'us-central1': 1.0,
      'us-east1': 1.0,
      'us-east4': 1.12,
      'us-west1': 1.0,
      'us-west2': 1.12,
      'us-west3': 1.12,
      'us-west4': 1.12,
      'northamerica-northeast1': 1.12,
      'southamerica-east1': 1.25,
      'europe-north1': 1.12,
      'europe-west1': 1.12,
      'europe-west2': 1.25,
      'europe-west3': 1.12,
      'europe-west4': 1.12,
      'europe-west6': 1.25,
      'asia-east1': 1.12,
      'asia-east2': 1.25,
      'asia-northeast1': 1.12,
      'asia-northeast2': 1.25,
      'asia-northeast3': 1.12,
      'asia-south1': 1.12,
      'asia-southeast1': 1.12,
      'asia-southeast2': 1.12,
      'australia-southeast1': 1.25,
      'australia-southeast2': 1.25
    };
    
    const basePrice = basePriceMap[machineType] || 0.05;
    const multiplier = regionMultiplier[region] || 1.0;
    
    return parseFloat((basePrice * multiplier).toFixed(4));
  }

  /**
   * Provision a new GCP instance
   */
  async provisionServer(request: ServerProvisioningRequest): Promise<ServerResource> {
    try {
      // Use default instance type if not specified
      const machineType = request.instanceType || this.config.defaultInstanceType || 'e2-medium';
      
      // Create a unique name for the instance
      const instanceName = `dokploy-${request.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${nanoid(6)}`;
      const instanceId = nanoid();
      
      // Combine tags from request and config
      const tags = {
        ...this.config.tags,
        ...request.tags,
        name: request.name,
        managed_by: 'dokploy',
        dokploy_id: instanceId
      };
      
      // Convert tags to GCP metadata format
      const metadata = {
        items: Object.entries(tags).map(([key, value]) => ({
          key,
          value: String(value)
        }))
      };
      
      // Add additional metadata for auto-delete configuration
      metadata.items.push({
        key: 'dokploy-auto-delete',
        value: String(request.autoDelete?.enabled || false)
      });
      
      if (request.autoDelete?.enabled) {
        metadata.items.push({
          key: 'dokploy-idle-threshold',
          value: String(request.autoDelete.idleThreshold || 60)
        });
        
        metadata.items.push({
          key: 'dokploy-max-lifetime',
          value: String(request.autoDelete.maxLifetime || 1440)
        });
      }
      
      // Generate an SSH key pair for the instance
      const keyName = `dokploy-${instanceId}`;
      const privateKeyPath = path.join(os.tmpdir(), `${keyName}`);
      const publicKeyPath = `${privateKeyPath}.pub`;
      
      await execAsync(`ssh-keygen -t rsa -b 2048 -f ${privateKeyPath} -N ""`);
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
      
      // Add SSH key to metadata
      metadata.items.push({
        key: 'ssh-keys',
        value: `dokploy:${publicKey}`
      });
      
      // Get the zone object
      const zone = this.compute.zone(this.zone);
      
      // Create the instance
      const [operation] = await zone.createVM(instanceName, {
        machineType,
        disks: [
          {
            boot: true,
            autoDelete: true,
            initializeParams: {
              sourceImage: 'projects/debian-cloud/global/images/family/debian-10',
              diskSizeGb: request.diskSize || 10
            }
          }
        ],
        networkInterfaces: [
          {
            network: 'global/networks/default',
            accessConfigs: [
              {
                type: 'ONE_TO_ONE_NAT',
                name: 'External NAT'
              }
            ]
          }
        ],
        metadata,
        tags: {
          items: ['http-server', 'https-server', 'dokploy']
        },
        scheduling: {
          preemptible: false
        },
        serviceAccounts: [
          {
            email: 'default',
            scopes: [
              'https://www.googleapis.com/auth/cloud-platform'
            ]
          }
        ],
        // Startup script to install Docker
        metadata: {
          items: [
            {
              key: 'startup-script',
              value: `#!/bin/bash
                # Update system
                apt-get update -y
                apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
                
                # Install Docker
                curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
                echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
                apt-get update -y
                apt-get install -y docker-ce docker-ce-cli containerd.io
                
                # Add dokploy user
                useradd -m -s /bin/bash dokploy
                usermod -aG docker dokploy
                mkdir -p /home/dokploy/.ssh
                echo "${publicKey}" > /home/dokploy/.ssh/authorized_keys
                chown -R dokploy:dokploy /home/dokploy/.ssh
                chmod 700 /home/dokploy/.ssh
                chmod 600 /home/dokploy/.ssh/authorized_keys
                
                # Add instance metadata to a file
                echo "DOKPLOY_INSTANCE_ID=${instanceId}" > /etc/dokploy-metadata
                echo "DOKPLOY_AUTO_DELETE=${request.autoDelete?.enabled || false}" >> /etc/dokploy-metadata
                echo "DOKPLOY_IDLE_THRESHOLD=${request.autoDelete?.idleThreshold || 60}" >> /etc/dokploy-metadata
                echo "DOKPLOY_MAX_LIFETIME=${request.autoDelete?.maxLifetime || 1440}" >> /etc/dokploy-metadata
              `
            }
          ]
        }
      });
      
      // Wait for the operation to complete
      await operation.promise();
      
      // Get the instance details
      const [instance] = await zone.vm(instanceName).get();
      
      // Get the public IP address
      const publicIp = instance.metadata.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
      const privateIp = instance.metadata.networkInterfaces?.[0]?.networkIP;
      
      // Get instance type details for cost estimation
      const instanceTypes = await this.listAvailableInstanceTypes(this.region);
      const instanceTypeInfo = instanceTypes.find(type => type.name === machineType);
      
      // Create the server resource object
      const serverResource: ServerResource = {
        id: instanceId,
        name: request.name,
        cloudProviderId: this.config.id,
        provider: 'gcp',
        region: this.region,
        instanceType: machineType,
        publicIp,
        privateIp,
        status: 'running',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        tags,
        cost: {
          hourlyRate: instanceTypeInfo?.hourlyPrice || 0.05,
          currentBilling: 0
        }
      };
      
      return serverResource;
    } catch (error) {
      console.error('Error provisioning GCP server:', error);
      throw error;
    }
  }

  /**
   * Terminate a GCP instance
   */
  async terminateServer(serverId: string): Promise<boolean> {
    try {
      // Find the instance by the Dokploy ID tag
      const [vms] = await this.compute.getVMs({
        filter: `metadata.items.key="dokploy_id" AND metadata.items.value="${serverId}"`
      });
      
      if (vms.length === 0) {
        throw new Error(`No instance found with Dokploy ID: ${serverId}`);
      }
      
      const instance = vms[0];
      const zone = instance.metadata.zone.split('/').pop() || this.zone;
      
      // Delete the instance
      const [operation] = await instance.delete();
      
      // Wait for the operation to complete
      await operation.promise();
      
      // Delete the SSH key
      const keyName = `dokploy-${serverId}`;
      const privateKeyPath = path.join(os.tmpdir(), `${keyName}`);
      const publicKeyPath = `${privateKeyPath}.pub`;
      
      if (fs.existsSync(privateKeyPath)) {
        fs.unlinkSync(privateKeyPath);
      }
      
      if (fs.existsSync(publicKeyPath)) {
        fs.unlinkSync(publicKeyPath);
      }
      
      return true;
    } catch (error) {
      console.error('Error terminating GCP server:', error);
      throw error;
    }
  }

  /**
   * Get the current status of a GCP instance
   */
  async getServerStatus(serverId: string): Promise<ServerResource> {
    try {
      // Find the instance by the Dokploy ID tag
      const [vms] = await this.compute.getVMs({
        filter: `metadata.items.key="dokploy_id" AND metadata.items.value="${serverId}"`
      });
      
      if (vms.length === 0) {
        throw new Error(`No instance found with Dokploy ID: ${serverId}`);
      }
      
      const instance = vms[0];
      const zone = instance.metadata.zone.split('/').pop() || this.zone;
      
      // Map GCP instance state to our status enum
      let status: ServerResource['status'] = 'error';
      switch (instance.metadata.status) {
        case 'PROVISIONING':
        case 'STAGING':
          status = 'provisioning';
          break;
        case 'RUNNING':
          status = 'running';
          break;
        case 'STOPPING':
        case 'SUSPENDED':
          status = 'stopped';
          break;
        case 'TERMINATED':
          status = 'terminated';
          break;
        default:
          status = 'error';
      }
      
      // Extract tags from metadata
      const tags: Record<string, string> = {};
      (instance.metadata.metadata?.items || []).forEach(item => {
        if (item.key && !item.key.startsWith('startup-script') && item.key !== 'ssh-keys') {
          tags[item.key] = item.value || '';
        }
      });
      
      // Get the creation timestamp
      const createdAt = new Date(instance.metadata.creationTimestamp);
      
      // Get the public IP address
      const publicIp = instance.metadata.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
      const privateIp = instance.metadata.networkInterfaces?.[0]?.networkIP;
      
      // Get instance type details for cost estimation
      const machineType = instance.metadata.machineType.split('/').pop() || 'e2-medium';
      const instanceTypes = await this.listAvailableInstanceTypes(this.region);
      const instanceTypeInfo = instanceTypes.find(type => type.name === machineType);
      
      // Get metrics
      const metrics = await this.getServerMetrics(serverId);
      
      // Create the server resource object
      const serverResource: ServerResource = {
        id: serverId,
        name: tags.name || serverId,
        cloudProviderId: this.config.id,
        provider: 'gcp',
        region: this.region,
        instanceType: machineType,
        publicIp,
        privateIp,
        status,
        createdAt,
        lastActiveAt: new Date(), // We don't have this info from GCP directly
        metrics,
        tags,
        cost: {
          hourlyRate: instanceTypeInfo?.hourlyPrice || 0.05,
          currentBilling: this.calculateCurrentBilling(createdAt, instanceTypeInfo?.hourlyPrice || 0.05)
        }
      };
      
      return serverResource;
    } catch (error) {
      console.error('Error getting GCP server status:', error);
      throw error;
    }
  }

  /**
   * Calculate the current billing amount for an instance
   */
  private calculateCurrentBilling(creationTime: Date, hourlyRate: number): number {
    const now = new Date();
    const runningHours = (now.getTime() - creationTime.getTime()) / (1000 * 60 * 60);
    return parseFloat((runningHours * hourlyRate).toFixed(4));
  }

  /**
   * List all GCP instances managed by Dokploy
   */
  async listServers(): Promise<ServerResource[]> {
    try {
      // Find instances with the Dokploy managed-by tag
      const [vms] = await this.compute.getVMs({
        filter: `metadata.items.key="managed_by" AND metadata.items.value="dokploy"`
      });
      
      // Convert to ServerResource objects
      const servers: ServerResource[] = [];
      
      for (const instance of vms) {
        // Extract tags from metadata
        const tags: Record<string, string> = {};
        (instance.metadata.metadata?.items || []).forEach(item => {
          if (item.key && !item.key.startsWith('startup-script') && item.key !== 'ssh-keys') {
            tags[item.key] = item.value || '';
          }
        });
        
        // Skip if no dokploy_id tag
        if (!tags.dokploy_id) continue;
        
        // Map GCP instance state to our status enum
        let status: ServerResource['status'] = 'error';
        switch (instance.metadata.status) {
          case 'PROVISIONING':
          case 'STAGING':
            status = 'provisioning';
            break;
          case 'RUNNING':
            status = 'running';
            break;
          case 'STOPPING':
          case 'SUSPENDED':
            status = 'stopped';
            break;
          case 'TERMINATED':
            status = 'terminated';
            break;
          default:
            status = 'error';
        }
        
        // Get the creation timestamp
        const createdAt = new Date(instance.metadata.creationTimestamp);
        
        // Get the public IP address
        const publicIp = instance.metadata.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP;
        const privateIp = instance.metadata.networkInterfaces?.[0]?.networkIP;
        
        // Get instance type details for cost estimation
        const machineType = instance.metadata.machineType.split('/').pop() || 'e2-medium';
        const instanceTypes = await this.listAvailableInstanceTypes(this.region);
        const instanceTypeInfo = instanceTypes.find(type => type.name === machineType);
        
        // Create the server resource object
        servers.push({
          id: tags.dokploy_id,
          name: tags.name || tags.dokploy_id,
          cloudProviderId: this.config.id,
          provider: 'gcp',
          region: this.region,
          instanceType: machineType,
          publicIp,
          privateIp,
          status,
          createdAt,
          lastActiveAt: new Date(), // We don't have this info from GCP directly
          tags,
          cost: {
            hourlyRate: instanceTypeInfo?.hourlyPrice || 0.05,
            currentBilling: this.calculateCurrentBilling(createdAt, instanceTypeInfo?.hourlyPrice || 0.05)
          }
        });
      }
      
      return servers;
    } catch (error) {
      console.error('Error listing GCP servers:', error);
      throw error;
    }
  }

  /**
   * Install Kubernetes on a GCP instance
   */
  async installKubernetes(serverId: string): Promise<{kubeconfig: string}> {
    try {
      // Get server details
      const server = await this.getServerStatus(serverId);
      if (server.status !== 'running') {
        throw new Error(`Server ${serverId} is not running`);
      }

      if (!server.publicIp) {
        throw new Error(`Server ${serverId} does not have a public IP`);
      }

      // Find the key pair
      const keyName = `dokploy-${serverId}`;
      const privateKeyPath = path.join(os.tmpdir(), `${keyName}`);
      
      // If the key doesn't exist locally, we can't proceed
      if (!fs.existsSync(privateKeyPath)) {
        throw new Error(`SSH key not found for server ${serverId}`);
      }

      // Install k3s (lightweight Kubernetes) via SSH
      const sshCommand = `ssh -o StrictHostKeyChecking=no -i ${privateKeyPath} dokploy@${server.publicIp}`;
      
      // Install k3s
      await execAsync(`${sshCommand} 'curl -sfL https://get.k3s.io | sudo sh -'`);
      
      // Wait for k3s to be ready
      await execAsync(`${sshCommand} 'sleep 30'`);
      
      // Get kubeconfig
      const kubeconfigResult = await execAsync(`${sshCommand} 'sudo cat /etc/rancher/k3s/k3s.yaml'`);
      
      // Replace localhost with the server's public IP
      let kubeconfig = kubeconfigResult.stdout;
      kubeconfig = kubeconfig.replace(/server: https:\/\/127.0.0.1:6443/g, `server: https://${server.publicIp}:6443`);
      
      return { kubeconfig };
    } catch (error) {
      console.error('Error installing Kubernetes on GCP server:', error);
      throw error;
    }
  }

  /**
   * Get resource metrics for a GCP instance
   */
  async getServerMetrics(serverId: string): Promise<ServerResource['metrics']> {
    try {
      // Find the instance by the Dokploy ID tag
      const [vms] = await this.compute.getVMs({
        filter: `metadata.items.key="dokploy_id" AND metadata.items.value="${serverId}"`
      });
      
      if (vms.length === 0) {
        throw new Error(`No instance found with Dokploy ID: ${serverId}`);
      }
      
      const instance = vms[0];
      const instanceId = instance.id;
      
      // Create a monitoring client
      const client = this.monitoring.metricServiceClient();
      
      // Set up the time range for metrics (last 5 minutes)
      const now = Date.now();
      const endTime = {
        seconds: Math.floor(now / 1000),
        nanos: (now % 1000) * 1e6,
      };
      const startTime = {
        seconds: Math.floor(now / 1000) - 300, // 5 minutes ago
        nanos: (now % 1000) * 1e6,
      };
      
      // Get CPU utilization
      const cpuRequest = {
        name: `projects/${this.projectId}`,
        filter: `metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.labels.instance_id="${instanceId}"`,
        interval: {
          startTime,
          endTime,
        },
      };
      
      // Get network metrics
      const networkInRequest = {
        name: `projects/${this.projectId}`,
        filter: `metric.type="compute.googleapis.com/instance/network/received_bytes_count" AND resource.labels.instance_id="${instanceId}"`,
        interval: {
          startTime,
          endTime,
        },
      };
      
      const networkOutRequest = {
        name: `projects/${this.projectId}`,
        filter: `metric.type="compute.googleapis.com/instance/network/sent_bytes_count" AND resource.labels.instance_id="${instanceId}"`,
        interval: {
          startTime,
          endTime,
        },
      };
      
      // Execute the requests
      const [cpuResponse] = await client.listTimeSeries(cpuRequest);
      const [networkInResponse] = await client.listTimeSeries(networkInRequest);
      const [networkOutResponse] = await client.listTimeSeries(networkOutRequest);
      
      // Extract the latest values
      let cpuUtilization = 0;
      if (cpuResponse.length > 0 && cpuResponse[0].points && cpuResponse[0].points.length > 0) {
        cpuUtilization = Number(cpuResponse[0].points[0].value.doubleValue) * 100;
      }
      
      let networkIn = 0;
      if (networkInResponse.length > 0 && networkInResponse[0].points && networkInResponse[0].points.length > 0) {
        networkIn = Number(networkInResponse[0].points[0].value.doubleValue);
      }
      
      let networkOut = 0;
      if (networkOutResponse.length > 0 && networkOutResponse[0].points && networkOutResponse[0].points.length > 0) {
        networkOut = Number(networkOutResponse[0].points[0].value.doubleValue);
      }
      
      // Memory utilization is not directly available from GCP Monitoring for instances
      // We'll estimate it based on CPU utilization for now
      const memoryUtilization = Math.min(cpuUtilization * 0.8, 100); // Simple estimation
      
      return {
        cpuUtilization,
        memoryUtilization,
        networkIn,
        networkOut
      };
    } catch (error) {
      console.error('Error getting GCP server metrics:', error);
      // Return default metrics instead of throwing
      return {
        cpuUtilization: 0,
        memoryUtilization: 0,
        networkIn: 0,
        networkOut: 0
      };
    }
  }
} 