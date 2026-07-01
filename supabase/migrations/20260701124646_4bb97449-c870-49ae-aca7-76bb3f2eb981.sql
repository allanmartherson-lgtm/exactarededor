DROP POLICY IF EXISTS "authenticated_all" ON public.glosa_batches;

CREATE POLICY "glosa_batches_internal_staff_all"
ON public.glosa_batches
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
);