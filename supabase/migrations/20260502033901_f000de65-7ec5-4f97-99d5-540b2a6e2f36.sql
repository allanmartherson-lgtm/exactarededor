-- Permitir que o autor edite suas próprias observações e marcar quando foi editada
ALTER TABLE public.payment_observations
  ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone;

CREATE POLICY "obs_update_self"
ON public.payment_observations
FOR UPDATE
TO authenticated
USING (auth.uid() = author_id)
WITH CHECK (auth.uid() = author_id);