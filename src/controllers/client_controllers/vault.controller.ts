import { Request, Response } from 'express';
import { isStaffRole, UserRole } from '../../shared/roles';
import { getFYFromDate } from '../../shared/fy-utils';
import { logServiceEvent } from '../../utils/operations';
import { canAccessClientServiceRecord } from '../../utils/service-access';
import { mirrorServiceDocToCommon, propagateCommonDocToServices, prefillServiceDocsFromCommon } from '../../utils/doc-sync';
import { createServiceClient } from '../../configs/supabase.config';
import { writeAudit } from '../../utils/audit';
import { notifyTexpertForService } from '../../utils/notifications';

export const getVaultGroups = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();

    let query = req.supabase
      .from('client_services')
      .select(`
        id, user_id, status, created_at,
        service:services(id, name, category, slug),
        client_documents(id, status)
      `)
      .order('created_at', { ascending: false });

    if (!isStaffRole(profile?.role as UserRole)) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const fyMap = new Map<string, any[]>();

    for (const cs of data ?? []) {
      const svc = Array.isArray(cs.service) ? cs.service[0] : cs.service;
      if (!svc) continue;
      const docs = (cs.client_documents ?? []) as any[];
      const fy = getFYFromDate(cs.created_at);

      const item = {
        clientServiceId: cs.id,
        serviceId: svc.id,
        serviceName: svc.name,
        serviceCategory: svc.category,
        serviceSlug: svc.slug,
        status: cs.status,
        fy,
        createdAt: cs.created_at,
        docsTotal: docs.length,
        docsUploaded: docs.filter(d => d.status === 'uploaded' || d.status === 'approved').length,
        docsVerified: docs.filter(d => d.status === 'approved').length,
      };

      if (!fyMap.has(fy)) fyMap.set(fy, []);
      fyMap.get(fy)!.push(item);
    }

    const groups = Array.from(fyMap.entries())
      .map(([fy, services]) => ({ fy, services }))
      .sort((a, b) => b.fy.localeCompare(a.fy));

    res.json({ data: groups });
  } catch (error) {
    console.error('getVaultGroups error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getVaultServiceDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();

    const sc = createServiceClient();
    const [{ data: cs, error }, { data: commonDocsRaw }, { data: outputDocsRaw }] = await Promise.all([
      req.supabase
        .from('client_services')
        .select(`
          id, user_id, status, created_at,
          service:services(
            id, name, slug,
            document_templates(id, name, description, required, sort_order)
          ),
          client_documents(
            id, template_id, document_name, status, file_path, uploaded_at, notes
          )
        `)
        .eq('id', id)
        .single(),
      req.supabase
        .from('common_documents')
        .select('document_type, document_name')
        .eq('user_id', req.user.id),
      sc
        .from('output_documents')
        .select('id, document_name, description, file_path, mime_type, uploaded_at')
        .eq('client_service_id', id)
        .order('uploaded_at', { ascending: false }),
    ]);

    if (error || !cs) return res.status(404).json({ error: 'Not found' });
    if (!isStaffRole(profile?.role as UserRole) && cs.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const svc = Array.isArray(cs.service) ? cs.service[0] : cs.service;
    let templates = (svc?.document_templates ?? [])
      .map((t: any) => ({ id: t.id, name: t.name, description: t.description ?? null, required: t.required, sortOrder: t.sort_order }))
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    if (templates.length === 0 && svc?.id) {
      const { data: reqs } = await req.supabase
        .from('service_document_requirements')
        .select('id, is_required, sort_order, document_type:document_types(id, name, description)')
        .eq('service_id', svc.id)
        .order('sort_order');

      if (reqs && reqs.length > 0) {
        templates = reqs
          .filter((r: any) => r.document_type)
          .map((r: any) => {
             const dt = Array.isArray(r.document_type) ? r.document_type[0] : r.document_type;
             return {
              id: r.id,
              name: dt.name,
              description: dt.description ?? null,
              required: r.is_required,
              sortOrder: r.sort_order,
            };
          });
      }
    }

    const docs = (cs.client_documents ?? []).map((d: any) => ({
      id: d.id,
      documentName: d.document_name,
      templateId: d.template_id,
      status: d.status,
      fileUrl: d.file_path ? `/api/documents/${d.id}/download` : null,
      filePath: d.file_path,
      uploadedAt: d.uploaded_at,
      notes: d.notes,
    }));

    // Sign URLs for output docs
    const outputDocs = await Promise.all((outputDocsRaw ?? []).map(async (d: any) => {
      if (!d.file_path) return { ...d, signed_url: null };
      const { data: signed } = await sc.storage.from('client-docs').createSignedUrl(d.file_path, 3600);
      return { ...d, signed_url: signed?.signedUrl ?? null };
    }));

    res.json({
      data: {
        clientServiceId: cs.id,
        userId: cs.user_id,
        status: cs.status,
        fy: getFYFromDate(cs.created_at),
        serviceName: svc?.name ?? 'Unknown',
        serviceSlug: svc?.slug ?? '',
        documents: docs,
        templates,
        outputDocuments: outputDocs,
        commonDocs: (commonDocsRaw ?? []).map((d: any) => ({
          documentType: d.document_type,
          documentName: d.document_name,
        })),
      }
    });
  } catch (error) {
    console.error('getVaultServiceDetail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCommonDocuments = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await req.supabase
      .from('common_documents')
      .select('id, document_type, document_name, file_path, stored_filename, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01') return res.json({ data: [] });
      return res.status(400).json({ error: error.message });
    }

    const docs = (data ?? []).map((d: any) => ({
      id: d.id,
      documentType: d.document_type,
      documentName: d.document_name,
      fileUrl: d.file_path ? `/api/common-documents/${d.id}/download` : null,
      storedFilename: d.stored_filename,
      createdAt: d.created_at,
    }));

    res.json({ data: docs });
  } catch (error) {
    console.error('getCommonDocuments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const file = req.file;
    const { serviceId, documentId, templateId, documentName, documentType = 'other' } = req.body;

    if (!file) return res.status(400).json({ error: 'No file provided' });
    if (!serviceId) return res.status(400).json({ error: 'serviceId required' });
    if (!documentName) return res.status(400).json({ error: 'documentName required' });

    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, JPG, PNG files are accepted' });
    }

    const { data: cs } = await req.supabase
      .from('client_services')
      .select('id, user_id, created_at, fiscal_year, assigned_to, assigned_texpert_id, service_id')
      .eq('id', serviceId)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });

    const { data: profile } = await req.supabase.from('users').select('role, pan').eq('id', req.user.id).single();
    const canAccess = await canAccessClientServiceRecord(req.supabase, {
      viewerId: req.user.id,
      viewerRole: profile?.role as UserRole,
      serviceUserId: cs.user_id,
      assignedTo: cs.assigned_to ?? null,
    });

    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    const pan = (profile?.pan ?? 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fy = cs.fiscal_year ?? getFYFromDate(cs.created_at);
    const ext = (file.originalname.split('.').pop() ?? 'pdf').toLowerCase();
    const safeDocType = documentType.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const storedFilename = `${pan}_FY${fy}_${safeDocType}.${ext}`;

    let targetDocumentId = documentId;

    if (!targetDocumentId && templateId) {
      const { data: existingByTemplate } = await req.supabase
        .from('client_documents')
        .select('id')
        .eq('client_service_id', serviceId)
        .eq('template_id', templateId)
        .maybeSingle();
      targetDocumentId = existingByTemplate?.id ?? null;
    }

    if (!targetDocumentId) {
      const { data: existingByName } = await req.supabase
        .from('client_documents')
        .select('id')
        .eq('client_service_id', serviceId)
        .eq('document_name', documentName)
        .maybeSingle();
      targetDocumentId = existingByName?.id ?? null;
    }

    if (!targetDocumentId) {
      const { data: newDoc, error: insertErr } = await req.supabase
        .from('client_documents')
        .insert({
          client_service_id: serviceId,
          template_id: templateId || null,
          document_name: documentName,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertErr || !newDoc) return res.status(500).json({ error: insertErr?.message ?? 'Failed to create document' });
      targetDocumentId = newDoc.id;
    }

    const filePath = `${cs.user_id}/${serviceId}/${targetDocumentId}.${ext}`;

    const { error: uploadErr } = await req.supabase.storage
      .from('client-docs')
      .upload(filePath, file.buffer, { upsert: true, contentType: file.mimetype });

    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { error: updateErr } = await req.supabase
      .from('client_documents')
      .update({
        status: 'uploaded',
        file_path: filePath,
        file_url: null,
        uploaded_at: new Date().toISOString(),
        template_id: templateId || null,
        document_name: documentName,
      })
      .eq('id', targetDocumentId);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // ── Bidirectional sync: if this doc is a known common type, mirror it to
    // common_documents and propagate to other active service docs for this user.
    const uploadedAt = new Date().toISOString();
    mirrorServiceDocToCommon(
      req.supabase,
      cs.user_id,
      documentName,
      filePath,
      uploadedAt,
      pan,
    ).catch(console.error);

    // Auto-advance + queue entry when all docs uploaded
    const sc = createServiceClient();
    const { data: allDocs } = await sc.from('client_documents').select('status').eq('client_service_id', serviceId);
    const allUploaded = allDocs && allDocs.length > 0 &&
      allDocs.every((d: any) => d.status === 'uploaded' || d.status === 'under_review' || d.status === 'approved');

    if (allUploaded) {
      const now2 = new Date().toISOString();
      const { data: svcRow } = await sc.from('client_services').select('status, assigned_texpert_id').eq('id', serviceId).single();
      if (svcRow && (svcRow.status === 'documents_required' || svcRow.status === 'pending')) {
        await sc.from('client_services').update({ status: 'documents_received', status_updated_at: now2, updated_at: now2 }).eq('id', serviceId);
      }

      // Ensure a queue entry exists with priority 5 (docs ready — bump urgency).
      // Only add/update if service has no texpert assigned yet.
      if (!svcRow?.assigned_texpert_id) {
        const { data: existingQ } = await sc
          .from('service_assignment_queue')
          .select('id, priority')
          .eq('client_service_id', serviceId)
          .eq('status', 'open')
          .maybeSingle();

        if (existingQ) {
          // Bump priority now that docs are ready
          if ((existingQ.priority ?? 0) < 5) {
            await sc.from('service_assignment_queue').update({ priority: 5 }).eq('id', existingQ.id);
          }
        } else {
          // No queue entry yet — insert one
          await sc.from('service_assignment_queue').insert({ client_service_id: serviceId, priority: 5 });
        }
      }
    }

    await logServiceEvent({
      clientServiceId: serviceId,
      actorUserId: req.user.id,
      eventType: 'document_uploaded',
      message: `${isStaffRole(profile?.role as UserRole) ? 'Internal operator' : 'Client'} uploaded '${documentName}'.`,
      metadata: { document_id: targetDocumentId, template_id: templateId, document_name: documentName },
    });

    writeAudit({
      actorId:    req.user!.id,
      action:     'document_uploaded',
      targetType: 'client_document',
      targetId:   targetDocumentId,
      metadata: {
        clientServiceId: serviceId,
        documentName,
        documentType,
      },
    }).catch(() => {/* non-blocking */});

    // When the CLIENT uploads, notify the assigned Taxpert so they can review.
    if (!isStaffRole(profile?.role as UserRole) && cs.assigned_texpert_id) {
      void (async () => {
        const sc = createServiceClient();
        const [{ data: client }, { data: svc }] = await Promise.all([
          sc.from('users').select('first_name, last_name').eq('id', cs.user_id).single(),
          sc.from('services').select('name').eq('id', cs.service_id).single(),
        ]);
        const clientName = client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || 'Client' : 'Client';
        await notifyTexpertForService(cs.assigned_texpert_id, serviceId, {
          type: 'document_uploaded',
          title: `Document uploaded · ${svc?.name ?? 'service'}`,
          body: `${clientName} uploaded "${documentName}".`,
        });
      })().catch(() => {/* non-blocking */});
    }

    res.json({ documentId: targetDocumentId, filePath, storedFilename, status: 'uploaded' });
  } catch (error) {
    console.error('uploadDocument error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const uploadCommonDocument = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const file = req.file;
    const documentType = req.body.documentType?.trim().toLowerCase();

    if (!file) return res.status(400).json({ error: 'No file provided' });
    if (!documentType) return res.status(400).json({ error: 'documentType required' });

    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, JPG, PNG files are accepted' });
    }

    const { data: profile } = await req.supabase.from('users').select('pan').eq('id', req.user.id).single();
    const pan = profile?.pan ?? 'UNKNOWN';
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? 'pdf';
    const safeType = documentType.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const storedFilename = `${pan}_${safeType}.${ext}`;
    const filePath = `${req.user.id}/common/${storedFilename}`;

    const { error: uploadErr } = await req.supabase.storage
      .from('client-docs')
      .upload(filePath, file.buffer, { upsert: true, contentType: file.mimetype });

    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { error: dbErr } = await req.supabase
      .from('common_documents')
      .upsert(
        {
          user_id: req.user.id,
          document_type: documentType,
          document_name: safeType.charAt(0) + safeType.slice(1).toLowerCase(),
          file_path: filePath,
          file_url: null,
          original_filename: file.originalname,
          stored_filename: storedFilename,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,document_type' }
      );

    if (dbErr) return res.status(500).json({ error: dbErr.message });

    // ── Bidirectional sync: propagate this common doc to all pending service docs
    // for the user that match the same document type, so they don't have to upload again.
    const syncUploadedAt = new Date().toISOString();
    propagateCommonDocToServices(
      req.supabase,
      req.user.id,
      documentType,
      filePath,
      syncUploadedAt,
    ).catch(console.error);

    res.json({ storedFilename, filePath, status: 'uploaded' });
  } catch (error) {
    console.error('uploadCommonDocument error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /vault/sync
 *
 * Backfill sync — runs prefillServiceDocsFromCommon for ALL active services of
 * the authenticated user. This is called automatically when the Vault page loads
 * so that any common docs uploaded before the sync system was introduced are
 * propagated into existing pending service-doc rows immediately.
 *
 * It is intentionally idempotent: uploading a doc that is already 'uploaded'
 * or 'approved' is never touched (the prefill only targets 'pending' rows).
 */
export const syncUserCommonDocs = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    // Fetch all active (non-completed, non-cancelled) services for this user
    const { data: activeServices, error } = await req.supabase
      .from('client_services')
      .select('id')
      .eq('user_id', req.user.id)
      .not('status', 'in', '(completed,cancelled)');

    if (error) return res.status(400).json({ error: error.message });
    if (!activeServices?.length) return res.json({ synced: 0 });

    // Run prefill concurrently across all active services
    await Promise.all(
      activeServices.map((svc: any) =>
        prefillServiceDocsFromCommon(req.supabase!, req.user!.id, svc.id)
      )
    );

    res.json({ synced: activeServices.length });
  } catch (error) {
    console.error('syncUserCommonDocs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

