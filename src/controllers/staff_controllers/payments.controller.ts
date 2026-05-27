import { Request, Response } from 'express';
import { isStaffRole, isAdminRole, UserRole } from '../../shared/roles';
import { createServiceClient } from '../../configs/supabase.config';

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { startDate, endDate, userId, serviceId, status } = req.query;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    let query = req.supabase
      .from('payments')
      .select(`
        *,
        service:services(name, category),
        user_profile:users!payments_user_id_fkey(first_name, last_name, pan)
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('created_at', startDate as string);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59`);
    if (userId) query = query.eq('user_id', userId as string);
    if (serviceId) query = query.eq('service_id', serviceId as string);
    if (status) query = query.eq('status', status as string);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
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

    const { data, error } = await req.supabase
      .from('payments')
      .select('amount, gst_amount, created_at')
      .eq('status', 'captured');

    if (error) return res.status(400).json({ error: error.message });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const total = data?.reduce((s, p) => s + p.amount, 0) ?? 0;
    const gst = data?.reduce((s, p) => s + p.gst_amount, 0) ?? 0;
    const count = data?.length ?? 0;
    const thisMonth = data?.filter(p => p.created_at >= monthStart).reduce((s, p) => s + p.amount, 0) ?? 0;

    res.json({ data: { total, gst, count, thisMonth } });
  } catch (error) {
    console.error('getPaymentStats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllServicesWithPrices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await req.supabase
      .from('services')
      .select('id, slug, name, category, price, is_active')
      .order('category').order('name');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getAllServicesWithPrices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateServicePrice = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { paise } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    if (paise < 0 || !Number.isInteger(paise)) return res.status(400).json({ error: 'Invalid price' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await req.supabase.from('services').update({ price: paise }).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error('updateServicePrice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- Invoices endpoints (bundled into payments router or separate router) ---
const INVOICE_SELECT = `
  *,
  invoice_items(*),
  client:users!invoices_client_id_fkey(first_name, last_name, email, pan),
  service:services(name, category, slug)
`;

export const getOrCreateInvoice = async (req: Request, res: Response) => {
  try {
    const { clientServiceId } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: existing, error: fetchErr } = await req.supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('client_service_id', clientServiceId)
      .maybeSingle();

    if (fetchErr) return res.status(400).json({ error: fetchErr.message });
    if (existing) return res.json({ data: existing });

    const { data: cs, error: csErr } = await req.supabase
      .from('client_services')
      .select('id, user_id, service_id, status, service:services(id, name, category, slug, price)')
      .eq('id', clientServiceId)
      .maybeSingle();

    if (csErr || !cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const svc = Array.isArray(cs.service) ? cs.service[0] : cs.service;
    const price = svc?.price ?? 0;

    const { data: settings } = await req.supabase
      .from('invoice_settings')
      .select('invoice_prefix')
      .limit(1)
      .maybeSingle();

    const prefix = settings?.invoice_prefix ?? 'TTP';
    const { data: invoiceNum } = await req.supabase.rpc('generate_invoice_number', { prefix });
    const invoiceNumber = invoiceNum ?? `${prefix}-${Date.now()}`;

    const sc = createServiceClient();
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: invoice, error: createErr } = await sc
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        client_id: req.user.id,
        client_service_id: clientServiceId,
        service_id: svc?.id ?? cs.service_id,
        status: 'pending',
        subtotal: price,
        total_amount: price,
        issued_at: new Date().toISOString(),
        due_date: dueDate,
      })
      .select()
      .single();

    if (createErr || !invoice) return res.status(500).json({ error: createErr?.message ?? 'Failed to create invoice' });

    await sc.from('invoice_items').insert({
      invoice_id: invoice.id,
      service_id: svc?.id ?? cs.service_id,
      description: svc?.name ?? 'Professional Tax Service',
      quantity: 1,
      unit_price: price,
      line_total: price,
    });

    const { data: full, error: fullErr } = await req.supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', invoice.id)
      .single();

    if (fullErr) return res.status(400).json({ error: fullErr.message });
    res.json({ data: full });
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

    let query = req.supabase
      .from('invoices')
      .select(`
        id, invoice_number, status, total_amount, issued_at, due_date, paid_at,
        client:users!invoices_client_id_fkey(first_name, last_name, email),
        service:services(name, category)
      `)
      .order('issued_at', { ascending: false });

    if (status) query = query.eq('status', status as string);
    if (clientId) query = query.eq('client_id', clientId as string);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getAllInvoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getInvoiceSettings = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await req.supabase
      .from('invoice_settings')
      .select('*')
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
