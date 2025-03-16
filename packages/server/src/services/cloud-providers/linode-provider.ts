import axios from 'axios';
import { CloudProviderService, InstanceTypeInfo, RegionInfo, ServerProvisioningRequest, ServerResource } from './types';
import { logger } from '@dokploy/server/utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export class LinodeCloudProvider implements CloudProviderService {
  private apiToken: string;
  private apiBaseUrl: string = 'https://api.linode.com/v4';
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
      throw new Error('Linode credentials must include apiToken');
    }
    
    this.apiToken = apiToken;
    
    logger.info(`Initialized Linode cloud provider: ${config.name} (${config.id})`);
  }

  /**
   * Make an authenticated API request to Linode
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
        logger.error(`Linode API error (${error.response.status}):`, error.response.data);
        throw new Error(`Linode API error: ${JSON.stringify(error.response.data)}`);
      }
      
      logger.error('Linode API request failed:', error);
      throw new Error(`Linode API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available Linode regions
   */
  async listAvailableRegions(): Promise<RegionInfo[]> {
    try {
      logger.info('Listing available Linode regions');
      
      const response = await this.apiRequest<{ data: any[] }>('GET', '/regions');
      
      return response.data
        .filter(region => region.status === 'ok')
        .map(region => ({
          id: region.id,
          name: region.id,
          description: region.country.toUpperCase(),
          zones: undefined,
        }));
    } catch (error) {
      logger.error('Error listing Linode regions:', error);
      throw new Error(`Failed to list Linode regions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List available instance types (Linode plans) in a region
   */
  async listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]> {
    try {
      logger.info(`Listing available Linode types in ${region}`);
      
      const response = await this.apiRequest<{ data: any[] }>('GET', '/linode/types');
      
      return response.data.map(type => {
        return {
          name: type.id,
          description: `${type.id} (${type.vcpus} vCPU, ${type.memory / 1024} GB RAM, ${type.disk} GB SSD)`,
          cpuCount: type.vcpus,
          memoryGb: type.memory / 1024,
          hourlyPrice: type.price.hourly,
        };
      });
    } catch (error) {
      logger.error(`Error listing Linode types in ${region}:`, error);
      throw new Error(`Failed to list Linode types: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Provision a new server (Linode)
   */
  async provisionServer(request: ServerProvisioningRequest): Promise<ServerResource> {
    try {
      logger.info(`Provisioning Linode: ${request.name}`);
      
      // Generate SSH key pair
      const sshKeyName = `dokploy-${request.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const sshKeyPair = await this.generateSshKeyPair(sshKeyName);
      
      // Determine Linode type (instance type)
      const type = request.instanceType || this.config.defaultInstanceType || 'g6-nanode-1';
      
      // Prepare tags
      const tags = this.getTags(request.tags);
      const tagsList = Object.keys(tags).map(key => `${key}:${tags[key]}`);
      
      // Create Linode
      const linodeResponse = await this.apiRequest<any>('POST', '/linode/instances', {
        label: request.name,
        region: this.config.region,
        type,
        image: 'linode/ubuntu20.04',
        root_pass: this.generateRandomPassword(),
        authorized_keys: [sshKeyPair.publicKey],
        booted: true,
        backups_enabled: false,
        private_ip: true,
        tags: tagsList,
      });
      
      const linodeId = linodeResponse.id;
      
      // Wait for Linode to be running
      let linode = linodeResponse;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (linode.status !== 'running' && attempts < maxAttempts) {
        logger.info(`Waiting for Linode ${linodeId} to be running (status: ${linode.status})...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        const response = await this.apiRequest<any>('GET', `/linode/instances/${linodeId}`);
        linode = response;
        attempts++;
      }
      
      if (linode.status !== 'running') {
        throw new Error(`Linode ${linodeId} did not become running after ${maxAttempts} attempts`);
      }
      
      // Get IP addresses
      const publicIp = linode.ipv4.find((ip: string) => !this.isPrivateIp(ip));
      const privateIp = linode.ipv4.find((ip: string) => this.isPrivateIp(ip));
      
      // Calculate hourly rate
      const hourlyRate = linode.type ? linode.type.price.hourly : 0;
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: linodeId.toString(),
        name: request.name,
        cloudProviderId: this.config.id,
        provider: 'linode',
        region: this.config.region,
        instanceType: type,
        status: this.mapLinodeStatusToServerStatus(linode.status),
        publicIp,
        privateIp,
        createdAt: new Date(linode.created),
        lastActiveAt: new Date(),
        tags,
        cost: {
          hourlyRate,
          currentBilling: 0,
        },
        sshKeyPath: sshKeyPair.privateKeyPath,
      };
      
      logger.info(`Linode provisioned successfully: ${linodeId}`);
      
      return serverResource;
    } catch (error) {
      logger.error(`Error provisioning Linode:`, error);
      throw new Error(`Failed to provision Linode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a random password for Linode root user
   */
  private generateRandomPassword(): string {
    const length = 32;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }
    
    return password;
  }

  /**
   * Check if an IP address is private
   */
  private isPrivateIp(ip: string): boolean {
    return ip.startsWith('10.') || 
           ip.startsWith('172.16.') || 
           ip.startsWith('172.17.') || 
           ip.startsWith('172.18.') || 
           ip.startsWith('172.19.') || 
           ip.startsWith('172.20.') || 
           ip.startsWith('172.21.') || 
           ip.startsWith('172.22.') || 
           ip.startsWith('172.23.') || 
           ip.startsWith('172.24.') || 
           ip.startsWith('172.25.') || 
           ip.startsWith('172.26.') || 
           ip.startsWith('172.27.') || 
           ip.startsWith('172.28.') || 
           ip.startsWith('172.29.') || 
           ip.startsWith('172.30.') || 
           ip.startsWith('172.31.') || 
           ip.startsWith('192.168.');
  }

  /**
   * Generate SSH key pair for Linode access
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
   * Map Linode status to server status
   */
  private mapLinodeStatusToServerStatus(linodeStatus: string): string {
    switch (linodeStatus) {
      case 'provisioning':
      case 'booting':
      case 'migrating':
        return 'provisioning';
      case 'running':
        return 'running';
      case 'offline':
      case 'shutting_down':
      case 'stopped':
        return 'stopped';
      case 'deleting':
        return 'terminated';
      case 'rebuilding':
      case 'cloning':
      case 'restoring':
      case 'resizing':
        return 'provisioning';
      default:
        return 'unknown';
    }
  }

  /**
   * Terminate a server (Linode)
   */
  async terminateServer(serverId: string): Promise<boolean> {
    try {
      logger.info(`Terminating Linode: ${serverId}`);
      
      // Delete the Linode
      await this.apiRequest('DELETE', `/linode/instances/${serverId}`);
      
      logger.info(`Linode terminated successfully: ${serverId}`);
      
      return true;
    } catch (error) {
      logger.error(`Error terminating Linode:`, error);
      throw new Error(`Failed to terminate Linode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server (Linode) status
   */
  async getServerStatus(serverId: string): Promise<ServerResource> {
    try {
      logger.info(`Getting status for Linode: ${serverId}`);
      
      // Get Linode details
      const linode = await this.apiRequest<any>('GET', `/linode/instances/${serverId}`);
      
      // Get IP addresses
      const publicIp = linode.ipv4.find((ip: string) => !this.isPrivateIp(ip));
      const privateIp = linode.ipv4.find((ip: string) => this.isPrivateIp(ip));
      
      // Get metrics
      const metrics = await this.getServerMetrics(serverId);
      
      // Calculate current billing
      const creationTime = new Date(linode.created);
      const hourlyRate = linode.type ? linode.type.price.hourly : 0;
      const currentBilling = this.calculateCurrentBilling(creationTime, hourlyRate);
      
      // Extract tags
      const tags: Record<string, string> = {};
      if (linode.tags && Array.isArray(linode.tags)) {
        linode.tags.forEach((tag: string) => {
          const parts = tag.split(':');
          if (parts.length === 2) {
            tags[parts[0]] = parts[1];
          }
        });
      }
      
      // Create server resource object
      const serverResource: ServerResource = {
        id: serverId,
        name: linode.label,
        cloudProviderId: this.config.id,
        provider: 'linode',
        region: linode.region,
        instanceType: linode.type ? linode.type.id : '',
        status: this.mapLinodeStatusToServerStatus(linode.status),
        publicIp,
        privateIp,
        createdAt: new Date(linode.created),
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
      logger.error(`Error getting Linode status:`, error);
      throw new Error(`Failed to get Linode status: ${error instanceof Error ? error.message : String(error)}`);
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
   * List all servers (Linodes)
   */
  async listServers(): Promise<ServerResource[]> {
    try {
      logger.info('Listing Linodes');
      
      // Get all Linodes
      const response = await this.apiRequest<{ data: any[] }>('GET', '/linode/instances');
      
      // Filter Linodes by tag to find those managed by this provider
      const managedLinodes = response.data.filter(linode => {
        return linode.tags && 
               linode.tags.includes(`managed-by:dokploy`) && 
               linode.tags.includes(`provider-id:${this.config.id}`);
      });
      
      // Map Linodes to server resources
      const serverResources: ServerResource[] = [];
      
      for (const linode of managedLinodes) {
        try {
          const serverResource = await this.getServerStatus(linode.id.toString());
          serverResources.push(serverResource);
        } catch (error) {
          logger.error(`Error getting status for Linode ${linode.id}:`, error);
        }
      }
      
      return serverResources;
    } catch (error) {
      logger.error(`Error listing Linodes:`, error);
      throw new Error(`Failed to list Linodes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Install Kubernetes on a server (Linode)
   */
  async installKubernetes(serverId: string): Promise<{ kubeconfig: string }> {
    try {
      logger.info(`Installing Kubernetes on Linode: ${serverId}`);
      
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
      logger.error(`Error installing Kubernetes on Linode:`, error);
      throw new Error(`Failed to install Kubernetes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get server (Linode) metrics
   */
  async getServerMetrics(serverId: string): Promise<ServerResource['metrics']> {
    try {
      logger.info(`Getting metrics for Linode: ${serverId}`);
      
      // Linode provides metrics through their API, but for simplicity we'll return default values
      // In a production environment, you would use the Linode Stats API endpoints
      
      return {
        cpuUtilization: 0, // Default value
        networkIn: 0,      // Default value
        networkOut: 0,     // Default value
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error(`Error getting Linode metrics:`, error);
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