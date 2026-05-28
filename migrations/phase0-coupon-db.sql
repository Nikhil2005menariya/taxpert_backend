-- ============================================================
-- TheTaxpert Phase 0 — Coupon & Payment DB Prerequisites
-- Run once on Supabase SQL editor (idempotent).
-- Must be run BEFORE testing any coupon or payment flow.
-- ============================================================

-- ── 1. coupon_usages table ────────────────────────────────────
-- Tracks which user used which coupon. Prevents double-use.
-- Code in coupons.controller.ts queries this table — will crash without it.
CREATE TABLE IF NOT EXISTS public.coupon_usages (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id  UUID        NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id)
);

ALTER TABLE public.coupon_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coupon_usages_own_read" ON public.coupon_usages;
CREATE POLICY "coupon_usages_own_read" ON public.coupon_usages
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON public.coupon_usages(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_user   ON public.coupon_usages(user_id);

-- ── 2. increment_coupon_used RPC ──────────────────────────────
-- Called by webhook after payment to increment coupons.used_count.
-- Defined as SECURITY DEFINER so it bypasses RLS from the service role.
CREATE OR REPLACE FUNCTION public.increment_coupon_used(p_coupon_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.coupons
  SET used_count = used_count + 1
  WHERE id = p_coupon_id;
$$;

-- ── 3. referral columns on users ─────────────────────────────
-- Added by phase2-assignment-queue.sql but included here as idempotent safety.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code_used    TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_user_id   UUID REFERENCES public.users(id);

-- ── 4. payments table extended columns ───────────────────────
-- These columns are written during payment recording in the webhook.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS base_amount     INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_amount      INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_rate        NUMERIC(5,2) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS discount_amount INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_amount INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_id       UUID         REFERENCES public.coupons(id),
  ADD COLUMN IF NOT EXISTS payment_method  TEXT;

-- Index for coupon → payment lookup (admin reporting)
CREATE INDEX IF NOT EXISTS idx_payments_coupon ON public.payments(coupon_id)
  WHERE coupon_id IS NOT NULL;

-- ── 5. referral_code column on users (idempotent safety) ─────
-- Already in phase2 migration but re-stated here to ensure it exists.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- ── Done ─────────────────────────────────────────────────────
-- After running this script:
--   1. Tell Claude "Phase 0 done"
--   2. Claude will implement Phase 1A (backend coupon fixes) +
--      Phase 1B (coupon input on InvoicePage)
