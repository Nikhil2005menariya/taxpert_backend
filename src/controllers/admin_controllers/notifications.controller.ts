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

export const sendNotification = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { recipientId, subject, body } = req.body;

    if (!recipientId || !subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'recipientId, subject, and body are required' });
    }

    const service = createServiceClient();
    const { data: recipient } = await service
      .from('users')
      .select('email, first_name')
      .eq('id', recipientId)
      .single();

    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    // Queue via BullMQ — ensures delivery with retry, not a fire-and-forget direct call
    await emailQueue.add('manual-notification', {
      type:    'manual-notification',
      payload: { to: recipient.email, subject: subject.trim(), body: body.trim() },
    });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'send_notification',
      targetType: 'user',
      targetId:   recipientId,
      metadata:   {
        subject:        subject.trim(),
        body:           body.trim(),
        recipient_email: recipient.email,
        recipient_name:  recipient.first_name,
      },
    });

    appLogger.info('sendNotification queued', { to: recipient.email, subject, actorId: req.user!.id });
    res.json({ success: true });
  } catch (err) {
    appLogger.error('sendNotification error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getNotificationHistory = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const service = createServiceClient();

    const { data: logs, error } = await service
      .from('audit_log')
      .select('id, actor_id, target_id, metadata, created_at')
      .eq('action', 'send_notification')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(400).json({ error: error.message });

    // Enrich with actor and recipient names
    const enriched = await Promise.all((logs ?? []).map(async (log: any) => {
      const [{ data: actor }, { data: recipient }] = await Promise.all([
        service.from('users').select('first_name, last_name').eq('id', log.actor_id).single(),
        service.from('users').select('first_name, last_name, email').eq('id', log.target_id).single(),
      ]);
      return {
        id:              log.id,
        created_at:      log.created_at,
        subject:         log.metadata?.subject ?? '',
        body:            log.metadata?.body ?? '',
        recipient_email: log.metadata?.recipient_email ?? recipient?.email ?? '',
        recipient_name:  recipient ? `${recipient.first_name} ${recipient.last_name}` : log.metadata?.recipient_name ?? '',
        sent_by:         actor ? `${actor.first_name} ${actor.last_name}` : 'Admin',
      };
    }));

    res.json({ data: enriched });
  } catch (err) {
    appLogger.error('getNotificationHistory error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
