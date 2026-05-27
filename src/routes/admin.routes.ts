import { Router } from 'express';
import {
  getAllUsers,
  createUser,
  updateUserRole,
  setUserPassword,
  getAssignments,
  assignToClient,
  removeAssignment,
  getFilingCountsByClient,
  getActiveTaxperts,
  quickAssignTaxpert,
  getClientTaxpert,
  getAllUserPermissionOverrides,
  getUserPermissionOverrides,
  updateUserPermissionOverrides,
  getPermissionAuditLog
} from '../controllers/staff_controllers/admin.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// User Management
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.patch('/users/role', updateUserRole);
router.patch('/users/password', setUserPassword);

// Taxpert Assignments
router.get('/assignments', getAssignments);
router.post('/assignments', assignToClient);
router.delete('/assignments', removeAssignment);
router.get('/taxperts/active', getActiveTaxperts);
router.post('/taxperts/quick-assign', quickAssignTaxpert);
router.get('/taxperts/client/:clientId', getClientTaxpert);

// Analytics
router.get('/analytics/filing-counts', getFilingCountsByClient);

// Permissions
router.get('/permissions', getAllUserPermissionOverrides);
router.get('/permissions/:userId', getUserPermissionOverrides);
router.put('/permissions', updateUserPermissionOverrides);
router.get('/permissions/audit/:targetUserId', getPermissionAuditLog);

export default router;
