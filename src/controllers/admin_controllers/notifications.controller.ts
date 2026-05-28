import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';
import { sendManualNotificationEmail } from '../../utils/email';

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

    if (!recipientId || !subject || !body) {
      return res.status(400).json({ error: 'recipientId, subject, and body are required' });
    }

    const service = createServiceClient();
    const { data: recipient } = await service
      .from('users')
      .select('email, first_name')
      .eq('id', recipientId)
      .single();

    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    await sendManualNotificationEmail({ to: recipient.email, subject, body });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'send_notification',
      targetType: 'user',
      targetId:   recipientId,
      metadata:   { subject },
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('sendNotification error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
