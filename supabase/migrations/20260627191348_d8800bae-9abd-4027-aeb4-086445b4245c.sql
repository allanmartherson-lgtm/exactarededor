DROP POLICY IF EXISTS "Authenticated read ai_retry_queue" ON public.ai_retry_queue;

CREATE POLICY "Internal staff read ai_retry_queue"
ON public.ai_retry_queue
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'diretor'::app_role)
  OR public.has_role(auth.uid(), 'validador'::app_role)
  OR public.has_role(auth.uid(), 'analista'::app_role)
);