import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';

async function assertAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.user || !req.supabase) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  const { data } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
  if (!isAdminRole(data?.role as UserRole)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

export const listPayouts = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const service = createServiceClient();

    const page     = parseInt(String(req.query.page  ?? '1'), 10);
    const limit    = parseInt(String(req.query.limit ?? '20'), 10);
    const texpertId = String(req.query.texpertId ?? '').trim();

    let query = service
      .from('texpert_payouts')
      .select(`
        id, amount, paid_at, notes, created_at,
        texpert:users!texpert_payouts_texpert_id_fkey(first_name, last_name, email),
        client_service:client_services(
          fiscal_year,
          service:services(name)
        ),
        recorded_by_user:users!texpert_payouts_recorded_by_fkey(first_name, last_name)
      `, { count: 'exact' })
      .order('paid_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (texpertId) {
      query = query.eq('texpert_id', texpertId);
    }

    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data, count, page, limit });
  } catch (err) {
    appLogger.error('listPayouts error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const recordPayout = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { texpertId, clientServiceId, amount, notes } = req.body;

    if (!texpertId || !clientServiceId || !amount) {
      return res.status(400).json({ error: 'texpertId, clientServiceId, and amount are required' });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive integer (in paise)' });
    }

    const service = createServiceClient();

    // Verify taxpert
    const { data: texpert } = await service
      .from('users')
      .select('id')
      .eq('id', texpertId)
      .in('role', ['expert', 'ca'])
      .single();
    if (!texpert) return res.status(404).json({ error: 'Taxpert not found' });

    const { data, error } = await service
      .from('texpert_payouts')
      .insert({
        texpert_id:        texpertId,
        client_service_id: clientServiceId,
        amount,
        notes,
        recorded_by:       req.user!.id,
      })
      .select('id')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'record_payout',
      targetType: 'texpert',
      targetId:   texpertId,
      metadata:   { amount, clientServiceId, payoutId: data.id },
    });

    // TODO: queue payout confirmation email to texpert

    res.json({ success: true, payoutId: data.id });
  } catch (err) {
    appLogger.error('recordPayout error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTexpertPayouts = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    const { data, error } = await service
      .from('texpert_payouts')
      .select(`
        id, amount, paid_at, notes, created_at,
        client_service:client_services(fiscal_year, service:services(name)),
        recorded_by_user:users!texpert_payouts_recorded_by_fkey(first_name, last_name)
      `)
      .eq('texpert_id', id)
      .order('paid_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    appLogger.error('getTexpertPayouts error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
