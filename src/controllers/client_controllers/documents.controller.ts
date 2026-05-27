import { Request, Response } from 'express';
import { getSignedDocumentUrl } from '../../utils/storage';
import { logServiceEvent } from '../../utils/operations';
import { UserRole } from '../../shared/roles';

export const addOptionalDocument = async (req: Request, res: Response) => {
  try {
    const { clientServiceId, templateId } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: cs } = await req.supabase.from('client_services').select('user_id').eq('id', clientServiceId).single();
    if (!cs || cs.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { data: existing } = await req.supabase
      .from('client_documents')
      .select('id')
      .eq('client_service_id', clientServiceId)
      .eq('template_id', templateId)
      .maybeSingle();

    if (existing) return res.json({ success: true });

    const { data: tmpl } = await req.supabase.from('document_templates').select('name').eq('id', templateId).single();
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });

    const { error } = await req.supabase.from('client_documents').insert({
      client_service_id: clientServiceId,
      template_id: templateId,
      document_name: tmpl.name,
      status: 'pending',
    });

    if (error) return res.status(400).json({ error: error.message });

    await logServiceEvent({
      clientServiceId,
      actorUserId: req.user.id,
      eventType: 'optional_document_added',
      message: `Optional document '${tmpl.name}' was added to the checklist.`,
      metadata: { template_id: templateId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('addOptionalDocument error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getDocumentSignedUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const { url, error } = await getSignedDocumentUrl(
      req.supabase,
      { userId: req.user.id, role: (profile?.role ?? 'client') as UserRole },
      { kind: 'client_document', documentId: id }
    );

    if (error) return res.status(400).json({ error });
    res.json({ url });
  } catch (error) {
    console.error('getDocumentSignedUrl error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCommonDocumentSignedUrl = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const { url, error } = await getSignedDocumentUrl(
      req.supabase,
      { userId: req.user.id, role: (profile?.role ?? 'client') as UserRole },
      { kind: 'common_document', documentId: id }
    );

    if (error) return res.status(400).json({ error });
    res.json({ url });
  } catch (error) {
    console.error('getCommonDocumentSignedUrl error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
