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

export const listTaxperts = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const service = createServiceClient();

    // Use texpert_stats view for aggregated data
    const { data, error } = await service
      .from('texpert_stats')
      .select('*')
      .order('first_name');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    appLogger.error('listTaxperts error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createTaxpert = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;

    const { first_name, last_name, email, mobile, pan, password } = req.body;

    if (!first_name || !last_name || !email || !mobile || !pan || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const panUpper = pan.toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panUpper)) {
      return res.status(400).json({ error: 'Invalid PAN format' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const service = createServiceClient();

    const { data: existing } = await service.from('users').select('id').eq('pan', panUpper).single();
    if (existing) return res.status(400).json({ error: 'PAN already registered' });

    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name, role: 'ca' },
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const { error: profileError } = await service.from('users').insert({
      id: authData.user.id,
      first_name,
      last_name,
      email,
      mobile,
      pan: panUpper,
      role: 'ca',
      is_active: true,
    });

    if (profileError) {
      await service.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: profileError.message });
    }

    await writeAudit({
      actorId:    req.user!.id,
      action:     'create_texpert',
      targetType: 'user',
      targetId:   authData.user.id,
      metadata:   { email, pan: panUpper },
    });

    // TODO: queue welcome email with credentials via email worker

    res.json({ success: true, userId: authData.user.id });
  } catch (err) {
    appLogger.error('createTaxpert error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTaxpertDetail = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    const [profileRes, servicesRes, payoutsRes] = await Promise.all([
      service.from('users').select('*').eq('id', id).single(),
      // Scalar select only — client_services has multiple FKs to users; FK-hint joins fail
      service
        .from('client_services')
        .select('id, status, fiscal_year, created_at, user_id, service_id, service:services(name, slug)')
        .eq('assigned_texpert_id', id)
        .order('created_at', { ascending: false }),
      service
        .from('texpert_payouts')
        .select('*')
        .eq('texpert_id', id)
        .order('paid_at', { ascending: false }),
    ]);

    if (profileRes.error || !profileRes.data) {
      return res.status(404).json({ error: 'Taxpert not found' });
    }
    if (!['expert', 'ca'].includes(profileRes.data.role)) {
      return res.status(404).json({ error: 'User is not a taxpert' });
    }

    // Batch-fetch client profiles for the assigned services
    const csRows = servicesRes.data ?? [];
    const clientIds = [...new Set(csRows.map((r: any) => r.user_id).filter(Boolean))] as string[];
    const clientRes = clientIds.length
      ? await service.from('users').select('id, first_name, last_name, email').in('id', clientIds)
      : { data: [] as any[] };
    const clientMap = new Map<string, any>();
    for (const c of clientRes.data ?? []) clientMap.set(c.id, c);

    const services = csRows.map((r: any) => ({
      ...r,
      client: clientMap.get(r.user_id) ?? null,
    }));

    res.json({
      profile:  profileRes.data,
      services,
      payouts:  payoutsRes.data ?? [],
    });
  } catch (err) {
    appLogger.error('getTaxpertDetail error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateTaxpert = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const { first_name, last_name, mobile } = req.body;

    const service = createServiceClient();
    const { error } = await service
      .from('users')
      .update({ first_name, last_name, mobile })
      .eq('id', id)
      .in('role', ['expert', 'ca']);

    if (error) return res.status(400).json({ error: error.message });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'update_texpert',
      targetType: 'user',
      targetId:   id,
      metadata:   { fields: Object.keys(req.body) },
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('updateTaxpert error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deactivateTaxpert = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    const { error } = await service
      .from('users')
      .update({ is_active: false })
      .eq('id', id)
      .in('role', ['expert', 'ca']);

    if (error) return res.status(400).json({ error: error.message });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'deactivate_texpert',
      targetType: 'user',
      targetId:   id,
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('deactivateTaxpert error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeTaxpert = async (req: Request, res: Response) => {
  try {
    if (!await assertAdmin(req, res)) return;
    const { id } = req.params;
    const service = createServiceClient();

    // Verify it's actually a taxpert before deleting
    const { data: user } = await service.from('users').select('role, email').eq('id', id).single();
    if (!user || !['expert', 'ca'].includes(user.role)) {
      return res.status(404).json({ error: 'Taxpert not found' });
    }

    const { error } = await service.auth.admin.deleteUser(id);
    if (error) return res.status(400).json({ error: error.message });

    await writeAudit({
      actorId:    req.user!.id,
      action:     'remove_texpert',
      targetType: 'user',
      targetId:   id,
      metadata:   { email: user.email },
    });

    res.json({ success: true });
  } catch (err) {
    appLogger.error('removeTaxpert error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
