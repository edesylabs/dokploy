/**
 * Secret Store Integration Types
 * 
 * This file defines the interfaces and types for integrating with external secret stores
 * like HashiCorp Vault, AWS Secrets Manager, etc.
 */

/**
 * Supported secret store providers
 */
export type SecretStoreProvider = 'vault' | 'aws-secrets-manager' | 'azure-key-vault' | 'gcp-secret-manager';

/**
 * Configuration for a secret store
 */
export interface SecretStoreConfig {
  id: string;
  name: string;
  provider: SecretStoreProvider;
  description?: string;
  credentials: Record<string, string>;
  defaultPath?: string;
  organizationId?: string;
}

/**
 * Secret data structure
 */
export interface Secret {
  key: string;
  value: string;
  path: string;
  version?: string;
  metadata?: Record<string, string>;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Secret reference for use in Kubernetes
 */
export interface SecretReference {
  storeId: string;
  path: string;
  key: string;
  version?: string;
}

/**
 * Interface that all secret store implementations must implement
 */
export interface SecretStoreService {
  /**
   * Get a secret from the store
   */
  getSecret(path: string, key: string): Promise<Secret>;
  
  /**
   * List secrets at a path
   */
  listSecrets(path: string): Promise<string[]>;
  
  /**
   * Create or update a secret
   */
  setSecret(path: string, key: string, value: string, metadata?: Record<string, string>): Promise<Secret>;
  
  /**
   * Delete a secret
   */
  deleteSecret(path: string, key: string): Promise<boolean>;
  
  /**
   * Check if the secret store is accessible
   */
  testConnection(): Promise<boolean>;
  
  /**
   * Generate a Kubernetes secret manifest from secret references
   */
  generateKubernetesSecret(
    name: string,
    namespace: string,
    secretRefs: SecretReference[]
  ): Promise<string>;
} 