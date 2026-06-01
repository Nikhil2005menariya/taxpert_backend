import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, isStaffRole, UserRole } from '../../shared/roles';
import { logServiceEvent } from '../../utils/operations';
import { appLogger } from '../../utils/logger';

const BUCKET        = 'client-docs';
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const SIGNED_TTL    = 3600; // 1 hour

export const uploadOutputDoc = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { id: clientServiceId } = req.params;
    const file = req.file;
    const { document_name, description } = req.body;

    if (!file)                          return res.status(400).json({ error: 'No file provided' });
    if (!document_name?.trim())         return res.status(400).json({ error: 'document_name required' });
    if (!ALLOWED_TYPES.includes(file.mimetype))
      return res.status(400).json({ error: 'Only PDF, JPG, PNG files are accepted' });

    const sc = createServiceClient();

    const { data: cs } = await sc
      .from('client_services')
      .select('id, user_id, assigned_texpert_id, status')
      .eq('id', clientServiceId)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.status === 'cancelled') return res.status(400).json({ error: 'Cannot upload to a cancelled service' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const isAdmin    = isAdminRole(profile?.role as UserRole);
    const isAssigned = cs.assigned_texpert_id === req.user.id;

    if (!isAdmin && !isAssigned) {
      return res.status(403).json({ error: 'Forbidden — not assigned to this service' });
    }

    // Insert row first to get the UUID for the storage path
    const { data: doc, error: insertErr } = await sc
      .from('output_documents')
      .insert({
        client_service_id: clientServiceId,
        uploaded_by:       req.user.id,
        document_name:     document_name.trim(),
        description:       description?.trim() ?? null,
        mime_type:         file.mimetype,
      })
      .select('id')
      .single();

    if (insertErr || !doc) {
      appLogger.error('uploadOutputDoc insert failed', { err: insertErr?.message });
      return res.status(500).json({ error: insertErr?.message ?? 'DB insert failed' });
    }

    const ext      = (file.originalname.split('.').pop() ?? 'pdf').toLowerCase();
    const filePath = `${cs.user_id}/${clientServiceId}/output/${doc.id}.${ext}`;

    const { error: uploadErr } = await sc.storage
      .from(BUCKET)
      .upload(filePath, file.buffer, { upsert: true, contentType: file.mimetype });

    if (uploadErr) {
      await sc.from('output_documents').delete().eq('id', doc.id);
      return res.status(500).json({ error: uploadErr.message });
    }

    await sc.from('output_documents')
      .update({ file_path: filePath, uploaded_at: new Date().toISOString() })
      .eq('id', doc.id);

    await logServiceEvent({
      clientServiceId,
      actorUserId: req.user.id,
      eventType:   'output_document_uploaded',
      message:     `Output document '${document_name.trim()}' was uploaded.`,
      metadata:    { output_doc_id: doc.id },
    });

    res.json({ id: doc.id, filePath, documentName: document_name.trim() });
  } catch (err: any) {
    appLogger.error('uploadOutputDoc error', { err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteOutputDoc = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { id: clientServiceId, docId } = req.params;
    const sc = createServiceClient();

    const { data: doc } = await sc
      .from('output_documents')
      .select('id, file_path, uploaded_by, document_name')
      .eq('id', docId)
      .eq('client_service_id', clientServiceId)
      .single();

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const isAdmin    = isAdminRole(profile?.role as UserRole);
    const isUploader = doc.uploaded_by === req.user.id;

    if (!isAdmin && !isUploader) {
      return res.status(403).json({ error: 'Forbidden — you did not upload this document' });
    }

    if (doc.file_path) {
      await sc.storage.from(BUCKET).remove([doc.file_path]);
    }

    await sc.from('output_documents').delete().eq('id', docId);

    await logServiceEvent({
      clientServiceId,
      actorUserId: req.user.id,
      eventType:   'output_document_deleted',
      message:     `Output document '${doc.document_name}' was deleted.`,
      metadata:    { output_doc_id: docId },
    });

    res.json({ success: true });
  } catch (err: any) {
    appLogger.error('deleteOutputDoc error', { err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getOutputDocSignedUrl = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { id: docId } = req.params;
    const sc = createServiceClient();

    const { data: doc } = await sc
      .from('output_documents')
      .select('id, file_path, client_service_id')
      .eq('id', docId)
      .single();

    if (!doc?.file_path) return res.status(404).json({ error: 'Document not found' });

    // Verify caller has access to this service
    const { data: cs } = await sc
      .from('client_services')
      .select('user_id, assigned_texpert_id')
      .eq('id', doc.client_service_id)
      .single();

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const role       = profile?.role as UserRole;
    const isOwner    = cs?.user_id === req.user.id;
    const isAssigned = cs?.assigned_texpert_id === req.user.id;

    if (!isAdminRole(role) && !isStaffRole(role) && !isOwner && !isAssigned) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: signed, error: signErr } = await sc.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path, SIGNED_TTL);

    if (signErr || !signed?.signedUrl) {
      return res.status(500).json({ error: signErr?.message ?? 'Could not create signed URL' });
    }

    res.json({ url: signed.signedUrl });
  } catch (err: any) {
    appLogger.error('getOutputDocSignedUrl error', { err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};
