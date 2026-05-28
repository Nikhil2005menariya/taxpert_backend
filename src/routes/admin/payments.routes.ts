// Admin-only payments + invoices endpoints. Mounted at /api/payments.
import { Router } from 'express';
import {
  getAllPayments,
  getPaymentStats,
  getAllServicesWithPrices,
  updateServicePrice,
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
router.get('/admin/services-prices',           getAllServicesWithPrices);
router.patch('/admin/services-prices/:id',     updateServicePrice);

// Invoices admin
router.get('/admin/invoices',                  getAllInvoices);
router.get('/admin/invoice-settings',          getInvoiceSettings);
router.patch('/admin/invoice-settings',        updateInvoiceSettings);

export default router;
