import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';
import { emailQueue } from '../../queues/email.queue';
import { notifyClientForService, notifyTexpertForService } from '../../utils/notifications';

// Helper: enqueue an email and never throw to the caller
function enqueueEmail(type: string, payload: Record<string, unknown>) {
  emailQueue.add(type, { type, payload })
    .catch(e => appLogger.warn(`${type} enqueue failed`, { err: e.message }));
}

async function assertAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.user || !req.supabase) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const { data } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!isAdminRole(data?.role as UserRole)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

export const listClientServices = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const sc = createServiceClient();

    const page   = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit  = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? '').trim();

    // Resolve matching user IDs from search term before the main query
    let clientIdFilter:  string[] | null = null;
    let texpertIdFilter: string[] | null = null;

    if (search) {
      const [clientRes, texpertRes] = await Promise.all([
        sc.from('users').select('id').eq('role', 'client')
          .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,pan.ilike.%${search}%`),
        sc.from('users').select('id').neq('role', 'client')
          .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`),
      ]);
      clientIdFilter  = (clientRes.data  ?? []).map((u: any) => u.id);
      texpertIdFilter = (texpertRes.data ?? []).map((u: any) => u.id);

      // No users matched the search term — return empty immediately
      if (clientIdFilter.length === 0 && texpertIdFilter.length === 0) {
        return res.json({ data: [], count: 0, page, limit });
      }
    }

    let query = sc
      .from('client_services')
      .select('id, status, payment_status, fiscal_year, created_at, updated_at, user_id, service_id, assigned_texpert_id', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) query = query.eq('status', status);

    if (clientIdFilter !== null || texpertIdFilter !== null) {
      const parts: string[] = [];
      if (clientIdFilter  && clientIdFilter.length  > 0) parts.push(`user_id.in.(${clientIdFilter.join(',')})`);
      if (texpertIdFilter && texpertIdFilter.length > 0) parts.push(`assigned_texpert_id.in.(${texpertIdFilter.join(',')})`);
      if (parts.length > 0) query = (query as any).or(parts.join(','));
    }

    const { data: rows, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const allRows = (rows ?? []) as any[];
    const userIds    = [...new Set(allRows.flatMap((r: any) => [r.user_id, r.assigned_texpert_id].filter(Boolean)))] as string[];
    const serviceIds = [...new Set(allRows.map((r: any) => r.service_id).filter(Boolean))] as string[];

    const [usersRes, servicesRes] = await Promise.all([
      userIds.length    ? sc.from('users').select('id, first_name, last_name, email, pan').in('id', userIds)       : { data: [], error: null },
      serviceIds.length ? sc.from('services').select('id, name, slug, category').in('id', serviceIds)             : { data: [], error: null },
    ]);

    const userMap    = new Map<string, any>((usersRes.data    ?? []).map((u: any) => [u.id, u]));
    const serviceMap = new Map<string, any>((servicesRes.data ?? []).map((s: any) => [s.id, s]));

    const data = allRows.map((row: any) => ({
      ...row,
      client:           userMap.get(row.user_id)                                          ?? null,
      assigned_texpert: row.assigned_texpert_id ? userMap.get(row.assigned_texpert_id)   ?? null : null,
      service:          serviceMap.get(row.service_id)                                    ?? null,
    }));

    res.json({ data, count, page, limit });
  } catch (err) {
    appLogger.error('listClientServices error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const listClients = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const service = createServiceClient();

    const page  = parseInt(String(req.query.page  ?? '1'), 10);
    const limit = parseInt(String(req.query.limit ?? '20'), 10);
    const search = String(req.query.search ?? '').trim();

    let query = service
      .from('users')
      .select('id, first_name, last_name, email, mobile, pan, is_active, created_at', { count: 'exact' })
      .eq('role', 'client')
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,pan.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data, count, page, limit });
  } catch (err) {
    appLogger.error('listClients error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getClientDetail = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    const [profileRes, servicesRes] = await Promise.all([
      service.from('users').select('*').eq('id', id).eq('role', 'client').single(),
      service
        .from('client_services')
        .select(`
          id, status, fiscal_year, payment_status, created_at, updated_at,
          assigned_texpert_id,
          service:services(name, slug, price),
          client_documents(id, document_name, status, file_url, reupload_requested)
        `)
        .eq('user_id', id)
        .order('created_at', { ascending: false }),
    ]);

    if (profileRes.error || !profileRes.data) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Enrich each service with its texpert (separate lookup avoids unregistered FK)
    const services = await Promise.all(
      (servicesRes.data ?? []).map(async (s: any) => {
        if (!s.assigned_texpert_id) return { ...s, assigned_texpert: null };
        const { data: tx } = await service.from('users')
          .select('id, first_name, last_name, email')
          .eq('id', s.assigned_texpert_id).single();
        return { ...s, assigned_texpert: tx ?? null };
      })
    );

    res.json({
      profile:  profileRes.data,
      services,
    });
  } catch (err) {
    appLogger.error('getClientDetail error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getClientServices = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    const { data: rows, error } = await service
      .from('client_services')
      .select(`
        id, status, fiscal_year, payment_status, notes, created_at, updated_at,
        assigned_texpert_id,
        service:services(name, slug, category, price),
        client_documents(id, document_name, status, file_url, reupload_requested, reupload_note)
      `)
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const data = await Promise.all(
      (rows ?? []).map(async (s: any) => {
        if (!s.assigned_texpert_id) return { ...s, assigned_texpert: null };
        const { data: tx } = await service.from('users')
          .select('id, first_name, last_name, email')
          .eq('id', s.assigned_texpert_id).single();
        return { ...s, assigned_texpert: tx ?? null };
      })
    );

    res.json({ data });
  } catch (err) {
    appLogger.error('getClientServices error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAdminServiceDetail = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    // Fetch the base row with only scalar columns — no FK-hint joins.
    // Multiple FKs between client_services and users (user_id, assigned_texpert_id, etc.)
    // mean PostgREST requires FK hints, which aren't in the schema cache until NOTIFY pgrst runs.
    // All related rows are fetched as separate parallel queries instead.
    const { data: cs, error } = await service
      .from('client_services')
      .select('id, status, fiscal_year, notes, payment_status, payment_id, razorpay_order_id, pinned_message, is_blocked, blocked_reason, user_id, service_id, assigned_texpert_id, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !cs) {
      appLogger.error('getAdminServiceDetail query failed', { error: error?.message, csNull: !cs });
      return res.status(404).json({ error: 'Service not found', debug: error?.message });
    }

    const csData = cs as any;

    // Parallel lookups for related entities
    const [serviceRes, clientRes, texpertRes, docsRes, outputDocsRes] = await Promise.all([
      service.from('services').select('id, name, slug, category, price').eq('id', csData.service_id).single(),
      service.from('users').select('id, first_name, last_name, email, mobile, pan').eq('id', csData.user_id).single(),
      csData.assigned_texpert_id
        ? service.from('users').select('id, first_name, last_name, email').eq('id', csData.assigned_texpert_id).single()
        : Promise.resolve({ data: null, error: null }),
      service.from('client_documents')
        .select('id, document_name, status, file_path, file_url, reupload_requested, reupload_note, uploaded_at, reupload_requested_at')
        .eq('client_service_id', id),
      service.from('output_documents')
        .select('id, document_name, description, file_path, mime_type, uploaded_by, uploaded_at')
        .eq('client_service_id', id)
        .order('uploaded_at', { ascending: false }),
    ]);

    // Fetch events/tasks in parallel; gracefully handle missing tables (code 42P01)
    const [eventsRes, tasksRes] = await Promise.all([
      service.from('service_events')
        .select('id, event_type, message, created_at, actor_user_id, metadata')
        .eq('client_service_id', id)
        .order('created_at', { ascending: false }),
      service.from('service_tasks')
        .select('id, title, description, task_type, scope, status, owner_user_id, due_at, completed_at, sort_order')
        .eq('client_service_id', id)
        .order('sort_order'),
    ]);

    // Generate signed URLs for documents
    const docs: any[] = docsRes.data ?? [];
    const docsWithUrls = await Promise.all(
      docs.map(async (doc: any) => {
        if (!doc.file_path) return { ...doc, signed_url: null };
        const { data: signed } = await service.storage
          .from('client-docs')
          .createSignedUrl(doc.file_path, 3600);
        return { ...doc, signed_url: signed?.signedUrl ?? null };
      })
    );

    // Generate signed URLs for output docs
    const outputDocs: any[] = outputDocsRes.data ?? [];
    const outputDocsWithUrls = await Promise.all(
      outputDocs.map(async (doc: any) => {
        if (!doc.file_path) return { ...doc, signed_url: null };
        const { data: signed } = await service.storage
          .from('client-docs')
          .createSignedUrl(doc.file_path, 3600);
        return { ...doc, signed_url: signed?.signedUrl ?? null };
      })
    );

    // Enrich output docs with uploader names
    const uploaderIds = [...new Set(outputDocs.map((d: any) => d.uploaded_by).filter(Boolean))] as string[];
    const uploadersRes = uploaderIds.length
      ? await service.from('users').select('id, first_name, last_name').in('id', uploaderIds)
      : { data: [] as any[] };
    const uploaderMap = new Map<string, string>();
    for (const u of uploadersRes.data ?? []) {
      uploaderMap.set(u.id, `${u.first_name} ${u.last_name}`.trim());
    }
    const outputDocsFinal = outputDocsWithUrls.map((d: any) => ({
      ...d,
      uploader_name: uploaderMap.get(d.uploaded_by) ?? 'Taxpert',
    }));

    const events = eventsRes.error?.code === '42P01' ? [] : (eventsRes.data ?? []);
    const tasks  = tasksRes.error?.code  === '42P01' ? [] : (tasksRes.data  ?? []);

    res.json({
      data: {
        ...csData,
        service:          serviceRes.data ?? null,
        client:           clientRes.data ?? null,
        assigned_texpert: texpertRes.data ?? null,
        client_documents: docsWithUrls,
        output_documents: outputDocsFinal,
        service_events:   events,
        service_tasks:    tasks,
      },
    });
  } catch (err) {
    appLogger.error('getAdminServiceDetail error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminUpdateService = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const { status, notes, is_blocked, blocked_reason, pinned_message } = req.body;

    const ALLOWED_STATUSES = [
      'documents_required', 'documents_received', 'in_progress',
      'under_review', 'payment', 'completed', 'on_hold', 'cancelled',
    ];

    const service = createServiceClient();

    // Snapshot the prior state once — used for guards and to detect real changes worth notifying.
    const { data: prev } = await service
      .from('client_services')
      .select('user_id, service_id, status, payment_status, assigned_texpert_id, is_blocked, pinned_message')
      .eq('id', id)
      .single();
    if (!prev) return res.status(404).json({ error: 'Service not found' });

    const updatePayload: Record<string, unknown> = {};
    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}` });
      }
      // Workflow progress requires an assigned Taxpert — nobody is responsible for the work yet.
      if (!prev.assigned_texpert_id) {
        return res.status(400).json({ error: 'Assign a Taxpert before updating the workflow status.' });
      }
      // A service can only be completed once payment is confirmed.
      if (status === 'completed' && prev.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Cannot complete — payment not yet confirmed' });
      }
      updatePayload.status = status;
      updatePayload.status_updated_at = new Date().toISOString();
    }
    if (notes !== undefined) updatePayload.notes = notes;
    if (is_blocked !== undefined) {
      updatePayload.is_blocked = is_blocked;
      updatePayload.blocked_at = is_blocked ? new Date().toISOString() : null;
    }
    if (blocked_reason !== undefined) updatePayload.blocked_reason = blocked_reason;
    if (pinned_message !== undefined) {
      updatePayload.pinned_message = pinned_message;
      updatePayload.pinned_message_at = pinned_message ? new Date().toISOString() : null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { error } = await service.from('client_services').update(updatePayload).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });

    // ── Determine which client-facing changes actually happened ──────────────
    const statusChanged = status !== undefined && status !== prev.status;
    const blockChanged  = is_blocked !== undefined && !!is_blocked !== !!prev.is_blocked;
    const pinnedText    = (pinned_message ?? '').trim();
    const pinnedChanged = pinned_message !== undefined && pinnedText.length > 0
      && pinnedText !== (prev.pinned_message ?? '').trim();

    if (statusChanged) {
      await service.from('service_events').insert({
        client_service_id: id,
        event_type:        'status_changed',
        actor_user_id:     req.user!.id,
        message:           `Status updated to ${status} by admin`,
        metadata:          { status, notes },
      });
    }

    // Notify the client about the changes that matter to them (non-blocking).
    if (statusChanged || blockChanged || pinnedChanged) {
      try {
        const [{ data: client }, { data: svc }] = await Promise.all([
          service.from('users').select('email, first_name').eq('id', prev.user_id).single(),
          service.from('services').select('name').eq('id', prev.service_id).single(),
        ]);
        const serviceName = svc?.name ?? 'your service';
        if (statusChanged) {
          if (client?.email) {
            enqueueEmail('workflow-status', {
              to: client.email, firstName: client.first_name, serviceName, status,
            });
          }
          void notifyClientForService(prev.user_id, id, {
            type: 'status_changed',
            title: `${serviceName}: status updated`,
            body: `Now "${String(status).replace(/_/g, ' ')}".`,
            metadata: { status },
          });
          // Keep the assigned texpert in the loop on admin-driven status changes.
          void notifyTexpertForService(prev.assigned_texpert_id, id, {
            type: 'admin_status_changed',
            title: `Admin updated status · ${serviceName}`,
            body: `Status is now "${String(status).replace(/_/g, ' ')}".`,
            metadata: { status },
          });
        }
        if (blockChanged) {
          if (client?.email) {
            enqueueEmail('service-hold', {
              to: client.email, firstName: client.first_name, serviceName,
              blocked: !!is_blocked,
              reason: is_blocked ? (blocked_reason ?? null) : null,
            });
          }
          void notifyClientForService(prev.user_id, id, {
            type: 'service_hold',
            title: is_blocked ? `${serviceName} paused` : `${serviceName} resumed`,
            body: is_blocked ? (blocked_reason ?? 'Your service has been temporarily paused.') : 'Your service is active again.',
          });
          void notifyTexpertForService(prev.assigned_texpert_id, id, {
            type: 'admin_service_hold',
            title: is_blocked ? `Admin paused · ${serviceName}` : `Admin resumed · ${serviceName}`,
            body: is_blocked ? (blocked_reason ? `Reason: ${blocked_reason}` : 'Service paused by admin.') : 'Service resumed by admin.',
          });
        }
        if (pinnedChanged) {
          if (client?.email) {
            enqueueEmail('pinned-message', {
              to: client.email, firstName: client.first_name, serviceName,
              message: pinnedText, clientServiceId: id,
            });
          }
          void notifyClientForService(prev.user_id, id, {
            type: 'pinned_message',
            title: `New message · ${serviceName}`,
            body: pinnedText.length > 90 ? pinnedText.slice(0, 90) + '…' : pinnedText,
          });
        }
      } catch (e) {
        appLogger.warn('adminUpdateService email lookup failed', { err: (e as Error).message });
      }
    }

    await writeAudit({
      actorId:    req.user!.id,
      action:     'admin_update_service',
      targetType: 'client_service',
      targetId:   id,
      metadata:   updatePayload,
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('adminUpdateService error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminAddTask = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const { title, description, due_at } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    const service = createServiceClient();
    const { data, error } = await service
      .from('service_tasks')
      .insert({
        client_service_id: id,
        title:             title.trim(),
        description:       description?.trim() ?? null,
        task_type:         'admin_task',
        scope:             'internal',
        status:            'todo',
        due_at:            due_at ?? null,
        owner_user_id:     req.user!.id,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'task_added',
      actor_user_id:     req.user!.id,
      message:           `Task added: ${title.trim()}`,
      metadata:          { task_id: data.id },
    });

    res.status(201).json({ data });
  } catch (err) {
    appLogger.error('adminAddTask error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminUpdateTask = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { taskId } = req.params;
    const { status } = req.body;

    const ALLOWED = ['todo', 'in_progress', 'done', 'cancelled'];
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(', ')}` });
    }

    const payload: Record<string, unknown> = { status };
    if (status === 'done') payload.completed_at = new Date().toISOString();

    const service = createServiceClient();
    const { error } = await service.from('service_tasks').update(payload).eq('id', taskId);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('adminUpdateTask error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminDeleteTask = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { taskId } = req.params;

    const service = createServiceClient();
    const { error } = await service.from('service_tasks').delete().eq('id', taskId);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('adminDeleteTask error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminLogEvent = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const service = createServiceClient();
    const { error } = await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'admin_note',
      actor_user_id:     req.user!.id,
      message:           message.trim(),
      metadata:          {},
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    appLogger.error('adminLogEvent error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminAddDocSlot = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const { document_name } = req.body;
    if (!document_name?.trim()) return res.status(400).json({ error: 'document_name is required' });

    const service = createServiceClient();
    const { data, error } = await service
      .from('client_documents')
      .insert({
        client_service_id: id,
        document_name:     document_name.trim(),
        status:            'pending',
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'optional_document_added',
      actor_user_id:     req.user!.id,
      message:           `Document slot added: ${document_name.trim()}`,
      metadata:          { doc_id: data.id },
    });

    // Email client (same template texpert uses)
    try {
      const { data: cs } = await service
        .from('client_services')
        .select('user_id, service_id')
        .eq('id', id)
        .single();
      if (cs) {
        const [{ data: client }, { data: svc }] = await Promise.all([
          service.from('users').select('email, first_name').eq('id', cs.user_id).single(),
          service.from('services').select('name').eq('id', cs.service_id).single(),
        ]);
        const serviceName = svc?.name ?? 'your service';
        if (client?.email) {
          enqueueEmail('additional-doc-added', {
            to:          client.email,
            firstName:   client.first_name,
            serviceName,
            docName:     document_name.trim(),
          });
        }
        void notifyClientForService(cs.user_id, id, {
          type: 'document_added',
          title: `New document requested · ${serviceName}`,
          body: `Please upload: ${document_name.trim()}`,
        });
      }
    } catch (e) {
      appLogger.warn('adminAddDocSlot email lookup failed', { err: (e as Error).message });
    }

    res.status(201).json({ data });
  } catch (err) {
    appLogger.error('adminAddDocSlot error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const adminUpdateDocStatus = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id, docId } = req.params;
    const { action, note } = req.body;

    if (!['approve', 'reject', 'reupload'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve, reject, or reupload' });
    }

    const service = createServiceClient();

    const { data: doc } = await service
      .from('client_documents')
      .select('id, document_name')
      .eq('id', docId)
      .eq('client_service_id', id)
      .single();

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    let updatePayload: Record<string, unknown>;
    let eventType: string;
    let eventMsg: string;

    if (action === 'approve') {
      updatePayload = { status: 'approved', reupload_requested: false };
      eventType = 'document_approved';
      eventMsg = `Document approved: ${doc.document_name}`;
    } else if (action === 'reject') {
      updatePayload = { status: 'rejected', reupload_requested: false };
      eventType = 'document_rejected';
      eventMsg = `Document rejected: ${doc.document_name}`;
    } else {
      updatePayload = {
        reupload_requested:    true,
        reupload_requested_at: new Date().toISOString(),
        reupload_requested_by: req.user!.id,
        reupload_note:         note ?? null,
      };
      eventType = 'document_reupload_requested';
      eventMsg = `Re-upload requested for: ${doc.document_name}`;
    }

    const { error } = await service.from('client_documents').update(updatePayload).eq('id', docId);
    if (error) return res.status(400).json({ error: error.message });

    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        eventType,
      actor_user_id:     req.user!.id,
      message:           eventMsg,
      metadata:          { documentId: docId, action, note },
    });

    // Email client (same template texpert uses)
    try {
      const { data: cs } = await service
        .from('client_services')
        .select('user_id, service_id')
        .eq('id', id)
        .single();
      if (cs) {
        const [{ data: client }, { data: svc }] = await Promise.all([
          service.from('users').select('email, first_name').eq('id', cs.user_id).single(),
          service.from('services').select('name').eq('id', cs.service_id).single(),
        ]);
        if (client?.email) {
          if (action === 'approve') {
            enqueueEmail('document-status', {
              to:           client.email,
              firstName:    client.first_name,
              documentName: doc.document_name,
              status:       'approved',
            });
          } else if (action === 'reject') {
            enqueueEmail('document-status', {
              to:           client.email,
              firstName:    client.first_name,
              documentName: doc.document_name,
              status:       'rejected',
              notes:        note ?? undefined,
              final:        true,
            });
          } else {
            enqueueEmail('reupload-request', {
              to:           client.email,
              firstName:    client.first_name,
              serviceName:  svc?.name ?? 'your service',
              documentName: doc.document_name,
              note,
            });
          }
        }
        const svcName = svc?.name ?? 'your service';
        const noteMap = {
          approve: { type: 'document_approved', title: `Document approved · ${svcName}`, body: `${doc.document_name} was approved.` },
          reject:  { type: 'document_rejected', title: `Document rejected · ${svcName}`, body: `${doc.document_name} was rejected${note ? `: ${note}` : '.'}` },
          reupload:{ type: 'document_reupload', title: `Re-upload requested · ${svcName}`, body: `Please re-upload ${doc.document_name}${note ? `: ${note}` : '.'}` },
        } as const;
        const n = noteMap[action as 'approve' | 'reject' | 'reupload'];
        if (n) void notifyClientForService(cs.user_id, id, n);
      }
    } catch (e) {
      appLogger.warn('adminUpdateDocStatus email lookup failed', { err: (e as Error).message });
    }

    res.json({ success: true });
  } catch (err) {
    appLogger.error('adminUpdateDocStatus error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
