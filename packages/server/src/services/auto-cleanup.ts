import { PrismaClient } from '@prisma/client';
import { createCloudProvider } from './cloud-providers';
import { ServerResource } from './cloud-providers/types';
import { logger } from '@dokploy/server/utils/logger';

/**
 * Service to automatically clean up unused cloud resources
 */
export class AutoCleanupService {
  private prisma: PrismaClient;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Start the auto-cleanup service
   * @param intervalMinutes How often to run the cleanup check (in minutes)
   */
  start(intervalMinutes: number = 15): void {
    if (this.isRunning) {
      logger.warn('Auto-cleanup service is already running');
      return;
    }

    logger.info(`Starting auto-cleanup service with interval of ${intervalMinutes} minutes`);
    
    // Run immediately on start
    this.runCleanup();
    
    // Then schedule regular runs
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, intervalMinutes * 60 * 1000);
    
    this.isRunning = true;
  }

  /**
   * Stop the auto-cleanup service
   */
  stop(): void {
    if (!this.isRunning || !this.intervalId) {
      logger.warn('Auto-cleanup service is not running');
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    this.isRunning = false;
    
    logger.info('Auto-cleanup service stopped');
  }

  /**
   * Run the cleanup process
   */
  private async runCleanup(): Promise<void> {
    try {
      logger.info('Running auto-cleanup check');
      
      // Get all cloud provider configurations
      const cloudProviders = await this.prisma.cloudProvider.findMany();
      
      // Process each cloud provider
      for (const provider of cloudProviders) {
        try {
          // Get all server resources for this provider
          const serverResources = await this.prisma.serverResource.findMany({
            where: {
              cloudProviderId: provider.id,
              status: {
                in: ['running', 'stopped'] // Only check active resources
              },
              autoDeleteEnabled: true // Only check resources with auto-delete enabled
            }
          });
          
          if (serverResources.length === 0) {
            continue;
          }
          
          // Create cloud provider service
          const cloudProviderService = createCloudProvider({
            id: provider.id,
            name: provider.name,
            provider: provider.type as any,
            credentials: JSON.parse(provider.credentials),
            region: provider.defaultRegion
          });
          
          // Check each server resource
          for (const resource of serverResources) {
            try {
              // Get the latest status from the cloud provider
              const serverStatus = await cloudProviderService.getServerStatus(resource.externalId);
              
              // Check if the server should be deleted
              const shouldDelete = this.shouldDeleteResource(resource, serverStatus);
              
              if (shouldDelete) {
                logger.info(`Auto-deleting server resource: ${resource.name} (${resource.id})`);
                
                // Terminate the server
                await cloudProviderService.terminateServer(resource.externalId);
                
                // Update the database
                await this.prisma.serverResource.update({
                  where: { id: resource.id },
                  data: {
                    status: 'terminated',
                    terminatedAt: new Date()
                  }
                });
                
                logger.info(`Server resource ${resource.name} (${resource.id}) terminated successfully`);
              }
            } catch (error) {
              logger.error(`Error processing server resource ${resource.id}:`, error);
            }
          }
        } catch (error) {
          logger.error(`Error processing cloud provider ${provider.id}:`, error);
        }
      }
      
      logger.info('Auto-cleanup check completed');
    } catch (error) {
      logger.error('Error running auto-cleanup:', error);
    }
  }

  /**
   * Determine if a resource should be deleted based on its configuration and status
   */
  private shouldDeleteResource(
    dbResource: any,
    cloudResource: ServerResource
  ): boolean {
    const now = new Date();
    
    // Check if the resource is already terminated
    if (cloudResource.status === 'terminated') {
      return false;
    }
    
    // Check if the resource has exceeded its maximum lifetime
    if (dbResource.maxLifetimeMinutes) {
      const createdAt = new Date(dbResource.createdAt);
      const lifetimeMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
      
      if (lifetimeMinutes >= dbResource.maxLifetimeMinutes) {
        logger.info(`Resource ${dbResource.name} (${dbResource.id}) has exceeded its maximum lifetime of ${dbResource.maxLifetimeMinutes} minutes`);
        return true;
      }
    }
    
    // Check if the resource has been idle for too long
    if (dbResource.idleThresholdMinutes) {
      const lastActiveAt = new Date(dbResource.lastActiveAt);
      const idleMinutes = (now.getTime() - lastActiveAt.getTime()) / (1000 * 60);
      
      // Consider a resource idle if CPU and network usage are below thresholds
      const isIdle = 
        (cloudResource.metrics?.cpuUtilization || 0) < 5 && // Less than 5% CPU
        (cloudResource.metrics?.networkIn || 0) < 1000000 && // Less than 1MB/s incoming
        (cloudResource.metrics?.networkOut || 0) < 1000000; // Less than 1MB/s outgoing
      
      if (isIdle && idleMinutes >= dbResource.idleThresholdMinutes) {
        logger.info(`Resource ${dbResource.name} (${dbResource.id}) has been idle for ${idleMinutes} minutes, exceeding threshold of ${dbResource.idleThresholdMinutes} minutes`);
        return true;
      }
    }
    
    return false;
  }
} 