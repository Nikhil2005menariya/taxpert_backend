import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';

async function assertAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.user || !req.supabase) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const { data } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!isAdminRole(data?.role as UserRole)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

export const getAuditLog = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const service = createServiceClient();

    const page       = parseInt(String(req.query.page       ?? '1'), 10);
    const limit      = parseInt(String(req.query.limit      ?? '50'), 10);
    const actorId    = String(req.query.actorId    ?? '').trim();
    const action     = String(req.query.action     ?? '').trim();
    const targetType = String(req.query.targetType ?? '').trim();

    let query = service
      .from('audit_log')
      .select(`
        id, action, target_type, target_id, metadata, created_at,
        actor:users!audit_log_actor_id_fkey(first_name, last_name, email, role)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (actorId)    query = query.eq('actor_id',    actorId);
    if (action)     query = query.eq('action',      action);
    if (targetType) query = query.eq('target_type', targetType);

    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data, count, page, limit });
  } catch (err) {
    appLogger.error('getAuditLog error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
