import { Router } from 'express';
import {
  listClientUsers,
  listStaffUsers,
  getAllUsers,
  createUser,
  updateUserRole,
  setUserPassword,
  getFilingCountsByClient,
  getActiveTaxperts,
  quickAssignTaxpert,
  getClientTaxpert,
  getAllUserPermissionOverrides,
  getUserPermissionOverrides,
  updateUserPermissionOverrides,
  getPermissionAuditLog
} from '../../controllers/staff_controllers/admin.controller';

// Phase 2 controllers
import { listTaxperts, createTaxpert, getTaxpertDetail, updateTaxpert, deactivateTaxpert, removeTaxpert } from '../../controllers/admin_controllers/taxperts.controller';
import {
  listClientServices,
  listClients, getClientDetail, getClientServices,
  getAdminServiceDetail, adminUpdateService, adminUpdateDocStatus,
  adminAddTask, adminUpdateTask, adminDeleteTask,
  adminLogEvent, adminAddDocSlot,
} from '../../controllers/admin_controllers/clients.controller';
import { getQueue, assignTexpert, unassignTexpert, addToQueue } from '../../controllers/admin_controllers/assignments.controller';
import { getAuditLog } from '../../controllers/admin_controllers/audit.controller';
import { listConsultations, markConsulted } from '../../controllers/admin_controllers/consultations.controller';
import { getDashboardStats } from '../../controllers/admin_controllers/dashboard.controller';

import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// ── Legacy User Management ────────────────────────────────────
router.get('/users/clients', listClientUsers);
router.get('/users/staff',   listStaffUsers);
router.get('/users',         getAllUsers);
router.post('/users', createUser);
router.patch('/users/role', updateUserRole);
router.patch('/users/password', setUserPassword);

router.post('/taxperts/quick-assign', quickAssignTaxpert);
router.get('/taxperts/client/:clientId', getClientTaxpert);

// ── Dashboard Stats ───────────────────────────────────────────
router.get('/dashboard-stats', getDashboardStats);

// ── Analytics ─────────────────────────────────────────────────
router.get('/analytics/filing-counts', getFilingCountsByClient);

// ── Permissions ───────────────────────────────────────────────
router.get('/permissions', getAllUserPermissionOverrides);
router.get('/permissions/:userId', getUserPermissionOverrides);
router.put('/permissions', updateUserPermissionOverrides);
router.get('/permissions/audit/:targetUserId', getPermissionAuditLog);

// ── Phase 2: Taxpert CRUD ─────────────────────────────────────
// NOTE: specific paths before /:id to avoid route conflicts
router.get('/taxperts/active',           getActiveTaxperts);
router.get('/taxperts',                  listTaxperts);
router.post('/taxperts/new',             createTaxpert);
router.get('/taxperts/:id/detail',       getTaxpertDetail);
router.patch('/taxperts/:id/deactivate', deactivateTaxpert);
router.patch('/taxperts/:id',            updateTaxpert);
router.delete('/taxperts/:id',           removeTaxpert);

// ── Phase 2: Client Management ────────────────────────────────
router.get('/client-services',                            listClientServices);
router.get('/clients',                                    listClients);
router.get('/clients/:id',                                getClientDetail);
router.get('/clients/:id/services',                       getClientServices);
// Service detail (full) — accessible by clientServiceId directly
router.get('/client-services/:id',                        getAdminServiceDetail);
router.patch('/client-services/:id',                      adminUpdateService);
router.patch('/client-services/:id/docs/:docId',          adminUpdateDocStatus);
router.post('/client-services/:id/tasks',                  adminAddTask);
router.patch('/client-services/:id/tasks/:taskId',         adminUpdateTask);
router.delete('/client-services/:id/tasks/:taskId',        adminDeleteTask);
router.post('/client-services/:id/events',                 adminLogEvent);
router.post('/client-services/:id/docs',                   adminAddDocSlot);

// ── Phase 2: Assignment Queue ─────────────────────────────────
router.get('/queue',                       getQueue);
router.post('/queue',                      addToQueue);
router.post('/assign',                     assignTexpert);
router.delete('/assign/:clientServiceId',  unassignTexpert);

// ── Phase 2: Audit Log ────────────────────────────────────────
router.get('/audit', getAuditLog);

// ── Consultation Inquiries ────────────────────────────────────
router.get('/consultations',                listConsultations);
router.patch('/consultations/:id/consulted', markConsulted);

export default router;
