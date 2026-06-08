-- Per-client "mark done" for computed compliance due dates.
-- Due dates are generated client-side from each service's statutory calendar, so
-- there's no per-occurrence row to flag. This table records which occurrences a
-- client has dismissed (by their stable due-date key); the frontend hides them
-- and they no longer count as overdue. Recurring occurrences carry a different
-- key each period, so a future month/year's deadline still surfaces.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_due_date_done (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_key      TEXT        NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, due_key)
);

CREATE INDEX IF NOT EXISTS idx_cddd_user ON public.client_due_date_done(user_id);

ALTER TABLE public.client_due_date_done ENABLE ROW LEVEL SECURITY;

-- A client manages only their own rows (also accessed via the API).
DROP POLICY IF EXISTS "cddd_self" ON public.client_due_date_done;
CREATE POLICY "cddd_self" ON public.client_due_date_done FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;
