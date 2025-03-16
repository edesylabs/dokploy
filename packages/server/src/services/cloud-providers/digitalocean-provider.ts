import axios from 'axios';
import { CloudProviderService, InstanceTypeInfo, RegionInfo, ServerProvisioningRequest, ServerResource } from './types';
import { logger } from '@dokploy/server/utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export class DigitalOceanCloudProvider implements CloudProviderService {
  private apiToken: string;
  private apiBaseUrl: string = 'https://api.digitalocean.com/v2';
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
    
    // Extract API token
    const { apiToken } = config.credentials;
    
    if (!apiToken) {
      throw new Error('DigitalOcean credentials must include apiToken');
    }
    
    this.apiToken = apiToken;
    
    logger.info(`Initialized DigitalOcean cloud provider: ${config.name} (${config.id})`);
  }

  /**
   * Make an authenticated API request to DigitalOcean
   */
  private async apiRequest<T>(method: string, path: string, data?: any): Promise<T> {
    try {
      const response = await axios({
        method,
        url: `${this.apiBaseUrl}${path}`,
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        data,
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error(`DigitalOcean API error (${error.response.status}):`, error.response.data);
        throw new Error(`DigitalOcean API error: ${JSON.stringify(error.response.data)}`);
      }
      
      logger.error('DigitalOcean API request failed:', error);
      throw new Error(`DigitalOcean API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available DigitalOcean regions
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    try {
      logger.info('Listing available DigitalOcean regions');
      
      const response = await this.apiRequest<{ regions: any[] }>('GET', '/regions');
      
      return response.regions
        .filter(region => region.available)
        .map(region => ({
          id: region.slug,
          name: region.name,
          description: this.getRegionLocation(region.name),
          zones: undefined, // DigitalOcean doesn't have availability zones in the same way as AWS/GCP
        }));
    } catch (error) {
      logger.error('Error listing DigitalOcean regions:', error);
      throw new Error(`Failed to list DigitalOcean regions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a human-readable location for a region
   */
  private getRegionLocation(regionName: string): string {
    // DigitalOcean region names are already descriptive
    return regionName;
  }

  /**
   * List available instance types (droplet sizes) in a region
   */
  async listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]> {
    try {
      logger.info(`Listing available DigitalOcean droplet sizes in ${region}`);
      
      const response = await this.apiRequest<{ sizes: any[] }>('GET', '/sizes');
      
      return response.sizes
        .filter(size => size.available && size.regions.includes(region))
        .map(size => {
          return {
            name: size.slug,
            description: `${size.slug} (${size.vcpus} vCPU, ${size.memory / 1024} GB RAM, ${size.disk} GB SSD)`,
            cpuCount: size.vcpus,
            memoryGb: size.memory / 1024,
            hourlyPrice: size.price_hourly,
          };
        });
    } catch (error) {
      logger.error(`Error listing DigitalOcean droplet sizes in ${region}:`, error);
      throw new Error(`Failed to list DigitalOcean droplet sizes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Provision a new server (droplet)
   */
  async provisionServer(request: ServerProvisioningRequest): Promise<ServerResource> {
    try {
      logger.info(`Provisioning DigitalOcean droplet: ${request.name}`);
      
      // Generate SSH key pair
      const sshKeyName = `dokploy-${request.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const sshKeyPair = await this.generateSshKeyPair(sshKeyName);
      
      // Register SSH key with DigitalOcean
      const sshKeyResponse = await this.apiRequest<{ ssh_key: { id: number } }>('POST', '/account/keys', {
        name: sshKeyName,
        public_key: sshKeyPair.publicKey,
      });
      
      // Determine droplet size (instance type)
      const size = request.instanceType || this.config.defaultInstanceType || 's-1vcpu-1gb';
      
      // Prepare tags
      const tags = this.getTags(request.tags);
      const tagsList = Object.entries(tags).map(([key, value]) => `${key}:${value}`);
      
      // Create droplet
      const dropletResponse = await this.apiRequest<{ droplet: any }>('POST', '/droplets', {
        name: request.name,
        region: this.config.region,
        size,
        image: 'ubuntu-20-04-x64',
        ssh_keys: [sshKeyResponse.ssh_key.id],
        backups: false,
        ipv6: true,
        monitoring: true,
        tags: tagsList,
        user_data: null,
        volumes: null,
        vpc_uuid: null,
      });
      
      const dropletId = dropletResponse.droplet.id;
      
      // Wait for droplet to be active and get its details
      let droplet = dropletResponse.droplet;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (droplet.status !== 'active' && attempts < maxAttempts) {
        logger.info(`Waiting for droplet ${dropletId} to be active (status: ${droplet.status})...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        const response = await this.apiRequest<{ droplet: any }>('GET', `/droplets/${dropletId}`);
        droplet = response.droplet;
        attempts++;
      }
      
      if (droplet.status !== 'active') {
        throw new Error(`Droplet ${dropletId} did not become active after ${maxAttempts} attempts`);
      }
      
      // Get IP addresses
      const publicIp = droplet.networks.v4.find((network: any) => network.type === 'public')?.ip_address;
      const privateIp = droplet.networks.v4.find((network: any) => network.type === 'private')?.ip_address;
      
      // Calculate hourly rate
      const hourlyRate = droplet.size.price_hourly || 0;
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: dropletId.toString(),
        name: request.name,
        cloudProviderId: this.config.id,
        provider: 'digitalocean',
        region: this.config.region,
        instanceType: size,
        status: this.mapDropletStatusToServerStatus(droplet.status),
        publicIp,
        privateIp,
        createdAt: new Date(droplet.created_at),
        lastActiveAt: new Date(),
        tags,
        cost: {
          hourlyRate,
          currentBilling: 0,
        },
        sshKeyPath: sshKeyPair.privateKeyPath,
      };
      
      logger.info(`DigitalOcean droplet provisioned successfully: ${dropletId}`);
      
      return serverResource;
    } catch (error) {
      logger.error(`Error provisioning DigitalOcean droplet:`, error);
      throw new Error(`Failed to provision DigitalOcean droplet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate SSH key pair for droplet access
   */
  private async generateSshKeyPair(keyName: string): Promise<{ publicKey: string; privateKeyPath: string }> {
    try {
      // Create .ssh directory if it doesn't exist
      const sshDir = path.join(os.homedir(), '.ssh', 'dokploy');
      if (!fs.existsSync(sshDir)) {
        fs.mkdirSync(sshDir, { recursive: true });
      }
      
      // Generate key file paths
      const privateKeyPath = path.join(sshDir, keyName);
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
   * Map DigitalOcean droplet status to server status
   */
  private mapDropletStatusToServerStatus(dropletStatus: string): string {
    switch (dropletStatus) {
      case 'new':
      case 'pending':
        return 'provisioning';
      case 'active':
        return 'running';
      case 'off':
        return 'stopped';
      case 'archive':
        return 'terminated';
      default:
        return 'unknown';
    }
  }

  /**
   * Terminate a server (droplet)
   */
  async terminateServer(serverId: string): Promise<boolean> {
    try {
      logger.info(`Terminating DigitalOcean droplet: ${serverId}`);
      
      // Delete the droplet
      await this.apiRequest('DELETE', `/droplets/${serverId}`);
      
      logger.info(`DigitalOcean droplet terminated successfully: ${serverId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error terminating DigitalOcean droplet:`, error);
      throw new Error(`Failed to terminate DigitalOcean droplet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server (droplet) status
   */
  async getServerStatus(serverId: string): Promise<ServerResource> {
    try {
      logger.info(`Getting status for DigitalOcean droplet: ${serverId}`);
      
      // Get droplet details
      const response = await this.apiRequest<{ droplet: any }>('GET', `/droplets/${serverId}`);
      const droplet = response.droplet;
      
      // Get IP addresses
      const publicIp = droplet.networks.v4.find((network: any) => network.type === 'public')?.ip_address;
      const privateIp = droplet.networks.v4.find((network: any) => network.type === 'private')?.ip_address;
      
      // Get metrics
      const metrics = await this.getServerMetrics(serverId);
      
      // Calculate current billing
      const creationTime = new Date(droplet.created_at);
      const hourlyRate = droplet.size.price_hourly || 0;
      const currentBilling = this.calculateCurrentBilling(creationTime, hourlyRate);
      
      // Extract tags
      const tags: Record<string, string> = {};
      if (droplet.tags && Array.isArray(droplet.tags)) {
        droplet.tags.forEach((tag: string) => {
          const parts = tag.split(':');
          if (parts.length === 2) {
            tags[parts[0]] = parts[1];
          }
        });
      }
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: serverId,
        name: droplet.name,
        cloudProviderId: this.config.id,
        provider: 'digitalocean',
        region: droplet.region.slug,
        instanceType: droplet.size.slug,
        status: this.mapDropletStatusToServerStatus(droplet.status),
        publicIp,
        privateIp,
        createdAt: new Date(droplet.created_at),
        lastActiveAt: new Date(),
        tags,
        cost: {
          hourlyRate,
          currentBilling,
        },
        metrics,
      };
      
      return serverResource;
    } catch (error) {
      logger.error(`Error getting DigitalOcean droplet status:`, error);
      throw new Error(`Failed to get DigitalOcean droplet status: ${error instanceof Error ? error.message : String(error)}`);
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
   * List all servers (droplets)
   */
  async listServers(): Promise<ServerResource[]> {
    try {
      logger.info('Listing DigitalOcean droplets');
      
      // Get all droplets
      const response = await this.apiRequest<{ droplets: any[] }>('GET', '/droplets');
      
      // Filter droplets by tag to find those managed by this provider
      const managedDroplets = response.droplets.filter(droplet => {
        return droplet.tags && droplet.tags.includes(`managed-by:dokploy`) && 
               droplet.tags.includes(`provider-id:${this.config.id}`);
      });
      
      // Map droplets to server resources
      const serverResources: ServerResource[] = [];
      
      for (const droplet of managedDroplets) {
        try {
          const serverResource = await this.getServerStatus(droplet.id.toString());
          serverResources.push(serverResource);
        } catch (error) {
          logger.error(`Error getting status for droplet ${droplet.id}:`, error);
        }
      }
      
      return serverResources;
    } catch (error) {
      logger.error(`Error listing DigitalOcean droplets:`, error);
      throw new Error(`Failed to list DigitalOcean droplets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Install Kubernetes on a server (droplet) as a master node
   */
  async installKubernetes(serverId: string): Promise<{kubeconfig: string, joinToken: string}> {
    try {
      logger.info(`Installing Kubernetes on DigitalOcean droplet: ${serverId}`);
      
      // Get server details
      const server = await this.getServerStatus(serverId);
      
      if (server.status !== 'running') {
        throw new Error(`Server must be in running state to install Kubernetes. Current state: ${server.status}`);
      }
      
      if (!server.publicIp) {
        throw new Error('Server must have a public IP address to install Kubernetes');
      }
      
      // Find SSH key path
      const sshKeyPath = path.join(os.homedir(), '.ssh', 'dokploy', `dokploy-${server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
      
      if (!fs.existsSync(sshKeyPath)) {
        throw new Error(`SSH key not found at ${sshKeyPath}`);
      }
      
      // Install Kubernetes using k3s
      const installScript = `
        set -e
        export INSTALL_K3S_EXEC="--disable=traefik --node-name=master --advertise-address=${server.publicIp} --tls-san=${server.publicIp}"
        curl -sfL https://get.k3s.io | sh -
        sudo kubectl -n kube-system wait --for=condition=available --timeout=600s deployment/coredns
        sudo cat /etc/rancher/k3s/k3s.yaml
        echo "---TOKEN---"
        sudo cat /var/lib/rancher/k3s/server/node-token
      `;
      
      logger.info(`Running Kubernetes installation script on ${server.publicIp}`);
      
      const { stdout } = await execAsync(`
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${sshKeyPath} root@${server.publicIp} '${installScript}'
      `);
      
      // Extract kubeconfig and join token from output
      const [kubeconfig, joinToken] = stdout.split('---TOKEN---').map(s => s.trim());
      
      // Replace localhost with server IP
      const updatedKubeconfig = kubeconfig.replace(/server: https:\/\/127.0.0.1:6443/g, `server: https://${server.publicIp}:6443`);
      
      logger.info(`Kubernetes installed successfully on ${serverId}`);
      
      return { 
        kubeconfig: updatedKubeconfig,
        joinToken
      };
    } catch (error) {
      logger.error(`Error installing Kubernetes on DigitalOcean droplet:`, error);
      throw new Error(`Failed to install Kubernetes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Add a worker node to an existing Kubernetes cluster
   */
  async addKubernetesWorkerNode(
    serverId: string, 
    masterNodeIp: string, 
    joinToken: string
  ): Promise<boolean> {
    try {
      logger.info(`Adding worker node ${serverId} to Kubernetes cluster with master ${masterNodeIp}`);
      
      // Get server details
      const server = await this.getServerStatus(serverId);
      
      if (server.status !== 'running') {
        throw new Error(`Server must be in running state to join Kubernetes cluster. Current state: ${server.status}`);
      }
      
      if (!server.publicIp) {
        throw new Error('Server must have a public IP address to join Kubernetes cluster');
      }
      
      // Find SSH key path
      const sshKeyPath = path.join(os.homedir(), '.ssh', 'dokploy', `dokploy-${server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`);
      
      if (!fs.existsSync(sshKeyPath)) {
        throw new Error(`SSH key not found at ${sshKeyPath}`);
      }
      
      // Join the Kubernetes cluster as a worker node
      const joinScript = `
        set -e
        export K3S_URL="https://${masterNodeIp}:6443"
        export K3S_TOKEN="${joinToken}"
        export INSTALL_K3S_EXEC="--node-name=${server.name}"
        curl -sfL https://get.k3s.io | sh -
      `;
      
      logger.info(`Running Kubernetes join script on ${server.publicIp}`);
      
      await execAsync(`
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${sshKeyPath} root@${server.publicIp} '${joinScript}'
      `);
      
      logger.info(`Worker node ${serverId} joined Kubernetes cluster successfully`);
      
      return true;
    } catch (error) {
      logger.error(`Error adding worker node to Kubernetes cluster:`, error);
      throw new Error(`Failed to add worker node: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server (droplet) metrics
   */
  async getServerMetrics(serverId: string): Promise<ServerResource['metrics']> {
    try {
      logger.info(`Getting metrics for DigitalOcean droplet: ${serverId}`);
      
      // DigitalOcean provides metrics through their Monitoring API
      // For simplicity, we'll return default values here
      // In a production environment, you would use the DigitalOcean Monitoring API
      
      return {
        cpuUtilization: 0, // Default value
        networkIn: 0,      // Default value
        networkOut: 0,     // Default value
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error(`Error getting DigitalOcean droplet metrics:`, error);
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
    
    // Add provider-id tag
    combinedTags['provider-id'] = this.config.id;
    
    return combinedTags;
  }
} 