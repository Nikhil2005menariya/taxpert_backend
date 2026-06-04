import { createServiceClient } from '../configs/supabase.config';
import { appLogger } from './logger';

export interface NotificationSpec {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Insert an in-app notification for a user. Non-blocking — never throws to the
 * caller. Generic across roles (client / texpert / admin) so the same store
 * powers everyone's notification bell.
 */
export async function createNotification(spec: NotificationSpec): Promise<void> {
  try {
    if (!spec.userId || !spec.title) return;
    const sc = createServiceClient();
    const { error } = await sc.from('notifications').insert({
      user_id:  spec.userId,
      type:     spec.type,
      title:    spec.title,
      body:     spec.body ?? null,
      link:     spec.link ?? null,
      metadata: spec.metadata ?? {},
    });
    if (error) appLogger.warn('createNotification insert failed', { err: error.message, type: spec.type });
  } catch (e) {
    appLogger.warn('createNotification failed', { err: (e as Error).message });
  }
}

/**
 * Convenience wrapper for client-service updates — deep-links to the client's
 * service detail page so clicking the notification opens the right service.
 */
export async function notifyClientForService(
  userId: string,
  clientServiceId: string,
  n: { type: string; title: string; body?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  return createNotification({
    userId,
    link: `/client/services/${clientServiceId}`,
    ...n,
  });
}

/**
 * Broadcast an admin-level notification to every active admin / super_admin.
 * Used for platform events (new queue item, payments, inquiries, escalations) —
 * NOT per-service progress noise. Non-blocking.
 */
export async function notifyAdmins(n: {
  type: string; title: string; body?: string | null; link?: string | null; metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sc = createServiceClient();
    const { data: admins } = await sc
      .from('users')
      .select('id')
      .in('role', ['admin', 'super_admin'])
      .eq('is_active', true);
    if (!admins?.length) return;
    const rows = admins.map((a: { id: string }) => ({
      user_id:  a.id,
      type:     n.type,
      title:    n.title,
      body:     n.body ?? null,
      link:     n.link ?? null,
      metadata: n.metadata ?? {},
    }));
    const { error } = await sc.from('notifications').insert(rows);
    if (error) appLogger.warn('notifyAdmins insert failed', { err: error.message, type: n.type });
  } catch (e) {
    appLogger.warn('notifyAdmins failed', { err: (e as Error).message });
  }
}

/**
 * Notify a Taxpert about an update on a service assigned to them — deep-links to
 * their service workspace. No-op when no texpert is assigned (userId falsy).
 */
export async function notifyTexpertForService(
  texpertUserId: string | null | undefined,
  clientServiceId: string,
  n: { type: string; title: string; body?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  if (!texpertUserId) return;
  return createNotification({
    userId: texpertUserId,
    link: `/texpert/services/${clientServiceId}`,
    ...n,
  });
}
