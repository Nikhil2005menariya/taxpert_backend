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

export const listConsultations = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;

    const sc       = createServiceClient();
    const page     = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit    = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const fromDate = String(req.query.from_date ?? '').trim();
    const toDate   = String(req.query.to_date   ?? '').trim();
    const status   = String(req.query.status    ?? '').trim(); // 'consulted' | 'pending' | ''

    let query = sc
      .from('consultation_requests')
      .select('id, name, phone, email, service_needed, message, is_consulted, consulted_at, notes, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status === 'consulted') query = query.eq('is_consulted', true);
    if (status === 'pending')   query = query.eq('is_consulted', false);
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate)   query = query.lte('created_at', toDate + 'T23:59:59.999Z');

    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data, count, page, limit });
  } catch (err) {
    appLogger.error('listConsultations error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const markConsulted = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;

    const { id } = req.params;
    const notes  = String(req.body.notes ?? '').trim() || null;

    const sc = createServiceClient();

    const { data: existing } = await sc
      .from('consultation_requests')
      .select('id, is_consulted')
      .eq('id', id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Inquiry not found' });
    if (existing.is_consulted) return res.status(400).json({ error: 'Already marked as consulted' });

    const { error } = await sc
      .from('consultation_requests')
      .update({
        is_consulted:  true,
        consulted_at:  new Date().toISOString(),
        consulted_by:  req.user!.id,
        notes,
      })
      .eq('id', id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('markConsulted error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
