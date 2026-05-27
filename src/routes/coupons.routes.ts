import { Router } from 'express';
import { validateCode, getMyReferralData } from '../controllers/client_controllers/coupons.controller';
import { getAllCoupons, createCoupon, toggleCoupon } from '../controllers/staff_controllers/coupons.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// --- Client routes ---
router.post('/validate', validateCode);
router.get('/my-referrals', getMyReferralData);

// --- Staff routes ---
router.get('/admin/all', getAllCoupons);
router.post('/admin/create', createCoupon);
router.patch('/admin/:id/toggle', toggleCoupon);

export default router;
