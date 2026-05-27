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

    const normalized = (data ?? []).map(row => {
      const svc = Array.isArray(row.service) ? row.service[0] : row.service;
      return { ...row, service: svc };
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
      .select('id, amount, gst_rate, status, captured_at, created_at, razorpay_payment_id, client_service_id, service:services(name, category)')
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
