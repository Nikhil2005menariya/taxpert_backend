import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { logSessionEvent } from '../../services/auth.service';

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const { first_name, last_name, mobile } = req.body;

    if (!first_name?.trim()) return res.status(400).json({ error: 'First name is required' });
    if (!last_name?.trim()) return res.status(400).json({ error: 'Last name is required' });
    if (!/^\d{10}$/.test(mobile?.trim())) return res.status(400).json({ error: 'Mobile must be exactly 10 digits' });

    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const serviceClient = createServiceClient();
    const { error } = await serviceClient
      .from('users')
      .update({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        mobile: mobile.trim(),
      })
      .eq('id', req.user.id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  try {
    const { new_password } = req.body;

    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    // Use user's client to change password
    const { error } = await req.supabase.auth.updateUser({ password: new_password });

    if (error) return res.status(400).json({ error: error.message });

    await logSessionEvent(req.user.id, 'password_change');

    res.json({ success: true });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
