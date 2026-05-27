import { Request, Response } from 'express';
import { logSessionEvent } from '../../services/auth.service';
import { createServiceClient } from '../../configs/supabase.config';

export const logout = async (req: Request, res: Response) => {
  try {
    if (req.user?.id) {
      await logSessionEvent(req.user.id, 'logout');
    }
    
    // In a stateless JWT backend, logout is mostly handled client-side (removing the token).
    // If you want to explicitly invalidate the Supabase session, you can use the token.
    if (req.accessToken && req.supabase) {
       await req.supabase.auth.signOut();
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const serviceClient = createServiceClient();
    
    // Fetch profile
    const { data: userProfile, error: profileError } = await serviceClient
      .from('users')
      .select('id, email, first_name, last_name, mobile, pan, role, is_active, referral_code, created_at')
      .eq('id', req.user.id)
      .single();

    if (profileError || !userProfile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Fetch assigned expert if client
    let expert = null;
    if (userProfile.role === 'client') {
      const { data: assignment } = await serviceClient
        .from('ca_assignments')
        .select('ca:users!ca_assignments_ca_id_fkey(first_name, last_name, role)')
        .eq('client_id', req.user.id)
        .limit(1)
        .maybeSingle();

      if (assignment?.ca) {
        expert = Array.isArray(assignment.ca) ? assignment.ca[0] : assignment.ca;
      }
    }

    res.json({
      user: userProfile,
      expert,
    });
  } catch (error: any) {
    console.error('GetMe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
