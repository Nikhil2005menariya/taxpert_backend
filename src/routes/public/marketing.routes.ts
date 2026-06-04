import { Router } from 'express';
import {
  getMarketingCategories,
  getMarketingCategoryBySlug,
  getMarketingServiceBySlug,
} from '../../controllers/public_controllers/marketing.controller';
import { submitConsultation } from '../../controllers/public_controllers/consultation.controller';

const router = Router();

// GET /api/marketing/categories
router.get('/categories', getMarketingCategories);

// GET /api/marketing/services/:slug
router.get('/services/:slug', getMarketingServiceBySlug);

// GET /api/marketing/categories/:slug
router.get('/categories/:slug', getMarketingCategoryBySlug);

// POST /api/marketing/consultations  — public, no auth
router.post('/consultations', submitConsultation);

export default router;
