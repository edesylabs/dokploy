import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@dokploy/server/middleware/validate-request';
import { prisma } from '@dokploy/server/db';
import { createCloudProvider } from '@dokploy/server/services/cloud-providers';
import composeRouter from './compose';
import secretsRouter from './secrets';

const router = Router();

// Register compose routes
router.use('/compose', composeRouter);

// Register secrets routes
router.use('/', secretsRouter);

// GET /api/kubernetes/clusters
// List all Kubernetes clusters
router.get('/clusters', async (req, res) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    
    const clusters = await prisma.kubernetesCluster.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: {
        cloudProvider: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        nodes: {
          select: {
            id: true,
            name: true,
            role: true,
            status: true,
            serverResourceId: true,
          },
        },
      },
    });
    
    // Format the response
    const response = clusters.map(cluster => ({
      id: cluster.id,
      name: cluster.name,
      provider: cluster.provider,
      status: cluster.status,
      createdAt: cluster.createdAt,
      updatedAt: cluster.updatedAt,
      cloudProvider: cluster.cloudProvider,
      nodeCount: cluster.nodes.length,
      masterNodeCount: cluster.nodes.filter(node => node.role === 'master').length,
      workerNodeCount: cluster.nodes.filter(node => node.role === 'worker').length,
    }));
    
    return res.json(response);
  } catch (error) {
    console.error('Error listing Kubernetes clusters:', error);
    return res.status(500).json({ error: 'Failed to list Kubernetes clusters' });
  }
});

// GET /api/kubernetes/clusters/:id
// Get a Kubernetes cluster by ID
router.get('/clusters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const cluster = await prisma.kubernetesCluster.findUnique({
      where: { id },
      include: {
        cloudProvider: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        nodes: {
          include: {
            serverResource: {
              select: {
                id: true,
                name: true,
                publicIp: true,
                privateIp: true,
                status: true,
                instanceType: true,
              },
            },
          },
        },
      },
    });
    
    if (!cluster) {
      return res.status(404).json({ error: 'Kubernetes cluster not found' });
    }
    
    // Format the response
    const response = {
      id: cluster.id,
      name: cluster.name,
      provider: cluster.provider,
      status: cluster.status,
      createdAt: cluster.createdAt,
      updatedAt: cluster.updatedAt,
      cloudProvider: cluster.cloudProvider,
      nodes: cluster.nodes.map(node => ({
        id: node.id,
        name: node.name,
        role: node.role,
        status: node.status,
        server: node.serverResource,
      })),
    };
    
    return res.json(response);
  } catch (error) {
    console.error('Error getting Kubernetes cluster:', error);
    return res.status(500).json({ error: 'Failed to get Kubernetes cluster' });
  }
});

// GET /api/kubernetes/clusters/:id/nodes
// List all nodes in a Kubernetes cluster
router.get('/clusters/:id/nodes', async (req, res) => {
  try {
    const { id } = req.params;
    
    const nodes = await prisma.kubernetesNode.findMany({
      where: { clusterId: id },
      include: {
        serverResource: {
          select: {
            id: true,
            name: true,
            publicIp: true,
            privateIp: true,
            status: true,
            instanceType: true,
            provider: true,
            region: true,
          },
        },
      },
    });
    
    return res.json(nodes);
  } catch (error) {
    console.error('Error listing Kubernetes nodes:', error);
    return res.status(500).json({ error: 'Failed to list Kubernetes nodes' });
  }
});

// GET /api/kubernetes/clusters/:id/kubeconfig
// Get the kubeconfig for a Kubernetes cluster
router.get('/clusters/:id/kubeconfig', async (req, res) => {
  try {
    const { id } = req.params;
    
    const cluster = await prisma.kubernetesCluster.findUnique({
      where: { id },
      select: {
        kubeconfig: true,
      },
    });
    
    if (!cluster) {
      return res.status(404).json({ error: 'Kubernetes cluster not found' });
    }
    
    if (!cluster.kubeconfig) {
      return res.status(404).json({ error: 'Kubeconfig not found for cluster' });
    }
    
    return res.json({ kubeconfig: cluster.kubeconfig });
  } catch (error) {
    console.error('Error getting Kubernetes kubeconfig:', error);
    return res.status(500).json({ error: 'Failed to get Kubernetes kubeconfig' });
  }
});

export default router; 