import { createServiceClient } from '../configs/supabase.config';

export async function logSessionEvent(
  userId: string,
  eventType: 'login' | 'logout' | 'forced_logout' | 'session_revoked' | 'password_change',
) {
  try {
    const svc = createServiceClient();
    await svc.from('session_events').insert({ user_id: userId, event_type: eventType });
  } catch (err) {
    // Session event logging must never block auth flows
    console.error('Failed to log session event:', err);
  }
}
