import axios from 'axios';
import { CloudProviderService, InstanceTypeInfo, RegionInfo, ServerProvisioningRequest, ServerResource } from './types';
import { logger } from '@dokploy/server/utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export class HetznerCloudProvider implements CloudProviderService {
  private apiToken: string;
  private apiBaseUrl: string = 'https://api.hetzner.cloud/v1';
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
      throw new Error('Hetzner credentials must include apiToken');
    }
    
    this.apiToken = apiToken;
    
    logger.info(`Initialized Hetzner cloud provider: ${config.name} (${config.id})`);
  }

  /**
   * Make an authenticated API request to Hetzner
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
        logger.error(`Hetzner API error (${error.response.status}):`, error.response.data);
        throw new Error(`Hetzner API error: ${JSON.stringify(error.response.data)}`);
      }
      
      logger.error('Hetzner API request failed:', error);
      throw new Error(`Hetzner API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available Hetzner regions (locations)
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    try {
      logger.info('Listing available Hetzner locations');
      
      const response = await this.apiRequest<{ locations: any[] }>('GET', '/locations');
      
      return response.locations.map(location => ({
        id: location.name,
        name: location.name,
        description: location.description,
        zones: undefined,
      }));
    } catch (error) {
      logger.error('Error listing Hetzner locations:', error);
      throw new Error(`Failed to list Hetzner locations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available instance types (server types) in a region
   */
  async listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]> {
    try {
      logger.info(`Listing available Hetzner server types in ${region}`);
      
      const response = await this.apiRequest<{ server_types: any[] }>('GET', '/server_types');
      
      return response.server_types.map(type => {
        // Calculate hourly price (Hetzner prices are monthly, divide by 730 hours in a month)
        const hourlyPrice = type.prices[0]?.price_monthly ? type.prices[0].price_monthly / 730 : 0;
        
        return {
          name: type.name,
          description: `${type.name} (${type.cores} vCPU, ${type.memory} GB RAM, ${type.disk} GB SSD)`,
          cpuCount: type.cores,
          memoryGb: type.memory,
          hourlyPrice: hourlyPrice,
        };
      });
    } catch (error) {
      logger.error(`Error listing Hetzner server types in ${region}:`, error);
      throw new Error(`Failed to list Hetzner server types: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Provision a new server
   */
  async provisionServer(request: ServerProvisioningRequest): Promise<ServerResource> {
    try {
      logger.info(`Provisioning Hetzner server: ${request.name}`);
      
      // Generate SSH key pair
      const sshKeyName = `dokploy-${request.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const sshKeyPair = await this.generateSshKeyPair(sshKeyName);
      
      // Register SSH key with Hetzner
      const sshKeyResponse = await this.apiRequest<{ ssh_key: { id: number } }>('POST', '/ssh_keys', {
        name: sshKeyName,
        public_key: sshKeyPair.publicKey,
      });
      
      // Determine server type (instance type)
      const serverType = request.instanceType || this.config.defaultInstanceType || 'cx11';
      
      // Prepare labels (tags)
      const labels = this.getTags(request.tags);
      
      // Create server
      const serverResponse = await this.apiRequest<{ server: any }>('POST', '/servers', {
        name: request.name,
        server_type: serverType,
        location: this.config.region,
        image: 'ubuntu-20.04',
        ssh_keys: [sshKeyResponse.ssh_key.id],
        start_after_create: true,
        labels,
      });
      
      const serverId = serverResponse.server.id;
      
      // Wait for server to be running
      let server = serverResponse.server;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (server.status !== 'running' && attempts < maxAttempts) {
        logger.info(`Waiting for server ${serverId} to be running (status: ${server.status})...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        const response = await this.apiRequest<{ server: any }>('GET', `/servers/${serverId}`);
        server = response.server;
        attempts++;
      }
      
      if (server.status !== 'running') {
        throw new Error(`Server ${serverId} did not become running after ${maxAttempts} attempts`);
      }
      
      // Get IP addresses
      const publicIp = server.public_net.ipv4.ip;
      const privateIp = server.private_net?.[0]?.ip;
      
      // Calculate hourly rate
      const hourlyRate = this.getHourlyRate(serverType);
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: serverId.toString(),
        name: request.name,
        cloudProviderId: this.config.id,
        provider: 'hetzner',
        region: this.config.region,
        instanceType: serverType,
        status: this.mapServerStatusToServerStatus(server.status),
        publicIp,
        privateIp,
        createdAt: new Date(server.created),
        lastActiveAt: new Date(),
        tags: labels,
        cost: {
          hourlyRate,
          currentBilling: 0,
        },
        sshKeyPath: sshKeyPair.privateKeyPath,
      };
      
      logger.info(`Hetzner server provisioned successfully: ${serverId}`);
      
      return serverResource;
    } catch (error) {
      logger.error(`Error provisioning Hetzner server:`, error);
      throw new Error(`Failed to provision Hetzner server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get hourly rate for a server type
   */
  private getHourlyRate(serverType: string): number {
    // Approximate hourly rates for Hetzner server types (as of 2023)
    // These should be replaced with actual API calls to get current pricing
    const hourlyRates: Record<string, number> = {
      'cx11': 0.007, // ~€5/month
      'cx21': 0.014, // ~€10/month
      'cx31': 0.027, // ~€20/month
      'cx41': 0.041, // ~€30/month
      'cx51': 0.068, // ~€50/month
      'ccx11': 0.014, // ~€10/month
      'ccx21': 0.027, // ~€20/month
      'ccx31': 0.055, // ~€40/month
      'ccx41': 0.082, // ~€60/month
      'ccx51': 0.137, // ~€100/month
    };
    
    return hourlyRates[serverType] || 0.01; // Default to €0.01/hour if unknown
  }

  /**
   * Generate SSH key pair for server access
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
   * Map Hetzner server status to server status
   */
  private mapServerStatusToServerStatus(serverStatus: string): string {
    switch (serverStatus) {
      case 'initializing':
      case 'starting':
        return 'provisioning';
      case 'running':
        return 'running';
      case 'stopping':
      case 'off':
        return 'stopped';
      case 'deleting':
        return 'terminated';
      case 'rebuilding':
      case 'migrating':
        return 'provisioning';
      default:
        return 'unknown';
    }
  }

  /**
   * Terminate a server
   */
  async terminateServer(serverId: string): Promise<boolean> {
    try {
      logger.info(`Terminating Hetzner server: ${serverId}`);
      
      // Delete the server
      await this.apiRequest('DELETE', `/servers/${serverId}`);
      
      logger.info(`Hetzner server terminated successfully: ${serverId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error terminating Hetzner server:`, error);
      throw new Error(`Failed to terminate Hetzner server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server status
   */
  async getServerStatus(serverId: string): Promise<ServerResource> {
    try {
      logger.info(`Getting status for Hetzner server: ${serverId}`);
      
      // Get server details
      const response = await this.apiRequest<{ server: any }>('GET', `/servers/${serverId}`);
      const server = response.server;
      
      // Get IP addresses
      const publicIp = server.public_net.ipv4.ip;
      const privateIp = server.private_net?.[0]?.ip;
      
      // Get metrics
      const metrics = await this.getServerMetrics(serverId);
      
      // Calculate current billing
      const creationTime = new Date(server.created);
      const hourlyRate = this.getHourlyRate(server.server_type.name);
      const currentBilling = this.calculateCurrentBilling(creationTime, hourlyRate);
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: serverId,
        name: server.name,
        cloudProviderId: this.config.id,
        provider: 'hetzner',
        region: server.datacenter.location.name,
        instanceType: server.server_type.name,
        status: this.mapServerStatusToServerStatus(server.status),
        publicIp,
        privateIp,
        createdAt: new Date(server.created),
        lastActiveAt: new Date(),
        tags: server.labels || {},
        cost: {
          hourlyRate,
          currentBilling,
        },
        metrics,
      };
      
      return serverResource;
    } catch (error) {
      logger.error(`Error getting Hetzner server status:`, error);
      throw new Error(`Failed to get Hetzner server status: ${error instanceof Error ? error.message : String(error)}`);
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
      logger.info('Listing Hetzner servers');
      
      // Get all servers
      const response = await this.apiRequest<{ servers: any[] }>('GET', '/servers');
      
      // Filter servers by label to find those managed by this provider
      const managedServers = response.servers.filter(server => {
        return server.labels && 
               server.labels['managed-by'] === 'dokploy' && 
               server.labels['provider-id'] === this.config.id;
      });
      
      // Map servers to server resources
      const serverResources: ServerResource[] = [];
      
      for (const server of managedServers) {
        try {
          const serverResource = await this.getServerStatus(server.id.toString());
          serverResources.push(serverResource);
        } catch (error) {
          logger.error(`Error getting status for server ${server.id}:`, error);
        }
      }
      
      return serverResources;
    } catch (error) {
      logger.error(`Error listing Hetzner servers:`, error);
      throw new Error(`Failed to list Hetzner servers: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Install Kubernetes on a server
   */
  async installKubernetes(serverId: string): Promise<{ kubeconfig: string }> {
    try {
      logger.info(`Installing Kubernetes on Hetzner server: ${serverId}`);
      
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
        export INSTALL_K3S_EXEC="--disable=traefik"
        curl -sfL https://get.k3s.io | sh -
        sudo kubectl -n kube-system wait --for=condition=available --timeout=600s deployment/coredns
        sudo cat /etc/rancher/k3s/k3s.yaml
      `;
      
      logger.info(`Running Kubernetes installation script on ${server.publicIp}`);
      
      const { stdout } = await execAsync(`
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${sshKeyPath} root@${server.publicIp} '${installScript}'
      `);
      
      // Extract kubeconfig from output
      const kubeconfig = stdout.trim();
      
      // Replace localhost with server IP
      const updatedKubeconfig = kubeconfig.replace(/server: https:\/\/127.0.0.1:6443/g, `server: https://${server.publicIp}:6443`);
      
      logger.info(`Kubernetes installed successfully on ${serverId}`);
      
      return { kubeconfig: updatedKubeconfig };
    } catch (error) {
      logger.error(`Error installing Kubernetes on Hetzner server:`, error);
      throw new Error(`Failed to install Kubernetes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server metrics
   */
  async getServerMetrics(serverId: string): Promise<ServerResource['metrics']> {
    try {
      logger.info(`Getting metrics for Hetzner server: ${serverId}`);
      
      // Hetzner doesn't provide a direct metrics API
      // For simplicity, we'll return default values here
      // In a production environment, you would use the Hetzner Cloud Monitoring API or install a monitoring agent
      
      return {
        cpuUtilization: 0, // Default value
        networkIn: 0,      // Default value
        networkOut: 0,     // Default value
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error(`Error getting Hetzner server metrics:`, error);
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