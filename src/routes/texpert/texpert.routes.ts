import { Router } from 'express';
import {
  getAssignedServices,
  getServiceDetail,
  updateServiceStatus,
  requestReupload,
  addDocSlot,
  getOpenQueue,
  claimFromQueue,
} from '../../controllers/staff_controllers/texpert.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// Assigned services
router.get('/services',                     getAssignedServices);
router.get('/services/:id',                 getServiceDetail);
router.patch('/services/:id/status',        updateServiceStatus);
router.post('/services/:id/reupload',       requestReupload);
router.post('/services/:id/doc-slots',      addDocSlot);

// Self-assign queue
router.get('/queue',                        getOpenQueue);
router.post('/queue/:queueId/claim',        claimFromQueue);

export default router;
