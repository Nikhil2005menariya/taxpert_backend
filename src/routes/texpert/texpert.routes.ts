import { Router } from 'express';
import multer from 'multer';
import { uploadOutputDoc, uploadOutputDocsBatch, deleteOutputDoc } from '../../controllers/staff_controllers/output-docs.controller';
import {
  getAssignedServices,
  getServiceDetail,
  updateServiceStatus,
  requestReupload,
  addDocSlot,
  approveDocument,
  rejectDocument,
  batchUpdateDocs,
  batchAddDocSlots,
  getOpenQueue,
  claimFromQueue,
  // Phase 2 — workspace
  addTexpertTask,
  updateTexpertTask,
  deleteTexpertTask,
  logInternalNote,
  updatePinnedMessage,
  updateNotesField,
  // Phase 5 — dashboard
  getDashboard,
} from '../../controllers/staff_controllers/texpert.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

// ── Dashboard ────────────────────────────────────────────────
router.get('/dashboard',                             getDashboard);

// ── Assigned services ────────────────────────────────────────
router.get('/services',                              getAssignedServices);
router.get('/services/:id',                          getServiceDetail);
router.patch('/services/:id/status',                 updateServiceStatus);
router.patch('/services/:id/pinned',                 updatePinnedMessage);
router.patch('/services/:id/notes-field',            updateNotesField);

// ── Document actions ─────────────────────────────────────────
router.post('/services/:id/docs/:docId/approve',     approveDocument);
router.post('/services/:id/docs/:docId/reject',      rejectDocument);
router.post('/services/:id/reupload',                requestReupload);
router.post('/services/:id/doc-slots',               addDocSlot);
// Bulk actions — single bundled email/notification for the client
router.patch('/services/:id/docs/batch',             batchUpdateDocs);
router.post('/services/:id/doc-slots/batch',         batchAddDocSlots);

// ── Tasks (internal checklist) ───────────────────────────────
router.post('/services/:id/tasks',                   addTexpertTask);
router.patch('/services/:id/tasks/:taskId',          updateTexpertTask);
router.delete('/services/:id/tasks/:taskId',         deleteTexpertTask);

// ── Internal notes (timeline) ────────────────────────────────
router.post('/services/:id/notes',                   logInternalNote);

// ── Output documents (texpert-generated) ────────────────────
router.post('/services/:id/output-docs',             upload.single('file'), uploadOutputDoc);
router.post('/services/:id/output-docs/batch',       upload.array('files', 20), uploadOutputDocsBatch);
router.delete('/services/:id/output-docs/:docId',    deleteOutputDoc);

// ── Self-assign queue ────────────────────────────────────────
router.get('/queue',                                 getOpenQueue);
router.post('/queue/:queueId/claim',                 claimFromQueue);

export default router;
