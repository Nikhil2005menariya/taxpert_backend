-- GST toggle + combined multi-service payments.
-- Run this ONCE on Supabase BEFORE deploying the code that uses these features.
--
-- 1. invoice_settings gains a GST toggle + rate. GST is ADDITIVE (charged on top
--    of the catalogue price). Defaults to OFF (TheTaxpert not yet GST-registered).
-- 2. payments.razorpay_payment_id is currently UNIQUE — that blocks combined
--    payments, which need one payment row per service all sharing the same
--    razorpay_payment_id. Replace it with a composite UNIQUE on
--    (razorpay_payment_id, client_service_id).

BEGIN;

-- ── 1. GST settings ───────────────────────────────────────────────────────────
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS gst_enabled BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_rate    NUMERIC(5,2) NOT NULL DEFAULT 18;

-- ── 2. Allow multiple payment rows per Razorpay payment (combined payments) ─────
-- Drop the single-column unique constraint (name from the baseline schema).
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_razorpay_payment_id_key;

-- Composite unique: a given Razorpay payment may settle several services, one row
-- each. NULL client_service_id rows (e.g. failed payments) stay distinct under
-- Postgres NULL semantics, so failed-payment inserts are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS payments_pid_cs_uniq
  ON public.payments (razorpay_payment_id, client_service_id);

COMMIT;
