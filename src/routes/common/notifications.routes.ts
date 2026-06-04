import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from '../../controllers/common_controllers/notifications.controller';

const router = Router();
router.use(authMiddleware);

router.get('/',              getNotifications);
router.get('/unread-count',  getUnreadCount);
router.patch('/read-all',    markAllRead);
router.patch('/:id/read',    markRead);

export default router;
