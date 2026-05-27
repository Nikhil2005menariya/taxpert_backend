import { Router } from 'express';
import { 
  getServiceWorkspace, 
  ensureServiceWorkspace, 
  getTaskInbox, 
  updateServiceTaskStatus, 
  getDashboardWorkload 
} from '../controllers/staff_controllers/workspace.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// Named routes first
router.get('/task-inbox', getTaskInbox);
router.get('/workload', getDashboardWorkload);

// Parameterized routes
router.get('/workspace/:id', getServiceWorkspace);
router.post('/workspace/:id/bootstrap', ensureServiceWorkspace);
router.patch('/tasks/:id/status', updateServiceTaskStatus);

export default router;
