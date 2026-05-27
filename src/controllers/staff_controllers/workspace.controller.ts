import { Request, Response } from 'express';
import { isStaffRole, UserRole } from '../../shared/roles';
import { canAccessClientServiceRecord } from '../../utils/service-access';
import { ensureServiceWorkspace as internalEnsureWorkspace, logServiceEvent, buildFallbackTasks } from '../../utils/operations';
import { createServiceClient } from '../../configs/supabase.config';
// We don't have due-dates or service-config utils migrated yet, so we'll stub the DB due dates as empty if missing.
// We can just rely on the fallback logic since the due-dates complex logic wasn't fully ported in phase 1.

export const getServiceWorkspace = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    
    const { data: serviceRow, error: serviceError } = await req.supabase
      .from('client_services')
      .select(`
        id, user_id, status, payment_status, created_at, assigned_to,
        service:services(slug, name, id),
        client_documents(status)
      `)
      .eq('id', id)
      .single();

    if (serviceError || !serviceRow) return res.status(404).json({ error: 'Service not found' });

    const canAccess = await canAccessClientServiceRecord(req.supabase, {
      viewerId: req.user.id,
      viewerRole: profile?.role as UserRole,
      serviceUserId: serviceRow.user_id,
      assignedTo: serviceRow.assigned_to,
    });
    
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    await internalEnsureWorkspace(id);

    const [tasksResult, eventsResult, dueDatesResult] = await Promise.all([
      req.supabase.from('service_tasks').select('*').eq('client_service_id', id).order('sort_order'),
      req.supabase.from('service_events').select('*').eq('client_service_id', id).order('created_at', { ascending: false }).limit(20),
      req.supabase.from('service_due_dates').select('*').eq('client_service_id', id).order('due_at'),
    ]);

    const docs = (serviceRow.client_documents ?? []) as any[];
    const fallbackTasks = buildFallbackTasks({
      status: serviceRow.status,
      docs: docs.map((doc) => ({ status: doc.status })),
      paymentStatus: serviceRow.payment_status ?? null,
    }).map((task, index) => ({
      id: `virtual-task-${index + 1}`,
      client_service_id: id,
      ...task,
      owner_user_id: null,
      due_at: null,
      completed_at: task.status === 'done' ? new Date().toISOString() : null,
      created_at: serviceRow.created_at,
      updated_at: serviceRow.created_at,
    }));

    const fallbackEvents = [
      {
        id: 'virtual-event-status',
        client_service_id: id,
        event_type: 'status_changed',
        actor_user_id: null,
        message: `Current workflow state: ${serviceRow.status}.`,
        metadata: { status: serviceRow.status },
        created_at: serviceRow.created_at,
      },
    ];

    const tasks = tasksResult.error?.code === '42P01' ? fallbackTasks : (tasksResult.data ?? []);
    const events = eventsResult.error?.code === '42P01' ? fallbackEvents : (eventsResult.data ?? []);
    const dueDates = dueDatesResult.error?.code === '42P01' ? [] : (dueDatesResult.data ?? []);

    res.json({
      data: {
        tasks,
        events,
        dueDates,
        hasPersistentWorkspace:
          tasksResult.error?.code !== '42P01' &&
          eventsResult.error?.code !== '42P01' &&
          dueDatesResult.error?.code !== '42P01',
      }
    });
  } catch (error) {
    console.error('getServiceWorkspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const ensureServiceWorkspace = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    // The internal function assumes service client is used for bootstrap writes.
    const result = await internalEnsureWorkspace(id);
    if (result?.error) return res.status(400).json({ error: result.error });

    res.json({ success: true });
  } catch (error) {
    console.error('ensureServiceWorkspace error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTaskInbox = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    let query = req.supabase
      .from('service_tasks')
      .select(`
        id, client_service_id, title, description, task_type, scope, status,
        owner_user_id, due_at, completed_at, sort_order, created_at, updated_at,
        client_service:client_services(
          id, user_id, assigned_to, status,
          service:services(name, slug),
          user:users!client_services_user_id_fkey(first_name, last_name)
        )
      `)
      .neq('status', 'done')
      .neq('status', 'cancelled')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true });

    if (profile?.role !== 'admin' && profile?.role !== 'super_admin') {
      query = query.or(`owner_user_id.eq.${req.user.id},owner_user_id.is.null`);
    }

    const { data, error } = await query.limit(40);
    if (error?.code === '42P01') return res.json({ data: [] });
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data });
  } catch (error) {
    console.error('getTaskInbox error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateServiceTaskStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data: taskRow, error: taskError } = await req.supabase.from('service_tasks').select('id, client_service_id').eq('id', id).single();
    if (taskError || !taskRow) return res.status(404).json({ error: 'Task not found' });

    const updatePayload = {
      status,
      owner_user_id: req.user.id,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await req.supabase.from('service_tasks').update(updatePayload).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: taskRow.client_service_id,
      actorUserId: req.user.id,
      eventType: 'status_changed',
      message: `Task updated to ${status}.`,
      metadata: { task_id: id, task_status: status },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('updateServiceTaskStatus error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDashboardWorkload = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const [tasksResult, breachesResult] = await Promise.all([
      req.supabase.from('service_tasks').select('id, status, scope, owner_user_id, due_at').or(`owner_user_id.eq.${req.user.id},owner_user_id.is.null`).neq('status', 'done'),
      req.supabase.from('sla_breaches').select('id, severity, resolved_at').is('resolved_at', null),
    ]);

    if (tasksResult.error?.code === '42P01') {
      return res.json({ data: { openTasks: 0, dueSoon: 0, breaches: 0 } });
    }

    const openTasks = tasksResult.data?.length ?? 0;
    const dueSoon = (tasksResult.data ?? []).filter((task) => {
      if (!task.due_at) return false;
      const diff = new Date(task.due_at).getTime() - Date.now();
      return diff >= 0 && diff <= 3 * 24 * 60 * 60 * 1000;
    }).length;
    const breaches = breachesResult.error?.code === '42P01' ? 0 : (breachesResult.data?.length ?? 0);

    res.json({ data: { openTasks, dueSoon, breaches } });
  } catch (error) {
    console.error('getDashboardWorkload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
