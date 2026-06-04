import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, isStaffRole, UserRole } from '../../shared/roles';
import { getAssignedClientIds } from '../../utils/service-access';
import { logServiceEvent } from '../../utils/operations';
import { emailQueue } from '../../queues/email.queue';
import { SupabaseClient } from '@supabase/supabase-js';
import { notifyClientForService } from '../../utils/notifications';

const WORKFLOW_TRANSITIONS: Record<string, string> = {
  pending:             "documents_required",
  documents_required:  "documents_received",
  documents_received:  "in_progress",
  in_progress:         "under_review",
  under_review:        "payment",
  payment:             "completed",
};

export const advanceWorkflow = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data: cs } = await req.supabase
      .from('client_services')
      .select('status, payment_status, user_id, service:services(name)')
      .eq('id', id)
      .single();

    if (!cs) return res.status(404).json({ error: 'Not found' });

    const next = WORKFLOW_TRANSITIONS[cs.status];
    if (!next) return res.status(400).json({ error: `No transition from '${cs.status}'` });

    if (cs.status === 'payment' && cs.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Cannot complete — payment not yet confirmed' });
    }

    const now = new Date().toISOString();
    const { error } = await req.supabase
      .from('client_services')
      .update({ status: next, status_updated_at: now, updated_at: now })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: id,
      actorUserId: req.user.id,
      eventType: 'status_changed',
      message: `Workflow advanced to ${next}.`,
      metadata: { previous_status: cs.status, next_status: next },
    });

    try {
      const { data: clientUser } = await req.supabase.from('users').select('first_name, email').eq('id', cs.user_id).single();
      const email = clientUser?.email;
      const firstName = clientUser?.first_name ?? 'there';
      const serviceName = (Array.isArray(cs.service) ? cs.service[0] : cs.service as any)?.name ?? 'your service';
      if (email) {
        emailQueue.add('workflow-status', { type: 'workflow-status', payload: {
          to: email,
          firstName,
          serviceName,
          status: next
        } }).catch(console.error);
      }
      void notifyClientForService(cs.user_id, id, {
        type: 'status_changed',
        title: `${serviceName}: status updated`,
        body: `Now "${String(next).replace(/_/g, ' ')}".`,
        metadata: { status: next },
      });
    } catch {}

    res.json({ newStatus: next });
  } catch (error) {
    console.error('advanceWorkflow error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateServiceStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    // Completion requires confirmed payment — a service cannot be closed unpaid.
    if (status === 'completed') {
      const { data: cs } = await req.supabase
        .from('client_services')
        .select('payment_status')
        .eq('id', id)
        .single();
      if (cs && cs.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Cannot complete — payment not yet confirmed' });
      }
    }

    const now = new Date().toISOString();
    const { error } = await req.supabase
      .from('client_services')
      .update({ status, status_updated_at: now, updated_at: now })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: id,
      actorUserId: req.user.id,
      eventType: 'status_changed',
      message: `Service status updated to ${status}.`,
      metadata: { next_status: status },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('updateServiceStatus error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const approveServiceDeletion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date().toISOString();
    const { error } = await req.supabase
      .from('client_services')
      .update({
        status: 'cancelled',
        deletion_requested: false,
        deletion_requested_at: null,
        status_updated_at: now,
        updated_at: now,
      })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('approveServiceDeletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const rejectServiceDeletion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date().toISOString();
    const { error } = await req.supabase
      .from('client_services')
      .update({ deletion_requested: false, deletion_requested_at: null, updated_at: now })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: id,
      actorUserId: req.user.id,
      eventType: 'deletion_rejected',
      message: 'Deletion request rejected by internal operator.',
    });
    res.json({ success: true });
  } catch (error) {
    console.error('rejectServiceDeletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

async function mergeUsersIntoOpsRows(
  supabase: SupabaseClient,
  rows: { user_id: string; assigned_to?: string | null; [k: string]: any }[],
) {
  if (rows.length === 0) return { data: [], error: null };

  const userIds = [
    ...new Set([
      ...rows.map(r => r.user_id),
      ...rows.map(r => r.assigned_to).filter(Boolean) as string[],
    ]),
  ];

  const { data: profiles, error: profErr } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, pan')
    .in('id', userIds);

  if (profErr) return { data: null, error: profErr.message };

  const userMap = new Map((profiles ?? []).map(u => [u.id, u]));

  const merged = rows.map(r => ({
    ...r,
    client: userMap.get(r.user_id) ?? null,
    assignee: r.assigned_to ? userMap.get(r.assigned_to) ?? null : null,
  }));

  return { data: merged, error: null };
}

export const getOpsServices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const BASE_SELECT = `
      id, user_id, service_id, status, payment_status,
      notes, assigned_to, assigned_by, status_updated_at, created_at, updated_at, fiscal_year,
      service:services(id, name, category, slug),
      client_documents(id, status)
    `;

    let query = req.supabase
      .from('client_services')
      .select(BASE_SELECT)
      .order('status_updated_at', { ascending: false, nullsFirst: false });

    if (!isAdminRole(profile?.role as UserRole)) {
      const assignedClientIds = await getAssignedClientIds(req.supabase, req.user.id);
      if (assignedClientIds.length === 0) {
        query = query.eq('assigned_to', req.user.id);
      } else {
        const [byAssigned, byPool] = await Promise.all([
          req.supabase.from('client_services').select(BASE_SELECT).eq('assigned_to', req.user.id).order('status_updated_at', { ascending: false, nullsFirst: false }),
          req.supabase.from('client_services').select(BASE_SELECT).in('user_id', assignedClientIds).order('status_updated_at', { ascending: false, nullsFirst: false }),
        ]);
        if (byAssigned.error) return res.status(400).json({ error: byAssigned.error.message });
        if (byPool.error) return res.status(400).json({ error: byPool.error.message });

        const seen = new Map<string, any>();
        for (const row of [...(byAssigned.data ?? []), ...(byPool.data ?? [])]) {
          if (row && !seen.has(row.id)) seen.set(row.id, row);
        }
        const rows = [...seen.values()].sort(
          (a, b) => new Date(b.status_updated_at ?? b.created_at).getTime() - new Date(a.status_updated_at ?? a.created_at).getTime()
        );
        const merged = await mergeUsersIntoOpsRows(req.supabase, rows);
        return res.json(merged);
      }
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const merged = await mergeUsersIntoOpsRows(req.supabase, data ?? []);
    res.json(merged);
  } catch (error) {
    console.error('getOpsServices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllClientServices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await req.supabase
      .from('client_services')
      .select(`
        id, user_id, service_id, status, payment_status, assigned_to,
        status_updated_at, created_at, updated_at,
        service:services(name, category, slug),
        client_documents(status),
        user:users!client_services_user_id_fkey(first_name, last_name, pan)
      `)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getAllClientServices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUnassignedServices = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const serviceClient = createServiceClient();
    const { data: csRows, error: csErr } = await serviceClient
      .from('client_services')
      .select('id, user_id, status, created_at, service:services(name)')
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    if (csErr) return res.status(400).json({ error: csErr.message });
    if (!csRows?.length) return res.json({ data: [] });

    const userIds = [...new Set(csRows.map(r => r.user_id))];
    const { data: assignments } = await serviceClient
      .from('ca_assignments')
      .select('client_id')
      .in('client_id', userIds);

    const assignedSet = new Set((assignments ?? []).map(a => a.client_id));
    const unassignedRows = csRows.filter(r => !assignedSet.has(r.user_id));

    if (!unassignedRows.length) return res.json({ data: [] });

    const unassignedUserIds = [...new Set(unassignedRows.map(r => r.user_id))];
    const { data: userProfiles } = await serviceClient
      .from('users')
      .select('id, first_name, last_name')
      .in('id', unassignedUserIds);

    const nameMap = new Map((userProfiles ?? []).map(u => [u.id, `${u.first_name} ${u.last_name}`.trim()]));

    const data = unassignedRows.map(r => ({
      clientServiceId: r.id,
      clientUserId: r.user_id,
      clientName: nameMap.get(r.user_id) ?? 'Unknown Client',
      serviceName: (Array.isArray(r.service) ? r.service[0] : r.service as any)?.name ?? '—',
      status: r.status,
      createdAt: r.created_at,
    }));

    res.json({ data });
  } catch (error) {
    console.error('getUnassignedServices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
