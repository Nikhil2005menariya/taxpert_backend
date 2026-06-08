// Client-facing payments + invoice endpoints. Mounted at /api/payments.
import { Router } from 'express';
import {
  getPendingClientInvoices,
  getMyPayments,
  createOrder,
  getCombinedInvoice,
} from '../../controllers/client_controllers/payments.controller';
import {
  getOrCreateInvoice,
  getInvoiceSettings,
} from '../../controllers/staff_controllers/payments.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/my-payments',                getMyPayments);
router.get('/pending-invoices',           getPendingClientInvoices);
router.post('/create-order',              createOrder);
router.post('/combined-invoice',          getCombinedInvoice);

// Invoice settings — any authenticated user can read (used on the invoice page)
router.get('/invoice-settings',           getInvoiceSettings);

// Invoice for a specific client_service
router.get('/invoices/:clientServiceId',  getOrCreateInvoice);

export default router;
