import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isStaffRole, UserRole } from '../../shared/roles';
import { logServiceEvent } from '../../utils/operations';
import { canAccessClientServiceRecord } from '../../utils/service-access';
import { emailQueue } from '../../queues/email.queue';

async function getDocumentAccessContext(documentId: string, viewerId: string, viewerRole: UserRole) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('client_documents')
    .select(`
      id, client_service_id, document_name,
      client_service:client_services(id, user_id, assigned_to, fiscal_year)
    `)
    .eq('id', documentId)
    .single();

  if (error || !data) return { error: 'Document not found', context: null };

  const clientService = Array.isArray(data.client_service) ? data.client_service[0] : data.client_service;
  const canAccess = await canAccessClientServiceRecord(supabase, {
    viewerId,
    viewerRole,
    serviceUserId: clientService?.user_id ?? '',
    assignedTo: clientService?.assigned_to ?? null,
  });

  if (!canAccess) return { error: 'Forbidden', context: null };

  return {
    error: null,
    context: {
      documentId: data.id,
      clientServiceId: data.client_service_id,
      documentName: data.document_name as string,
      clientUserId: clientService?.user_id as string,
      fiscalYear: (clientService as Record<string, unknown> | null)?.fiscal_year as string | null,
    },
  };
}

export const verifyDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const access = await getDocumentAccessContext(id, req.user.id, profile?.role as UserRole);
    if (access.error || !access.context) return res.status(403).json({ error: access.error ?? 'Forbidden' });

    const { error } = await req.supabase
      .from('client_documents')
      .update({
        status: 'approved',
        verified_by: req.user.id,
        verified_at: new Date().toISOString(),
        notes: notes ?? null,
      })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: access.context.clientServiceId,
      actorUserId: req.user.id,
      eventType: 'document_approved',
      message: 'A document was approved for this service.',
      metadata: { document_id: id },
    });

    try {
      const serviceClient = createServiceClient();
      const [{ data: clientProfile }, { data: authData }] = await Promise.all([
        serviceClient.from('users').select('first_name').eq('id', access.context.clientUserId).single(),
        serviceClient.auth.admin.getUserById(access.context.clientUserId),
      ]);
      const email = authData?.user?.email;
      if (email) {
        const appUrl = process.env.APP_URL ?? 'https://thetaxpert.com';
        const vaultLink = access.context.fiscalYear
          ? `${appUrl}/vault?fy=${access.context.fiscalYear}&svc=${access.context.clientServiceId}`
          : `${appUrl}/vault`;
        emailQueue.add('document-status', { type: 'document-status', payload: {
          to: email,
          firstName: clientProfile?.first_name ?? 'there',
          documentName: access.context.documentName,
          status: 'approved',
          vaultLink,
        } }).catch(console.error);
      }
    } catch {}

    res.json({ success: true });
  } catch (error) {
    console.error('verifyDocument error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const rejectDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    if (!notes) return res.status(400).json({ error: 'Notes are required when rejecting a document' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const access = await getDocumentAccessContext(id, req.user.id, profile?.role as UserRole);
    if (access.error || !access.context) return res.status(403).json({ error: access.error ?? 'Forbidden' });

    const { error } = await req.supabase
      .from('client_documents')
      .update({ status: 'rejected', notes, verified_by: req.user.id })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId: access.context.clientServiceId,
      actorUserId: req.user.id,
      eventType: 'document_rejected',
      message: 'A document was rejected and needs re-upload.',
      metadata: { document_id: id, notes },
    });

    try {
      const serviceClient = createServiceClient();
      const [{ data: clientProfile }, { data: authData }] = await Promise.all([
        serviceClient.from('users').select('first_name').eq('id', access.context.clientUserId).single(),
        serviceClient.auth.admin.getUserById(access.context.clientUserId),
      ]);
      const email = authData?.user?.email;
      if (email) {
        const appUrl = process.env.APP_URL ?? 'https://thetaxpert.com';
        const vaultLink = access.context.fiscalYear
          ? `${appUrl}/vault?fy=${access.context.fiscalYear}&svc=${access.context.clientServiceId}`
          : `${appUrl}/vault`;
        emailQueue.add('document-status', { type: 'document-status', payload: {
          to: email,
          firstName: clientProfile?.first_name ?? 'there',
          documentName: access.context.documentName,
          status: 'rejected',
          notes,
          vaultLink,
        } }).catch(console.error);
      }
    } catch {}

    res.json({ success: true });
  } catch (error) {
    console.error('rejectDocument error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
