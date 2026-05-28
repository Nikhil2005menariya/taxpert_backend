import { Router } from 'express';

// ── Auth ──────────────────────────────────────────────────────
import authRoutes from './auth/auth.routes';

// ── Public (unauthenticated) ──────────────────────────────────
import marketingRoutes        from './public/marketing.routes';
import publicServicesRoutes   from './public/services.routes';

// ── Client-facing (logged-in user) ────────────────────────────
import clientServicesRoutes   from './client/client-services.routes';
import clientDocumentsRoutes  from './client/documents.routes';
import clientVaultRoutes      from './client/vault.routes';
import clientCommonDocsRoutes from './client/common-documents.routes';
import clientPaymentsRoutes   from './client/payments.routes';
import clientCouponsRoutes    from './client/coupons.routes';

// ── Texpert / Operations ──────────────────────────────────────
import texpertRoutes          from './texpert/texpert.routes';
import operationsRoutes       from './texpert/operations.routes';
import remindersRoutes        from './texpert/reminders.routes';

// ── Admin ─────────────────────────────────────────────────────
import adminRoutes            from './admin/admin.routes';
import adminConfigRoutes      from './admin/config.routes';
import adminPaymentsRoutes    from './admin/payments.routes';
import adminCouponsRoutes     from './admin/coupons.routes';

const router = Router();

// ── Mount points (URLs are unchanged from previous structure) ─

// Auth
router.use('/auth',             authRoutes);

// Public
router.use('/marketing',        marketingRoutes);
router.use('/services',         publicServicesRoutes);

// Client-facing
router.use('/client-services',  clientServicesRoutes);
router.use('/documents',        clientDocumentsRoutes);
router.use('/vault',            clientVaultRoutes);
router.use('/common-documents', clientCommonDocsRoutes);

// Payments — both admin + client routers share the /api/payments prefix
router.use('/payments',         adminPaymentsRoutes);
router.use('/payments',         clientPaymentsRoutes);

// Coupons — both admin + client routers share the /api/coupons prefix
router.use('/coupons',          adminCouponsRoutes);
router.use('/coupons',          clientCouponsRoutes);

// Texpert / Ops
router.use('/texpert',          texpertRoutes);
router.use('/operations',       operationsRoutes);
router.use('/reminders',        remindersRoutes);

// Admin
router.use('/admin',            adminRoutes);
router.use('/config',           adminConfigRoutes);

export default router;
