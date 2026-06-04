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

    // Start of 12-month window for the revenue trend chart
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const [
      revAllRes,
      revMonthRes,
      monthlyPayRes,

      pipelineDocsRequired,
      pipelineDocsReceived,
      pipelineUnderReview,
      pipelineInProgress,
      pipelineInvoicePending,
      pipelineCompleted,
      pipelineCancelled,

      queueOpenRes,
      queueTopRes,

      recentInquiriesRes,
      texpertUsersRes,
      newClientsRes,
      totalClientsRes,
    ] = await Promise.all([
      // Revenue totals
      service.from('payments').select('amount').eq('status', 'captured'),
      service.from('payments').select('amount').eq('status', 'captured').gte('captured_at', firstOfMonth),

      // Monthly revenue for line chart (last 12 months)
      service.from('payments')
        .select('amount, captured_at')
        .eq('status', 'captured')
        .gte('captured_at', twelveMonthsAgo.toISOString()),

      // Pipeline status counts
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'documents_required'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'documents_received'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'under_review'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'payment'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      service.from('client_services').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),

      // Queue
      service.from('service_assignment_queue').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      service.from('service_assignment_queue')
        .select('id, priority, client_service_id, client_service:client_services(user_id, service:services(name))')
        .eq('status', 'open')
        .order('priority', { ascending: false })
        .limit(5),

      // Recent pending consultation inquiries
      service.from('consultation_requests')
        .select('id, name, phone, email, service_needed, created_at')
        .eq('is_consulted', false)
        .order('created_at', { ascending: false })
        .limit(5),

      // Texpert users for workload
      service.from('users')
        .select('id, first_name, last_name, role')
        .in('role', ['expert', 'ca'])
        .eq('is_active', true),

      // Client counts
      service.from('users').select('*', { count: 'exact', head: true }).eq('role', 'client').gte('created_at', firstOfMonth),
      service.from('users').select('*', { count: 'exact', head: true }).eq('role', 'client'),
    ]);

    // ── Revenue ───────────────────────────────────────────────────────────────
    const revenue = {
      total:     (revAllRes.data   ?? []).reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
      thisMonth: (revMonthRes.data ?? []).reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
    };

    // ── Revenue by month (last 12) ────────────────────────────────────────────
    const monthAmountMap: Record<string, number> = {};
    for (const p of (monthlyPayRes.data ?? []) as any[]) {
      if (!p.captured_at) continue;
      const key = (p.captured_at as string).slice(0, 7); // "2025-06"
      monthAmountMap[key] = (monthAmountMap[key] ?? 0) + (p.amount ?? 0);
    }

    const revenueByMonth: { key: string; label: string; amount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      revenueByMonth.push({ key, label, amount: monthAmountMap[key] ?? 0 });
    }

    // ── Pipeline ──────────────────────────────────────────────────────────────
    const pipeline: Record<string, number> = {
      documents_required: pipelineDocsRequired.count  ?? 0,
      documents_received: pipelineDocsReceived.count  ?? 0,
      under_review:       pipelineUnderReview.count   ?? 0,
      in_progress:        pipelineInProgress.count    ?? 0,
      payment:            pipelineInvoicePending.count ?? 0,
      completed:          pipelineCompleted.count      ?? 0,
      cancelled:          pipelineCancelled.count      ?? 0,
    };

    // ── Queue — batch-fetch client names ──────────────────────────────────────
    const rawQueue = queueTopRes.data ?? [];
    const queueUserIds = [...new Set((rawQueue as any[]).map((q: any) => q.client_service?.user_id).filter(Boolean))] as string[];
    const queueClientsRes = queueUserIds.length
      ? await service.from('users').select('id, first_name, last_name').in('id', queueUserIds)
      : { data: [] as any[] };
    const queueClientMap = new Map<string, string>();
    for (const c of queueClientsRes.data ?? []) {
      queueClientMap.set(c.id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim());
    }
    const queueItems = (rawQueue as any[]).map((q: any) => ({
      ...q,
      client_name:  q.client_service?.user_id ? (queueClientMap.get(q.client_service.user_id) ?? '—') : '—',
      service_name: Array.isArray(q.client_service?.service)
        ? q.client_service.service[0]?.name
        : (q.client_service?.service?.name ?? '—'),
    }));

    const queue = { openCount: queueOpenRes.count ?? 0, topItems: queueItems };

    // ── Texpert Workload ───────────────────────────────────────────────────────
    const texpertUsers = (texpertUsersRes.data ?? []) as any[];
    const texpertIds   = texpertUsers.map((u: any) => u.id);

    let texpertWorkload: any[] = [];
    if (texpertIds.length > 0) {
      const workloadRows = await Promise.all(
        texpertIds.map((id: string) =>
          service.from('client_services')
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

    res.json({
      revenue,
      revenueByMonth,
      pipeline,
      queue,
      recentInquiries: recentInquiriesRes.data ?? [],
      texpertWorkload,
      clients: {
        total:        totalClientsRes.count ?? 0,
        newThisMonth: newClientsRes.count   ?? 0,
      },
    });

  } catch (err) {
    appLogger.error('getDashboardStats error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
