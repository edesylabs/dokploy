import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@dokploy/server/middleware/validate-request';
import { prisma } from '@dokploy/server/db';
import { createCloudProvider } from '@dokploy/server/services/cloud-providers';
import { ServerProvisioningRequest } from '@dokploy/server/services/cloud-providers/types';
import { AutoCleanupService } from '@dokploy/server/services/auto-cleanup';

// Initialize the auto-cleanup service
const autoCleanupService = new AutoCleanupService(prisma);

// Start the auto-cleanup service when the server starts
// This should be moved to a proper server initialization function
setTimeout(() => {
  autoCleanupService.start(15); // Check every 15 minutes
}, 5000); // Wait 5 seconds after server start

const router = Router();

// Schema for creating a cloud provider
const createCloudProviderSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['aws', 'gcp', 'azure', 'digitalocean', 'linode', 'hetzner']),
  credentials: z.record(z.string()),
  defaultRegion: z.string().min(1),
  defaultInstanceType: z.string().optional(),
  defaultTags: z.record(z.string()).optional(),
  organizationId: z.string().optional(),
});

// Schema for updating a cloud provider
const updateCloudProviderSchema = z.object({
  name: z.string().min(1).optional(),
  credentials: z.record(z.string()).optional(),
  defaultRegion: z.string().min(1).optional(),
  defaultInstanceType: z.string().optional(),
  defaultTags: z.record(z.string()).optional(),
});

// Schema for creating a server resource
const createServerResourceSchema = z.object({
  name: z.string().min(1),
  cloudProviderId: z.string().min(1),
  instanceType: z.string().optional(),
  diskSize: z.number().positive().optional(),
  memory: z.number().positive().optional(),
  cpuCount: z.number().positive().optional(),
  tags: z.record(z.string()).optional(),
  autoDelete: z.object({
    enabled: z.boolean(),
    idleThreshold: z.number().positive().optional(),
    maxLifetime: z.number().positive().optional(),
  }).optional(),
  organizationId: z.string().optional(),
});

// GET /api/cloud-providers
// List all cloud providers
router.get('/', async (req, res) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    
    const cloudProviders = await prisma.cloudProvider.findMany({
      where: organizationId ? { organizationId } : undefined,
      select: {
        id: true,
        name: true,
        type: true,
        defaultRegion: true,
        defaultInstanceType: true,
        defaultTags: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        // Don't include credentials in the response
      },
    });
    
    return res.json(cloudProviders);
  } catch (error) {
    console.error('Error listing cloud providers:', error);
    return res.status(500).json({ error: 'Failed to list cloud providers' });
  }
});

// POST /api/cloud-providers
// Create a new cloud provider
router.post('/', validateRequest(createCloudProviderSchema), async (req, res) => {
  try {
    const { 
      name, 
      type, 
      credentials, 
      defaultRegion, 
      defaultInstanceType, 
      defaultTags,
      organizationId
    } = req.body;
    
    // Create the cloud provider in the database
    const cloudProvider = await prisma.cloudProvider.create({
      data: {
        name,
        type,
        credentials: JSON.stringify(credentials),
        defaultRegion,
        defaultInstanceType,
        defaultTags: defaultTags ? JSON.stringify(defaultTags) : null,
        organizationId,
      },
    });
    
    // Return the cloud provider without credentials
    return res.status(201).json({
      id: cloudProvider.id,
      name: cloudProvider.name,
      type: cloudProvider.type,
      defaultRegion: cloudProvider.defaultRegion,
      defaultInstanceType: cloudProvider.defaultInstanceType,
      defaultTags: cloudProvider.defaultTags ? JSON.parse(cloudProvider.defaultTags) : null,
      createdAt: cloudProvider.createdAt,
      updatedAt: cloudProvider.updatedAt,
      organizationId: cloudProvider.organizationId,
    });
  } catch (error) {
    console.error('Error creating cloud provider:', error);
    return res.status(500).json({ error: 'Failed to create cloud provider' });
  }
});

