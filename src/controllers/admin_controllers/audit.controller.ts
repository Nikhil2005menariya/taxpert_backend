import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';

async function assertAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.user || !req.supabase) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const { data } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!isAdminRole(data?.role as UserRole)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

export const getAuditLog = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const sc = createServiceClient();

    const page       = Math.max(1, parseInt(String(req.query.page       ?? '1'), 10));
    const limit      = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
    const actorId    = String(req.query.actorId    ?? '').trim();
    const action     = String(req.query.action     ?? '').trim();
    const targetType = String(req.query.targetType ?? '').trim();
    const search     = String(req.query.search     ?? '').trim();
    const fromDate   = String(req.query.from_date  ?? '').trim();
    const toDate     = String(req.query.to_date    ?? '').trim();

    // ── Resolve search term → matching user IDs ───────────────────────────
    let searchUserIds: string[] = [];
    if (search) {
      const { data: matchedUsers } = await sc
        .from('users')
        .select('id')
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,pan.ilike.%${search}%,mobile.ilike.%${search}%`);
      searchUserIds = (matchedUsers ?? []).map((u: any) => u.id);
      if (searchUserIds.length === 0) {
        return res.json({ data: [], count: 0, page, limit });
      }
    }

    // ── Build base query ──────────────────────────────────────────────────
    let query = sc
      .from('audit_log')
      .select(`
        id, action, target_type, target_id, metadata, created_at,
        actor:users!audit_log_actor_id_fkey(id, first_name, last_name, email, role, pan, mobile)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (actorId)    query = query.eq('actor_id',    actorId);
    if (action)     query = query.eq('action',      action);
    if (targetType) query = query.eq('target_type', targetType);
    if (fromDate)   query = query.gte('created_at', fromDate);
    if (toDate)     query = query.lte('created_at', toDate + 'T23:59:59.999Z');

    if (searchUserIds.length > 0) {
      const idList = searchUserIds.join(',');
      query = (query as any).or(
        `actor_id.in.(${idList}),and(target_type.eq.user,target_id.in.(${idList}))`
      );
    }

    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const entries = (data ?? []) as any[];

    // ── Collect entity IDs to resolve ─────────────────────────────────────
    const csIds      = new Set<string>();
    const userIds    = new Set<string>();
    const paymentIds = new Set<string>();

    for (const e of entries) {
      const m = e.metadata ?? {};
      if (e.target_type === 'client_service')                         csIds.add(e.target_id);
      if (e.target_type === 'client_document' && m.clientServiceId)   csIds.add(m.clientServiceId as string);
      if (e.target_type === 'payment')                                paymentIds.add(e.target_id);
      if (e.target_type === 'user')                                   userIds.add(e.target_id);
      // clientServiceId in metadata (e.g. payment_captured, document_uploaded)
      if (m.clientServiceId) csIds.add(m.clientServiceId as string);
      // User IDs embedded in metadata
      for (const k of ['texpertId', 'userId', 'clientId'] as const) {
        if (m[k]) userIds.add(m[k] as string);
      }
    }

    // ── Batch fetch entities ──────────────────────────────────────────────
    const [usersRes, csRes, paymentsRes] = await Promise.all([
      userIds.size
        ? sc.from('users')
            .select('id, first_name, last_name, email, role, pan, mobile')
            .in('id', [...userIds])
        : { data: [] as any[] },
      csIds.size
        ? sc.from('client_services')
            .select('id, status, fiscal_year, user_id, assigned_texpert_id, service:services(id, name, slug, category)')
            .in('id', [...csIds])
        : { data: [] as any[] },
      paymentIds.size
        // Payment audit entries store target_id = razorpay_payment_id (not the UUID PK).
        ? sc.from('payments')
            .select('id, amount, base_amount, gst_amount, gst_rate, discount_amount, payment_method, razorpay_payment_id, razorpay_order_id, status, user_id, service_id, coupon_id, captured_at')
            .in('razorpay_payment_id', [...paymentIds])
        : { data: [] as any[] },
    ]);

    const userMap    = new Map<string, any>((usersRes.data    ?? []).map((u: any) => [u.id, u]));
    const csMap      = new Map<string, any>((csRes.data       ?? []).map((cs: any) => [cs.id, cs]));
    const paymentMap = new Map<string, any>((paymentsRes.data ?? []).map((p: any) => [p.razorpay_payment_id, p]));

    // Collect additional user IDs from client_services and payments
    const secondaryUserIds = new Set<string>();
    for (const cs of csRes.data ?? []) {
      if (cs.user_id             && !userMap.has(cs.user_id))            secondaryUserIds.add(cs.user_id);
      if (cs.assigned_texpert_id && !userMap.has(cs.assigned_texpert_id)) secondaryUserIds.add(cs.assigned_texpert_id);
    }
    for (const p of paymentsRes.data ?? []) {
      if (p.user_id && !userMap.has(p.user_id)) secondaryUserIds.add(p.user_id);
    }

    // Service IDs from payments
    const svcIds = new Set<string>();
    for (const p of paymentsRes.data ?? []) {
      if (p.service_id) svcIds.add(p.service_id);
    }

    const [moreUsersRes, svcRes] = await Promise.all([
      secondaryUserIds.size
        ? sc.from('users').select('id, first_name, last_name, email, role, pan, mobile').in('id', [...secondaryUserIds])
        : { data: [] as any[] },
      svcIds.size
        ? sc.from('services').select('id, name, slug').in('id', [...svcIds])
        : { data: [] as any[] },
    ]);

    for (const u of moreUsersRes.data ?? []) userMap.set(u.id, u);
    const svcMap = new Map<string, any>((svcRes.data ?? []).map((s: any) => [s.id, s]));

    // ── Build enriched entries ────────────────────────────────────────────
    const enrichedData = entries.map((entry: any) => {
      const m       = entry.metadata ?? {};
      const en: Record<string, any> = {};

      // ── client_service target ──
      if (entry.target_type === 'client_service') {
        const cs = csMap.get(entry.target_id);
        if (cs) {
          en.service_name   = (cs.service as any)?.name  ?? null;
          en.service_slug   = (cs.service as any)?.slug  ?? null;
          en.service_status = cs.status;
          en.fiscal_year    = cs.fiscal_year;
          en.client  = userMap.get(cs.user_id) ?? null;
          en.texpert = cs.assigned_texpert_id ? (userMap.get(cs.assigned_texpert_id) ?? null) : null;
        }
      }

      // ── client_document target ──
      if (entry.target_type === 'client_document') {
        const cs = csMap.get(m.clientServiceId as string);
        if (cs) {
          en.service_name = (cs.service as any)?.name ?? null;
          en.client       = userMap.get(cs.user_id) ?? null;
          en.texpert      = cs.assigned_texpert_id ? (userMap.get(cs.assigned_texpert_id) ?? null) : null;
        }
      }

      // ── user target ──
      if (entry.target_type === 'user') {
        en.target_user = userMap.get(entry.target_id) ?? null;
      }

      // ── payment target ──
      if (entry.target_type === 'payment') {
        const p = paymentMap.get(entry.target_id);
        if (p) {
          en.payment_amount    = p.amount;
          en.base_amount       = p.base_amount;
          en.gst_amount        = p.gst_amount;
          en.gst_rate          = p.gst_rate;
          en.discount_amount   = p.discount_amount;
          en.payment_method    = p.payment_method;
          en.razorpay_id       = p.razorpay_payment_id;
          en.razorpay_order_id = p.razorpay_order_id;
          en.payment_status    = p.status;
          en.payment_captured_at = p.captured_at;
          en.coupon_id         = p.coupon_id;
          en.client = userMap.get(p.user_id) ?? null;
          const svc = svcMap.get(p.service_id);
          if (svc) en.service_name = svc.name;
        }
        // Texpert from clientServiceId in metadata
        const cs = csMap.get(m.clientServiceId as string);
        if (cs?.assigned_texpert_id) {
          en.texpert = userMap.get(cs.assigned_texpert_id) ?? null;
        }
        // Fallback client from metadata.userId if not already set
        if (!en.client && m.userId) en.client = userMap.get(m.userId as string) ?? null;
      }

      // Resolve texpert from metadata.texpertId if not already set
      if (m.texpertId && !en.texpert) {
        en.texpert = userMap.get(m.texpertId as string) ?? null;
      }

      // For any entry with clientServiceId in metadata, pull service context if not set
      if (m.clientServiceId && !en.service_name) {
        const cs = csMap.get(m.clientServiceId as string);
        if (cs) {
          en.service_name   = (cs.service as any)?.name ?? null;
          en.service_status = cs.status;
          en.fiscal_year    = cs.fiscal_year;
          if (!en.client)  en.client  = userMap.get(cs.user_id) ?? null;
          if (!en.texpert && cs.assigned_texpert_id) {
            en.texpert = userMap.get(cs.assigned_texpert_id) ?? null;
          }
        }
      }

      return { ...entry, enriched: en };
    });

    res.json({ data: enrichedData, count, page, limit });
  } catch (err) {
    appLogger.error('getAuditLog error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
