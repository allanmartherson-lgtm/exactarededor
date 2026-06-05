ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS pending_admin_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS pending_review_note text;

CREATE INDEX IF NOT EXISTS idx_doctors_pending_review
  ON public.doctors (pending_admin_review)
  WHERE pending_admin_review = true;

-- Permite a qualquer autenticado criar registro provisório (pendente de revisão).
CREATE POLICY "doctors_insert_pending_self"
  ON public.doctors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
  );

-- Autor pode atualizar (corrigir dados) enquanto estiver pendente.
CREATE POLICY "doctors_update_own_pending"
  ON public.doctors
  FOR UPDATE
  TO authenticated
  USING (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
  )
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
  );