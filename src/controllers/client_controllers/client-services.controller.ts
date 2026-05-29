import { Request, Response } from 'express';
import { isAdminRole, isStaffRole, UserRole } from '../../shared/roles';
import { getAssignedClientIds, canAccessClientServiceRecord } from '../../utils/service-access';
import { logServiceEvent } from '../../utils/operations';
import { createServiceClient } from '../../configs/supabase.config';

const SERVICE_SELECT = `
  id, user_id, service_id, status, payment_status, payment_id,
  razorpay_order_id, notes, assigned_to, assigned_by, status_updated_at, created_at, updated_at,
  service:services(id, name, category, slug),
  client_documents(id, template_id, document_name, status, file_path, uploaded_at)
`;

export const getClientServices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const role = profile?.role as UserRole;

    if (!isStaffRole(role)) {
      const { data, error } = await req.supabase
        .from('client_services')
        .select(SERVICE_SELECT)
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ data });
    }

    if (isAdminRole(role)) {
      const { data, error } = await req.supabase
        .from('client_services')
        .select(SERVICE_SELECT)
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ data });
    }

    const assignedClientIds = await getAssignedClientIds(req.supabase, req.user.id);
    const [byAssignment, byClientPool] = await Promise.all([
      req.supabase.from('client_services').select(SERVICE_SELECT).eq('assigned_to', req.user.id).order('created_at', { ascending: false }),
      assignedClientIds.length > 0
        ? req.supabase.from('client_services').select(SERVICE_SELECT).in('user_id', assignedClientIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: null, error: null })
    ]);

    if (byAssignment.error) return res.status(400).json({ error: byAssignment.error.message });
    if (byClientPool.error) return res.status(400).json({ error: byClientPool.error.message });

    const seen = new Map<string, any>();
    for (const row of [...(byAssignment.data ?? []), ...(byClientPool.data ?? [])]) {
      if (row && !seen.has(row.id)) seen.set(row.id, row);
    }
    const merged = [...seen.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ data: merged });
  } catch (error) {
    console.error('getClientServices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDashboardSummary = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const role = (profile?.role ?? 'client') as UserRole;

    if (isStaffRole(role)) {
      const [
        { count: total },
        { count: active },
        { count: needsDocs },
        { count: invoicePending },
      ] = await Promise.all([
        req.supabase.from('client_services').select('id', { count: 'exact', head: true }),
        req.supabase.from('client_services').select('id', { count: 'exact', head: true }).not('status', 'in', '(completed,cancelled)'),
        req.supabase.from('client_services').select('id', { count: 'exact', head: true }).eq('status', 'documents_required'),
        req.supabase.from('client_services').select('id', { count: 'exact', head: true }).eq('status', 'invoice_pending').eq('payment_status', 'pending'),
      ]);
      return res.json({
        data: {
          kind: 'staff',
          total: total ?? 0,
          active: active ?? 0,
          needsDocs: needsDocs ?? 0,
          invoicePending: invoicePending ?? 0,
        }
      });
    }

    const { data: rows, error } = await req.supabase
      .from('client_services')
      .select(`
        id, status, payment_status, updated_at, status_updated_at, created_at, fiscal_year,
        service:services(id, name, slug, category),
        client_documents(id, status)
      `)
      .eq('user_id', req.user.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const all = (rows ?? []) as any[];
    const active = all.filter(s => !['completed', 'cancelled'].includes(s.status));
    const completed = all.filter(s => s.status === 'completed').length;
    const docsRequired = all.filter(s => s.status === 'documents_required');

    const totalPendingDocs = docsRequired.reduce((sum, s) => {
      return sum + (s.client_documents ?? []).filter(
        (d: any) => d.status === 'pending' || d.status === 'rejected' || d.status === 'expired'
      ).length;
    }, 0);

    res.json({
      data: {
        kind: 'client',
        all,
        active,
        docsRequired,
        completed,
        total: all.length,
        totalPendingDocs,
      }
    });
  } catch (error) {
    console.error('getDashboardSummary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDueDateServices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (isStaffRole(profile?.role)) return res.status(403).json({ error: 'Staff should use /workload' });

    const { data, error } = await req.supabase
      .from('client_services')
      .select('status, service:services(slug, name)')
      .eq('user_id', req.user.id)
      .neq('status', 'completed')
      .neq('status', 'cancelled');

    if (error) return res.status(400).json({ error: error.message });

    const normalized = (data ?? []).map((row) => {
      const svc = Array.isArray(row.service) ? row.service[0] ?? null : row.service ?? null;
      return { status: row.status as string, service: svc as { slug: string; name: string } | null };
    });

    res.json({ data: normalized });
  } catch (error) {
    console.error('getDueDateServices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getClientServiceById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error: queryError } = await req.supabase
      .from('client_services')
      .select(`
        id, user_id, service_id, status, payment_status, payment_id,
        pinned_message, pinned_message_at,
        fiscal_year, assigned_to, assigned_by, status_updated_at, created_at, updated_at,
        deletion_requested, deletion_requested_at,
        service:services(id, name, category, slug),
        client_documents(
          id, template_id, document_name, status, file_path,
          notes, reupload_requested, reupload_note, uploaded_at, verified_at, verified_by
        )
      `)
      .eq('id', id)
      .single();

    if (queryError || !data) return res.status(404).json({ error: 'Service not found' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    
    const canAccess = await canAccessClientServiceRecord(req.supabase, {
      viewerId: req.user.id,
      viewerRole: profile?.role as UserRole,
      serviceUserId: data.user_id,
      assignedTo: data.assigned_to ?? null,
    });

    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    res.json({ data });
  } catch (error) {
    console.error('getClientServiceById error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeServiceDirect = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();

    // Use service client (bypasses RLS) for the real reads/writes; req.supabase only for auth
    const sc = createServiceClient();
    const { data: cs } = await sc
      .from('client_services')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (!isStaffRole(profile?.role) && cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    // Count docs via service client
    const { count: docCount } = await sc
      .from('client_documents')
      .select('id', { count: 'exact', head: true })
      .eq('client_service_id', id);

    if ((docCount ?? 0) > 0) return res.status(400).json({ error: 'Service has documents — request deletion instead so your Taxpert can review.' });

    const { error } = await sc.from('client_services').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error('removeServiceDirect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const requestServiceDeletion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const sc = createServiceClient();

    // Verify ownership via service client
    const { data: cs } = await sc.from('client_services').select('id, user_id').eq('id', id).single();
    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date().toISOString();
    const { error } = await sc
      .from('client_services')
      .update({ deletion_requested: true, deletion_requested_at: now, updated_at: now })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: id,
      actorUserId: req.user.id,
      eventType: 'deletion_requested',
      message: 'Client requested deletion for this service.',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('requestServiceDeletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const cancelDeletionRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const sc = createServiceClient();

    const { data: cs } = await sc.from('client_services').select('id, user_id').eq('id', id).single();
    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await sc
      .from('client_services')
      .update({ deletion_requested: false, deletion_requested_at: null })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: id,
      actorUserId: req.user.id,
      eventType: 'deletion_request_cancelled',
      message: 'Client cancelled the deletion request.',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('cancelDeletionRequest error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
