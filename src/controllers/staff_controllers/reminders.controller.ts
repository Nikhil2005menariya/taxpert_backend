import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { emailQueue } from '../../queues/email.queue';
import { isStaffRole, UserRole } from '../../shared/roles';
import { config } from '../../configs/app.config';
export const sendManualReminder = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { clientServiceId } = req.params;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data: cs } = await req.supabase
      .from('client_services')
      .select('id, user_id, status, fiscal_year, service:services(name)')
      .eq('id', clientServiceId)
      .single();

    if (!cs) return res.status(404).json({ error: 'Service not found' });
    if (cs.status !== 'documents_required') {
      return res.status(400).json({ error: 'Reminders only apply to services awaiting documents' });
    }

    const { data: pendingDocs } = await req.supabase
      .from('client_documents')
      .select('id, document_name')
      .eq('client_service_id', clientServiceId)
      .eq('status', 'pending');

    if (!pendingDocs?.length) {
      return res.status(400).json({ error: 'No pending documents' });
    }

    const { data: lastReminder } = await req.supabase
      .from('document_reminders')
      .select('id, sent_at')
      .eq('client_service_id', clientServiceId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastReminder?.sent_at) {
      const hoursSinceLast = (Date.now() - new Date(lastReminder.sent_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < 24) {
        return res.status(400).json({ error: 'Reminder already sent recently', lastSent: lastReminder.sent_at });
      }
    }

    const service = createServiceClient();
    const [{ data: clientProfile }, { data: authData }] = await Promise.all([
      req.supabase.from('users').select('first_name').eq('id', cs.user_id).single(),
      service.auth.admin.getUserById(cs.user_id),
    ]);

    const email = authData?.user?.email;
    if (!email) return res.status(400).json({ error: 'Could not resolve client email' });

    const firstName = clientProfile?.first_name ?? 'there';
    const svc = Array.isArray(cs.service) ? cs.service[0] : cs.service;
    const serviceName = svc?.name ?? 'your service';
    const pendingDocNames = pendingDocs.map((d: any) => d.document_name);

    try {
      const appUrl = config.APP_URL ?? 'https://thetaxpert.com';
      const fy = cs.fiscal_year;
      const vaultLink = fy ? `${appUrl}/vault?fy=${fy}&svc=${cs.id}` : `${appUrl}/vault`;
      await emailQueue.add('document-reminder', { type: 'document-reminder', payload: {
        to: email,
        firstName,
        serviceName,
        pendingDocuments: pendingDocNames,
        vaultLink,
        reminderType: 'manual_nudge',
      } });
    } catch (err) {
      return res.status(500).json({ error: `Email delivery failed: ${err instanceof Error ? err.message : 'unknown error'}` });
    }

    const { error: insertErr } = await service.from('document_reminders').insert({
      client_service_id: clientServiceId,
      user_id: cs.user_id,
      reminder_type: 'manual_nudge',
      sent_by: req.user.id,
      pending_docs: pendingDocs.length,
    });

    if (insertErr && insertErr.code !== '42P01') {
      console.error('[sendManualReminder] insert failed:', insertErr.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('sendManualReminder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getLastReminder = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { clientServiceId } = req.params;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await req.supabase
      .from('document_reminders')
      .select('id, sent_at, reminder_type, pending_docs')
      .eq('client_service_id', clientServiceId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== '42P01') return res.status(400).json({ error: error.message });
    res.json({ data: data ?? null });
  } catch (error) {
    console.error('getLastReminder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPendingDocumentClients = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data: services, error: svcErr } = await req.supabase
      .from('client_services')
      .select(`
        id, user_id, created_at,
        service:services(name),
        client:users!client_services_user_id_fkey(first_name, last_name),
        client_documents(status)
      `)
      .eq('status', 'documents_required')
      .order('created_at', { ascending: true });

    if (svcErr) return res.status(400).json({ error: svcErr.message });
    if (!services?.length) return res.json({ data: [] });

    const serviceIds = services.map((s: any) => s.id);
    const { data: reminders } = await req.supabase
      .from('document_reminders')
      .select('client_service_id, sent_at, reminder_type')
      .in('client_service_id', serviceIds)
      .order('sent_at', { ascending: false });

    const lastReminderMap = new Map<string, { sent_at: string; reminder_type: string }>();
    for (const r of reminders ?? []) {
      if (!lastReminderMap.has(r.client_service_id)) {
        lastReminderMap.set(r.client_service_id, { sent_at: r.sent_at, reminder_type: r.reminder_type });
      }
    }

    const now = Date.now();

    const data = services.map((cs: any) => {
      const svc = Array.isArray(cs.service) ? cs.service[0] : cs.service;
      const client = Array.isArray(cs.client) ? cs.client[0] : cs.client;
      const docs = cs.client_documents ?? [];
      const pendingDocsCount = docs.filter((d: any) => d.status === 'pending' || d.status === 'rejected').length;
      const daysWaiting = Math.floor((now - new Date(cs.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const lastReminder = lastReminderMap.get(cs.id);

      return {
        clientServiceId: cs.id,
        clientName: `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim() || 'Unknown',
        serviceName: svc?.name ?? 'Unknown',
        pendingDocsCount,
        daysWaiting,
        lastReminderAt: lastReminder?.sent_at ?? null,
        lastReminderType: lastReminder?.reminder_type ?? null,
      };
    });

    res.json({ data });
  } catch (error) {
    console.error('getPendingDocumentClients error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
