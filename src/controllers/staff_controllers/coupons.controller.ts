import { Request, Response } from 'express';
import { isStaffRole, UserRole } from '../../shared/roles';

export const getAllCoupons = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await req.supabase
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getAllCoupons error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createCoupon = async (req: Request, res: Response) => {
  try {
    const input = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await req.supabase.from('coupons').insert({
      ...input,
      code: input.code.toUpperCase().trim(),
      created_by: req.user.id,
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('createCoupon error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const toggleCoupon = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isStaffRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await req.supabase.from('coupons').update({ is_active: isActive }).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('toggleCoupon error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
