import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isTaxExpertRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';
import {
  sendReuploadRequestEmail,
  sendAdditionalDocAddedEmail,
} from '../../utils/email';

async function assertTexpert(req: Request, res: Response): Promise<{ role: string } | null> {
  if (!req.user || !req.supabase) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const { data } = await req.supabase.from('users').select('role, is_active').eq('id', req.user.id).single();
  if (!data || !isTaxExpertRole(data.role as UserRole)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  if (!data.is_active) { res.status(403).json({ error: 'Account deactivated' }); return null; }
  return data;
}

export const getAssignedServices = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const service = createServiceClient();

    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? '').trim();

    let query = service
      .from('client_services')
      .select(`
        id, status, fiscal_year, notes, created_at, updated_at,
        service:services(name, slug, category),
        client:users!client_services_user_id_fkey(id, first_name, last_name, email),
        client_documents(id, document_name, status, reupload_requested)
      `)
      .eq('assigned_texpert_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    // Client-side search filter on service name or client name (Supabase nested filter workaround)
    const filtered = search
      ? (data ?? []).filter(cs => {
          const svcName    = (cs.service as any)?.name?.toLowerCase() ?? '';
          const clientName = `${(cs.client as any)?.first_name ?? ''} ${(cs.client as any)?.last_name ?? ''}`.toLowerCase();
          return svcName.includes(search.toLowerCase()) || clientName.includes(search.toLowerCase());
        })
      : data;

    res.json({ data: filtered });
  } catch (err) {
    appLogger.error('getAssignedServices error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getServiceDetail = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    const { data, error } = await service
      .from('client_services')
      .select(`
        id, status, fiscal_year, notes, created_at, updated_at,
        service:services(name, slug, category, price),
        client:users!client_services_user_id_fkey(id, first_name, last_name, email, mobile),
        client_documents(id, document_name, status, file_url, reupload_requested, reupload_note, uploaded_at),
        service_events(id, event_type, message, created_at, actor_user_id)
      `)
      .eq('id', id)
      .eq('assigned_texpert_id', req.user!.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Service not found' });

    res.json({ data });
  } catch (err) {
    appLogger.error('getServiceDetail error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateServiceStatus = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) return res.status(400).json({ error: 'status is required' });

    const ALLOWED_STATUSES = [
      'documents_required', 'documents_received', 'in_progress',
      'under_review', 'invoice_pending', 'completed', 'on_hold',
    ];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const service = createServiceClient();

    // Verify ownership
    const { data: cs } = await service
      .from('client_services')
      .select('id, user_id, service:services(name)')
      .eq('id', id)
      .eq('assigned_texpert_id', req.user!.id)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });

    const updatePayload: Record<string, unknown> = {
      status,
      status_updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) updatePayload.notes = notes;

    const { error } = await service
      .from('client_services')
      .update(updatePayload)
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    // Log service event
    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'status_changed',
      actor_user_id:     req.user!.id,
      message:           `Status updated to ${status}`,
      metadata:          { status, notes },
    });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'update_service_status',
      targetType: 'client_service',
      targetId:   id,
      metadata:   { status },
    });

    // TODO: queue workflow status email to client

    res.json({ success: true });
  } catch (err) {
    appLogger.error('updateServiceStatus error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const requestReupload = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    const { documentId, note } = req.body;

    if (!documentId) return res.status(400).json({ error: 'documentId is required' });

    const service = createServiceClient();

    // Verify the document belongs to a service assigned to this texpert
    const { data: doc } = await service
      .from('client_documents')
      .select(`
        id, document_name, client_service_id,
        client_service:client_services(
          assigned_texpert_id, user_id,
          service:services(name),
          client:users!client_services_user_id_fkey(email, first_name)
        )
      `)
      .eq('id', documentId)
      .eq('client_service_id', id)
      .single();

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const cs = doc.client_service as any;
    if (cs?.assigned_texpert_id !== req.user!.id) {
      return res.status(403).json({ error: 'Not assigned to this service' });
    }

    const { error } = await service
      .from('client_documents')
      .update({
        reupload_requested:    true,
        reupload_requested_at: new Date().toISOString(),
        reupload_requested_by: req.user!.id,
        reupload_note:         note ?? null,
      })
      .eq('id', documentId);

    if (error) return res.status(400).json({ error: error.message });

    // Log service event
    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'document_rejected',
      actor_user_id:     req.user!.id,
      message:           `Re-upload requested for: ${doc.document_name}`,
      metadata:          { documentId, note },
    });

    // Send email to client
    if (cs?.client?.email) {
      await sendReuploadRequestEmail({
        to:           cs.client.email,
        firstName:    cs.client.first_name,
        serviceName:  cs.service?.name ?? 'your service',
        documentName: doc.document_name,
        note,
      });
    }

    res.json({ success: true });
  } catch (err) {
    appLogger.error('requestReupload error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addDocSlot = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    const { documentName } = req.body;

    if (!documentName?.trim()) {
      return res.status(400).json({ error: 'documentName is required' });
    }

    const service = createServiceClient();

    // Verify ownership
    const { data: cs } = await service
      .from('client_services')
      .select(`
        id, user_id, assigned_texpert_id,
        service:services(name),
        client:users!client_services_user_id_fkey(email, first_name)
      `)
      .eq('id', id)
      .eq('assigned_texpert_id', req.user!.id)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });

    const { data: newDoc, error } = await service
      .from('client_documents')
      .insert({
        client_service_id: id,
        document_name:     documentName.trim(),
        status:            'pending',
        template_id:       null,
      })
      .select('id')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Log service event
    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'optional_document_added',
      actor_user_id:     req.user!.id,
      message:           `Additional document slot added: ${documentName}`,
      metadata:          { documentId: newDoc.id, documentName },
    });

    const clientData = cs.client as any;
    if (clientData?.email) {
      await sendAdditionalDocAddedEmail({
        to:          clientData.email,
        firstName:   clientData.first_name,
        serviceName: (cs.service as any)?.name ?? 'your service',
        docName:     documentName.trim(),
      });
    }

    res.json({ success: true, documentId: newDoc.id });
  } catch (err) {
    appLogger.error('addDocSlot error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getOpenQueue = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const service = createServiceClient();

    const { data: qItems, error } = await service
      .from('service_assignment_queue')
      .select(`
        id, priority, created_at,
        client_service:client_services(
          id, fiscal_year, status, user_id,
          service:services(name, slug, category)
        )
      `)
      .eq('status', 'open')
      .order('priority', { ascending: false })
      .order('created_at');

    if (error) return res.status(400).json({ error: error.message });
    if (!qItems?.length) return res.json({ data: [] });

    const userIds = [...new Set(qItems.map((q: any) => q.client_service?.user_id).filter(Boolean))];
    const { data: clients } = await service
      .from('users')
      .select('id, first_name, last_name')
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
    appLogger.error('getOpenQueue error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const claimFromQueue = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { queueId } = req.params;
    const service = createServiceClient();

    // Fetch the queue item
    const { data: qItem } = await service
      .from('service_assignment_queue')
      .select('id, client_service_id, status')
      .eq('id', queueId)
      .eq('status', 'open')
      .single();

    if (!qItem) return res.status(404).json({ error: 'Queue item not found or already claimed' });

    // Assign texpert on client_service
    const { error: assignError } = await service
      .from('client_services')
      .update({
        assigned_texpert_id:  req.user!.id,
        assigned_texpert_at:  new Date().toISOString(),
        assigned_by_admin_id: null,
      })
      .eq('id', qItem.client_service_id);

    if (assignError) return res.status(400).json({ error: assignError.message });

    // Mark queue item as claimed
    await service
      .from('service_assignment_queue')
      .update({ status: 'claimed', claimed_by: req.user!.id, claimed_at: new Date().toISOString() })
      .eq('id', queueId);

    await writeAudit({
      actorId:    req.user!.id,
      action:     'self_assign_service',
      targetType: 'client_service',
      targetId:   qItem.client_service_id,
      metadata:   { queueId },
    });

    res.json({ success: true, clientServiceId: qItem.client_service_id });
  } catch (err) {
    appLogger.error('claimFromQueue error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
