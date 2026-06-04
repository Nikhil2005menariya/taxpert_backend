-- Consultation requests submitted via the public "Book Free Consultation" form.
-- All reads/writes go through the service-role client (backend only), so no RLS needed.

CREATE TABLE IF NOT EXISTS consultation_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  phone          text        NOT NULL,
  email          text        NOT NULL,
  service_needed text        NOT NULL,
  message        text,
  is_consulted   boolean     NOT NULL DEFAULT false,
  consulted_at   timestamptz,
  consulted_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consult_created_at    ON consultation_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consult_is_consulted  ON consultation_requests (is_consulted);
