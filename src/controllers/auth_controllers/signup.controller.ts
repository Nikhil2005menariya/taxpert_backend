import { Request, Response } from 'express';
import { signupSchema } from '../../shared/validations';
import { createServiceClient } from '../../configs/supabase.config';
import { emailQueue } from '../../queues/email.queue';

export const signup = async (req: Request, res: Response) => {
  try {
    const raw = {
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      email: req.body.email,
      mobile: req.body.mobile,
      pan: req.body.pan?.toUpperCase(),
      password: req.body.password,
    };

    const referralCodeUsed = req.body.referral_code_used?.toUpperCase().trim() || null;

    const parsed = signupSchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { first_name, last_name, email, mobile, pan, password } = parsed.data;
    const serviceClient = createServiceClient();

    // 1. Create auth user
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto confirm for now, or false if you want them to confirm
      user_metadata: { first_name, last_name },
    });

    if (authError) return res.status(400).json({ error: authError.message });
    if (!authData.user) return res.status(400).json({ error: 'Failed to create account' });

    // 2. Generate referral code
    const ownReferralCode = `TAXPERT-${authData.user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

    // 3. Resolve referrer
    let referredByUserId: string | null = null;
    if (referralCodeUsed) {
      const { data: referrer } = await serviceClient
        .from('users')
        .select('id')
        .eq('referral_code', referralCodeUsed)
        .maybeSingle();
      if (referrer && referrer.id !== authData.user.id) {
        referredByUserId = referrer.id;
      }
    }

    // 4. Insert profile
    const { error: profileError } = await serviceClient.from('users').insert({
      id: authData.user.id,
      first_name,
      last_name,
      email,
      mobile,
      pan,
      role: 'client',
      referral_code: ownReferralCode,
      referral_code_used: referredByUserId ? referralCodeUsed : null,
      referred_by_user_id: referredByUserId,
    });

    // 5. Cleanup on profile failure
    if (profileError) {
      await serviceClient.auth.admin.deleteUser(authData.user.id);
      if (profileError.code === '23505') {
        return res.status(400).json({ error: 'This PAN is already registered' });
      }
      return res.status(400).json({ error: profileError.message });
    }

    // 6. Non-blocking side-effects
    Promise.allSettled([
      emailQueue.add('signup', { type: 'signup', payload: { to: email, firstName: first_name } }),
      // trackEvent('signup', authData.user.id, { has_referral: !!referredByUserId }) // Assuming trackEvent is implemented similarly
    ]).catch(console.error);

    // 7. Login the user automatically to get tokens
    const { data: sessionData, error: sessionError } = await serviceClient.auth.signInWithPassword({
      email,
      password,
    });

    if (sessionError || !sessionData.session) {
       return res.status(201).json({
         success: true,
         message: 'Account created. Please confirm your email, then sign in.',
       });
    }

    return res.status(201).json({
      success: true,
      session: sessionData.session,
      user: sessionData.user,
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
