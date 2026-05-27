"use server";

import { createServiceClient } from '../configs/supabase.config';

export type EventType =
  | "signup"
  | "referral_click"
  | "payment_success"
  | "payment_failed"
  | "service_started"
  | "referral_rewarded"
  | "coupon_applied"
  | "webhook_received";

export async function trackEvent(
  eventType: EventType,
  userId?: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    const supabase = createServiceClient();
    await supabase.from("platform_events").insert({
      event_type: eventType,
      user_id:    userId ?? null,
      metadata:   metadata ?? {},
    });
  } catch {
    // Analytics must never block the main flow
  }
}
