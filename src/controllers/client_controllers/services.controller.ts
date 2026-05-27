import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { currentFY } from '../../shared/fy-utils';
import { autoAssignTaxpert } from '../../utils/auto-assign';
import { emailQueue } from '../../queues/email.queue';

export const checkServiceExists = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: service } = await req.supabase
      .from('services')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (!service) return res.json({ exists: false, clientServiceId: null });

    const { data: cs } = await req.supabase
      .from('client_services')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('service_id', service.id)
      .neq('status', 'cancelled')
      .maybeSingle();

    res.json({ exists: !!cs, clientServiceId: cs?.id ?? null });
  } catch (error) {
    console.error('checkServiceExists error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const assignService = async (req: Request, res: Response) => {
  try {
    const { slug } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const serviceClient = createServiceClient();

    const { data: service, error: svcErr } = await serviceClient
      .from('services')
      .select('id, name, price, requires_fy')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (svcErr || !service) return res.status(404).json({ error: 'Service not found' });

    const { data: existing } = await req.supabase
      .from('client_services')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('service_id', service.id)
      .neq('status', 'cancelled')
      .maybeSingle();

    if (existing) return res.json({ data: existing, alreadyExists: true });

    const now = new Date().toISOString();
    const fiscalYear = service.requires_fy !== false ? currentFY() : null;

    const { data: cs, error: csErr } = await req.supabase
      .from('client_services')
      .insert({
        user_id: req.user.id,
        service_id: service.id,
        status: 'documents_required',
        status_updated_at: now,
        payment_status: 'pending',
        payment_id: null,
        razorpay_order_id: null,
        fiscal_year: fiscalYear,
      })
      .select()
      .single();

    if (csErr || !cs) return res.status(400).json({ error: csErr?.message ?? 'Failed to assign service' });

    // Auto-assign
    autoAssignTaxpert(serviceClient, req.user.id).catch(console.error);

    // Setup documents
    const { data: docReqs } = await serviceClient
      .from('service_document_requirements')
      .select('id, is_required, sort_order, document_type:document_types(id, name)')
      .eq('service_id', service.id)
      .eq('is_required', true)
      .order('sort_order');

    if (docReqs && docReqs.length > 0) {
      const docs = docReqs.map(req => {
        const dt = Array.isArray(req.document_type) ? req.document_type[0] : req.document_type;
        return {
          client_service_id: cs.id,
          template_id: null,
          document_name: (dt as any)?.name ?? 'Document',
          status: 'pending',
        };
      });
      await req.supabase.from('client_documents').insert(docs);
    } else {
      const { data: templates } = await serviceClient
        .from('document_templates')
        .select('id, name, required')
        .eq('service_id', service.id)
        .order('sort_order');

      if (templates && templates.length > 0) {
        const docs = templates
          .filter(t => t.required)
          .map(t => ({
            client_service_id: cs.id,
            template_id: t.id,
            document_name: t.name,
            status: 'pending',
          }));
        await req.supabase.from('client_documents').insert(docs);
      }
    }

    // Log event
    serviceClient.from('service_events').insert({
      client_service_id: cs.id,
      actor_user_id: req.user.id,
      event_type: 'service_created',
      message: `Service '${service.name}' was added to the workspace.`,
      metadata: { service_slug: slug },
    }).then(({ error }) => { if (error) console.error(error); });

    // Hit the operations bootstrap endpoint internally, or just import it.
    // I'll create a lightweight function for bootstrapping workspace later.
    // For now I'll import it from operations once I build it, or just use fetch?
    // Let's import it directly:
    // import { ensureServiceWorkspace } from '../../utils/operations'; (will build next)
    ensureServiceWorkspace(cs.id).catch(console.error);

    // Send email
    if (req.user.email) {
      const { data: userProfile } = await serviceClient.from('users').select('first_name').eq('id', req.user.id).single();
      const firstName = userProfile?.first_name ?? 'there';
      
      const docNames = docReqs?.map(r => {
        const dt = Array.isArray(r.document_type) ? r.document_type[0] : r.document_type;
        return (dt as any)?.name;
      }).filter(Boolean) || [];

      if (docNames.length > 0) {
        emailQueue.add('document-request', { type: 'document-request', payload: { to: req.user.email, firstName, serviceName: service.name, documents: docNames } }).catch(console.error);
      }
    }

    res.status(201).json({ data: cs, alreadyExists: false });
  } catch (error) {
    console.error('assignService error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export async function ensureServiceWorkspace(clientServiceId: string) {
    // Will implement fully in workspace controller, this is a placeholder
}
