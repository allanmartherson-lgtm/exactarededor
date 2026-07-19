
DROP POLICY IF EXISTS "Authenticated users can read events" ON public.deduction_application_events;

CREATE POLICY "Internal staff read events in active hospital"
ON public.deduction_application_events
FOR SELECT
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  )
  OR (
    (
      public.has_role(auth.uid(), 'analista'::app_role)
      OR public.has_role(auth.uid(), 'validador'::app_role)
      OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
    )
    AND hospital_id IS NOT NULL
    AND hospital_id = public.current_active_hospital()
  )
);
