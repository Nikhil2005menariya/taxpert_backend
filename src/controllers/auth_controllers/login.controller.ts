import { Request, Response } from 'express';
import { loginSchema } from '../../shared/validations';
import { createServiceClient } from '../../configs/supabase.config';
import { logSessionEvent } from '../../services/auth.service';

export const login = async (req: Request, res: Response) => {
  try {
    const raw = {
      email: req.body.email,
      password: req.body.password,
    };

    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const serviceClient = createServiceClient();
    const { data: signInData, error } = await serviceClient.auth.signInWithPassword(parsed.data);

    if (error) {
      const lower = error.message.toLowerCase();
      if (lower.includes('email not confirmed')) {
        return res.status(400).json({ error: 'Please confirm your email first, then sign in.' });
      }
      return res.status(401).json({ error: error.message });
    }

    if (signInData?.user?.id) {
      await logSessionEvent(signInData.user.id, 'login');
    }

    res.json({
      success: true,
      session: signInData.session,
      user: signInData.user,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
