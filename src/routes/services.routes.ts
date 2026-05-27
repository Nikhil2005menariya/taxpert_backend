import { Router } from 'express';
import { getServices, getServicePriceBySlug, getServiceDocumentTemplates } from '../controllers/public_controllers/services.controller';
import { checkServiceExists, assignService } from '../controllers/client_controllers/services.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { globalLimiter } from '../middlewares/rate-limit.middleware';

const router = Router();

// Public routes
router.get('/', globalLimiter, getServices);
router.get('/:slug/price', globalLimiter, getServicePriceBySlug);
router.get('/:slug/documents', globalLimiter, getServiceDocumentTemplates);

// Protected routes
router.use(authMiddleware);
router.get('/:slug/check', checkServiceExists);
router.post('/assign', assignService);

export default router;
