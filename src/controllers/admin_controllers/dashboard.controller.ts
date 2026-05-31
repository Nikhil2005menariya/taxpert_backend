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

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;

    const service = createServiceClient();

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // ── Run all top-level queries in parallel ──────────────────────────────────
    const [
      // Revenue rows — fetch raw and sum in JS (same pattern as getPaymentStats)
      revAllRes,
      revMonthRes,
      failedRes,

      pipelineDocsRequired,
      pipelineDocsReceived,
      pipelineUnderReview,
      pipelineInProgress,
      pipelineInvoicePending,
      pipelineCompleted,
      pipelineCancelled,

      queueOpenRes,
      queueTopRes,

      overdueRes,

      recentPayRes,

      texpertUsersRes,

      newClientsRes,
      totalClientsRes,
    ] = await Promise.all([
      // Revenue — all captured (amount + gst_amount for totals)
      service.from('payments').select('amount, gst_amount').eq('status', 'captured'),
      // Revenue — this month captured
      service.from('payments').select('amount').eq('status', 'captured').gte('captured_at', firstOfMonth),
      // Failed count
      service.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'failed'),

      // Pipeline status counts
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'documents_required'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'documents_received'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'under_review'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'invoice_pending'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),

      // Queue
      service.from('service_assignment_queue').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      service.from('service_assignment_queue')
        .select('id, priority, client_service_id, client_service:client_services(user_id, service:services(name))')
        .eq('status', 'open')
        .order('priority', { ascending: false })
        .limit(5),

      // Overdue invoices
      service.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'overdue'),

      // Recent payments
      service.from('payments')
        .select('id, amount, payment_method, captured_at, user_id, service_id')
        .eq('status', 'captured')
        .order('captured_at', { ascending: false, nullsFirst: false })
        .limit(5),

      // Texpert users
      service.from('users')
        .select('id, first_name, last_name, role')
        .in('role', ['expert', 'ca'])
        .eq('is_active', true),

      // New clients this month
      service.from('users').select('*', { count: 'exact', head: true }).eq('role', 'client').gte('created_at', firstOfMonth),
      // Total clients
      service.from('users').select('*', { count: 'exact', head: true }).eq('role', 'client'),
    ]);

    // ── Revenue (JS-side sum, same as getPaymentStats) ────────────────────────
    const allCapt  = revAllRes.data   ?? [];
    const monthCapt = revMonthRes.data ?? [];
    const revenue = {
      total:       allCapt.reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
      thisMonth:   monthCapt.reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
      gst:         allCapt.reduce((s: number, p: any) => s + (p.gst_amount ?? 0), 0),
      failedCount: failedRes.count ?? 0,
    };

    // ── Pipeline ──────────────────────────────────────────────────────────────
    const pipeline: Record<string, number> = {
      documents_required:  pipelineDocsRequired.count  ?? 0,
      documents_received:  pipelineDocsReceived.count  ?? 0,
      under_review:        pipelineUnderReview.count   ?? 0,
      in_progress:         pipelineInProgress.count    ?? 0,
      invoice_pending:     pipelineInvoicePending.count ?? 0,
      completed:           pipelineCompleted.count     ?? 0,
      cancelled:           pipelineCancelled.count     ?? 0,
    };

    // ── Queue — batch-fetch client names (FK-hint join on client_services unsafe) ─
    const rawQueue = queueTopRes.data ?? [];
    const queueUserIds = [...new Set(rawQueue.map((q: any) => q.client_service?.user_id).filter(Boolean))] as string[];
    const queueClientsRes = queueUserIds.length
      ? await service.from('users').select('id, first_name, last_name').in('id', queueUserIds)
      : { data: [] as any[] };
    const queueClientMap = new Map<string, string>();
    for (const c of queueClientsRes.data ?? []) {
      queueClientMap.set(c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim());
    }
    const queueItems = rawQueue.map((q: any) => ({
      ...q,
      client_name: q.client_service?.user_id ? (queueClientMap.get(q.client_service.user_id) ?? '—') : '—',
      service_name: Array.isArray(q.client_service?.service) ? q.client_service.service[0]?.name : q.client_service?.service?.name ?? '—',
    }));

    const queue = {
      openCount: queueOpenRes.count ?? 0,
      topItems:  queueItems,
    };

    // ── Recent Payments — enrich with user name + service name ────────────────
    const rawPayments = recentPayRes.data ?? [];
    const paymentUserIds    = [...new Set(rawPayments.map((p: any) => p.user_id).filter(Boolean))];
    const paymentServiceIds = [...new Set(rawPayments.map((p: any) => p.service_id).filter(Boolean))];

    const [payUsersRes, payServicesRes] = await Promise.all([
      paymentUserIds.length
        ? service.from('users').select('id, first_name, last_name').in('id', paymentUserIds as string[])
        : Promise.resolve({ data: [] }),
      paymentServiceIds.length
        ? service.from('services').select('id, name').in('id', paymentServiceIds as string[])
        : Promise.resolve({ data: [] }),
    ]);

    const userMap: Record<string, string> = {};
    for (const u of (payUsersRes.data ?? []) as any[]) {
      userMap[u.id] = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Unknown';
    }
    const serviceMap: Record<string, string> = {};
    for (const s of (payServicesRes.data ?? []) as any[]) {
      serviceMap[s.id] = s.name;
    }

    const recentPayments = rawPayments.map((p: any) => ({
      ...p,
      client_name:  userMap[p.user_id]    ?? '—',
      service_name: serviceMap[p.service_id] ?? '—',
    }));

    // ── Texpert Workload ───────────────────────────────────────────────────────
    const texpertUsers = texpertUsersRes.data ?? [];
    const texpertIds   = texpertUsers.map((u: any) => u.id);

    let texpertWorkload: any[] = [];
    if (texpertIds.length > 0) {
      const workloadRows = await Promise.all(
        texpertIds.map((id: string) =>
          service
            .from('client_services')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_texpert_id', id)
            .not('status', 'in', '("completed","cancelled")')
        )
      );
      texpertWorkload = texpertUsers.map((u: any, i: number) => ({
        id:           u.id,
        first_name:   u.first_name,
        last_name:    u.last_name,
        role:         u.role,
        active_count: workloadRows[i].count ?? 0,
      }));
    }

    // ── Clients ───────────────────────────────────────────────────────────────
    const clients = {
      total:        totalClientsRes.count  ?? 0,
      newThisMonth: newClientsRes.count ?? 0,
    };

    res.json({
      revenue,
      pipeline,
      queue,
      overdueInvoices: overdueRes.count ?? 0,
      recentPayments,
      texpertWorkload,
      clients,
    });

  } catch (err) {
    appLogger.error('getDashboardStats error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
