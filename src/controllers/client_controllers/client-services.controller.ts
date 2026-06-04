import { Request, Response } from 'express';
import { isAdminRole, isStaffRole, UserRole } from '../../shared/roles';
import { getAssignedClientIds, canAccessClientServiceRecord } from '../../utils/service-access';
import { logServiceEvent } from '../../utils/operations';
import { createServiceClient } from '../../configs/supabase.config';
import { emailQueue } from '../../queues/email.queue';
import { appLogger } from '../../utils/logger';
import { notifyTexpertForService, notifyAdmins } from '../../utils/notifications';

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
      const sc = createServiceClient();
      const [
        { count: total },
        { count: active },
        { count: needsDocs },
        { count: invoicePending },
      ] = await Promise.all([
        sc.from('client_services').select('id', { count: 'exact', head: true }),
        sc.from('client_services').select('id', { count: 'exact', head: true }).not('status', 'in', '(completed,cancelled)'),
        sc.from('client_services').select('id', { count: 'exact', head: true }).in('status', ['documents_required', 'action_required']),
        sc.from('client_services').select('id', { count: 'exact', head: true }).eq('status', 'payment').eq('payment_status', 'pending'),
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
    const PENDING_DOC_STATUSES = ['pending', 'rejected', 'expired'];
    const hasPendingDocs = (s: any) =>
      (s.client_documents ?? []).some((d: any) => PENDING_DOC_STATUSES.includes(d.status));

    const docsRequired = all.filter(
      s => s.status === 'documents_required' || (s.status === 'action_required' && hasPendingDocs(s))
    );

    const totalPendingDocs = docsRequired.reduce((sum, s) => {
      return sum + (s.client_documents ?? []).filter(
        (d: any) => PENDING_DOC_STATUSES.includes(d.status)
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
        fiscal_year, assigned_to, assigned_by, assigned_texpert_id, status_updated_at, created_at, updated_at,
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

    // Fetch output documents (texpert-generated) — use service client to bypass RLS
    const sc = createServiceClient();
    const { data: outputDocsRaw } = await sc
      .from('output_documents')
      .select('id, document_name, description, file_path, mime_type, uploaded_at')
      .eq('client_service_id', id)
      .order('uploaded_at', { ascending: false });

    // Sign URLs for output docs
    const outputDocuments = await Promise.all((outputDocsRaw ?? []).map(async (d: any) => {
      if (!d.file_path) return { ...d, signed_url: null };
      const { data: signed } = await sc.storage.from('client-docs').createSignedUrl(d.file_path, 3600);
      return { ...d, signed_url: signed?.signedUrl ?? null };
    }));

    res.json({ data: { ...data, output_documents: outputDocuments } });
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
      .select('id, user_id, assigned_texpert_id')
      .eq('id', id)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (!isStaffRole(profile?.role) && cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    // Once a Taxpert is assigned they own the work — removal must go through the
    // approval flow (request-deletion → texpert/admin accepts). Block direct delete.
    if (cs.assigned_texpert_id) {
      return res.status(400).json({ error: 'A Taxpert is assigned — request deletion instead so your Taxpert or an admin can review.' });
    }

    // Never hard-delete a service with payment history — financial records must be preserved.
    const { count: payCount } = await sc
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('client_service_id', id);
    if ((payCount ?? 0) > 0) {
      return res.status(400).json({ error: 'This service has payment history and cannot be removed. Please contact support.' });
    }

    // No Taxpert assigned → remove completely. Cascade clears documents, events,
    // tasks and queue entries, so this works even when documents were uploaded.
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
    const { data: cs } = await sc
      .from('client_services')
      .select('id, user_id, service_id, fiscal_year, assigned_texpert_id')
      .eq('id', id)
      .single();
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

    // Notify the assigned Taxpert by email (non-blocking)
    if (cs.assigned_texpert_id) {
      try {
        const [{ data: texpert }, { data: client }, { data: svc }] = await Promise.all([
          sc.from('users').select('email, first_name').eq('id', cs.assigned_texpert_id).single(),
          sc.from('users').select('first_name, last_name, email').eq('id', cs.user_id).single(),
          sc.from('services').select('name').eq('id', cs.service_id).single(),
        ]);
        const clientName = client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || 'A client' : 'A client';
        const serviceName = svc?.name ?? 'a service';
        if (texpert?.email) {
          emailQueue.add('deletion-requested', {
            type:    'deletion-requested',
            payload: {
              to:           texpert.email,
              texpertFirstName: texpert.first_name ?? 'there',
              clientName,
              clientEmail:  client?.email ?? null,
              serviceName,
              fiscalYear:   cs.fiscal_year ?? null,
              clientServiceId: id,
            },
          }).catch(e => appLogger.warn('deletion-requested email enqueue failed', { err: e.message }));
        }
        void notifyTexpertForService(cs.assigned_texpert_id, id, {
          type: 'deletion_requested',
          title: `Deletion requested · ${serviceName}`,
          body: `${clientName} requested to delete this service. Review and approve or reject.`,
        });
        // Admins only need to know about deletion requests on assigned (in-progress) services.
        if (cs.assigned_texpert_id) {
          void notifyAdmins({
            type: 'deletion_requested',
            title: `Deletion requested · ${serviceName}`,
            body: `${clientName} requested to delete an assigned service.`,
            link: `/admin/client-services/${id}`,
          });
        }
      } catch (e) {
        appLogger.warn('deletion-requested email lookup failed', { err: (e as Error).message });
      }
    }

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
