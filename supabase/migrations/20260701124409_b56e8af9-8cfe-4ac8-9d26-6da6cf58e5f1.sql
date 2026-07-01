DROP POLICY IF EXISTS "System configurations are viewable by everyone authenticated" ON public.system_configurations;

CREATE POLICY "System configurations viewable by internal staff"
ON public.system_configurations
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
);