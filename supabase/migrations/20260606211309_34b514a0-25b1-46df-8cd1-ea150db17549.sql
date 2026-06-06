ALTER TABLE public.pendencias
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opened_by text NOT NULL DEFAULT 'empresa'
    CHECK (opened_by IN ('empresa','medico'));

CREATE INDEX IF NOT EXISTS idx_pend_doctor ON public.pendencias(doctor_id, created_at DESC);

DROP POLICY IF EXISTS "pend_doctor_select" ON public.pendencias;
CREATE POLICY "pend_doctor_select" ON public.pendencias
  FOR SELECT TO authenticated
  USING (
    doctor_id IS NOT NULL
    AND doctor_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

DROP POLICY IF EXISTS "pend_doctor_insert" ON public.pendencias;
CREATE POLICY "pend_doctor_insert" ON public.pendencias
  FOR INSERT TO authenticated
  WITH CHECK (
    opened_by = 'medico'
    AND created_by_user_id = auth.uid()
    AND doctor_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
    AND company_id IN (
      SELECT dc.company_id
      FROM public.doctor_companies dc
      JOIN public.doctor_portal_users dpu ON dpu.doctor_id = dc.doctor_id
      WHERE dpu.user_id = auth.uid()
        AND dpu.active = true
        AND (dc.end_date IS NULL OR dc.end_date >= CURRENT_DATE)
    )
  );

DROP POLICY IF EXISTS "pend_doctor_update" ON public.pendencias;
CREATE POLICY "pend_doctor_update" ON public.pendencias
  FOR UPDATE TO authenticated
  USING (
    doctor_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  )
  WITH CHECK (
    doctor_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

NOTIFY pgrst, 'reload schema';