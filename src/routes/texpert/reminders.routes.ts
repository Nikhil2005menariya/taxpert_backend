import { Router } from 'express';
import {
  sendManualReminder,
  getLastReminder,
  getPendingDocumentClients
} from '../../controllers/staff_controllers/reminders.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/pending-clients', getPendingDocumentClients);
router.get('/last/:clientServiceId', getLastReminder);
router.post('/send/:clientServiceId', sendManualReminder);

export default router;
