import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isTaxExpertRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';
import { emailQueue } from '../../queues/email.queue';
import { notifyClientForService } from '../../utils/notifications';

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
    const sc = createServiceClient();

    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = String(req.query.status ?? '').trim();
    const fy     = String(req.query.fy     ?? '').trim();
    const sort   = String(req.query.sort   ?? 'recently_updated').trim();

    // Sort mapping
    const sortCol = sort === 'oldest' ? 'created_at' : sort === 'status' ? 'status' : 'updated_at';
    const sortAsc = sort === 'oldest';

    // Base rows — scalar-only (no FK-hint joins; multiple FKs to users would fail)
    let query = sc
      .from('client_services')
      .select('id, status, fiscal_year, notes, payment_status, user_id, service_id, assigned_texpert_at, created_at, updated_at')
      .eq('assigned_texpert_id', req.user!.id)
      .order(sortCol, { ascending: sortAsc });

    if (status) query = query.eq('status', status);
    if (fy)     query = query.eq('fiscal_year', fy);

    const { data: rows, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    // Enrich each row with client + service + doc summary (parallel per-row)
    const enriched = await Promise.all((rows ?? []).map(async (r: any) => {
      const [{ data: client }, { data: svc }, { data: docs }] = await Promise.all([
        sc.from('users').select('id, first_name, last_name, email, pan').eq('id', r.user_id).single(),
        sc.from('services').select('name, slug, category').eq('id', r.service_id).single(),
        sc.from('client_documents')
          .select('id, status, reupload_requested, file_path, file_url, uploaded_at')
          .eq('client_service_id', r.id),
      ]);

      const docList = docs ?? [];
      const total      = docList.length;
      const uploaded   = docList.filter((d: any) => d.file_path || d.file_url).length;
      const approved   = docList.filter((d: any) => d.status === 'approved').length;
      const reuploads  = docList.filter((d: any) => d.reupload_requested).length;
      // "Newly uploaded" — uploaded after assigned_texpert_at OR after updated_at, whichever applies
      const reviewRef = r.assigned_texpert_at ?? r.created_at;
      const newSinceReview = docList.filter((d: any) =>
        d.uploaded_at && new Date(d.uploaded_at) > new Date(reviewRef)
      ).length;

      // Simple SLA flag — services in actionable state for >7d without status change
      const daysSinceUpdate = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      const sla =
        r.status === 'completed' || r.status === 'cancelled' || r.status === 'on_hold' ? null
        : daysSinceUpdate >= 7 ? 'overdue'
        : daysSinceUpdate >= 3 ? 'attention'
        : null;

      return {
        ...r,
        client,
        service: svc,
        doc_summary: { total, uploaded, approved, pending: total - uploaded, reuploads, newSinceReview },
        sla,
      };
    }));

    // Search filter (client-side over the enriched list — covers name, PAN, service name, FY)
    const filtered = search
      ? enriched.filter((cs: any) => {
          const svcName    = cs.service?.name?.toLowerCase() ?? '';
          const clientName = `${cs.client?.first_name ?? ''} ${cs.client?.last_name ?? ''}`.toLowerCase();
          const pan        = (cs.client?.pan ?? '').toLowerCase();
          const fyStr      = (cs.fiscal_year ?? '').toLowerCase();
          return svcName.includes(search) || clientName.includes(search) || pan.includes(search) || fyStr.includes(search);
        })
      : enriched;

    // Collect distinct fiscal_years for the FY filter dropdown
    const fiscalYears = Array.from(new Set(enriched.map((r: any) => r.fiscal_year).filter(Boolean))).sort().reverse();

    res.json({ data: filtered, fiscal_years: fiscalYears });
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

    // Base row — scalar columns only (no FK-hint joins, since multiple FKs to users would fail)
    const { data: cs, error } = await service
      .from('client_services')
      .select('id, status, fiscal_year, notes, payment_status, payment_id, pinned_message, is_blocked, blocked_reason, deletion_requested, deletion_requested_at, user_id, service_id, assigned_texpert_id, assigned_texpert_at, created_at, updated_at')
      .eq('id', id)
      .eq('assigned_texpert_id', req.user!.id)
      .single();

    if (error || !cs) return res.status(404).json({ error: 'Service not found' });

    const csData = cs as any;

    // Parallel lookups for related entities
    const [serviceRes, clientRes, docsRes, eventsRes, tasksRes, outputDocsRes] = await Promise.all([
      service.from('services').select('id, name, slug, category, price').eq('id', csData.service_id).single(),
      service.from('users').select('id, first_name, last_name, email, mobile, pan').eq('id', csData.user_id).single(),
      service.from('client_documents')
        .select('id, document_name, status, file_path, file_url, reupload_requested, reupload_note, uploaded_at, reupload_requested_at')
        .eq('client_service_id', id),
      service.from('service_events')
        .select('id, event_type, message, created_at, actor_user_id, metadata')
        .eq('client_service_id', id)
        .order('created_at', { ascending: false }),
      service.from('service_tasks')
        .select('id, title, description, task_type, scope, status, owner_user_id, due_at, completed_at, sort_order')
        .eq('client_service_id', id)
        .order('sort_order'),
      service.from('output_documents')
        .select('id, document_name, description, file_path, mime_type, uploaded_by, uploaded_at')
        .eq('client_service_id', id)
        .order('uploaded_at', { ascending: false }),
    ]);

    // Sign URLs for docs that have a file_path
    const docs: any[] = docsRes.data ?? [];
    const docsWithUrls = await Promise.all(docs.map(async (doc: any) => {
      if (!doc.file_path) return { ...doc, signed_url: null };
      const { data: signed } = await service.storage.from('client-docs').createSignedUrl(doc.file_path, 3600);
      return { ...doc, signed_url: signed?.signedUrl ?? null };
    }));

    // Sign URLs for output docs
    const outputDocs: any[] = outputDocsRes.data ?? [];
    const outputDocsWithUrls = await Promise.all(outputDocs.map(async (doc: any) => {
      if (!doc.file_path) return { ...doc, signed_url: null };
      const { data: signed } = await service.storage.from('client-docs').createSignedUrl(doc.file_path, 3600);
      return { ...doc, signed_url: signed?.signedUrl ?? null };
    }));

    res.json({
      data: {
        ...csData,
        service:          serviceRes.data ?? null,
        client:           clientRes.data ?? null,
        client_documents: docsWithUrls,
        output_documents: outputDocsWithUrls,
        service_events:   eventsRes.error?.code === '42P01' ? [] : (eventsRes.data ?? []),
        service_tasks:    tasksRes.error?.code  === '42P01' ? [] : (tasksRes.data  ?? []),
      },
    });
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
      'under_review', 'payment', 'completed', 'on_hold',
    ];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const service = createServiceClient();

    // Verify ownership — fetch service_id + user_id for follow-up enrichment
    const { data: cs } = await service
      .from('client_services')
      .select('id, user_id, service_id, payment_status')
      .eq('id', id)
      .eq('assigned_texpert_id', req.user!.id)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });

    // A service can only be completed once payment is confirmed.
    if (status === 'completed' && cs.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Cannot complete — payment not yet confirmed' });
    }

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

    // Queue workflow status email to client (non-blocking)
    try {
      const [{ data: clientUser }, { data: svc }] = await Promise.all([
        service.from('users').select('email, first_name').eq('id', cs.user_id).single(),
        service.from('services').select('name').eq('id', cs.service_id).single(),
      ]);
      const serviceName = svc?.name ?? 'your service';
      if (clientUser?.email) {
        emailQueue.add('workflow-status', {
          type:    'workflow-status',
          payload: {
            to:          clientUser.email,
            firstName:   clientUser.first_name,
            serviceName,
            status,
          },
        }).catch(e => appLogger.warn('workflow-status email enqueue failed', { err: e.message }));
      }
      void notifyClientForService(cs.user_id, id, {
        type: 'status_changed',
        title: `${serviceName}: status updated`,
        body: `Now "${String(status).replace(/_/g, ' ')}".`,
        metadata: { status },
      });
    } catch (e) {
      appLogger.warn('workflow-status email lookup failed', { err: (e as Error).message });
    }

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

    const sc = createServiceClient();

    // Verify the document belongs to this service
    const { data: doc } = await sc
      .from('client_documents')
      .select('id, document_name, client_service_id')
      .eq('id', documentId)
      .eq('client_service_id', id)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Verify ownership — separate query to avoid FK cache issues
    const { data: cs } = await sc
      .from('client_services')
      .select('user_id, service_id, assigned_texpert_id')
      .eq('id', id)
      .single();
    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.assigned_texpert_id !== req.user!.id) {
      return res.status(403).json({ error: 'Not assigned to this service' });
    }

    const { error } = await sc
      .from('client_documents')
      .update({
        reupload_requested:    true,
        reupload_requested_at: new Date().toISOString(),
        reupload_requested_by: req.user!.id,
        reupload_note:         note ?? null,
      })
      .eq('id', documentId);

    if (error) return res.status(400).json({ error: error.message });

    await sc.from('service_events').insert({
      client_service_id: id,
      event_type:        'document_reupload_requested',
      actor_user_id:     req.user!.id,
      message:           `Re-upload requested for: ${doc.document_name}`,
      metadata:          { documentId, note },
    });

    // Queue email to client (non-blocking)
    try {
      const [{ data: client }, { data: svc }] = await Promise.all([
        sc.from('users').select('email, first_name').eq('id', cs.user_id).single(),
        sc.from('services').select('name').eq('id', cs.service_id).single(),
      ]);
      const serviceName = svc?.name ?? 'your service';
      if (client?.email) {
        emailQueue.add('reupload-request', {
          type: 'reupload-request',
          payload: {
            to:           client.email,
            firstName:    client.first_name,
            serviceName,
            documentName: doc.document_name,
            note,
          },
        }).catch(e => appLogger.warn('reupload email enqueue failed', { err: e.message }));
      }
      void notifyClientForService(cs.user_id, id, {
        type: 'document_reupload',
        title: `Re-upload requested · ${serviceName}`,
        body: `Please re-upload ${doc.document_name}${note ? `: ${note}` : '.'}`,
      });
    } catch (e) {
      appLogger.warn('reupload email lookup failed', { err: (e as Error).message });
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

    const sc = createServiceClient();

    // Verify ownership — scalar select only (no FK-hint joins)
    const { data: cs } = await sc
      .from('client_services')
      .select('user_id, service_id, assigned_texpert_id')
      .eq('id', id)
      .single();
    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.assigned_texpert_id !== req.user!.id) {
      return res.status(403).json({ error: 'Not assigned to this service' });
    }

    const { data: newDoc, error } = await sc
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

    await sc.from('service_events').insert({
      client_service_id: id,
      event_type:        'optional_document_added',
      actor_user_id:     req.user!.id,
      message:           `Additional document slot added: ${documentName.trim()}`,
      metadata:          { documentId: newDoc.id, documentName: documentName.trim() },
    });

    // Queue email to client (non-blocking)
    try {
      const [{ data: client }, { data: svc }] = await Promise.all([
        sc.from('users').select('email, first_name').eq('id', cs.user_id).single(),
        sc.from('services').select('name').eq('id', cs.service_id).single(),
      ]);
      const serviceName = svc?.name ?? 'your service';
      if (client?.email) {
        emailQueue.add('additional-doc-added', {
          type: 'additional-doc-added',
          payload: {
            to:          client.email,
            firstName:   client.first_name,
            serviceName,
            docName:     documentName.trim(),
          },
        }).catch(e => appLogger.warn('add-doc email enqueue failed', { err: e.message }));
      }
      void notifyClientForService(cs.user_id, id, {
        type: 'document_added',
        title: `New document requested · ${serviceName}`,
        body: `Please upload: ${documentName.trim()}`,
      });
    } catch (e) {
      appLogger.warn('addDocSlot email lookup failed', { err: (e as Error).message });
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

    // Privacy mask — texperts only see first name + last initial until they claim.
    // No email, no full surname. Protects client PII across the firm.
    const clientMap: Record<string, any> = {};
    for (const c of clients ?? []) {
      clientMap[c.id] = {
        first_name:     c.first_name,
        last_initial:   c.last_name ? `${c.last_name.charAt(0)}.` : '',
        display_name:   `${c.first_name} ${c.last_name ? c.last_name.charAt(0) + '.' : ''}`.trim(),
      };
    }

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

// ── Approve a single document ─────────────────────────────────
export const approveDocument = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id, docId } = req.params;
    const service = createServiceClient();

    // Verify document belongs to a service assigned to this texpert
    const { data: doc } = await service
      .from('client_documents')
      .select('id, document_name, client_service_id, status')
      .eq('id', docId)
      .eq('client_service_id', id)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { data: cs } = await service
      .from('client_services')
      .select('user_id, service_id, assigned_texpert_id')
      .eq('id', id)
      .single();
    if (!cs || cs.assigned_texpert_id !== req.user!.id) {
      return res.status(403).json({ error: 'Not assigned to this service' });
    }

    const { error } = await service
      .from('client_documents')
      .update({
        status:               'approved',
        reupload_requested:   false,
        verified_at:          new Date().toISOString(),
        verified_by:          req.user!.id,
      })
      .eq('id', docId);

    if (error) return res.status(400).json({ error: error.message });

    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'document_approved',
      actor_user_id:     req.user!.id,
      message:           `Document approved: ${doc.document_name}`,
      metadata:          { documentId: docId },
    });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'approve_document',
      targetType: 'client_document',
      targetId:   docId,
      metadata:   { clientServiceId: id, documentName: doc.document_name },
    });

    // Queue confirmation email to client
    try {
      const [{ data: clientUser }, { data: svc }] = await Promise.all([
        service.from('users').select('email, first_name').eq('id', cs.user_id).single(),
        service.from('services').select('name').eq('id', cs.service_id).single(),
      ]);
      if (clientUser?.email) {
        emailQueue.add('document-status', {
          type:    'document-status',
          payload: {
            to:           clientUser.email,
            firstName:    clientUser.first_name,
            documentName: doc.document_name,
            status:       'approved',
            vaultLink:    `${process.env.APP_URL ?? 'https://thetaxpert.com'}/my-services`,
          },
        }).catch(e => appLogger.warn('approve email enqueue failed', { err: e.message }));
      }
      void notifyClientForService(cs.user_id, id, {
        type: 'document_approved',
        title: `Document approved · ${svc?.name ?? 'your service'}`,
        body: `${doc.document_name} was approved.`,
      });
    } catch (e) {
      appLogger.warn('approve email lookup failed', { err: (e as Error).message });
    }

    res.json({ success: true });
  } catch (err) {
    appLogger.error('approveDocument error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Reject a single document (final — no re-upload allowed) ───
export const rejectDocument = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id, docId } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ error: 'reason is required for final rejection' });
    }

    const service = createServiceClient();

    const { data: doc } = await service
      .from('client_documents')
      .select('id, document_name, client_service_id')
      .eq('id', docId)
      .eq('client_service_id', id)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { data: cs } = await service
      .from('client_services')
      .select('user_id, service_id, assigned_texpert_id')
      .eq('id', id)
      .single();
    if (!cs || cs.assigned_texpert_id !== req.user!.id) {
      return res.status(403).json({ error: 'Not assigned to this service' });
    }

    const { error } = await service
      .from('client_documents')
      .update({
        status:             'rejected',
        reupload_requested: false,
        reupload_note:      reason.trim(),
        verified_at:        new Date().toISOString(),
        verified_by:        req.user!.id,
      })
      .eq('id', docId);

    if (error) return res.status(400).json({ error: error.message });

    await service.from('service_events').insert({
      client_service_id: id,
      event_type:        'document_rejected',
      actor_user_id:     req.user!.id,
      message:           `Document rejected (final): ${doc.document_name}`,
      metadata:          { documentId: docId, reason: reason.trim() },
    });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'reject_document',
      targetType: 'client_document',
      targetId:   docId,
      metadata:   { clientServiceId: id, documentName: doc.document_name, reason: reason.trim() },
    });

    // Email client about final rejection (no re-upload CTA)
    try {
      const { data: clientUser } = await service
        .from('users')
        .select('email, first_name')
        .eq('id', cs.user_id)
        .single();
      if (clientUser?.email) {
        emailQueue.add('document-status', {
          type:    'document-status',
          payload: {
            to:           clientUser.email,
            firstName:    clientUser.first_name,
            documentName: doc.document_name,
            status:       'rejected',
            notes:        reason.trim(),
            final:        true,
          },
        }).catch(e => appLogger.warn('reject email enqueue failed', { err: e.message }));
      }
      void notifyClientForService(cs.user_id, id, {
        type: 'document_rejected',
        title: 'Document rejected',
        body: `${doc.document_name} was rejected: ${reason.trim()}`,
      });
    } catch (e) {
      appLogger.warn('reject email lookup failed', { err: (e as Error).message });
    }

    res.json({ success: true });
  } catch (err) {
    appLogger.error('rejectDocument error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const claimFromQueue = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { queueId } = req.params;
    const service = createServiceClient();

    // ── Atomic race-safe claim ────────────────────────────────
    // UPDATE the queue row with WHERE status='open'. If 0 rows affected,
    // someone else won the race. The `.select()` returns the actual rows
    // affected — Supabase only includes a row if it passed the WHERE.
    const { data: claimedRows, error: claimErr } = await service
      .from('service_assignment_queue')
      .update({ status: 'claimed', claimed_by: req.user!.id, claimed_at: new Date().toISOString() })
      .eq('id', queueId)
      .eq('status', 'open')
      .select('id, client_service_id');

    if (claimErr) return res.status(400).json({ error: claimErr.message });
    if (!claimedRows || claimedRows.length === 0) {
      return res.status(409).json({ error: 'This service has already been claimed by another texpert.' });
    }

    const qItem = claimedRows[0];

    // Assign texpert on client_service (we own the queue row now — safe to proceed)
    const { error: assignError } = await service
      .from('client_services')
      .update({
        assigned_texpert_id:  req.user!.id,
        assigned_texpert_at:  new Date().toISOString(),
        assigned_by_admin_id: null,
      })
      .eq('id', qItem.client_service_id);

    if (assignError) return res.status(400).json({ error: assignError.message });

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

// ═══════════════════════════════════════════════════════════════
// Phase 2 — Workspace endpoints: tasks, notes, pinned message
// ═══════════════════════════════════════════════════════════════

async function assertOwnership(req: Request, res: Response, clientServiceId: string): Promise<boolean> {
  const sc = createServiceClient();
  const { data: cs } = await sc
    .from('client_services')
    .select('assigned_texpert_id')
    .eq('id', clientServiceId)
    .single();
  if (!cs) { res.status(404).json({ error: 'Service not found' }); return false; }
  if (cs.assigned_texpert_id !== req.user!.id) {
    res.status(403).json({ error: 'Not assigned to this service' });
    return false;
  }
  return true;
}

// ── Add a task (texpert's internal checklist) ─────────────────
export const addTexpertTask = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    if (!await assertOwnership(req, res, id)) return;

    const { title, description, due_at } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    const sc = createServiceClient();
    const { data, error } = await sc
      .from('service_tasks')
      .insert({
        client_service_id: id,
        title:             title.trim(),
        description:       description?.trim() ?? null,
        task_type:         'texpert_task',
        scope:             'internal',
        status:            'todo',
        due_at:            due_at ?? null,
        owner_user_id:     req.user!.id,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await sc.from('service_events').insert({
      client_service_id: id,
      event_type:        'task_added',
      actor_user_id:     req.user!.id,
      message:           `Task added: ${title.trim()}`,
      metadata:          { task_id: data.id, is_internal: true },
    });

    res.status(201).json({ data });
  } catch (err) {
    appLogger.error('addTexpertTask error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Update task status ────────────────────────────────────────
export const updateTexpertTask = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id, taskId } = req.params;
    if (!await assertOwnership(req, res, id)) return;

    const { status } = req.body;
    const ALLOWED = ['todo', 'in_progress', 'done', 'cancelled'];
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(', ')}` });
    }

    const payload: Record<string, unknown> = { status };
    if (status === 'done') payload.completed_at = new Date().toISOString();

    const sc = createServiceClient();
    const { error } = await sc
      .from('service_tasks')
      .update(payload)
      .eq('id', taskId)
      .eq('client_service_id', id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('updateTexpertTask error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Delete a task ─────────────────────────────────────────────
export const deleteTexpertTask = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id, taskId } = req.params;
    if (!await assertOwnership(req, res, id)) return;

    const sc = createServiceClient();
    const { error } = await sc
      .from('service_tasks')
      .delete()
      .eq('id', taskId)
      .eq('client_service_id', id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('deleteTexpertTask error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Log an internal note as a service_event ───────────────────
export const logInternalNote = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    if (!await assertOwnership(req, res, id)) return;

    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

    const sc = createServiceClient();
    const { error } = await sc.from('service_events').insert({
      client_service_id: id,
      event_type:        'texpert_note',
      actor_user_id:     req.user!.id,
      message:           message.trim(),
      metadata:          { is_internal: true },
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    appLogger.error('logInternalNote error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Update the pinned message (visible to client) ─────────────
export const updatePinnedMessage = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    if (!await assertOwnership(req, res, id)) return;

    const { pinned_message } = req.body;

    const sc = createServiceClient();
    const { error } = await sc
      .from('client_services')
      .update({
        pinned_message:    pinned_message?.trim() || null,
        pinned_message_at: pinned_message?.trim() ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await sc.from('service_events').insert({
      client_service_id: id,
      event_type:        'pinned_updated',
      actor_user_id:     req.user!.id,
      message:           pinned_message?.trim() ? `Pinned: ${pinned_message.trim()}` : 'Pinned message cleared',
      metadata:          { is_internal: true },
    });

    // A pinned message is a message TO the client — email + notify (only when set).
    const pinnedText = pinned_message?.trim();
    if (pinnedText) {
      try {
        const { data: cs } = await sc.from('client_services').select('user_id, service_id').eq('id', id).single();
        if (cs) {
          const [{ data: client }, { data: svc }] = await Promise.all([
            sc.from('users').select('email, first_name').eq('id', cs.user_id).single(),
            sc.from('services').select('name').eq('id', cs.service_id).single(),
          ]);
          const serviceName = svc?.name ?? 'your service';
          if (client?.email) {
            emailQueue.add('pinned-message', {
              type: 'pinned-message',
              payload: { to: client.email, firstName: client.first_name, serviceName, message: pinnedText, clientServiceId: id },
            }).catch(e => appLogger.warn('pinned email enqueue failed', { err: e.message }));
          }
          void notifyClientForService(cs.user_id, id, {
            type: 'pinned_message',
            title: `New message · ${serviceName}`,
            body: pinnedText.length > 90 ? pinnedText.slice(0, 90) + '…' : pinnedText,
          });
        }
      } catch (e) {
        appLogger.warn('pinned notify failed', { err: (e as Error).message });
      }
    }

    res.json({ success: true });
  } catch (err) {
    appLogger.error('updatePinnedMessage error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── Save scratchpad notes (debounced auto-save from frontend) ─
export const updateNotesField = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const { id } = req.params;
    if (!await assertOwnership(req, res, id)) return;

    const { notes } = req.body;

    const sc = createServiceClient();
    const { error } = await sc
      .from('client_services')
      .update({ notes: notes ?? null })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    appLogger.error('updateNotesField error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════
// Phase 5 — Dashboard
// ═══════════════════════════════════════════════════════════════

export const getDashboard = async (req: Request, res: Response) => {
  try {
    if (!await assertTexpert(req, res)) return;
    const sc = createServiceClient();
    const uid = req.user!.id;

    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // ── Parallel fetch: assigned services (basis for everything else) ──
    const { data: services, error: svcErr } = await sc
      .from('client_services')
      .select('id, status, payment_status, fiscal_year, status_updated_at, assigned_texpert_at, created_at, updated_at, user_id, service_id')
      .eq('assigned_texpert_id', uid);

    if (svcErr) return res.status(400).json({ error: svcErr.message });

    const serviceIds = (services ?? []).map((s: any) => s.id);

    // ── Parallel: queue count, docs, events ──
    const [queueRes, docsRes, eventsRes] = await Promise.all([
      sc.from('service_assignment_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open'),
      serviceIds.length
        ? sc.from('client_documents')
            .select('id, client_service_id, status, file_path, file_url, reupload_requested, reupload_requested_at, uploaded_at')
            .in('client_service_id', serviceIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      serviceIds.length
        ? sc.from('service_events')
            .select('id, client_service_id, event_type, message, created_at, actor_user_id, metadata')
            .in('client_service_id', serviceIds)
            .order('created_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    // ── Stats ──────────────────────────────────────────────────
    const activeServices = (services ?? []).filter((s: any) =>
      !['completed', 'cancelled', 'on_hold'].includes(s.status)
    ).length;

    const completedThisMonth = (services ?? []).filter((s: any) =>
      s.status === 'completed' && s.status_updated_at && s.status_updated_at >= monthStart
    ).length;

    const allDocs   = docsRes.data ?? [];

    // "Pending review" = services that have docs uploaded but not yet approved
    const pendingReviewSet = new Set<string>();
    for (const d of allDocs as any[]) {
      const hasFile = !!(d.file_path || d.file_url);
      if (hasFile && d.status !== 'approved' && d.status !== 'rejected') {
        pendingReviewSet.add(d.client_service_id);
      }
    }
    const pendingReview = pendingReviewSet.size;

    const stats = {
      activeServices,
      pendingReview,
      completedThisMonth,
      queueOpen: queueRes.count ?? 0,
    };

    // ── Needs Attention ─────────────────────────────────────────
    // A service needs attention if ANY of:
    //   - has docs uploaded after the last review timestamp
    //   - has a reupload request >3 days old (stalled)
    //   - SLA: in actionable state and not updated in >3 days
    const docsByService: Record<string, any[]> = {};
    for (const d of allDocs as any[]) {
      (docsByService[d.client_service_id] ??= []).push(d);
    }

    type AttentionItem = {
      id: string;
      service_name: string;
      client_display: string;
      fiscal_year: string | null;
      status: string;
      reason: 'payment_received' | 'new_docs' | 'overdue_reupload' | 'sla_overdue' | 'sla_attention';
      priority: number; // for sorting (higher first)
      updated_at: string;
    };

    const needsAttention: AttentionItem[] = [];

    for (const s of services ?? []) {
      if (['completed', 'cancelled'].includes(s.status)) continue;

      const sDocs    = docsByService[s.id] ?? [];
      const refDate  = s.assigned_texpert_at ?? s.created_at;
      const newDocs  = sDocs.filter((d: any) =>
        d.uploaded_at && new Date(d.uploaded_at) > new Date(refDate)
      );

      const oldestStalledReupload = sDocs
        .filter((d: any) => d.reupload_requested && d.reupload_requested_at)
        .map((d: any) => new Date(d.reupload_requested_at).getTime())
        .sort((a: number, b: number) => a - b)[0];

      const daysSinceUpdate = Math.floor((Date.now() - new Date(s.updated_at).getTime()) / (1000 * 60 * 60 * 24));

      let reason: AttentionItem['reason'] | null = null;
      let priority = 0;

      if (s.status === 'payment' && s.payment_status === 'paid') {
        // Client has paid — the service is ready for the texpert to finalise/complete.
        reason   = 'payment_received';
        priority = 40;
      } else if (newDocs.length > 0) {
        reason   = 'new_docs';
        priority = 30 + newDocs.length;
      } else if (oldestStalledReupload && Date.now() - oldestStalledReupload > 3 * 86_400_000) {
        reason   = 'overdue_reupload';
        priority = 20;
      } else if (s.status !== 'on_hold') {
        if (daysSinceUpdate >= 7)      { reason = 'sla_overdue';    priority = 15; }
        else if (daysSinceUpdate >= 3) { reason = 'sla_attention';  priority = 5;  }
      }

      if (!reason) continue;

      needsAttention.push({
        id:             s.id,
        service_name:   '',  // filled below
        client_display: '',  // filled below
        fiscal_year:    s.fiscal_year,
        status:         s.status,
        reason,
        priority,
        updated_at:     s.updated_at,
      });
    }

    // Enrich attention list with service + client names (only for items we'll show)
    const attentionIds = needsAttention.sort((a, b) => b.priority - a.priority).slice(0, 8);
    if (attentionIds.length > 0) {
      const enrichedSvcMap = new Map<string, any>();
      const enrichedClientMap = new Map<string, any>();
      const serviceIdsNeeded = [...new Set(attentionIds.map(a => services?.find((s: any) => s.id === a.id)?.service_id).filter(Boolean) as string[])];
      const userIdsNeeded    = [...new Set(attentionIds.map(a => services?.find((s: any) => s.id === a.id)?.user_id).filter(Boolean) as string[])];

      const [svcLookup, clientLookup] = await Promise.all([
        serviceIdsNeeded.length ? sc.from('services').select('id, name').in('id', serviceIdsNeeded) : Promise.resolve({ data: [] as any[] }),
        userIdsNeeded.length    ? sc.from('users').select('id, first_name, last_name').in('id', userIdsNeeded)   : Promise.resolve({ data: [] as any[] }),
      ]);

      for (const s of (svcLookup.data ?? [])) enrichedSvcMap.set(s.id, s);
      for (const c of (clientLookup.data ?? [])) enrichedClientMap.set(c.id, c);

      for (const item of attentionIds) {
        const src = services?.find((s: any) => s.id === item.id);
        const svc = enrichedSvcMap.get(src?.service_id);
        const cli = enrichedClientMap.get(src?.user_id);
        item.service_name   = svc?.name ?? 'Service';
        item.client_display = cli ? `${cli.first_name} ${cli.last_name ?? ''}`.trim() : 'Client';
      }
    }

    // ── Recent Activity ─────────────────────────────────────────
    // Events are already scoped to THIS texpert's assigned services. Drop the
    // texpert's own actions so the feed shows updates from others — client doc
    // uploads, payments, admin status changes, assignment, etc.
    const events = (eventsRes.data ?? [])
      .filter((e: any) => e.actor_user_id !== uid)
      .slice(0, 10);
    if (events.length > 0) {
      const evtServiceIds = [...new Set(events.map((e: any) => e.client_service_id))];
      const evtServices   = (services ?? []).filter((s: any) => evtServiceIds.includes(s.id));
      const evtSvcIdsLookup = [...new Set(evtServices.map((s: any) => s.service_id))];
      const evtUserIdsLookup = [...new Set(evtServices.map((s: any) => s.user_id))];

      const [svcLookup2, clientLookup2] = await Promise.all([
        evtSvcIdsLookup.length  ? sc.from('services').select('id, name').in('id', evtSvcIdsLookup)  : Promise.resolve({ data: [] as any[] }),
        evtUserIdsLookup.length ? sc.from('users').select('id, first_name').in('id', evtUserIdsLookup) : Promise.resolve({ data: [] as any[] }),
      ]);

      const svcMap = new Map<string, any>(); for (const s of svcLookup2.data ?? []) svcMap.set(s.id, s);
      const cliMap = new Map<string, any>(); for (const c of clientLookup2.data ?? []) cliMap.set(c.id, c);

      for (const ev of events as any[]) {
        const src = evtServices.find((s: any) => s.id === ev.client_service_id);
        ev.service_name      = svcMap.get(src?.service_id)?.name ?? 'Service';
        ev.client_first_name = cliMap.get(src?.user_id)?.first_name ?? 'Client';
      }
    }

    res.json({
      data: {
        stats,
        needs_attention: attentionIds,
        recent_activity: events,
      },
    });
  } catch (err) {
    appLogger.error('getDashboard error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

