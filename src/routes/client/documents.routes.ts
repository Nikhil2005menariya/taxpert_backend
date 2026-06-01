import { Router } from 'express';
import { verifyDocument, rejectDocument } from '../../controllers/staff_controllers/documents.controller';
import { addOptionalDocument, getDocumentSignedUrl, getCommonDocumentSignedUrl } from '../../controllers/client_controllers/documents.controller';
import { getOutputDocSignedUrl } from '../../controllers/staff_controllers/output-docs.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// Staff document actions
router.post('/:id/verify', verifyDocument);
router.post('/:id/reject', rejectDocument);

// Client document actions
router.post('/add-optional', addOptionalDocument);
router.get('/:id/download', getDocumentSignedUrl);
// Output doc download (accessible to client, texpert, admin)
router.get('/output/:id/download', getOutputDocSignedUrl);

export default router;
