import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';
import { emailQueue } from '../../queues/email.queue';

async function assertAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.user || !req.supabase) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const { data } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!isAdminRole(data?.role as UserRole)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

export const getQueue = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const service = createServiceClient();

    // Fetch queue items + client_service + service name in one query.
    // Avoid 3-level nested user join (Supabase schema cache limitation).
    const { data: qItems, error } = await service
      .from('service_assignment_queue')
      .select(`
        id, priority, status, created_at,
        client_service:client_services(
          id, fiscal_year, status, user_id,
          service:services(name, slug)
        )
      `)
      .eq('status', 'open')
      .order('priority', { ascending: false })
      .order('created_at');

    if (error) return res.status(400).json({ error: error.message });
    if (!qItems?.length) return res.json({ data: [] });

    // Second query: fetch client profiles for all unique user_ids
    const userIds = [...new Set(qItems.map((q: any) => q.client_service?.user_id).filter(Boolean))];
    const { data: clients } = await service
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', userIds);

    const clientMap: Record<string, any> = {};
    for (const c of clients ?? []) clientMap[c.id] = c;

    const data = qItems.map((q: any) => ({
      ...q,
      client_service: q.client_service
        ? { ...q.client_service, client: clientMap[q.client_service.user_id] ?? null }
        : null,
    }));

    res.json({ data });
  } catch (err) {
    appLogger.error('getQueue error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const assignTexpert = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { clientServiceId, texpertId } = req.body;

    if (!clientServiceId || !texpertId) {
      return res.status(400).json({ error: 'clientServiceId and texpertId are required' });
    }

    const service = createServiceClient();

    // Verify texpert exists and is active
    const { data: texpert } = await service
      .from('users')
      .select('id, first_name, last_name')
      .eq('id', texpertId)
      .in('role', ['expert', 'ca'])
      .eq('is_active', true)
      .single();
    if (!texpert) return res.status(404).json({ error: 'Active taxpert not found' });

    const { error } = await service
      .from('client_services')
      .update({
        assigned_texpert_id:  texpertId,
        assigned_texpert_at:  new Date().toISOString(),
        assigned_by_admin_id: req.user!.id,
      })
      .eq('id', clientServiceId);

    if (error) return res.status(400).json({ error: error.message });

    // Close any open queue entry for this service
    await service
      .from('service_assignment_queue')
      .update({ status: 'closed' })
      .eq('client_service_id', clientServiceId)
      .eq('status', 'open');

    await writeAudit({
      actorId:    req.user!.id,
      action:     'assign_texpert',
      targetType: 'client_service',
      targetId:   clientServiceId,
      metadata:   { texpertId },
    });

    // Queue texpert-assigned email (template sends to BOTH client and texpert)
    try {
      const { data: cs } = await service
        .from('client_services')
        .select('user_id, service_id, fiscal_year')
        .eq('id', clientServiceId)
        .single();
      if (cs) {
        const [{ data: client }, { data: svc }, { data: texpertProfile }] = await Promise.all([
          service.from('users').select('email, first_name').eq('id', cs.user_id).single(),
          service.from('services').select('name').eq('id', cs.service_id).single(),
          service.from('users').select('email, first_name').eq('id', texpertId).single(),
        ]);
        if (client?.email && texpertProfile?.email) {
          emailQueue.add('texpert-assigned', {
            type: 'texpert-assigned',
            payload: {
              clientEmail:       client.email,
              clientFirstName:   client.first_name,
              texpertEmail:      texpertProfile.email,
              texpertFirstName:  texpertProfile.first_name,
              serviceName:       svc?.name ?? 'your service',
              fiscalYear:        cs.fiscal_year ?? null,
            },
          }).catch(e => appLogger.warn('texpert-assigned enqueue failed', { err: e.message }));
        }
      }
    } catch (e) {
      appLogger.warn('assignTexpert email lookup failed', { err: (e as Error).message });
    }

    res.json({ success: true });
  } catch (err) {
    appLogger.error('assignTexpert error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const unassignTexpert = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { clientServiceId } = req.params;
    const service = createServiceClient();

    const { error } = await service
      .from('client_services')
      .update({
        assigned_texpert_id:  null,
        assigned_texpert_at:  null,
        assigned_by_admin_id: null,
      })
      .eq('id', clientServiceId);

    if (error) return res.status(400).json({ error: error.message });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'unassign_texpert',
      targetType: 'client_service',
      targetId:   clientServiceId,
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('unassignTexpert error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addToQueue = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { clientServiceId, priority = 0 } = req.body;

    if (!clientServiceId) {
      return res.status(400).json({ error: 'clientServiceId is required' });
    }

    const service = createServiceClient();

    // Prevent duplicate open entries
    const { data: existing } = await service
      .from('service_assignment_queue')
      .select('id')
      .eq('client_service_id', clientServiceId)
      .eq('status', 'open')
      .single();

    if (existing) return res.status(400).json({ error: 'Service is already in the queue' });

    const { error } = await service
      .from('service_assignment_queue')
      .insert({ client_service_id: clientServiceId, priority });

    if (error) return res.status(400).json({ error: error.message });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'add_to_queue',
      targetType: 'client_service',
      targetId:   clientServiceId,
      metadata:   { priority },
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('addToQueue error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
