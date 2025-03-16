import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@dokploy/server/middleware/validate-request';
import { prisma } from '@dokploy/server/db';
import { createSecretStore } from '@dokploy/server/services/secrets';
import { logger } from '@dokploy/server/utils/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Schema for creating a Kubernetes secret
const createKubernetesSecretSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().default('default'),
  clusterId: z.string(),
  secretReferences: z.array(
    z.object({
      secretStoreId: z.string(),
      path: z.string(),
      key: z.string(),
      version: z.string().optional(),
    })
  ),
  organizationId: z.string().optional(),
});

// Schema for updating a Kubernetes secret
const updateKubernetesSecretSchema = z.object({
  name: z.string().min(1).optional(),
  namespace: z.string().optional(),
  secretReferences: z.array(
    z.object({
      secretStoreId: z.string(),
      path: z.string(),
      key: z.string(),
      version: z.string().optional(),
    })
  ).optional(),
});

// GET /api/kubernetes/secrets
// List all Kubernetes secrets
router.get('/secrets', async (req, res) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    const clusterId = req.query.clusterId as string | undefined;
    
    const kubernetesSecrets = await prisma.kubernetesSecret.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(clusterId ? { clusterId } : {}),
      },
      include: {
        cluster: {
          select: {
            name: true,
          },
        },
        secretReferences: {
          include: {
            secretStore: {
              select: {
                name: true,
                provider: true,
              },
            },
          },
        },
      },
    });
    
    // Format the response
    const response = kubernetesSecrets.map(secret => ({
      id: secret.id,
      name: secret.name,
      namespace: secret.namespace,
      clusterId: secret.clusterId,
      clusterName: secret.cluster?.name,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      secretReferences: secret.secretReferences.map(ref => ({
        id: ref.id,
        path: ref.path,
        key: ref.key,
        secretStoreId: ref.secretStoreId,
        secretStoreName: ref.secretStore.name,
        secretStoreProvider: ref.secretStore.provider,
      })),
    }));
    
    return res.json(response);
  } catch (error) {
    logger.error('Error listing Kubernetes secrets:', error);
    return res.status(500).json({ error: 'Failed to list Kubernetes secrets' });
  }
});

// GET /api/kubernetes/secrets/:id
// Get a Kubernetes secret by ID
router.get('/secrets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const kubernetesSecret = await prisma.kubernetesSecret.findUnique({
      where: { id },
      include: {
        cluster: {
          select: {
            name: true,
            kubeconfig: true,
          },
        },
        secretReferences: {
          include: {
            secretStore: {
              select: {
                name: true,
                provider: true,
              },
            },
          },
        },
      },
    });
    
    if (!kubernetesSecret) {
      return res.status(404).json({ error: 'Kubernetes secret not found' });
    }
    
    // Format the response
    const response = {
      id: kubernetesSecret.id,
      name: kubernetesSecret.name,
      namespace: kubernetesSecret.namespace,
      clusterId: kubernetesSecret.clusterId,
      clusterName: kubernetesSecret.cluster?.name,
      createdAt: kubernetesSecret.createdAt,
      updatedAt: kubernetesSecret.updatedAt,
      secretReferences: kubernetesSecret.secretReferences.map(ref => ({
        id: ref.id,
        path: ref.path,
        key: ref.key,
        secretStoreId: ref.secretStoreId,
        secretStoreName: ref.secretStore.name,
        secretStoreProvider: ref.secretStore.provider,
      })),
    };
    
    return res.json(response);
  } catch (error) {
    logger.error('Error getting Kubernetes secret:', error);
    return res.status(500).json({ error: 'Failed to get Kubernetes secret' });
  }
});

