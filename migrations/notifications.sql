-- In-app notifications. One row per recipient per event.
-- Generic by design (user_id can be any role) so admin/texpert notifications
-- can reuse the same table later. All reads/writes go through the backend
-- service-role client (filtered by user_id), so no RLS is required.

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text        NOT NULL,              -- 'status_changed' | 'document_status' | 'payment' | ...
  title       text        NOT NULL,              -- short headline shown in the dropdown
  body        text,                              -- optional one-line detail
  link        text,                              -- frontend route to open on click, e.g. /client/services/<id>
  metadata    jsonb       NOT NULL DEFAULT '{}',
  is_read     boolean     NOT NULL DEFAULT false,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread  ON public.notifications (user_id, is_read);
