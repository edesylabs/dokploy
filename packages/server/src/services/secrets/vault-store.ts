import axios from 'axios';
import { SecretStoreService, Secret, SecretReference } from './types';
import { logger } from '@dokploy/server/utils/logger';

/**
 * HashiCorp Vault integration for secret management
 */
export class VaultSecretStore implements SecretStoreService {
  private token: string;
  private baseUrl: string;
  private namespace?: string;
  private config: {
    id: string;
    name: string;
    credentials: Record<string, string>;
    defaultPath?: string;
  };

  constructor(config: {
    id: string;
    name: string;
    credentials: Record<string, string>;
    defaultPath?: string;
  }) {
    this.config = config;
    
    const { address, token, namespace } = config.credentials;
    
    if (!address || !token) {
      throw new Error('Vault credentials must include address and token');
    }
    
    this.baseUrl = address.endsWith('/') ? address.slice(0, -1) : address;
    this.token = token;
    this.namespace = namespace;
    
    logger.info(`Initialized Vault secret store: ${config.name} (${config.id})`);
  }

  /**
   * Make an authenticated API request to Vault
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    data?: any,
    headers: Record<string, string> = {}
  ): Promise<T> {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}/v1/${path}`,
        headers: {
          'X-Vault-Token': this.token,
          ...(this.namespace ? { 'X-Vault-Namespace': this.namespace } : {}),
          ...headers,
        },
        data,
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error(`Vault API error (${error.response.status}):`, error.response.data);
        throw new Error(`Vault API error: ${JSON.stringify(error.response.data)}`);
      }
      
      logger.error('Vault API request failed:', error);
      throw new Error(`Vault API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a secret from Vault
   */
  async getSecret(path: string, key: string): Promise<Secret> {
    try {
      logger.info(`Getting secret ${key} from ${path}`);
      
      // Normalize path for KV v2 engine
      const isKvV2 = path.startsWith('secret/');
      const apiPath = isKvV2 ? `${path}/data` : path;
      
      const response = await this.apiRequest<any>('GET', apiPath);
      
      // Extract data based on KV version
      const data = isKvV2 ? response.data.data : response.data;
      
      if (!data || data[key] === undefined) {
        throw new Error(`Secret ${key} not found at ${path}`);
      }
      
      return {
        key,
        value: data[key],
        path,
        version: isKvV2 ? response.data.metadata.version : undefined,
        metadata: isKvV2 ? response.data.metadata : undefined,
        createdAt: isKvV2 ? new Date(response.data.metadata.created_time) : undefined,
        updatedAt: isKvV2 ? new Date(response.data.metadata.updated_time) : undefined,
      };
    } catch (error) {
      logger.error(`Error getting secret ${key} from ${path}:`, error);
      throw new Error(`Failed to get secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List secrets at a path
   */
  async listSecrets(path: string): Promise<string[]> {
    try {
      logger.info(`Listing secrets at ${path}`);
      
      // Normalize path for KV v2 engine
      const isKvV2 = path.startsWith('secret/');
      const apiPath = isKvV2 ? `${path}/metadata?list=true` : `${path}?list=true`;
      
      const response = await this.apiRequest<any>('GET', apiPath);
      
      return response.data.keys || [];
    } catch (error) {
      logger.error(`Error listing secrets at ${path}:`, error);
      throw new Error(`Failed to list secrets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create or update a secret in Vault
   */
  async setSecret(
    path: string,
    key: string,
    value: string,
    metadata?: Record<string, string>
  ): Promise<Secret> {
    try {
      logger.info(`Setting secret ${key} at ${path}`);
      
      // Normalize path for KV v2 engine
      const isKvV2 = path.startsWith('secret/');
      const apiPath = isKvV2 ? `${path}/data` : path;
      
      // Prepare data based on KV version
      const data = isKvV2
        ? { data: { [key]: value }, options: { cas: 0 } }
        : { [key]: value };
      
      await this.apiRequest('POST', apiPath, data);
      
      // Return the created secret
      return {
        key,
        value,
        path,
        metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Error setting secret ${key} at ${path}:`, error);
      throw new Error(`Failed to set secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a secret from Vault
   */
  async deleteSecret(path: string, key: string): Promise<boolean> {
    try {
      logger.info(`Deleting secret ${key} from ${path}`);
      
      // Normalize path for KV v2 engine
      const isKvV2 = path.startsWith('secret/');
      const apiPath = isKvV2 ? `${path}/data` : path;
      
      // For KV v2, we need to get the current data, remove the key, and update
      if (isKvV2) {
        const response = await this.apiRequest<any>('GET', apiPath);
        const data = response.data.data;
        
        if (data && data[key] !== undefined) {
          delete data[key];
          await this.apiRequest('POST', apiPath, { data, options: { cas: 0 } });
        }
      } else {
        // For KV v1, we can just delete the key
        await this.apiRequest('DELETE', `${path}/${key}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error deleting secret ${key} from ${path}:`, error);
      throw new Error(`Failed to delete secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Test connection to Vault
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing connection to Vault');
      
      // Try to get Vault health status
      await this.apiRequest<any>('GET', 'sys/health');
      
      return true;
    } catch (error) {
      logger.error('Vault connection test failed:', error);
      return false;
    }
  }

  /**
   * Generate a Kubernetes secret manifest from secret references
   */
  async generateKubernetesSecret(
    name: string,
    namespace: string,
    secretRefs: SecretReference[]
  ): Promise<string> {
    try {
      logger.info(`Generating Kubernetes secret manifest for ${name} in ${namespace}`);
      
      // Fetch all referenced secrets
      const secretData: Record<string, string> = {};
      
      for (const ref of secretRefs) {
        if (ref.storeId !== this.config.id) {
          continue; // Skip references to other secret stores
        }
        
        const secret = await this.getSecret(ref.path, ref.key);
        secretData[ref.key] = Buffer.from(secret.value).toString('base64');
      }
      
      // Create the Kubernetes secret manifest
      const manifest = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name,
          namespace,
          annotations: {
            'dokploy.io/managed-by': 'dokploy',
            'dokploy.io/secret-store': this.config.id,
          },
        },
        type: 'Opaque',
        data: secretData,
      };
      
      return JSON.stringify(manifest, null, 2);
    } catch (error) {
      logger.error(`Error generating Kubernetes secret manifest:`, error);
      throw new Error(`Failed to generate Kubernetes secret manifest: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 