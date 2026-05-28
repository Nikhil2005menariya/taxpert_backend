import { Router } from 'express';
import {
  getMarketingCategories,
  getMarketingCategoryBySlug,
  getMarketingServiceBySlug,
} from '../../controllers/public_controllers/marketing.controller';

const router = Router();

// GET /api/marketing/categories
router.get('/categories', getMarketingCategories);

// GET /api/marketing/services/:slug  (must come before /categories/:slug to avoid route conflict)
router.get('/services/:slug', getMarketingServiceBySlug);

// GET /api/marketing/categories/:slug
router.get('/categories/:slug', getMarketingCategoryBySlug);

export default router;