// GET /api/cloud-providers/:id
// Get a cloud provider by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const cloudProvider = await prisma.cloudProvider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        defaultRegion: true,
        defaultInstanceType: true,
        defaultTags: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        // Don't include credentials in the response
      },
    });
    
    if (!cloudProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Parse the defaultTags JSON string
    const response = {
      ...cloudProvider,
      defaultTags: cloudProvider.defaultTags ? JSON.parse(cloudProvider.defaultTags) : null,
    };
    
    return res.json(response);
  } catch (error) {
    console.error('Error getting cloud provider:', error);
    return res.status(500).json({ error: 'Failed to get cloud provider' });
  }
});

// PUT /api/cloud-providers/:id
// Update a cloud provider
router.put('/:id', validateRequest(updateCloudProviderSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      credentials, 
      defaultRegion, 
      defaultInstanceType, 
      defaultTags 
    } = req.body;
    
    // Check if the cloud provider exists
    const existingProvider = await prisma.cloudProvider.findUnique({
      where: { id },
    });
    
    if (!existingProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Update the cloud provider
    const cloudProvider = await prisma.cloudProvider.update({
      where: { id },
      data: {
        name,
        credentials: credentials ? JSON.stringify(credentials) : undefined,
        defaultRegion,
        defaultInstanceType,
        defaultTags: defaultTags ? JSON.stringify(defaultTags) : undefined,
      },
    });
    
    // Return the updated cloud provider without credentials
    return res.json({
      id: cloudProvider.id,
      name: cloudProvider.name,
      type: cloudProvider.type,
      defaultRegion: cloudProvider.defaultRegion,
      defaultInstanceType: cloudProvider.defaultInstanceType,
      defaultTags: cloudProvider.defaultTags ? JSON.parse(cloudProvider.defaultTags) : null,
      createdAt: cloudProvider.createdAt,
      updatedAt: cloudProvider.updatedAt,
      organizationId: cloudProvider.organizationId,
    });
  } catch (error) {
    console.error('Error updating cloud provider:', error);
    return res.status(500).json({ error: 'Failed to update cloud provider' });
  }
});

// DELETE /api/cloud-providers/:id
// Delete a cloud provider
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the cloud provider exists
    const existingProvider = await prisma.cloudProvider.findUnique({
      where: { id },
      include: {
        serverResources: {
          where: {
            status: {
              in: ['provisioning', 'running', 'stopped']
            }
          }
        }
      }
    });
    
    if (!existingProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Check if there are active server resources
    if (existingProvider.serverResources.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete cloud provider with active server resources',
        activeResources: existingProvider.serverResources.length
      });
    }
    
    // Delete the cloud provider
    await prisma.cloudProvider.delete({
      where: { id },
    });
    
    return res.status(204).end();
  } catch (error) {
    console.error('Error deleting cloud provider:', error);
    return res.status(500).json({ error: 'Failed to delete cloud provider' });
  }
});

// GET /api/cloud-providers/:id/regions
// List available regions for a cloud provider
router.get('/:id/regions', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the cloud provider
    const cloudProvider = await prisma.cloudProvider.findUnique({
      where: { id },
    });
    
    if (!cloudProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: cloudProvider.id,
      name: cloudProvider.name,
      provider: cloudProvider.type as any,
      credentials: JSON.parse(cloudProvider.credentials),
      region: cloudProvider.defaultRegion,
    });
    
    // Get the available regions
    const regions = await cloudProviderService.listAvailableRegions();
    
    return res.json(regions);
  } catch (error) {
    console.error('Error listing regions:', error);
    return res.status(500).json({ error: 'Failed to list regions' });
  }
});

