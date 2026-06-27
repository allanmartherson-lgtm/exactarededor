DROP POLICY IF EXISTS "Hospital members can view directors" ON public.hospital_directors;

CREATE POLICY "Admins and directors can view directors"
ON public.hospital_directors
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'diretor'::app_role)
);