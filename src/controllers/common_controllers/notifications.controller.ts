import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { appLogger } from '../../utils/logger';

// All endpoints are scoped to the authenticated user (req.user.id) — a user can
// only ever read/modify their own notifications.

export const getNotifications = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const sc = createServiceClient();
    const { data, error } = await sc
      .from('notifications')
      .select('id, type, title, body, link, metadata, is_read, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    appLogger.error('getNotifications error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sc = createServiceClient();
    const { count, error } = await sc
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ count: count ?? 0 });
  } catch (err) {
    appLogger.error('getUnreadCount error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const markRead = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const sc = createServiceClient();
    const { error } = await sc
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.user.id); // ownership guard
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    appLogger.error('markRead error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const markAllRead = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sc = createServiceClient();
    const { error } = await sc
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .eq('is_read', false);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    appLogger.error('markAllRead error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