// GET /api/cloud-providers/:id/instance-types
// List available instance types for a cloud provider in a region
router.get('/:id/instance-types', async (req, res) => {
  try {
    const { id } = req.params;
    const region = req.query.region as string;
    
    if (!region) {
      return res.status(400).json({ error: 'Region is required' });
    }
    
    // Get the cloud provider
    const cloudProvider = await prisma.cloudProvider.findUnique({
      where: { id },
    });
    
    if (!cloudProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: cloudProvider.id,
      name: cloudProvider.name,
      provider: cloudProvider.type as any,
      credentials: JSON.parse(cloudProvider.credentials),
      region: cloudProvider.defaultRegion,
    });
    
    // Get the available instance types
    const instanceTypes = await cloudProviderService.listAvailableInstanceTypes(region);
    
    return res.json(instanceTypes);
  } catch (error) {
    console.error('Error listing instance types:', error);
    return res.status(500).json({ error: 'Failed to list instance types' });
  }
});

// POST /api/cloud-providers/:id/servers
// Provision a new server
router.post('/:id/servers', validateRequest(createServerResourceSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      instanceType, 
      diskSize, 
      memory, 
      cpuCount, 
      tags, 
      autoDelete,
      organizationId
    } = req.body;
    
    // Get the cloud provider
    const cloudProvider = await prisma.cloudProvider.findUnique({
      where: { id },
    });
    
    if (!cloudProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: cloudProvider.id,
      name: cloudProvider.name,
      provider: cloudProvider.type as any,
      credentials: JSON.parse(cloudProvider.credentials),
      region: cloudProvider.defaultRegion,
      defaultInstanceType: cloudProvider.defaultInstanceType || undefined,
      tags: cloudProvider.defaultTags ? JSON.parse(cloudProvider.defaultTags) : undefined,
    });
    
    // Create the server provisioning request
    const provisioningRequest: ServerProvisioningRequest = {
      name,
      cloudProviderId: cloudProvider.id,
      instanceType,
      diskSize,
      memory,
      cpuCount,
      tags,
      autoDelete,
    };
    
    // Provision the server
    const serverResource = await cloudProviderService.provisionServer(provisioningRequest);
    
    // Save the server resource to the database
    const dbServerResource = await prisma.serverResource.create({
      data: {
        name: serverResource.name,
        externalId: serverResource.id,
        cloudProviderId: cloudProvider.id,
        provider: serverResource.provider,
        region: serverResource.region,
        instanceType: serverResource.instanceType,
        publicIp: serverResource.publicIp,
        privateIp: serverResource.privateIp,
        status: serverResource.status,
        lastActiveAt: serverResource.lastActiveAt,
        autoDeleteEnabled: autoDelete?.enabled || false,
        idleThresholdMinutes: autoDelete?.idleThreshold,
        maxLifetimeMinutes: autoDelete?.maxLifetime,
        hourlyRate: serverResource.cost.hourlyRate,
        currentBilling: serverResource.cost.currentBilling,
        tags: JSON.stringify(serverResource.tags),
        organizationId,
      },
    });
    
    return res.status(201).json({
      ...dbServerResource,
      tags: serverResource.tags,
    });
  } catch (error) {
    console.error('Error provisioning server:', error);
    return res.status(500).json({ error: 'Failed to provision server' });
  }
});

// GET /api/cloud-providers/:id/servers
// List servers for a cloud provider
router.get('/:id/servers', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the cloud provider
    const cloudProvider = await prisma.cloudProvider.findUnique({
      where: { id },
    });
    
    if (!cloudProvider) {
      return res.status(404).json({ error: 'Cloud provider not found' });
    }
    
    // Get the server resources from the database
    const serverResources = await prisma.serverResource.findMany({
      where: { cloudProviderId: id },
    });
    
    // Format the response
    const response = serverResources.map(resource => ({
      ...resource,
      tags: resource.tags ? JSON.parse(resource.tags) : null,
    }));
    
    return res.json(response);
  } catch (error) {
    console.error('Error listing servers:', error);
    return res.status(500).json({ error: 'Failed to list servers' });
  }
});

export default router; 