import { Router } from 'express';
import multer from 'multer';
import { 
  getVaultGroups, 
  getVaultServiceDetail, 
  getCommonDocuments, 
  uploadDocument, 
  uploadCommonDocument,
  syncUserCommonDocs,
} from '../controllers/client_controllers/vault.controller';
import { getCommonDocumentSignedUrl } from '../controllers/client_controllers/documents.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max per file
});

const router = Router();
router.use(authMiddleware);

// Upload routes (with multer)
router.post('/upload', upload.single('file'), uploadDocument);
router.post('/common-upload', upload.single('file'), uploadCommonDocument);

// Backfill sync — propagates existing common docs to all active service docs
router.post('/sync', syncUserCommonDocs);

// Data routes
router.get('/groups', getVaultGroups);
router.get('/common-documents', getCommonDocuments);
router.get('/service/:id', getVaultServiceDetail);

// Note: common-documents/:id/download is best placed here or under /common-documents route file
// I will place it under /vault router, but mapping it to /common-documents path in main index or here.
// Actually, MASTER-MIGRATION-PLAN says: GET /api/common-documents/:id/download
// So let's keep it here but we'll export it and mount in index.ts
// Wait, the router is for /vault. So it will be /api/vault/common-documents/:id/download.
// But the plan says /api/common-documents/:id/download. Let's make a separate route file for common-documents if needed,
// OR just add it to vault.routes.ts and mount it twice? No, let's just make it part of vault routes or index.ts.

export default router;
