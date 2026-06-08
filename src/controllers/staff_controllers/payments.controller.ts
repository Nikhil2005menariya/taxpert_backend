import { Request, Response } from 'express';
import { isStaffRole, isAdminRole, UserRole } from '../../shared/roles';
import { createServiceClient } from '../../configs/supabase.config';

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { startDate, endDate, userId, serviceId, status, method } = req.query;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    // Use service client — payments.user_id references auth.users so FK-hint joins won't work
    const sc = createServiceClient();
    let query = sc
      .from('payments')
      .select('id, amount, base_amount, gst_amount, gst_rate, discount_amount, original_amount, status, payment_method, captured_at, created_at, razorpay_payment_id, razorpay_order_id, coupon_id, user_id, service_id, client_service_id')
      .order('captured_at', { ascending: false, nullsFirst: false });

    if (startDate) query = query.gte('captured_at', startDate as string);
    if (endDate)   query = query.lte('captured_at', `${endDate}T23:59:59Z`);
    if (userId)    query = query.eq('user_id', userId as string);
    if (serviceId) query = query.eq('service_id', serviceId as string);
    if (status)    query = query.eq('status', status as string);
    if (method)    query = query.eq('payment_method', method as string);

    const { data: payments, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    // Batch enrich — 2 queries regardless of row count (avoids N+1)
    const rows = payments ?? [];
    const uniqueUserIds    = [...new Set(rows.map((p: any) => p.user_id).filter(Boolean))]    as string[];
    const uniqueServiceIds = [...new Set(rows.map((p: any) => p.service_id).filter(Boolean))] as string[];

    const [usersRes, svcsRes] = await Promise.all([
      uniqueUserIds.length    ? sc.from('users').select('id, first_name, last_name, email, pan').in('id', uniqueUserIds)    : Promise.resolve({ data: [] as any[] }),
      uniqueServiceIds.length ? sc.from('services').select('id, name, category').in('id', uniqueServiceIds)                  : Promise.resolve({ data: [] as any[] }),
    ]);

    const userMap = new Map<string, any>(); for (const u of usersRes.data ?? [])  userMap.set(u.id, u);
    const svcMap  = new Map<string, any>(); for (const s of svcsRes.data  ?? [])  svcMap.set(s.id, s);

    const enriched = rows.map((p: any) => ({
      ...p,
      user_profile: userMap.get(p.user_id)   ?? null,
      service:      svcMap.get(p.service_id) ?? null,
    }));

    res.json({ data: enriched });
  } catch (error) {
    console.error('getAllPayments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPaymentStats = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const sc = createServiceClient();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [capturedRes, failedRes, monthRes] = await Promise.all([
      sc.from('payments').select('amount, gst_amount').eq('status', 'captured'),
      sc.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      sc.from('payments').select('amount').eq('status', 'captured').gte('captured_at', monthStart),
    ]);

    const total     = (capturedRes.data ?? []).reduce((s, p) => s + p.amount, 0);
    const gst       = (capturedRes.data ?? []).reduce((s, p) => s + (p.gst_amount ?? 0), 0);
    const count     = capturedRes.data?.length ?? 0;
    const thisMonth = (monthRes.data ?? []).reduce((s, p) => s + p.amount, 0);
    const failed    = failedRes.count ?? 0;

    res.json({ data: { total, gst, count, thisMonth, failed } });
  } catch (error) {
    console.error('getPaymentStats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- Invoices endpoints (bundled into payments router or separate router) ---
// Avoid FK-hint on users (constraint name varies by migration) — fetch client separately
const INVOICE_SELECT = `
  *,
  invoice_items(*),
  service:services(name, category, slug)
`;

export const getOrCreateInvoice = async (req: Request, res: Response) => {
  try {
    const { clientServiceId } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const sc = createServiceClient();

    // Use service client for all reads — avoids RLS blocking invoice fetches
    const { data: existing, error: fetchErr } = await sc
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('client_service_id', clientServiceId)
      .maybeSingle();

    if (fetchErr) return res.status(400).json({ error: fetchErr.message });
    if (existing) {
      // Attach client profile (not in INVOICE_SELECT to avoid FK-hint issues)
      const { data: clientProfile } = await sc
        .from('users')
        .select('first_name, last_name, email, pan')
        .eq('id', existing.client_id)
        .single();
      return res.json({ data: { ...existing, client: clientProfile ?? null } });
    }

    const { data: cs, error: csErr } = await sc
      .from('client_services')
      .select('id, user_id, service_id, status, service:services(id, name, category, slug, price)')
      .eq('id', clientServiceId)
      .maybeSingle();

    if (csErr || !cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const svc = Array.isArray(cs.service) ? cs.service[0] : cs.service;
    const price = svc?.price ?? 0;

    // Use service client for all DB ops — avoids RLS blocking invoice creation or RPC calls
    const { data: settings } = await sc
      .from('invoice_settings')
      .select('invoice_prefix, gst_enabled, gst_rate')
      .limit(1)
      .maybeSingle();

    const prefix = settings?.invoice_prefix ?? 'TTP';
    const { data: invoiceNum } = await sc.rpc('generate_invoice_number', { prefix });
    const invoiceNumber = invoiceNum ?? `${prefix}-${Date.now()}`;

    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // GST is additive: catalogue price is the base, GST is charged on top.
    const gstEnabled = settings?.gst_enabled === true;
    const gstRate    = Number(settings?.gst_rate ?? 18);
    const gstAmount  = gstEnabled ? Math.round((price * gstRate) / 100) : 0;
    const totalAmount = price + gstAmount;

    const { data: invoice, error: createErr } = await sc
      .from('invoices')
      .insert({
        invoice_number:    invoiceNumber,
        client_id:         req.user.id,
        client_service_id: clientServiceId,
        service_id:        svc?.id ?? cs.service_id,
        status:            'pending',
        subtotal:          price,
        total_amount:      totalAmount,
        gst_amount:        gstEnabled ? gstAmount : null,
        gst_percent:       gstEnabled ? gstRate : null,
        issued_at:         new Date().toISOString(),
        due_date:          dueDate,
      })
      .select()
      .single();

    if (createErr || !invoice) return res.status(500).json({ error: createErr?.message ?? 'Failed to create invoice' });

    await sc.from('invoice_items').insert({
      invoice_id:  invoice.id,
      service_id:  svc?.id ?? cs.service_id,
      description: svc?.name ?? 'Professional Tax Service',
      quantity:    1,
      unit_price:  price,
      line_total:  price,
    });

    // Re-fetch full invoice with relations, then attach client profile
    const { data: full, error: fullErr } = await sc
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', invoice.id)
      .single();

    if (fullErr) return res.status(400).json({ error: fullErr.message });

    const { data: clientProfile } = await sc
      .from('users')
      .select('first_name, last_name, email, pan')
      .eq('id', req.user.id)
      .single();

    res.json({ data: { ...full, client: clientProfile ?? null } });
  } catch (error) {
    console.error('getOrCreateInvoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllInvoices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { status, clientId } = req.query;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    // Use service client — avoids FK-hint join issues on invoices.client_id
    const sc = createServiceClient();
    let query = sc
      .from('invoices')
      .select('id, invoice_number, status, total_amount, issued_at, due_date, paid_at, client_id, service:services(name, category)')
      .order('issued_at', { ascending: false });

    if (status)   query = query.eq('status',    status    as string);
    if (clientId) query = query.eq('client_id', clientId  as string);

    const { data: invoices, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    // Batch-fetch client profiles
    const rows = invoices ?? [];
    const clientIds = [...new Set(rows.map((i: any) => i.client_id).filter(Boolean))] as string[];
    const clientRes = clientIds.length
      ? await sc.from('users').select('id, first_name, last_name, email').in('id', clientIds)
      : { data: [] as any[] };

    const clientMap = new Map<string, any>();
    for (const c of clientRes.data ?? []) clientMap.set(c.id, c);

    const enriched = rows.map((i: any) => ({
      ...i,
      client: clientMap.get(i.client_id) ?? null,
    }));

    res.json({ data: enriched });
  } catch (error) {
    console.error('getAllInvoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getInvoiceSettings = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    // Any authenticated user can read — used on the client invoice page
    const sc = createServiceClient();
    const { data, error } = await sc
      .from('invoice_settings')
      .select('business_name, support_email, support_phone, website, pan, invoice_prefix, bank_name, account_holder_name, account_number, ifsc, upi_id, default_terms, payment_instructions, logo_url, gst_enabled, gst_rate')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single();

    if (error && error.code !== 'PGRST116') return res.status(400).json({ error: error.message });
    res.json({ data: data || null });
  } catch (error) {
    console.error('getInvoiceSettings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateInvoiceSettings = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    
    // Using JSON body instead of FormData since we are an API
    const updates = req.body;
    
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    if (!updates.business_name) return res.status(400).json({ error: 'Business name is required' });
    if (!updates.invoice_prefix) return res.status(400).json({ error: 'Invoice prefix is required' });

    const sc = createServiceClient();
    const { error } = await sc
      .from('invoice_settings')
      .update(updates)
      .eq('id', '00000000-0000-0000-0000-000000000001');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('updateInvoiceSettings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
