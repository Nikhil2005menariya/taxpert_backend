// Client-facing coupon validation + referrals. Mounted at /api/coupons.
import { Router } from 'express';
import { validateCode, getMyReferralData } from '../../controllers/client_controllers/coupons.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.post('/validate',     validateCode);
router.get('/my-referrals',  getMyReferralData);

export default router;
