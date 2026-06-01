import { Request, Response } from 'express';
import { loginSchema } from '../../shared/validations';
import { createServiceClient } from '../../configs/supabase.config';
import { logSessionEvent, logFailedLoginAudit } from '../../services/auth.service';

export const login = async (req: Request, res: Response) => {
  try {
    const raw = {
      email:    req.body.email,
      password: req.body.password,
    };

    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const sc = createServiceClient();
    const { data: signInData, error } = await sc.auth.signInWithPassword(parsed.data);

    if (error) {
      const lower = error.message.toLowerCase();
      let clientMessage = error.message;

      if (lower.includes('email not confirmed')) {
        clientMessage = 'Your email is not verified. Please check your inbox for the verification link, or request a new one on the sign-in page.';
        logFailedLoginAudit(parsed.data.email, 'email_not_confirmed', req).catch(console.error);
        return res.status(400).json({ error: clientMessage, code: 'EMAIL_NOT_CONFIRMED' });
      }

      if (lower.includes('invalid login') || lower.includes('invalid credentials') || lower.includes('wrong password')) {
        clientMessage = 'Incorrect email or password.';
      }

      logFailedLoginAudit(parsed.data.email, error.message, req).catch(console.error);
      return res.status(401).json({ error: clientMessage });
    }

    // Successful login
    if (signInData?.user?.id) {
      logSessionEvent(signInData.user.id, 'login', req, {
        email: parsed.data.email,
      }).catch(console.error);
    }

    res.json({
      success: true,
      session: signInData.session,
      user:    signInData.user,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
