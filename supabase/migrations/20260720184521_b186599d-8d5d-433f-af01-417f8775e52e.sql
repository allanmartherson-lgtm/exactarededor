ALTER TABLE public.tuss_procedure_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read TUSS names"
ON public.tuss_procedure_names
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins manage TUSS names"
ON public.tuss_procedure_names
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));