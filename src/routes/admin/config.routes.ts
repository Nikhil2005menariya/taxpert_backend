import { Router } from 'express';
import {
  getServiceCategories,
  upsertServiceCategory,
  toggleCategoryActive,
  getServicesConfig,
  getServiceConfigById,
  createService,
  updateService,
  toggleServiceActive,
  getDocumentTypes,
  upsertDocumentType,
  patchDocumentType,
  getServiceDocumentRequirements,
  addDocumentRequirement,
  updateDocumentRequirement,
  removeDocumentRequirement,
  getServiceDueDateTemplates,
  upsertDueDateTemplate,
  removeDueDateTemplate,
  computeDueDatesFromDB,
  getRequiredDocTypesForService
} from '../../controllers/staff_controllers/config.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// Categories
router.get('/categories', getServiceCategories);
router.post('/categories', upsertServiceCategory);
router.patch('/categories/:id/toggle', toggleCategoryActive);

// Services
router.get('/services', getServicesConfig);
router.get('/services/:id', getServiceConfigById);
router.post('/services', createService);
router.put('/services/:id', updateService);
router.patch('/services/:id/toggle', toggleServiceActive);

// Document Types
router.get('/document-types', getDocumentTypes);
router.post('/document-types', upsertDocumentType);
router.patch('/document-types/:id', patchDocumentType);

// Service Document Requirements
router.get('/services/:serviceId/requirements', getServiceDocumentRequirements);
router.post('/requirements', addDocumentRequirement);
router.put('/requirements/:id', updateDocumentRequirement);
router.delete('/requirements/:id', removeDocumentRequirement);
router.get('/services/:serviceId/required-doc-types', getRequiredDocTypesForService);

// Due Date Templates
router.get('/services/:serviceId/due-dates', getServiceDueDateTemplates);
router.post('/due-dates', upsertDueDateTemplate);
router.delete('/due-dates/:id', removeDueDateTemplate);
router.get('/services/:serviceId/compute-due-dates', computeDueDatesFromDB);

export default router;
