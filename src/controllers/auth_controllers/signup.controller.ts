import { Request, Response } from 'express';
import { signupSchema } from '../../shared/validations';
import { createServiceClient } from '../../configs/supabase.config';
import { redisKv } from '../../configs/redis-client';
import { emailQueue } from '../../queues/email.queue';
import { sendOtpEmail } from '../../utils/email';
import { logSignupAudit } from '../../services/auth.service';
import { appLogger } from '../../utils/logger';

// ── Constants ─────────────────────────────────────────────────

const OTP_TTL_SECONDS = 600;         // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

function otpKey(email: string) {
  return `signup_otp:${email.toLowerCase()}`;
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── Types ─────────────────────────────────────────────────────

interface PendingSignup {
  first_name:          string;
  last_name:           string;
  email:               string;
  mobile:              string;
  pan:                 string;
  password:            string;
  referral_code_used:  string | null;
  otp:                 string;
  attempts:            number;
  created_at:          number;
}

// ── Helpers ───────────────────────────────────────────────────

type SC = ReturnType<typeof createServiceClient>;

/** Find a Supabase auth user by email (paginates listUsers). */
async function findAuthUserByEmail(sc: SC, email: string) {
  const target = email.toLowerCase();
  let page = 1;
  // Paginate defensively — stop when a page returns fewer than perPage rows.
  for (;;) {
    const { data, error } = await sc.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find(u => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 50) return null; // hard safety cap (~10k users)
  }
}

/** Permanently delete a stale/unconfirmed account from auth + users table. */
async function purgeStaleAccount(sc: SC, userId: string, reason: string) {
  await sc.auth.admin.deleteUser(userId).catch(() => {});
  await Promise.resolve(sc.from('users').delete().eq('id', userId)).catch(() => {});
  appLogger.info(`[signup] purged stale account ${userId} — ${reason}`);
}

/**
 * Resolve uniqueness for email / pan / mobile.
 *
 * A `users` row is only a TRUE blocker if its matching Supabase auth user
 * has email_confirmed_at set. If the auth user is unconfirmed (a leftover from
 * an abandoned signup or the legacy flow) — or missing entirely — the stale
 * record is purged and the field is treated as available.
 *
 * Returns a blocking conflict, or null if clear.
 */
async function resolveUniqueness(
  sc: SC,
  email: string,
  pan: string,
  mobile: string,
): Promise<{ field: string; label: string } | null> {
  // Resolve a single users-table row → confirmed? stale? gone?
  async function evaluate(userId: string, label: string): Promise<{ field: string; label: string } | null> {
    const { data: authData } = await sc.auth.admin.getUserById(userId);
    const authUser = authData?.user;
    if (!authUser) {
      // Profile row with no auth user — orphan. Remove the dangling row.
      await Promise.resolve(sc.from('users').delete().eq('id', userId)).catch(() => {});
      appLogger.info(`[signup] removed orphan users row ${userId} (no auth user)`);
      return null;
    }
    if (authUser.email_confirmed_at) {
      return { field: label.toLowerCase(), label };
    }
    // Unconfirmed leftover → purge and treat field as available
    await purgeStaleAccount(sc, userId, `unconfirmed ${label}`);
    return null;
  }

  const [emailRow, panRow, mobileRow] = await Promise.all([
    sc.from('users').select('id').eq('email',  email).maybeSingle(),
    sc.from('users').select('id').eq('pan',    pan).maybeSingle(),
    sc.from('users').select('id').eq('mobile', mobile).maybeSingle(),
  ]);

  if (emailRow.data) {
    const c = await evaluate(emailRow.data.id, 'Email address');
    if (c) return c;
  }
  if (panRow.data) {
    const c = await evaluate(panRow.data.id, 'PAN');
    if (c) return c;
  }
  if (mobileRow.data) {
    const c = await evaluate(mobileRow.data.id, 'Mobile number');
    if (c) return c;
  }

  // Edge case: an unconfirmed auth user exists for this email WITHOUT a users
  // row (e.g. legacy flow where profile insert failed, or a rolled-back verify).
  // It would block createUser later — purge it now if unconfirmed.
  const authByEmail = await findAuthUserByEmail(sc, email);
  if (authByEmail) {
    if (authByEmail.email_confirmed_at) {
      return { field: 'email', label: 'Email address' };
    }
    await purgeStaleAccount(sc, authByEmail.id, 'unconfirmed auth user (no profile)');
  }

  return null;
}

// ── POST /auth/signup-initiate ─────────────────────────────────
// Step 1: validate fields → check uniqueness → send OTP
// Nothing is written to the database at this stage.

export const signupInitiate = async (req: Request, res: Response) => {
  try {
    const raw = {
      first_name: req.body.first_name,
      last_name:  req.body.last_name,
      email:      req.body.email,
      mobile:     req.body.mobile,
      pan:        req.body.pan?.toUpperCase(),
      password:   req.body.password,
    };

    const referralCodeUsed = req.body.referral_code_used?.toUpperCase().trim() || null;

    const parsed = signupSchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { first_name, last_name, email, mobile, pan, password } = parsed.data;
    const sc = createServiceClient();

    // Uniqueness check — purges stale unconfirmed leftovers automatically
    const conflict = await resolveUniqueness(sc, email, pan, mobile);
    if (conflict) {
      return res.status(400).json({
        error: `${conflict.label} is already registered. Please sign in or use the forgot password option.`,
      });
    }

    // Check if there's already a pending OTP for this email (active within window)
    const existing = await redisKv.get(otpKey(email));
    if (existing) {
      const data: PendingSignup = JSON.parse(existing);
      const ageSec = (Date.now() - data.created_at) / 1000;
      if (ageSec < OTP_TTL_SECONDS) {
        // Still within window — tell them to use the code they already have
        const remainingMin = Math.ceil((OTP_TTL_SECONDS - ageSec) / 60);
        return res.status(400).json({
          error:     `A verification code was already sent to ${email}. Check your inbox (valid for ${remainingMin} more minute${remainingMin !== 1 ? 's' : ''}).`,
          code:      'OTP_ALREADY_SENT',
          email,
        });
      }
      // Expired pending — delete and proceed
      await redisKv.del(otpKey(email));
    }

    // Generate OTP and store pending signup in Redis
    const otp: string = generateOtp();
    const pending: PendingSignup = {
      first_name, last_name, email, mobile, pan, password,
      referral_code_used: referralCodeUsed,
      otp,
      attempts:   0,
      created_at: Date.now(),
    };

    await redisKv.setex(otpKey(email), OTP_TTL_SECONDS, JSON.stringify(pending));

    // Send OTP email directly via Resend (synchronous — user is waiting)
    try {
      await sendOtpEmail({ to: email, firstName: first_name, otp });
    } catch (emailErr: any) {
      // Clean up Redis if email failed to send
      await redisKv.del(otpKey(email));
      appLogger.error('[signup-initiate] failed to send OTP email', { err: emailErr.message });
      return res.status(500).json({ error: 'Could not send verification email. Please try again.' });
    }

    appLogger.info('[signup-initiate] OTP sent', { email });

    return res.json({
      success: true,
      email,
      message: `A 6-digit verification code has been sent to ${email}. It expires in 10 minutes.`,
    });
  } catch (error: any) {
    console.error('signupInitiate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /auth/signup-verify-otp ──────────────────────────────
// Step 2: validate OTP → create auth user + profile → return session

export const signupVerifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;
    if (!email?.trim() || !otp?.trim()) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const key             = otpKey(normalizedEmail);

    // Load pending signup from Redis
    const raw = await redisKv.get(key);
    if (!raw) {
      return res.status(400).json({
        error: 'Verification code expired or not found. Please start over.',
        code:  'OTP_EXPIRED',
      });
    }

    const pending: PendingSignup = JSON.parse(raw);

    // Increment attempt count before checking (prevents timing attacks)
    pending.attempts += 1;
    const remainingAttempts = OTP_MAX_ATTEMPTS - pending.attempts;

    if (pending.otp !== otp.trim()) {
      if (pending.attempts >= OTP_MAX_ATTEMPTS) {
        // Too many wrong attempts — invalidate
        await redisKv.del(key);
        return res.status(400).json({
          error: 'Too many incorrect attempts. Please start over.',
          code:  'OTP_MAX_ATTEMPTS',
        });
      }
      // Save updated attempt count back to Redis (preserve remaining TTL)
      const ttlLeft = await redisKv.ttl(key);
      if (ttlLeft > 0) {
        await redisKv.setex(key, ttlLeft, JSON.stringify(pending));
      }
      return res.status(400).json({
        error:             `Incorrect code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
        code:              'OTP_WRONG',
        remainingAttempts,
      });
    }

    // OTP is valid — delete it immediately (single use)
    await redisKv.del(key);

    const sc = createServiceClient();

    // Final uniqueness check (race guard — purges stale leftovers, blocks only on confirmed users)
    const conflict = await resolveUniqueness(sc, pending.email, pending.pan, pending.mobile);
    if (conflict) {
      return res.status(400).json({
        error: `${conflict.label} was registered by someone else just now. Please use a different one.`,
      });
    }

    // Resolve referrer
    let referredByUserId: string | null = null;
    if (pending.referral_code_used) {
      const { data: referrer } = await sc
        .from('users')
        .select('id')
        .eq('referral_code', pending.referral_code_used)
        .maybeSingle();
      if (referrer) referredByUserId = referrer.id;
    }

    // Create auth user — email_confirm: true (user already verified via OTP)
    const { data: authData, error: authError } = await sc.auth.admin.createUser({
      email:         pending.email,
      password:      pending.password,
      email_confirm: true,
      user_metadata: { first_name: pending.first_name, last_name: pending.last_name },
    });

    if (authError || !authData.user) {
      appLogger.error('[signup-verify] createUser failed', { err: authError?.message });
      return res.status(400).json({ error: authError?.message ?? 'Failed to create account' });
    }

    // Generate referral code
    const ownReferralCode = `TAXPERT-${authData.user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

    // Insert profile row — user is confirmed and permanent from this point
    const { error: profileError } = await sc.from('users').insert({
      id:                  authData.user.id,
      first_name:          pending.first_name,
      last_name:           pending.last_name,
      email:               pending.email,
      mobile:              pending.mobile,
      pan:                 pending.pan,
      role:                'client',
      referral_code:       ownReferralCode,
      referral_code_used:  referredByUserId ? pending.referral_code_used : null,
      referred_by_user_id: referredByUserId,
    });

    if (profileError) {
      // Roll back auth user — keep system consistent
      await sc.auth.admin.deleteUser(authData.user.id).catch(() => {});
      if (profileError.code === '23505') {
        return res.status(400).json({ error: 'PAN or mobile number is already registered.' });
      }
      return res.status(400).json({ error: profileError.message });
    }

    // Create session
    const { data: sessionData, error: sessionError } = await sc.auth.signInWithPassword({
      email:    pending.email,
      password: pending.password,
    });

    if (sessionError || !sessionData.session) {
      // Account created but session failed — user can just log in manually
      appLogger.warn('[signup-verify] session creation failed', { err: sessionError?.message });
      return res.status(201).json({
        success: true,
        message: 'Account created successfully. Please sign in.',
      });
    }

    // Non-blocking side-effects
    logSignupAudit(authData.user.id, pending.email, req).catch(console.error);
    emailQueue.add('signup', {
      type: 'signup',
      payload: { to: pending.email, firstName: pending.first_name },
    }).catch(console.error);

    appLogger.info('[signup-verify] account created', { userId: authData.user.id, email: pending.email });

    return res.status(201).json({
      success: true,
      session: sessionData.session,
      user:    sessionData.user,
    });
  } catch (error: any) {
    console.error('signupVerifyOtp error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /auth/signup-resend-otp ──────────────────────────────
// Resend a fresh OTP to the same email (within the pending window)

export const signupResendOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });

    const key = otpKey(email.trim().toLowerCase());
    const raw = await redisKv.get(key);

    if (!raw) {
      return res.status(400).json({
        error: 'No pending registration found. Please start the signup process again.',
        code:  'OTP_EXPIRED',
      });
    }

    const pending: PendingSignup = JSON.parse(raw);

    // Generate a new OTP, reset attempts, reset TTL
    pending.otp      = generateOtp();
    pending.attempts = 0;
    pending.created_at = Date.now();

    await redisKv.setex(key, OTP_TTL_SECONDS, JSON.stringify(pending));

    try {
      await sendOtpEmail({ to: pending.email, firstName: pending.first_name, otp: pending.otp });
    } catch (emailErr: any) {
      appLogger.error('[signup-resend-otp] failed to send', { err: emailErr.message });
      return res.status(500).json({ error: 'Could not resend code. Please try again.' });
    }

    return res.json({ success: true, message: 'A new verification code has been sent.' });
  } catch (error: any) {
    console.error('signupResendOtp error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