// POST /api/kubernetes/secrets
// Create a new Kubernetes secret
router.post('/secrets', validateRequest(createKubernetesSecretSchema), async (req, res) => {
  try {
    const { name, namespace, clusterId, secretReferences, organizationId } = req.body;
    
    // Check if the cluster exists
    const cluster = await prisma.kubernetesCluster.findUnique({
      where: { id: clusterId },
      select: {
        kubeconfig: true,
      },
    });
    
    if (!cluster) {
      return res.status(404).json({ error: 'Kubernetes cluster not found' });
    }
    
    if (!cluster.kubeconfig) {
      return res.status(400).json({ error: 'Kubeconfig not found for cluster' });
    }
    
    // Create the Kubernetes secret in the database
    const kubernetesSecret = await prisma.kubernetesSecret.create({
      data: {
        name,
        namespace,
        clusterId,
        organizationId,
      },
    });
    
    // Create secret references
    const createdReferences = [];
    for (const ref of secretReferences) {
      const secretReference = await prisma.secretReference.create({
        data: {
          path: ref.path,
          key: ref.key,
          version: ref.version,
          secretStoreId: ref.secretStoreId,
          kubernetesSecretId: kubernetesSecret.id,
          organizationId,
        },
      });
      createdReferences.push(secretReference);
    }
    
    // Generate and apply the Kubernetes secret manifest
    try {
      // Get all secret stores
      const secretStoreIds = [...new Set(secretReferences.map(ref => ref.secretStoreId))];
      const secretStores = await prisma.secretStore.findMany({
        where: {
          id: {
            in: secretStoreIds,
          },
        },
      });
      
      // Create secret store services
      const secretStoreServices = secretStores.map(store => ({
        id: store.id,
        service: createSecretStore({
          id: store.id,
          name: store.name,
          provider: store.provider as any,
          credentials: JSON.parse(store.credentials),
          defaultPath: store.defaultPath,
        }),
      }));
      
      // Generate the Kubernetes secret manifest
      let secretManifest = '';
      for (const { id, service } of secretStoreServices) {
        const storeRefs = secretReferences.filter(ref => ref.secretStoreId === id);
        const manifest = await service.generateKubernetesSecret(
          name,
          namespace,
          storeRefs.map(ref => ({
            storeId: ref.secretStoreId,
            path: ref.path,
            key: ref.key,
            version: ref.version,
          }))
        );
        secretManifest += manifest + '\n---\n';
      }
      
      // Apply the manifest to the cluster
      const kubeconfigPath = path.join(os.tmpdir(), `kubeconfig-${Date.now()}.yaml`);
      try {
        // Write kubeconfig to a temporary file
        await fs.promises.writeFile(kubeconfigPath, cluster.kubeconfig);
        
        // Write the manifest to a temporary file
        const manifestPath = path.join(os.tmpdir(), `secret-manifest-${Date.now()}.yaml`);
        await fs.promises.writeFile(manifestPath, secretManifest);
        
        // Apply the manifest
        await execAsync(`kubectl --kubeconfig=${kubeconfigPath} apply -f ${manifestPath}`);
        
        // Clean up
        await fs.promises.unlink(manifestPath);
      } finally {
        // Clean up kubeconfig
        if (fs.existsSync(kubeconfigPath)) {
          await fs.promises.unlink(kubeconfigPath);
        }
      }
    } catch (error) {
      logger.error('Error applying Kubernetes secret:', error);
      
      // Delete the created resources on error
      await prisma.secretReference.deleteMany({
        where: {
          kubernetesSecretId: kubernetesSecret.id,
        },
      });
      
      await prisma.kubernetesSecret.delete({
        where: {
          id: kubernetesSecret.id,
        },
      });
      
      return res.status(500).json({
        error: 'Failed to apply Kubernetes secret',
        details: error instanceof Error ? error.message : String(error),
      });
    }
    
    // Return the created secret
    const response = {
      id: kubernetesSecret.id,
      name: kubernetesSecret.name,
      namespace: kubernetesSecret.namespace,
      clusterId: kubernetesSecret.clusterId,
      createdAt: kubernetesSecret.createdAt,
      updatedAt: kubernetesSecret.updatedAt,
      secretReferences: createdReferences.map(ref => ({
        id: ref.id,
        path: ref.path,
        key: ref.key,
        secretStoreId: ref.secretStoreId,
      })),
    };
    
    return res.status(201).json(response);
  } catch (error) {
    logger.error('Error creating Kubernetes secret:', error);
    return res.status(500).json({ error: 'Failed to create Kubernetes secret' });
  }
});

