-- Restrictive: block any portal user from touching staging PII
CREATE POLICY staging_block_portal_users
ON public.doctors_import_staging
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (NOT public.is_portal_user(auth.uid()))
WITH CHECK (NOT public.is_portal_user(auth.uid()));

-- Restrictive: tighten role check (defense-in-depth against missing/altered permissive policies)
CREATE POLICY staging_require_internal_role
ON public.doctors_import_staging
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role));