-- Tighten multi-tenant isolation on hospital-related tables

-- 1) hospital_directors: scope by hospital
DROP POLICY IF EXISTS "Admins and directors can view directors" ON public.hospital_directors;
DROP POLICY IF EXISTS "Admins and directors manage directors" ON public.hospital_directors;

CREATE POLICY "hd_select_scoped"
ON public.hospital_directors
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'diretor'::app_role) AND public.hospital_scope_allows(hospital_id))
);

CREATE POLICY "hd_modify_scoped"
ON public.hospital_directors
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'diretor'::app_role) AND public.hospital_scope_allows(hospital_id))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'diretor'::app_role) AND public.hospital_scope_allows(hospital_id))
);

-- 2) hospital_settings: scope writes by hospital
DROP POLICY IF EXISTS "Hospital settings insert by admin" ON public.hospital_settings;
DROP POLICY IF EXISTS "Hospital settings update by admin" ON public.hospital_settings;
DROP POLICY IF EXISTS "Hospital settings delete by admin" ON public.hospital_settings;

CREATE POLICY "hs_insert_scoped"
ON public.hospital_settings
FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.hospital_scope_allows(hospital_id));

CREATE POLICY "hs_update_scoped"
ON public.hospital_settings
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND public.hospital_scope_allows(hospital_id))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND public.hospital_scope_allows(hospital_id));

CREATE POLICY "hs_delete_scoped"
ON public.hospital_settings
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND public.hospital_scope_allows(hospital_id));

-- 3) user_active_hospital: allow user to manage own row (scoped to hospitals they can access)
CREATE POLICY "uah_insert_self"
ON public.user_active_hospital
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.hospital_scope_allows(hospital_id));

CREATE POLICY "uah_update_self"
ON public.user_active_hospital
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND public.hospital_scope_allows(hospital_id));

CREATE POLICY "uah_delete_self"
ON public.user_active_hospital
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- 4) user_hospitals: keep restrictive scope; refine SELECT so diretor is bound to their hospitals
DROP POLICY IF EXISTS "Users can see their own hospital links" ON public.user_hospitals;

CREATE POLICY "uh_select_scoped"
ON public.user_hospitals
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'diretor'::app_role) AND public.hospital_scope_allows(hospital_id))
);

-- 5) hospitals: admin manage remains global; add explicit restrictive scope for non-admin selects
-- (SELECT policy user_can_see_hospital already covers portals + linked users)
