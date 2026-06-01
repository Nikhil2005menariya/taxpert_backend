import { Request } from 'express';
import { createServiceClient } from '../configs/supabase.config';

// Extract real client IP, respecting reverse-proxy X-Forwarded-For header
function extractIp(req?: Pick<Request, 'headers' | 'ip' | 'socket'>): string {
  if (!req) return 'unknown';
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const first = (Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip ?? (req.socket as any)?.remoteAddress ?? 'unknown';
}

function extractUA(req?: Pick<Request, 'headers'>): string {
  return (req?.headers['user-agent'] ?? 'unknown').slice(0, 300);
}

// Map internal event names → audit_log action strings
const ACTION_MAP: Record<string, string> = {
  login:           'user_login',
  logout:          'user_logout',
  forced_logout:   'user_logout',
  session_revoked: 'user_logout',
  password_change: 'password_change',
};

// ── logSessionEvent ────────────────────────────────────────────
// Now writes to BOTH session_events (legacy) AND audit_log (admin-visible)
export async function logSessionEvent(
  userId: string,
  eventType: 'login' | 'logout' | 'forced_logout' | 'session_revoked' | 'password_change',
  req?: Pick<Request, 'headers' | 'ip' | 'socket'>,
  extraMeta: Record<string, unknown> = {},
) {
  try {
    const svc = createServiceClient();

    // Legacy table — keep for backward compat (fire and forget)
    void svc.from('session_events').insert({ user_id: userId, event_type: eventType });

    // audit_log — visible in admin audit page
    await svc.from('audit_log').insert({
      actor_id:    userId,
      action:      ACTION_MAP[eventType] ?? eventType,
      target_type: 'user',
      target_id:   userId,
      metadata: {
        ip:        extractIp(req),
        userAgent: extractUA(req),
        ...extraMeta,
      },
    });
  } catch (err) {
    console.error('Failed to log session event:', err);
  }
}

// ── logSignupAudit ─────────────────────────────────────────────
// Called once on successful account creation
export async function logSignupAudit(
  userId: string,
  email: string,
  req?: Pick<Request, 'headers' | 'ip' | 'socket'>,
) {
  try {
    const svc = createServiceClient();
    await svc.from('audit_log').insert({
      actor_id:    userId,
      action:      'user_signup',
      target_type: 'user',
      target_id:   userId,
      metadata: {
        email,
        ip:        extractIp(req),
        userAgent: extractUA(req),
      },
    });
  } catch (err) {
    console.error('Failed to log signup audit:', err);
  }
}

// ── logFailedLoginAudit ────────────────────────────────────────
// Called on bad credentials — actor_id is null (user unknown)
export async function logFailedLoginAudit(
  email: string,
  reason: string,
  req?: Pick<Request, 'headers' | 'ip' | 'socket'>,
) {
  try {
    const svc = createServiceClient();
    await svc.from('audit_log').insert({
      actor_id:    null,
      action:      'login_failed',
      target_type: 'user',
      target_id:   email,      // email as target_id for traceability
      metadata: {
        email,
        reason,
        ip:        extractIp(req),
        userAgent: extractUA(req),
      },
    });
  } catch (err) {
    console.error('Failed to log failed login:', err);
  }
}
