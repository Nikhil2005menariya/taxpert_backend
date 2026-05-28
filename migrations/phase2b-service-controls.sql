-- ============================================================
-- TheTaxpert Phase 2b — Service control columns
-- Run once on Supabase SQL editor (idempotent).
-- After running this, uncomment the extended SELECT in
-- getAdminServiceDetail and re-enable the full Settings form.
-- ============================================================

ALTER TABLE public.client_services
  ADD COLUMN IF NOT EXISTS pinned_message  TEXT,
  ADD COLUMN IF NOT EXISTS is_blocked      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason  TEXT;

-- Index for quickly finding blocked services
CREATE INDEX IF NOT EXISTS idx_client_services_blocked
  ON public.client_services(is_blocked) WHERE is_blocked = true;
