import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '@dokploy/server/utils/logger';

const execAsync = promisify(exec);

/**
 * Service for translating Docker Compose files to Kubernetes manifests
 */
export class ComposeTranslator {
  /**
   * Translate a Docker Compose file to Kubernetes manifests
   * @param composeContent The content of the Docker Compose file
   * @returns An object containing the generated Kubernetes manifests
   */
  async translateComposeToKubernetes(composeContent: string): Promise<Record<string, string>> {
    try {
      logger.info('Translating Docker Compose file to Kubernetes manifests');
      
      // Create a temporary directory
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dokploy-compose-'));
      const composeFilePath = path.join(tempDir, 'docker-compose.yml');
      
      // Write the compose file to the temporary directory
      await fs.promises.writeFile(composeFilePath, composeContent);
      
      // Use Kompose to convert the compose file to Kubernetes manifests
      await execAsync(`kompose convert -f ${composeFilePath} -o ${tempDir}`);
      
      // Read all generated files
      const files = await fs.promises.readdir(tempDir);
      const manifests: Record<string, string> = {};
      
      for (const file of files) {
        if (file === 'docker-compose.yml') continue;
        
        const filePath = path.join(tempDir, file);
        const content = await fs.promises.readFile(filePath, 'utf8');
        manifests[file] = content;
      }
      
      // Clean up the temporary directory
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      
      return manifests;
    } catch (error) {
      logger.error('Error translating Docker Compose file:', error);
      throw new Error(`Failed to translate Docker Compose file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Translate a Docker Compose file to Kubernetes manifests without using Kompose
   * This is a fallback method if Kompose is not available
   * @param composeContent The content of the Docker Compose file
   * @returns An object containing the generated Kubernetes manifests
   */
  async translateComposeManually(composeContent: string): Promise<Record<string, string>> {
    try {
      logger.info('Manually translating Docker Compose file to Kubernetes manifests');
      
      // Parse the compose file
      const compose = JSON.parse(composeContent);
      const manifests: Record<string, string> = {};
      
      // Process each service in the compose file
      for (const [serviceName, serviceConfig] of Object.entries(compose.services || {})) {
        // Create a deployment for the service
        const deployment = this.createDeployment(serviceName, serviceConfig as any);
        manifests[`${serviceName}-deployment.yaml`] = deployment;
        
        // Create a service for the service if it exposes ports
        if ((serviceConfig as any).ports && (serviceConfig as any).ports.length > 0) {
          const service = this.createService(serviceName, serviceConfig as any);
          manifests[`${serviceName}-service.yaml`] = service;
        }
      }
      
      return manifests;
    } catch (error) {
      logger.error('Error manually translating Docker Compose file:', error);
      throw new Error(`Failed to manually translate Docker Compose file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Create a Kubernetes Deployment manifest for a Docker Compose service
   */
  private createDeployment(serviceName: string, serviceConfig: any): string {
    // Extract the image name
    const image = serviceConfig.image || 'nginx:latest';
    
    // Extract environment variables
    const env = [];
    if (serviceConfig.environment) {
      for (const [key, value] of Object.entries(serviceConfig.environment)) {
        env.push({ name: key, value: String(value) });
      }
    }
    
    // Extract volume mounts
    const volumeMounts = [];
    const volumes = [];
    if (serviceConfig.volumes) {
      for (let i = 0; i < serviceConfig.volumes.length; i++) {
        const volume = serviceConfig.volumes[i];
        const parts = volume.split(':');
        if (parts.length >= 2) {
          const name = `volume-${i}`;
          volumeMounts.push({
            name,
            mountPath: parts[1],
          });
          volumes.push({
            name,
            hostPath: {
              path: parts[0],
            },
          });
        }
      }
    }
    
    // Create the deployment manifest
    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: serviceName,
        labels: {
          app: serviceName,
        },
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            app: serviceName,
          },
        },
        template: {
          metadata: {
            labels: {
              app: serviceName,
            },
          },
          spec: {
            containers: [
              {
                name: serviceName,
                image,
                env,
                volumeMounts,
              },
            ],
            volumes,
          },
        },
      },
    };
    
    return JSON.stringify(deployment, null, 2);
  }
  
  /**
   * Create a Kubernetes Service manifest for a Docker Compose service
   */
  private createService(serviceName: string, serviceConfig: any): string {
    // Extract ports
    const ports = [];
    if (serviceConfig.ports) {
      for (const port of serviceConfig.ports) {
        const parts = port.split(':');
        if (parts.length >= 2) {
          ports.push({
            port: parseInt(parts[0], 10),
            targetPort: parseInt(parts[1], 10),
          });
        } else {
          ports.push({
            port: parseInt(parts[0], 10),
            targetPort: parseInt(parts[0], 10),
          });
        }
      }
    }
    
    // Create the service manifest
    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        labels: {
          app: serviceName,
        },
      },
      spec: {
        selector: {
          app: serviceName,
        },
        ports,
      },
    };
    
    return JSON.stringify(service, null, 2);
  }
} 