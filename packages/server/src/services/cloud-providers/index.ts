import { CloudProviderConfig, CloudProviderService } from './types';
import { AWSCloudProvider } from './aws-provider';
import { GCPCloudProvider } from './gcp-provider';
import { AzureCloudProvider } from './azure-provider';
import { DigitalOceanCloudProvider } from './digitalocean-provider';
import { LinodeCloudProvider } from './linode-provider';
import { HetznerCloudProvider } from './hetzner-provider';

/**
 * Factory function to create a cloud provider service based on the provider type
 */
export function createCloudProvider(config: CloudProviderConfig): CloudProviderService {
  switch (config.provider) {
    case 'aws':
      return new AWSCloudProvider(config);
    case 'gcp':
      return new GCPCloudProvider(config);
    case 'azure':
      return new AzureCloudProvider(config);
    case 'digitalocean':
      return new DigitalOceanCloudProvider(config);
    case 'linode':
      return new LinodeCloudProvider(config);
    case 'hetzner':
      return new HetznerCloudProvider(config);
    // Add more providers as they are implemented
    default:
      throw new Error(`Unsupported cloud provider: ${config.provider}`);
  }
}

export * from './types'; 