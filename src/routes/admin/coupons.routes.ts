// Admin coupon management. Mounted at /api/coupons.
import { Router } from 'express';
import { getAllCoupons, createCoupon, toggleCoupon } from '../../controllers/staff_controllers/coupons.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/admin/all',          getAllCoupons);
router.post('/admin/create',      createCoupon);
router.patch('/admin/:id/toggle', toggleCoupon);

export default router;
