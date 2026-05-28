import { Router } from 'express';
import { 
  getClientServices, 
  getDashboardSummary, 
  getDueDateServices, 
  getClientServiceById, 
  removeServiceDirect, 
  requestServiceDeletion, 
  cancelDeletionRequest 
} from '../../controllers/client_controllers/client-services.controller';
import { 
  getOpsServices, 
  getAllClientServices, 
  getUnassignedServices, 
  advanceWorkflow, 
  updateServiceStatus, 
  approveServiceDeletion, 
  rejectServiceDeletion 
} from '../../controllers/staff_controllers/ops.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// --- Named Routes First (Priority) ---

// Staff ops routes
router.get('/ops', getOpsServices);
router.get('/all', getAllClientServices);
router.get('/unassigned', getUnassignedServices);

// Client dashboard routes
router.get('/dashboard', getDashboardSummary);
router.get('/due-dates', getDueDateServices);

// Base route for getting all own/assigned services
router.get('/', getClientServices);

// --- Parameterized Routes (:id) Last ---
router.get('/:id', getClientServiceById);
router.delete('/:id', removeServiceDirect);
router.post('/:id/request-deletion', requestServiceDeletion);
router.post('/:id/cancel-deletion', cancelDeletionRequest);

// Staff parametrized routes
router.post('/:id/advance', advanceWorkflow);
router.patch('/:id/status', updateServiceStatus);
router.post('/:id/approve-deletion', approveServiceDeletion);
router.post('/:id/reject-deletion', rejectServiceDeletion);

export default router;
