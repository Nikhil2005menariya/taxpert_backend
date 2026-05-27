import { Router } from 'express';
import { 
  getPendingClientInvoices, 
  getMyPayments, 
  createOrder 
} from '../controllers/client_controllers/payments.controller';
import { 
  getAllPayments, 
  getPaymentStats, 
  getAllServicesWithPrices, 
  updateServicePrice, 
  getOrCreateInvoice, 
  getAllInvoices, 
  getInvoiceSettings,
  updateInvoiceSettings 
} from '../controllers/staff_controllers/payments.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
router.use(authMiddleware);

// --- Staff routes ---
router.get('/admin/all', getAllPayments);
router.get('/admin/stats', getPaymentStats);
router.get('/admin/services-prices', getAllServicesWithPrices);
router.patch('/admin/services-prices/:id', updateServicePrice);

// Invoices (Staff)
router.get('/admin/invoices', getAllInvoices);
router.get('/admin/invoice-settings', getInvoiceSettings);
router.patch('/admin/invoice-settings', updateInvoiceSettings);

// --- Client routes ---
router.get('/my-payments', getMyPayments);
router.get('/pending-invoices', getPendingClientInvoices);
router.post('/create-order', createOrder);

// Invoices (Client)
router.get('/invoices/:clientServiceId', getOrCreateInvoice);

export default router;
