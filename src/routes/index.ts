import { Router } from 'express';

import authRoutes from './auth.routes';
import marketingRoutes from './marketing.routes';
import servicesRoutes from './services.routes';
import clientServicesRoutes from './client-services.routes';
import operationsRoutes from './operations.routes';
import documentsRoutes from './documents.routes';
import vaultRoutes from './vault.routes';
import commonDocumentsRoutes from './common-documents.routes';
import paymentsRoutes from './payments.routes';
import couponsRoutes from './coupons.routes';

import adminRoutes from './admin.routes';
import configRoutes from './config.routes';
import remindersRoutes from './reminders.routes';

const router = Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/marketing', marketingRoutes);
router.use('/services', servicesRoutes);
router.use('/client-services', clientServicesRoutes);
router.use('/operations', operationsRoutes);
router.use('/documents', documentsRoutes);
router.use('/vault', vaultRoutes);
router.use('/common-documents', commonDocumentsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/coupons', couponsRoutes);
router.use('/admin', adminRoutes);
router.use('/config', configRoutes);
router.use('/reminders', remindersRoutes);

export default router;
