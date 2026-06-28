DROP POLICY IF EXISTS campaign_recipients_empresa_select ON public.comm_campaign_recipients;
DROP POLICY IF EXISTS campaign_recipients_medico_select  ON public.comm_campaign_recipients;

DROP POLICY IF EXISTS "admin sees all switch log" ON public.hospital_switch_log;
CREATE POLICY "admin sees scoped switch log"
ON public.hospital_switch_log
FOR SELECT
TO authenticated
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  AND (
    hospital_scope_allows(new_hospital_id)
    OR (old_hospital_id IS NOT NULL AND hospital_scope_allows(old_hospital_id))
  )
);

CREATE POLICY "internal staff read payment questions"
ON public.payment_questions
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
);