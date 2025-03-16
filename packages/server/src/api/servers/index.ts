import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@dokploy/server/middleware/validate-request';
import { prisma } from '@dokploy/server/db';
import { createCloudProvider } from '@dokploy/server/services/cloud-providers';

const router = Router();

// Schema for updating a server resource
const updateServerResourceSchema = z.object({
  name: z.string().min(1).optional(),
  autoDeleteEnabled: z.boolean().optional(),
  idleThresholdMinutes: z.number().positive().optional(),
  maxLifetimeMinutes: z.number().positive().optional(),
  tags: z.record(z.string()).optional(),
});

// GET /api/servers
// List all server resources
router.get('/', async (req, res) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    
    const serverResources = await prisma.serverResource.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: {
        cloudProvider: {
          select: {
            name: true,
            type: true,
          },
        },
      },
    });
    
    // Format the response
    const response = serverResources.map(resource => ({
      ...resource,
      tags: resource.tags ? JSON.parse(resource.tags) : null,
    }));
    
    return res.json(response);
  } catch (error) {
    console.error('Error listing server resources:', error);
    return res.status(500).json({ error: 'Failed to list server resources' });
  }
});

// GET /api/servers/:id
// Get a server resource by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const serverResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: {
          select: {
            name: true,
            type: true,
          },
        },
      },
    });
    
    if (!serverResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    // Format the response
    const response = {
      ...serverResource,
      tags: serverResource.tags ? JSON.parse(serverResource.tags) : null,
    };
    
    return res.json(response);
  } catch (error) {
    console.error('Error getting server resource:', error);
    return res.status(500).json({ error: 'Failed to get server resource' });
  }
});

// PUT /api/servers/:id
// Update a server resource
router.put('/:id', validateRequest(updateServerResourceSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      autoDeleteEnabled, 
      idleThresholdMinutes, 
      maxLifetimeMinutes, 
      tags 
    } = req.body;
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    // Update the server resource
    const serverResource = await prisma.serverResource.update({
      where: { id },
      data: {
        name,
        autoDeleteEnabled,
        idleThresholdMinutes,
        maxLifetimeMinutes,
        tags: tags ? JSON.stringify(tags) : undefined,
      },
      include: {
        cloudProvider: {
          select: {
            name: true,
            type: true,
          },
        },
      },
    });
    
    // Format the response
    const response = {
      ...serverResource,
      tags: serverResource.tags ? JSON.parse(serverResource.tags) : null,
    };
    
    return res.json(response);
  } catch (error) {
    console.error('Error updating server resource:', error);
    return res.status(500).json({ error: 'Failed to update server resource' });
  }
});

// DELETE /api/servers/:id
// Terminate and delete a server resource
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: true,
      },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: existingResource.cloudProvider.id,
      name: existingResource.cloudProvider.name,
      provider: existingResource.cloudProvider.type as any,
      credentials: JSON.parse(existingResource.cloudProvider.credentials),
      region: existingResource.cloudProvider.defaultRegion,
    });
    
    // Terminate the server
    await cloudProviderService.terminateServer(existingResource.externalId);
    
    // Update the server resource status
    await prisma.serverResource.update({
      where: { id },
      data: {
        status: 'terminated',
        terminatedAt: new Date(),
      },
    });
    
    return res.status(204).end();
  } catch (error) {
    console.error('Error terminating server resource:', error);
    return res.status(500).json({ error: 'Failed to terminate server resource' });
  }
});

// GET /api/servers/:id/status
// Get the current status of a server resource
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: true,
      },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: existingResource.cloudProvider.id,
      name: existingResource.cloudProvider.name,
      provider: existingResource.cloudProvider.type as any,
      credentials: JSON.parse(existingResource.cloudProvider.credentials),
      region: existingResource.cloudProvider.defaultRegion,
    });
    
    // Get the server status
    const serverStatus = await cloudProviderService.getServerStatus(existingResource.externalId);
    
    // Update the server resource in the database
    await prisma.serverResource.update({
      where: { id },
      data: {
        status: serverStatus.status,
        publicIp: serverStatus.publicIp,
        privateIp: serverStatus.privateIp,
        lastActiveAt: new Date(),
        currentBilling: serverStatus.cost.currentBilling,
      },
    });
    
    return res.json(serverStatus);
  } catch (error) {
    console.error('Error getting server status:', error);
    return res.status(500).json({ error: 'Failed to get server status' });
  }
});

// POST /api/servers/:id/start
// Start a stopped server
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: true,
      },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    if (existingResource.status !== 'stopped') {
      return res.status(400).json({ error: 'Server is not in a stopped state' });
    }
    
    // TODO: Implement start functionality in cloud provider services
    // For now, just return a not implemented error
    return res.status(501).json({ error: 'Start functionality not implemented yet' });
  } catch (error) {
    console.error('Error starting server:', error);
    return res.status(500).json({ error: 'Failed to start server' });
  }
});