// PUT /api/kubernetes/secrets/:id
// Update a Kubernetes secret
router.put('/secrets/:id', validateRequest(updateKubernetesSecretSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, namespace, secretReferences } = req.body;
    
    // Check if the secret exists
    const existingSecret = await prisma.kubernetesSecret.findUnique({
      where: { id },
      include: {
        cluster: {
          select: {
            kubeconfig: true,
          },
        },
      },
    });
    
    if (!existingSecret) {
      return res.status(404).json({ error: 'Kubernetes secret not found' });
    }
    
    // Update the secret in the database
    const kubernetesSecret = await prisma.kubernetesSecret.update({
      where: { id },
      data: {
        name,
        namespace,
      },
    });
    
    // Update secret references if provided
    if (secretReferences) {
      // Delete existing references
      await prisma.secretReference.deleteMany({
        where: {
          kubernetesSecretId: id,
        },
      });
      
      // Create new references
      const createdReferences = [];
      for (const ref of secretReferences) {
        const secretReference = await prisma.secretReference.create({
          data: {
            path: ref.path,
            key: ref.key,
            version: ref.version,
            secretStoreId: ref.secretStoreId,
            kubernetesSecretId: id,
            organizationId: existingSecret.organizationId,
          },
        });
        createdReferences.push(secretReference);
      }
      
      // Generate and apply the updated Kubernetes secret manifest
      try {
        // Get all secret stores
        const secretStoreIds = [...new Set(secretReferences.map(ref => ref.secretStoreId))];
        const secretStores = await prisma.secretStore.findMany({
          where: {
            id: {
              in: secretStoreIds,
            },
          },
        });
        
        // Create secret store services
        const secretStoreServices = secretStores.map(store => ({
          id: store.id,
          service: createSecretStore({
            id: store.id,
            name: store.name,
            provider: store.provider as any,
            credentials: JSON.parse(store.credentials),
            defaultPath: store.defaultPath,
          }),
        }));
        
        // Generate the Kubernetes secret manifest
        let secretManifest = '';
        for (const { id, service } of secretStoreServices) {
          const storeRefs = secretReferences.filter(ref => ref.secretStoreId === id);
          const manifest = await service.generateKubernetesSecret(
            name || existingSecret.name,
            namespace || existingSecret.namespace,
            storeRefs.map(ref => ({
              storeId: ref.secretStoreId,
              path: ref.path,
              key: ref.key,
              version: ref.version,
            }))
          );
          secretManifest += manifest + '\n---\n';
        }
        
        // Apply the manifest to the cluster
        const kubeconfigPath = path.join(os.tmpdir(), `kubeconfig-${Date.now()}.yaml`);
        try {
          // Write kubeconfig to a temporary file
          await fs.promises.writeFile(kubeconfigPath, existingSecret.cluster.kubeconfig);
          
          // Write the manifest to a temporary file
          const manifestPath = path.join(os.tmpdir(), `secret-manifest-${Date.now()}.yaml`);
          await fs.promises.writeFile(manifestPath, secretManifest);
          
          // Apply the manifest
          await execAsync(`kubectl --kubeconfig=${kubeconfigPath} apply -f ${manifestPath}`);
          
          // Clean up
          await fs.promises.unlink(manifestPath);
        } finally {
          // Clean up kubeconfig
          if (fs.existsSync(kubeconfigPath)) {
            await fs.promises.unlink(kubeconfigPath);
          }
        }
      } catch (error) {
        logger.error('Error applying updated Kubernetes secret:', error);
        return res.status(500).json({
          error: 'Failed to apply updated Kubernetes secret',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    // Get the updated secret with references
    const updatedSecret = await prisma.kubernetesSecret.findUnique({
      where: { id },
      include: {
        secretReferences: {
          include: {
            secretStore: {
              select: {
                name: true,
                provider: true,
              },
            },
          },
        },
      },
    });
    
    // Format the response
    const response = {
      id: updatedSecret.id,
      name: updatedSecret.name,
      namespace: updatedSecret.namespace,
      clusterId: updatedSecret.clusterId,
      createdAt: updatedSecret.createdAt,
      updatedAt: updatedSecret.updatedAt,
      secretReferences: updatedSecret.secretReferences.map(ref => ({
        id: ref.id,
        path: ref.path,
        key: ref.key,
        secretStoreId: ref.secretStoreId,
        secretStoreName: ref.secretStore.name,
        secretStoreProvider: ref.secretStore.provider,
      })),
    };
    
    return res.json(response);
  } catch (error) {
    logger.error('Error updating Kubernetes secret:', error);
    return res.status(500).json({ error: 'Failed to update Kubernetes secret' });
  }
});

// DELETE /api/kubernetes/secrets/:id
// Delete a Kubernetes secret
router.delete('/secrets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the secret exists
    const existingSecret = await prisma.kubernetesSecret.findUnique({
      where: { id },
      include: {
        cluster: {
          select: {
            kubeconfig: true,
          },
        },
      },
    });
    
    if (!existingSecret) {
      return res.status(404).json({ error: 'Kubernetes secret not found' });
    }
    
    // Delete the secret from Kubernetes
    try {
      const kubeconfigPath = path.join(os.tmpdir(), `kubeconfig-${Date.now()}.yaml`);
      try {
        // Write kubeconfig to a temporary file
        await fs.promises.writeFile(kubeconfigPath, existingSecret.cluster.kubeconfig);
        
        // Delete the secret
        await execAsync(`kubectl --kubeconfig=${kubeconfigPath} delete secret ${existingSecret.name} -n ${existingSecret.namespace}`);
      } finally {
        // Clean up kubeconfig
        if (fs.existsSync(kubeconfigPath)) {
          await fs.promises.unlink(kubeconfigPath);
        }
      }
    } catch (error) {
      logger.error('Error deleting Kubernetes secret from cluster:', error);
      // Continue with database deletion even if Kubernetes deletion fails
    }
    
    // Delete secret references
    await prisma.secretReference.deleteMany({
      where: {
        kubernetesSecretId: id,
      },
    });
    
    // Delete the secret from the database
    await prisma.kubernetesSecret.delete({
      where: { id },
    });
    
    return res.status(204).end();
  } catch (error) {
    logger.error('Error deleting Kubernetes secret:', error);
    return res.status(500).json({ error: 'Failed to delete Kubernetes secret' });
  }
});

export default router; 