import { 
  SecretsManagerClient, 
  GetSecretValueCommand,
  ListSecretsCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  SecretListEntry
} from '@aws-sdk/client-secrets-manager';
import { SecretStoreService, Secret, SecretReference } from './types';
import { logger } from '@dokploy/server/utils/logger';

/**
 * AWS Secrets Manager integration for secret management
 */
export class AwsSecretsManagerStore implements SecretStoreService {
  private client: SecretsManagerClient;
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
    
    const { accessKeyId, secretAccessKey, region } = config.credentials;
    
    if (!accessKeyId || !secretAccessKey || !region) {
      throw new Error('AWS credentials must include accessKeyId, secretAccessKey, and region');
    }
    
    this.client = new SecretsManagerClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    
    logger.info(`Initialized AWS Secrets Manager store: ${config.name} (${config.id})`);
  }

  /**
   * Get a secret from AWS Secrets Manager
   * In AWS Secrets Manager, the path is the secret name/ARN and the key is a JSON field
   */
  async getSecret(path: string, key: string): Promise<Secret> {
    try {
      logger.info(`Getting secret ${key} from ${path}`);
      
      const command = new GetSecretValueCommand({
        SecretId: path,
      });
      
      const response = await this.client.send(command);
      
      if (!response.SecretString) {
        throw new Error(`Secret ${path} not found or has no string value`);
      }
      
      // Parse the secret string as JSON
      let secretData: Record<string, string>;
      try {
        secretData = JSON.parse(response.SecretString);
      } catch (e) {
        // If not JSON, treat the whole string as the value
        if (key === 'value') {
          return {
            key,
            value: response.SecretString,
            path,
            version: response.VersionId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        throw new Error(`Secret ${path} is not in JSON format and key ${key} was requested`);
      }
      
      if (secretData[key] === undefined) {
        throw new Error(`Key ${key} not found in secret ${path}`);
      }
      
      return {
        key,
        value: secretData[key],
        path,
        version: response.VersionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Error getting secret ${key} from ${path}:`, error);
      throw new Error(`Failed to get secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List secrets in AWS Secrets Manager
   * In AWS, we can only list secret names, not keys within secrets
   */
  async listSecrets(path: string): Promise<string[]> {
    try {
      logger.info(`Listing secrets with prefix ${path}`);
      
      const command = new ListSecretsCommand({
        // Filter by name prefix if path is provided
        Filters: path ? [
          {
            Key: 'name',
            Values: [path],
          },
        ] : undefined,
      });
      
      const response = await this.client.send(command);
      
      // Extract secret names from the response
      const secretNames = (response.SecretList || []).map((secret: SecretListEntry) => 
        secret.Name || ''
      ).filter(Boolean);
      
      return secretNames;
    } catch (error) {
      logger.error(`Error listing secrets with prefix ${path}:`, error);
      throw new Error(`Failed to list secrets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create or update a secret in AWS Secrets Manager
   */
  async setSecret(
    path: string,
    key: string,
    value: string,
    metadata?: Record<string, string>
  ): Promise<Secret> {
    try {
      logger.info(`Setting secret ${key} at ${path}`);
      
      // First, check if the secret already exists
      let existingSecret: Record<string, string> = {};
      let exists = false;
      
      try {
        const getCommand = new GetSecretValueCommand({
          SecretId: path,
        });
        
        const response = await this.client.send(getCommand);
        
        if (response.SecretString) {
          try {
            existingSecret = JSON.parse(response.SecretString);
            exists = true;
          } catch (e) {
            // If not JSON, create a new JSON object
            existingSecret = { value: response.SecretString };
            exists = true;
          }
        }
      } catch (error) {
        // Secret doesn't exist, will create a new one
        exists = false;
      }
      
      // Update the secret data
      existingSecret[key] = value;
      
      // Create or update the secret
      if (exists) {
        const updateCommand = new UpdateSecretCommand({
          SecretId: path,
          SecretString: JSON.stringify(existingSecret),
        });
        
        await this.client.send(updateCommand);
      } else {
        const createCommand = new CreateSecretCommand({
          Name: path,
          SecretString: JSON.stringify({ [key]: value }),
          Tags: metadata ? Object.entries(metadata).map(([k, v]) => ({ Key: k, Value: v })) : undefined,
        });
        
        await this.client.send(createCommand);
      }
      
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
   * Delete a secret from AWS Secrets Manager
   */
  async deleteSecret(path: string, key: string): Promise<boolean> {
    try {
      logger.info(`Deleting secret ${key} from ${path}`);
      
      // First, check if the secret exists and is in JSON format
      try {
        const getCommand = new GetSecretValueCommand({
          SecretId: path,
        });
        
        const response = await this.client.send(getCommand);
        
        if (response.SecretString) {
          try {
            const secretData = JSON.parse(response.SecretString);
            
            // If the key exists in the JSON, remove it and update the secret
            if (secretData[key] !== undefined) {
              delete secretData[key];
              
              // If there are still other keys, update the secret
              if (Object.keys(secretData).length > 0) {
                const updateCommand = new UpdateSecretCommand({
                  SecretId: path,
                  SecretString: JSON.stringify(secretData),
                });
                
                await this.client.send(updateCommand);
                return true;
              }
            }
          } catch (e) {
            // Not JSON, can't delete a specific key
            logger.warn(`Secret ${path} is not in JSON format, can't delete key ${key}`);
            return false;
          }
        }
      } catch (error) {
        // Secret doesn't exist
        logger.warn(`Secret ${path} not found, can't delete key ${key}`);
        return false;
      }
      
      // If we get here, either the key was the only one in the secret,
      // or the secret doesn't exist in JSON format, so delete the whole secret
      const deleteCommand = new DeleteSecretCommand({
        SecretId: path,
        // Set to false for immediate deletion, true for recovery window
        ForceDeleteWithoutRecovery: false,
      });
      
      await this.client.send(deleteCommand);
      
      return true;
    } catch (error) {
      logger.error(`Error deleting secret ${key} from ${path}:`, error);
      throw new Error(`Failed to delete secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Test connection to AWS Secrets Manager
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('Testing connection to AWS Secrets Manager');
      
      // Try to list secrets (with a limit of 1) to test the connection
      const command = new ListSecretsCommand({
        MaxResults: 1,
      });
      
      await this.client.send(command);
      
      return true;
    } catch (error) {
      logger.error('AWS Secrets Manager connection test failed:', error);
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