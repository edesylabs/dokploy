import { SecretStoreService, SecretStoreConfig } from './types';
import { VaultSecretStore } from './vault-store';
import { AwsSecretsManagerStore } from './aws-secrets-manager';
import { logger } from '@dokploy/server/utils/logger';

/**
 * Create a secret store service based on the provider type
 */
export function createSecretStore(config: SecretStoreConfig): SecretStoreService {
  logger.info(`Creating secret store service for ${config.name} (${config.provider})`);
  
  switch (config.provider) {
    case 'vault':
      return new VaultSecretStore(config);
    
    case 'aws-secrets-manager':
      return new AwsSecretsManagerStore(config);
    
    case 'azure-key-vault':
      // TODO: Implement Azure Key Vault integration
      throw new Error('Azure Key Vault integration not implemented yet');
    
    case 'gcp-secret-manager':
      // TODO: Implement GCP Secret Manager integration
      throw new Error('GCP Secret Manager integration not implemented yet');
    
    default:
      throw new Error(`Unsupported secret store provider: ${config.provider}`);
  }
}

// Re-export types
export * from './types'; 