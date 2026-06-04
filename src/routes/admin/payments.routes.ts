// Admin-only payments + invoices endpoints. Mounted at /api/payments.
import { Router } from 'express';
import {
  getAllPayments,
  getPaymentStats,
  getAllInvoices,
  getInvoiceSettings,
  updateInvoiceSettings,
} from '../../controllers/staff_controllers/payments.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// Payments admin
router.get('/admin/all',                       getAllPayments);
router.get('/admin/stats',                     getPaymentStats);

// Invoices admin
router.get('/admin/invoices',                  getAllInvoices);
router.get('/admin/invoice-settings',          getInvoiceSettings);
router.patch('/admin/invoice-settings',        updateInvoiceSettings);

export default router;
