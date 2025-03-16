import { Router } from 'express';
import cloudProvidersRouter from './cloud-providers';
import serversRouter from './servers';
import kubernetesRouter from './kubernetes';
import secretStoresRouter from './secret-stores';

const router = Router();

// Register routes
router.use('/cloud-providers', cloudProvidersRouter);
router.use('/servers', serversRouter);
router.use('/kubernetes', kubernetesRouter);
router.use('/secret-stores', secretStoresRouter);

export default router; 