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
      .eq('status', 'payment')
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

// Combined invoice — preview for paying multiple pending services together.
// Returns per-service line items (GST additive per invoice_settings), totals,
// the client profile and business settings so the combined bill can be rendered.
export const getCombinedInvoice = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const ids: string[] = Array.isArray(req.body?.clientServiceIds) ? req.body.clientServiceIds : [];
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length < 2) {
      return res.status(400).json({ error: 'Select at least two services to combine.' });
    }

    // Only the caller's own services, in the payment stage, not yet paid.
    const { data: rows, error } = await req.supabase
      .from('client_services')
      .select('id, status, payment_status, service:services(id, name, slug, category, price)')
      .eq('user_id', req.user.id)
      .in('id', uniqueIds);

    if (error) return res.status(400).json({ error: error.message });

    const eligible = (rows ?? []).filter(
      (r: any) => r.status === 'payment' && r.payment_status !== 'paid',
    );
    if (eligible.length !== uniqueIds.length) {
      return res.status(400).json({ error: 'One or more selected services are no longer payable.' });
    }

    // GST settings (additive)
    const { data: settings } = await req.supabase
      .from('invoice_settings')
      .select('business_name, support_email, support_phone, website, pan, invoice_prefix, bank_name, account_holder_name, account_number, ifsc, upi_id, default_terms, payment_instructions, logo_url, gst_enabled, gst_rate')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .maybeSingle();

    const gstEnabled = settings?.gst_enabled === true;
    const gstRate    = Number(settings?.gst_rate ?? 18);

    const items = eligible.map((r: any) => {
      const svc  = Array.isArray(r.service) ? r.service[0] : r.service;
      const base = svc?.price ?? 0;
      const gst  = gstEnabled ? Math.round((base * gstRate) / 100) : 0;
      return {
        clientServiceId: r.id,
        serviceId:       svc?.id ?? null,
        slug:            svc?.slug ?? null,
        name:            svc?.name ?? 'Professional Service',
        category:        svc?.category ?? null,
        base,
        gstAmount:       gst,
        total:           base + gst,
      };
    });

    const subtotal = items.reduce((s, i) => s + i.base, 0);
    const gstTotal = items.reduce((s, i) => s + i.gstAmount, 0);
    const total    = subtotal + gstTotal;

    const { data: client } = await req.supabase
      .from('users')
      .select('first_name, last_name, email, pan')
      .eq('id', req.user.id)
      .maybeSingle();

    res.json({
      data: { items, subtotal, gstTotal, total, gstEnabled, gstRate, settings: settings ?? null, client: client ?? null },
    });
  } catch (error) {
    console.error('getCombinedInvoice error:', error);
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
