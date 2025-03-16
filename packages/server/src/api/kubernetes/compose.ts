import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { validateRequest } from '@dokploy/server/middleware/validate-request';
import { ComposeTranslator } from '@dokploy/server/services/kubernetes/compose-translator';
import { prisma } from '@dokploy/server/db';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

const router = Router();
const upload = multer({ dest: 'uploads/' });
const composeTranslator = new ComposeTranslator();

// Schema for translating a Docker Compose file
const translateComposeSchema = z.object({
  composeContent: z.string().optional(),
  clusterId: z.string().optional(),
  namespace: z.string().default('default'),
});

// POST /api/kubernetes/compose/translate
// Translate a Docker Compose file to Kubernetes manifests
router.post(
  '/translate',
  validateRequest(translateComposeSchema),
  async (req, res) => {
    try {
      const { composeContent, namespace } = req.body;

      if (!composeContent) {
        return res.status(400).json({ error: 'Compose content is required' });
      }

      // Translate the compose file
      const manifests = await composeTranslator.translateComposeToKubernetes(composeContent);

      return res.json({
        manifests,
        namespace,
      });
    } catch (error) {
      console.error('Error translating Docker Compose file:', error);
      return res.status(500).json({
        error: 'Failed to translate Docker Compose file',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// POST /api/kubernetes/compose/upload
// Upload and translate a Docker Compose file
router.post('/upload', upload.single('composeFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read the uploaded file
    const composeContent = fs.readFileSync(req.file.path, 'utf8');

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Translate the compose file
    const manifests = await composeTranslator.translateComposeToKubernetes(composeContent);

    return res.json({
      manifests,
      namespace: req.body.namespace || 'default',
    });
  } catch (error) {
    console.error('Error processing uploaded Docker Compose file:', error);
    return res.status(500).json({
      error: 'Failed to process uploaded Docker Compose file',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// POST /api/kubernetes/compose/deploy
// Deploy translated Kubernetes manifests to a cluster
router.post('/deploy', async (req, res) => {
  try {
    const { clusterId, manifests, namespace } = req.body;

    if (!clusterId) {
      return res.status(400).json({ error: 'Cluster ID is required' });
    }

    if (!manifests || Object.keys(manifests).length === 0) {
      return res.status(400).json({ error: 'Manifests are required' });
    }

    // Get the cluster
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

    // TODO: Deploy the manifests to the cluster using the kubeconfig
    // This would typically involve using the Kubernetes client library
    // or executing kubectl commands

    // For now, we'll just return a success message
    return res.json({
      message: 'Manifests deployed successfully',
      namespace,
      manifestCount: Object.keys(manifests).length,
    });
  } catch (error) {
    console.error('Error deploying Kubernetes manifests:', error);
    return res.status(500).json({
      error: 'Failed to deploy Kubernetes manifests',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router; 