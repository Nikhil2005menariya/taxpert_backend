import { Router } from 'express';
import { getCommonDocumentSignedUrl } from '../../controllers/client_controllers/documents.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/:id/download', getCommonDocumentSignedUrl);

export default router;