// POST /api/servers/:id/stop
// Stop a running server
router.post('/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: true,
      },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    if (existingResource.status !== 'running') {
      return res.status(400).json({ error: 'Server is not in a running state' });
    }
    
    // TODO: Implement stop functionality in cloud provider services
    // For now, just return a not implemented error
    return res.status(501).json({ error: 'Stop functionality not implemented yet' });
  } catch (error) {
    console.error('Error stopping server:', error);
    return res.status(500).json({ error: 'Failed to stop server' });
  }
});

// POST /api/servers/:id/install-kubernetes
// Install Kubernetes on a server as a master node
router.post('/:id/install-kubernetes', async (req, res) => {
  try {
    const { id } = req.params;
    const { clusterName } = req.body;
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: true,
      },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    if (existingResource.status !== 'running') {
      return res.status(400).json({ error: 'Server must be in a running state' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: existingResource.cloudProvider.id,
      name: existingResource.cloudProvider.name,
      provider: existingResource.cloudProvider.type as any,
      credentials: JSON.parse(existingResource.cloudProvider.credentials),
      region: existingResource.cloudProvider.defaultRegion,
    });
    
    // Install Kubernetes
    const result = await cloudProviderService.installKubernetes(existingResource.externalId);
    
    // Create a Kubernetes cluster in the database
    const cluster = await prisma.kubernetesCluster.create({
      data: {
        name: clusterName || `${existingResource.name}-cluster`,
        provider: existingResource.provider,
        kubeconfig: result.kubeconfig,
        status: 'running',
        cloudProviderId: existingResource.cloudProviderId,
        organizationId: existingResource.organizationId,
      },
    });
    
    // Create a Kubernetes node in the database (master node)
    const node = await prisma.kubernetesNode.create({
      data: {
        name: existingResource.name,
        role: 'master',
        status: 'running',
        joinToken: result.joinToken,
        clusterId: cluster.id,
        serverResourceId: existingResource.id,
        organizationId: existingResource.organizationId,
      },
    });
    
    return res.json({
      message: 'Kubernetes installed successfully',
      clusterId: cluster.id,
      nodeId: node.id,
    });
  } catch (error) {
    console.error('Error installing Kubernetes:', error);
    return res.status(500).json({ error: 'Failed to install Kubernetes' });
  }
});

// POST /api/servers/:id/join-kubernetes
// Add a server as a worker node to an existing Kubernetes cluster
router.post('/:id/join-kubernetes', async (req, res) => {
  try {
    const { id } = req.params;
    const { clusterId } = req.body;
    
    if (!clusterId) {
      return res.status(400).json({ error: 'Cluster ID is required' });
    }
    
    // Check if the server resource exists
    const existingResource = await prisma.serverResource.findUnique({
      where: { id },
      include: {
        cloudProvider: true,
      },
    });
    
    if (!existingResource) {
      return res.status(404).json({ error: 'Server resource not found' });
    }
    
    if (existingResource.status !== 'running') {
      return res.status(400).json({ error: 'Server must be in a running state' });
    }
    
    // Check if the cluster exists
    const cluster = await prisma.kubernetesCluster.findUnique({
      where: { id: clusterId },
    });
    
    if (!cluster) {
      return res.status(404).json({ error: 'Kubernetes cluster not found' });
    }
    
    // Get the master node
    const masterNode = await prisma.kubernetesNode.findFirst({
      where: {
        clusterId,
        role: 'master',
      },
      include: {
        serverResource: true,
      },
    });
    
    if (!masterNode) {
      return res.status(404).json({ error: 'Master node not found for the cluster' });
    }
    
    if (!masterNode.joinToken) {
      return res.status(400).json({ error: 'Join token not found for the cluster' });
    }
    
    if (!masterNode.serverResource.publicIp) {
      return res.status(400).json({ error: 'Master node does not have a public IP' });
    }
    
    // Create the cloud provider service
    const cloudProviderService = createCloudProvider({
      id: existingResource.cloudProvider.id,
      name: existingResource.cloudProvider.name,
      provider: existingResource.cloudProvider.type as any,
      credentials: JSON.parse(existingResource.cloudProvider.credentials),
      region: existingResource.cloudProvider.defaultRegion,
    });
    
    // Add the server as a worker node
    await cloudProviderService.addKubernetesWorkerNode(
      existingResource.externalId,
      masterNode.serverResource.publicIp,
      masterNode.joinToken
    );
    
    // Create a Kubernetes node in the database (worker node)
    const node = await prisma.kubernetesNode.create({
      data: {
        name: existingResource.name,
        role: 'worker',
        status: 'running',
        clusterId,
        serverResourceId: existingResource.id,
        organizationId: existingResource.organizationId,
      },
    });
    
    return res.json({
      message: 'Server joined Kubernetes cluster successfully',
      clusterId,
      nodeId: node.id,
    });
  } catch (error) {
    console.error('Error joining Kubernetes cluster:', error);
    return res.status(500).json({ error: 'Failed to join Kubernetes cluster' });
  }
});

export default router; 