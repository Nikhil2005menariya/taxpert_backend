import { Router } from 'express';
import {
  signupInitiate,
  signupVerifyOtp,
  signupResendOtp,
} from '../../controllers/auth_controllers/signup.controller';
import { login } from '../../controllers/auth_controllers/login.controller';
import { logout, getMe } from '../../controllers/auth_controllers/session.controller';
import { updateProfile, changePassword } from '../../controllers/auth_controllers/profile.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { authLimiter } from '../../middlewares/rate-limit.middleware';

const router = Router();

// Public endpoints — OTP-based signup
router.post('/signup-initiate',    authLimiter, signupInitiate);
router.post('/signup-verify-otp',  authLimiter, signupVerifyOtp);
router.post('/signup-resend-otp',  authLimiter, signupResendOtp);
router.post('/login',              authLimiter, login);

// Protected endpoints
router.use(authMiddleware);

router.post('/logout', logout);
router.get('/me', getMe);
router.patch('/profile', updateProfile);
router.patch('/password', changePassword);

export default router;
