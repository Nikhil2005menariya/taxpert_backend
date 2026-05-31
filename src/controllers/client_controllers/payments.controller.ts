import { Request, Response } from 'express';
import { isStaffRole, UserRole } from '../../shared/roles';
import { createRazorpayOrder } from '../../utils/razorpay';

export const getPendingClientInvoices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await req.supabase
      .from('client_services')
      .select('id, status, payment_status, service:services(id, name, slug, category, price)')
      .eq('user_id', req.user.id)
      .eq('status', 'invoice_pending')
      .neq('payment_status', 'paid');

    if (error) return res.status(400).json({ error: error.message });

    const rows = data ?? [];

    // Batch-fetch invoice due_date + status for each pending service
    const csIds = rows.map((r: any) => r.id).filter(Boolean);
    const invoiceRes = csIds.length
      ? await req.supabase
          .from('invoices')
          .select('client_service_id, due_date, status, invoice_number')
          .in('client_service_id', csIds)
          .in('status', ['pending', 'overdue'])
      : { data: [] as any[] };

    const invoiceMap = new Map<string, any>();
    for (const inv of invoiceRes.data ?? []) invoiceMap.set(inv.client_service_id, inv);

    const normalized = rows.map((row: any) => {
      const svc = Array.isArray(row.service) ? row.service[0] : row.service;
      const inv = invoiceMap.get(row.id);
      return {
        ...row,
        service:        svc,
        invoice_due_date:    inv?.due_date    ?? null,
        invoice_status:      inv?.status      ?? null,
        invoice_number:      inv?.invoice_number ?? null,
      };
    });

    res.json({ data: normalized });
  } catch (error) {
    console.error('getPendingClientInvoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMyPayments = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await req.supabase
      .from('payments')
      .select('id, amount, base_amount, gst_amount, gst_rate, discount_amount, original_amount, payment_method, status, captured_at, created_at, razorpay_payment_id, client_service_id, service:services(name, category)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    
    const normalized = (data ?? []).map(row => {
      const svc = Array.isArray(row.service) ? row.service[0] : row.service;
      return { ...row, service: svc };
    });

    res.json({ data: normalized });
  } catch (error) {
    console.error('getMyPayments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createOrder = async (req: Request, res: Response) => {
  try {
    const { amount, receipt, notes } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const order = await createRazorpayOrder({ amount, receipt, notes });
    res.json({ data: order });
  } catch (error: any) {
    console.error('createOrder error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
