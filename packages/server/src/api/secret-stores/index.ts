import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '@dokploy/server/middleware/validate-request';
import { prisma } from '@dokploy/server/db';
import { createSecretStore, SecretStoreProvider } from '@dokploy/server/services/secrets';
import { logger } from '@dokploy/server/utils/logger';

const router = Router();

// Schema for creating a secret store
const createSecretStoreSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['vault', 'aws-secrets-manager', 'azure-key-vault', 'gcp-secret-manager']),
  credentials: z.record(z.string()),
  defaultPath: z.string().optional(),
  description: z.string().optional(),
  organizationId: z.string().optional(),
});

// Schema for updating a secret store
const updateSecretStoreSchema = z.object({
  name: z.string().min(1).optional(),
  credentials: z.record(z.string()).optional(),
  defaultPath: z.string().optional(),
  description: z.string().optional(),
});

// GET /api/secret-stores
// List all secret stores
router.get('/', async (req, res) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    
    const secretStores = await prisma.secretStore.findMany({
      where: organizationId ? { organizationId } : undefined,
    });
    
    // Format the response (remove sensitive credentials)
    const response = secretStores.map(store => ({
      id: store.id,
      name: store.name,
      provider: store.provider,
      defaultPath: store.defaultPath,
      description: store.description,
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
      organizationId: store.organizationId,
    }));
    
    return res.json(response);
  } catch (error) {
    logger.error('Error listing secret stores:', error);
    return res.status(500).json({ error: 'Failed to list secret stores' });
  }
});

// GET /api/secret-stores/:id
// Get a secret store by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const secretStore = await prisma.secretStore.findUnique({
      where: { id },
    });
    
    if (!secretStore) {
      return res.status(404).json({ error: 'Secret store not found' });
    }
    
    // Format the response (remove sensitive credentials)
    const response = {
      id: secretStore.id,
      name: secretStore.name,
      provider: secretStore.provider,
      defaultPath: secretStore.defaultPath,
      description: secretStore.description,
      createdAt: secretStore.createdAt,
      updatedAt: secretStore.updatedAt,
      organizationId: secretStore.organizationId,
    };
    
    return res.json(response);
  } catch (error) {
    logger.error('Error getting secret store:', error);
    return res.status(500).json({ error: 'Failed to get secret store' });
  }
});

// POST /api/secret-stores
// Create a new secret store
router.post('/', validateRequest(createSecretStoreSchema), async (req, res) => {
  try {
    const { name, provider, credentials, defaultPath, description, organizationId } = req.body;
    
    // Test the connection to the secret store
    try {
      const secretStore = createSecretStore({
        id: 'temp-id',
        name,
        provider: provider as SecretStoreProvider,
        credentials,
        defaultPath,
      });
      
      const connectionTest = await secretStore.testConnection();
      
      if (!connectionTest) {
        return res.status(400).json({ error: 'Failed to connect to the secret store' });
      }
    } catch (error) {
      logger.error('Error testing secret store connection:', error);
      return res.status(400).json({ 
        error: 'Failed to connect to the secret store',
        details: error instanceof Error ? error.message : String(error),
      });
    }
    
    // Create the secret store in the database
    const secretStore = await prisma.secretStore.create({
      data: {
        name,
        provider,
        credentials: JSON.stringify(credentials),
        defaultPath,
        description,
        organizationId,
      },
    });
    
    // Format the response (remove sensitive credentials)
    const response = {
      id: secretStore.id,
      name: secretStore.name,
      provider: secretStore.provider,
      defaultPath: secretStore.defaultPath,
      description: secretStore.description,
      createdAt: secretStore.createdAt,
      updatedAt: secretStore.updatedAt,
      organizationId: secretStore.organizationId,
    };
    
    return res.status(201).json(response);
  } catch (error) {
    logger.error('Error creating secret store:', error);
    return res.status(500).json({ error: 'Failed to create secret store' });
  }
});

// PUT /api/secret-stores/:id
// Update a secret store
router.put('/:id', validateRequest(updateSecretStoreSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, credentials, defaultPath, description } = req.body;
    
    // Check if the secret store exists
    const existingStore = await prisma.secretStore.findUnique({
      where: { id },
    });
    
    if (!existingStore) {
      return res.status(404).json({ error: 'Secret store not found' });
    }
    
    // If credentials are being updated, test the connection
    if (credentials) {
      try {
        const secretStore = createSecretStore({
          id,
          name: name || existingStore.name,
          provider: existingStore.provider as SecretStoreProvider,
          credentials,
          defaultPath: defaultPath || existingStore.defaultPath,
        });
        
        const connectionTest = await secretStore.testConnection();
        
        if (!connectionTest) {
          return res.status(400).json({ error: 'Failed to connect to the secret store with the new credentials' });
        }
      } catch (error) {
        logger.error('Error testing secret store connection:', error);
        return res.status(400).json({ 
          error: 'Failed to connect to the secret store with the new credentials',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    // Update the secret store
    const secretStore = await prisma.secretStore.update({
      where: { id },
      data: {
        name,
        credentials: credentials ? JSON.stringify(credentials) : undefined,
        defaultPath,
        description,
      },
    });
    
    // Format the response (remove sensitive credentials)
    const response = {
      id: secretStore.id,
      name: secretStore.name,
      provider: secretStore.provider,
      defaultPath: secretStore.defaultPath,
      description: secretStore.description,
      createdAt: secretStore.createdAt,
      updatedAt: secretStore.updatedAt,
      organizationId: secretStore.organizationId,
    };
    
    return res.json(response);
  } catch (error) {
    logger.error('Error updating secret store:', error);
    return res.status(500).json({ error: 'Failed to update secret store' });
  }
});

// DELETE /api/secret-stores/:id
// Delete a secret store
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the secret store exists
    const existingStore = await prisma.secretStore.findUnique({
      where: { id },
      include: {
        secretReferences: true,
      },
    });
    
    if (!existingStore) {
      return res.status(404).json({ error: 'Secret store not found' });
    }
    
    // Check if the secret store has any references
    if (existingStore.secretReferences.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete secret store with existing references',
        referenceCount: existingStore.secretReferences.length,
      });
    }
    
    // Delete the secret store
    await prisma.secretStore.delete({
      where: { id },
    });
    
    return res.status(204).end();
  } catch (error) {
    logger.error('Error deleting secret store:', error);
    return res.status(500).json({ error: 'Failed to delete secret store' });
  }
});

// POST /api/secret-stores/:id/test
// Test connection to a secret store
router.post('/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the secret store
    const secretStore = await prisma.secretStore.findUnique({
      where: { id },
    });
    
    if (!secretStore) {
      return res.status(404).json({ error: 'Secret store not found' });
    }
    
    // Test the connection
    try {
      const store = createSecretStore({
        id: secretStore.id,
        name: secretStore.name,
        provider: secretStore.provider as SecretStoreProvider,
        credentials: JSON.parse(secretStore.credentials),
        defaultPath: secretStore.defaultPath,
      });
      
      const connectionTest = await store.testConnection();
      
      return res.json({ success: connectionTest });
    } catch (error) {
      logger.error('Error testing secret store connection:', error);
      return res.status(400).json({ 
        success: false,
        error: 'Failed to connect to the secret store',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    logger.error('Error testing secret store connection:', error);
    return res.status(500).json({ error: 'Failed to test secret store connection' });
  }
});

export default router; 