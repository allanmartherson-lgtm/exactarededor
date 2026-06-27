
DROP POLICY IF EXISTS ar_insert_anyone ON public.access_requests;

CREATE POLICY ar_insert_anon
  ON public.access_requests FOR INSERT
  TO anon
  WITH CHECK (
    status = 'pendente'
    AND hospital_id IS NULL
    AND requested_roles = ARRAY['analista']::text[]
  );

CREATE POLICY ar_insert_authenticated
  ON public.access_requests FOR INSERT
  TO authenticated
  WITH CHECK (status = 'pendente');

DROP POLICY IF EXISTS "Authenticated update ai_retry_queue" ON public.ai_retry_queue;

CREATE POLICY "Internal staff update ai_retry_queue"
  ON public.ai_retry_queue FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  );
