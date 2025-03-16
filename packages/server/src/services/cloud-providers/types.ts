/**
 * Cloud Provider Integration Types
 * 
 * This file defines the interfaces and types for the cloud provider integration layer.
 * It provides a unified abstraction for working with different cloud providers (AWS, GCP, Azure, etc.)
 */

/**
 * Configuration for a cloud provider
 */
export interface CloudProviderConfig {
  id: string;
  name: string;
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'linode' | 'hetzner';
  credentials: Record<string, string>;
  region: string;
  defaultInstanceType?: string;
  tags?: Record<string, string>;
}

/**
 * Request to provision a new server
 */
export interface ServerProvisioningRequest {
  name: string;
  cloudProviderId: string;
  instanceType?: string;
  diskSize?: number; // GB
  memory?: number; // GB
  cpuCount?: number;
  tags?: Record<string, string>;
  autoDelete?: {
    enabled: boolean;
    idleThreshold?: number; // minutes
    maxLifetime?: number; // minutes
  };
}

/**
 * Represents a server resource
 */
export interface ServerResource {
  id: string;
  name: string;
  cloudProviderId: string;
  provider: string;
  region: string;
  instanceType: string;
  publicIp?: string;
  privateIp?: string;
  status: 'provisioning' | 'running' | 'stopped' | 'terminated' | 'error';
  createdAt: Date;
  lastActiveAt: Date;
  metrics?: {
    cpuUtilization: number;
    memoryUtilization: number;
    networkIn: number;
    networkOut: number;
  };
  tags: Record<string, string>;
  cost: {
    hourlyRate: number;
    currentBilling: number;
  };
  sshKeyPath?: string; // Path to SSH private key for server access
}

/**
 * Instance type information
 */
export interface InstanceTypeInfo {
  name: string;
  cpuCount: number;
  memoryGb: number;
  storageGb?: number;
  hourlyPrice: number;
  description: string;
}

/**
 * Region information
 */
export interface RegionInfo {
  id: string;
  name: string;
  location: string;
  available: boolean;
}

/**
 * Kubernetes cluster node information
 */
export interface KubernetesNodeInfo {
  id: string;
  name: string;
  role: 'master' | 'worker';
  serverId: string;
  publicIp?: string;
  privateIp?: string;
  status: 'provisioning' | 'running' | 'error';
  joinToken?: string; // Token used by worker nodes to join the cluster
}

/**
 * Interface that all cloud provider implementations must implement
 */
export interface CloudProviderService {
  /**
   * List available regions for this cloud provider
   */
  listAvailableRegions(): Promise<RegionInfo[]>;
  
  /**
   * List available instance types for a specific region
   */
  listAvailableInstanceTypes(region: string): Promise<InstanceTypeInfo[]>;
  
  /**
   * Provision a new server
   */
  provisionServer(request: ServerProvisioningRequest): Promise<ServerResource>;
  
  /**
   * Terminate a server
   */
  terminateServer(serverId: string): Promise<boolean>;
  
  /**
   * Get the current status of a server
   */
  getServerStatus(serverId: string): Promise<ServerResource>;
  
  /**
   * List all servers for this cloud provider
   */
  listServers(): Promise<ServerResource[]>;
  
  /**
   * Install Kubernetes on a server as a master node
   */
  installKubernetes(serverId: string): Promise<{kubeconfig: string, joinToken: string}>;
  
  /**
   * Add a worker node to an existing Kubernetes cluster
   */
  addKubernetesWorkerNode(
    serverId: string, 
    masterNodeIp: string, 
    joinToken: string
  ): Promise<boolean>;
  
  /**
   * Get resource metrics for a server
   */
  getServerMetrics(serverId: string): Promise<ServerResource['metrics']>;
} 