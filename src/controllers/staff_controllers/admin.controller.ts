import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole, isStaffRole } from '../../shared/roles';
import { emailQueue } from '../../queues/email.queue';
import { appLogger } from '../../utils/logger';

export const listClientUsers = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: me } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(me?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const page   = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit  = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const search = String(req.query.search ?? '').trim();

    let query = service
      .from('users')
      .select('id, first_name, last_name, email, mobile, pan, is_active, created_at', { count: 'exact' })
      .eq('role', 'client')
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,pan.ilike.%${search}%,mobile.ilike.%${search}%`
      );
    }

    const { data: users, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    // Fetch service counts only for this page's user IDs
    const userIds = (users ?? []).map((u: any) => u.id);
    const countMap: Record<string, { total: number; filed: number }> = {};

    if (userIds.length > 0) {
      const { data: svcs } = await service
        .from('client_services')
        .select('user_id, status')
        .in('user_id', userIds);

      for (const s of svcs ?? []) {
        if (!countMap[s.user_id]) countMap[s.user_id] = { total: 0, filed: 0 };
        countMap[s.user_id].total++;
        if (s.status === 'completed') countMap[s.user_id].filed++;
      }
    }

    const data = (users ?? []).map((u: any) => ({
      ...u,
      total_services:     countMap[u.id]?.total ?? 0,
      completed_services: countMap[u.id]?.filed  ?? 0,
    }));

    res.json({ data, count, page, limit });
  } catch (error) {
    console.error('listClientUsers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const listStaffUsers = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: me } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(me?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const page   = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10));
    const limit  = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const search = String(req.query.search ?? '').trim();
    const role   = String(req.query.role   ?? '').trim();

    let query = service
      .from('users')
      .select('id, first_name, last_name, email, mobile, pan, role, is_active, created_at', { count: 'exact' })
      .neq('role', 'client')
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (role)   query = query.eq('role', role);
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,mobile.ilike.%${search}%`);

    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    res.json({ data, count, page, limit });
  } catch (error) {
    console.error('listStaffUsers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service.from('users').select('*').order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getAllUsers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { first_name, last_name, email, mobile, pan, role, password } = req.body;

    if (!first_name || !last_name || !email || !mobile || !pan || !role || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const panUpper = pan.toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panUpper)) {
      return res.status(400).json({ error: 'Invalid PAN format (e.g. ABCDE1234F)' });
    }

    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const service = createServiceClient();
    const { data: existing } = await service.from('users').select('id').eq('pan', panUpper).single();
    if (existing) return res.status(400).json({ error: 'This PAN is already registered' });

    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name, role },
    });

    if (authError) return res.status(400).json({ error: authError.message });

    const { error: profileError } = await service.from('users').insert({
      id: authData.user.id,
      first_name,
      last_name,
      email,
      mobile,
      pan: panUpper,
      role,
    });

    if (profileError) {
      await service.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ error: profileError.message });
    }

    // Queue welcome email via worker (non-blocking)
    emailQueue.add('new-user-welcome', {
      type:    'new-user-welcome',
      payload: { to: email, firstName: first_name, email, password, role },
    }).catch(e => appLogger.warn('new-user-welcome enqueue failed', { err: e.message }));

    res.json({ success: true, userId: authData.user.id });
  } catch (error) {
    appLogger.error('createUser error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    const viewerRole = profile?.role as UserRole;
    if (!isAdminRole(viewerRole)) return res.status(403).json({ error: 'Forbidden' });

    const { userId, role } = req.body;

    if (role === 'super_admin' && viewerRole !== 'super_admin') {
      return res.status(403).json({ error: 'Only a Super Admin can assign the Super Admin role.' });
    }
    if (role === 'admin' && viewerRole !== 'super_admin') {
      return res.status(403).json({ error: 'Only a Super Admin can assign the Admin role.' });
    }

    const service = createServiceClient();
    const { error: dbError } = await service.from('users').update({ role }).eq('id', userId);
    if (dbError) return res.status(400).json({ error: dbError.message });

    const { error: metaError } = await service.auth.admin.updateUserById(userId, { user_metadata: { role } });
    if (metaError) console.error('[updateUserRole] metadata sync failed:', metaError.message);

    res.json({ success: true });
  } catch (error) {
    console.error('updateUserRole error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const setUserPassword = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: adminProfile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(adminProfile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { userId, newPassword, password } = req.body;
    const pwd = (newPassword ?? password ?? '') as string;
    if (!pwd || pwd.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const service = createServiceClient();

    // Fetch user info for the notification email
    const { data: user } = await service
      .from('users')
      .select('email, first_name')
      .eq('id', userId)
      .single();

    const { error: authError } = await service.auth.admin.updateUserById(userId, { password: pwd });
    if (authError) return res.status(400).json({ error: authError.message });

    // Queue notification email (non-blocking)
    if (user?.email) {
      emailQueue.add('admin-password-reset', {
        type:    'admin-password-reset',
        payload: {
          to:          user.email,
          firstName:   user.first_name ?? 'User',
          newPassword: pwd,
        },
      }).catch(e => appLogger.warn('admin-password-reset enqueue failed', { err: e.message }));
    }

    res.json({ success: true });
  } catch (error) {
    appLogger.error('setUserPassword error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
};


export const getFilingCountsByClient = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service.from('client_services').select('user_id, status');
    if (error) return res.status(400).json({ error: error.message });

    const counts: Record<string, { total: number; filed: number; processing: number }> = {};
    for (const row of data ?? []) {
      if (!counts[row.user_id]) counts[row.user_id] = { total: 0, filed: 0, processing: 0 };
      counts[row.user_id].total++;
      if (row.status === 'completed') counts[row.user_id].filed++;
      if (row.status === 'in_progress' || row.status === 'under_review') counts[row.user_id].processing++;
    }

    res.json({ data: counts });
  } catch (error) {
    console.error('getFilingCountsByClient error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getActiveTaxperts = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service
      .from('users')
      .select('id, first_name, last_name')
      .in('role', ['expert', 'ca'])
      .eq('is_active', true)
      .order('first_name');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getActiveTaxperts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const quickAssignTaxpert = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { taxpertId, clientId } = req.body;

    const service = createServiceClient();
    const { error } = await service.from('ca_assignments').upsert({ ca_id: taxpertId, client_id: clientId });
    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (error) {
    console.error('quickAssignTaxpert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getClientTaxpert = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { clientId } = req.params;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service
      .from('ca_assignments')
      .select('ca_id, ca:users!ca_assignments_ca_id_fkey(id, first_name, last_name)')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });

    const ca = data ? (Array.isArray(data.ca) ? data.ca[0] : data.ca) : null;
    res.json({ data: ca });
  } catch (error) {
    console.error('getClientTaxpert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- Permissions ---

export const getAllUserPermissionOverrides = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service.from('user_permissions').select('user_id, granted, revoked, updated_at');

    if (error && error.code !== '42P01') return res.status(400).json({ error: error.message });
    res.json({ data: data ?? [] });
  } catch (error) {
    console.error('getAllUserPermissionOverrides error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserPermissionOverrides = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { userId } = req.params;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service
      .from('user_permissions')
      .select('granted, revoked')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== '42P01') return res.status(400).json({ error: error.message });
    res.json({ data: data ?? { granted: [], revoked: [] } });
  } catch (error) {
    console.error('getUserPermissionOverrides error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUserPermissionOverrides = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const { userId, granted, revoked, note } = req.body;

    const service = createServiceClient();
    const { data: current } = await service.from('user_permissions').select('granted, revoked').eq('user_id', userId).maybeSingle();

    const grantedBefore = current?.granted ?? [];
    const revokedBefore = current?.revoked ?? [];

    const { error: dbError } = await service.from('user_permissions').upsert({
      user_id: userId,
      granted,
      revoked,
      updated_at: new Date().toISOString(),
      updated_by: req.user.id,
    });

    if (dbError) return res.status(400).json({ error: dbError.message });

    await service.from('permission_audit_log').insert({
      actor_user_id: req.user.id,
      target_user_id: userId,
      granted_before: grantedBefore,
      revoked_before: revokedBefore,
      granted_after: granted,
      revoked_after: revoked,
      note: note ?? null,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('updateUserPermissionOverrides error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPermissionAuditLog = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { targetUserId } = req.params;

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const service = createServiceClient();
    const { data, error } = await service
      .from('permission_audit_log')
      .select(`
        id, granted_before, revoked_before, granted_after, revoked_after,
        note, created_at,
        actor:users!permission_audit_log_actor_user_id_fkey(first_name, last_name)
      `)
      .eq('target_user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error && error.code !== '42P01') return res.status(400).json({ error: error.message });
    res.json({ data: data ?? [] });
  } catch (error) {
    console.error('getPermissionAuditLog error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
