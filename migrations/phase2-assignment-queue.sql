-- ============================================================
-- TheTaxpert Phase 2 — Assignment Queue & Texpert Ops
-- Run once on Supabase SQL editor (idempotent).
-- ============================================================

-- 1. Per-service texpert assignment columns on client_services
ALTER TABLE public.client_services
  ADD COLUMN IF NOT EXISTS assigned_texpert_id  UUID        REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS assigned_texpert_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by_admin_id UUID        REFERENCES public.users(id);

-- 2. is_active and referral_code on users (if not present)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS referral_code TEXT    UNIQUE;

-- 3. Open assignment queue
CREATE TABLE IF NOT EXISTS public.service_assignment_queue (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_service_id UUID        NOT NULL REFERENCES public.client_services(id) ON DELETE CASCADE,
  priority          INTEGER     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'claimed', 'closed')),
  claimed_by        UUID        REFERENCES public.users(id),
  claimed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.service_assignment_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "queue_admin_all"      ON public.service_assignment_queue;
DROP POLICY IF EXISTS "queue_texpert_read"   ON public.service_assignment_queue;
DROP POLICY IF EXISTS "queue_texpert_claim"  ON public.service_assignment_queue;

CREATE POLICY "queue_admin_all" ON public.service_assignment_queue FOR ALL USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "queue_texpert_read" ON public.service_assignment_queue FOR SELECT USING (
  public.current_user_role() IN ('expert', 'ca')
);
CREATE POLICY "queue_texpert_claim" ON public.service_assignment_queue FOR UPDATE
  USING (public.current_user_role() IN ('expert', 'ca'))
  WITH CHECK (claimed_by = auth.uid() AND status = 'claimed');

-- 4. Texpert payout tracking
CREATE TABLE IF NOT EXISTS public.texpert_payouts (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  texpert_id        UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_service_id UUID        NOT NULL REFERENCES public.client_services(id) ON DELETE CASCADE,
  amount            INTEGER     NOT NULL,  -- in paise
  paid_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by       UUID        NOT NULL REFERENCES public.users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.texpert_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_admin_all"   ON public.texpert_payouts;
DROP POLICY IF EXISTS "payouts_texpert_own" ON public.texpert_payouts;

CREATE POLICY "payouts_admin_all" ON public.texpert_payouts FOR ALL USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
CREATE POLICY "payouts_texpert_own" ON public.texpert_payouts FOR SELECT USING (
  texpert_id = auth.uid()
);

-- 5. Reupload request columns on client_documents
ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS reupload_requested    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reupload_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reupload_requested_by UUID        REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS reupload_note         TEXT;

-- 6. Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id    UUID        REFERENCES public.users(id),
  action      TEXT        NOT NULL,
  target_type TEXT        NOT NULL,
  target_id   TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_admin_read"     ON public.audit_log;
DROP POLICY IF EXISTS "audit_service_insert" ON public.audit_log;

CREATE POLICY "audit_admin_read" ON public.audit_log FOR SELECT USING (
  public.current_user_role() IN ('admin', 'super_admin')
);
-- Inserts come from the service-role backend only; no user-facing insert needed.

-- 7. Texpert stats view
DROP VIEW IF EXISTS public.texpert_stats;
CREATE VIEW public.texpert_stats AS
SELECT
  u.id,
  u.first_name,
  u.last_name,
  u.email,
  u.is_active,
  COUNT(DISTINCT cs.id) FILTER (WHERE cs.assigned_texpert_id = u.id)                             AS total_services,
  COUNT(DISTINCT cs.id) FILTER (WHERE cs.assigned_texpert_id = u.id AND cs.status = 'completed') AS completed_services,
  COALESCE(SUM(tp.amount) FILTER (WHERE tp.texpert_id = u.id), 0)                                AS total_payout_paise
FROM public.users u
LEFT JOIN public.client_services cs ON cs.assigned_texpert_id = u.id
LEFT JOIN public.texpert_payouts  tp ON tp.texpert_id = u.id
WHERE u.role IN ('expert', 'ca')
GROUP BY u.id, u.first_name, u.last_name, u.email, u.is_active;

-- 8. Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_client_services_texpert ON public.client_services(assigned_texpert_id);
CREATE INDEX IF NOT EXISTS idx_texpert_payouts_texpert ON public.texpert_payouts(texpert_id);
CREATE INDEX IF NOT EXISTS idx_service_queue_status    ON public.service_assignment_queue(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor         ON public.audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target        ON public.audit_log(target_type, target_id);
