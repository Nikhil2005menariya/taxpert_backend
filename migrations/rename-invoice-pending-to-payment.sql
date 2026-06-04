  -- Rename the `invoice_pending` service status to `payment`.
  -- Run this ONCE on Supabase BEFORE deploying the code that uses the new value.
  -- The application code writes/reads status = 'payment'; the CHECK constraint must
  -- allow it and existing rows must be migrated, or inserts/updates will fail.

  BEGIN;

  -- 1. Drop the old constraint so we can migrate existing rows.
  ALTER TABLE public.client_services
    DROP CONSTRAINT IF EXISTS client_services_status_check;

  -- 2. Migrate existing data.
  UPDATE public.client_services
    SET status = 'payment'
    WHERE status = 'invoice_pending';

  -- 3. Re-add the constraint with the new canonical value set.
  ALTER TABLE public.client_services
    ADD CONSTRAINT client_services_status_check CHECK (
      status IN (
        'pending', 'documents_required', 'documents_received',
        'in_progress', 'under_review', 'payment',
        'completed', 'on_hold', 'cancelled'
      )
    );

  COMMIT;
