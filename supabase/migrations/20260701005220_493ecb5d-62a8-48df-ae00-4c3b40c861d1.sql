
ALTER TABLE public.convenios
  ADD COLUMN IF NOT EXISTS pending_admin_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS pending_review_note text;

ALTER TABLE public.sectors
  ADD COLUMN IF NOT EXISTS pending_admin_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS pending_review_note text;

DROP POLICY IF EXISTS convenios_insert_pending_analyst ON public.convenios;
CREATE POLICY convenios_insert_pending_analyst
  ON public.convenios
  FOR INSERT
  TO authenticated
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS sectors_insert_pending_analyst ON public.sectors;
CREATE POLICY sectors_insert_pending_analyst
  ON public.sectors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
  );
