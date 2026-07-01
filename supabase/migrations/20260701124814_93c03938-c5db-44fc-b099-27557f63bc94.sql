CREATE OR REPLACE FUNCTION public.user_can_see_hospital(_hospital_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = _hospital_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.company_portal_user_hospitals cpuh
      JOIN public.company_portal_users cpu ON cpu.id = cpuh.portal_user_id
      WHERE cpu.user_id = auth.uid() AND cpuh.hospital_id = _hospital_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.doctor_portal_user_hospitals dpuh
      JOIN public.doctor_portal_users dpu ON dpu.id = dpuh.portal_user_id
      WHERE dpu.user_id = auth.uid() AND dpuh.hospital_id = _hospital_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.user_can_see_hospital(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_see_hospital(uuid) TO authenticated;

DROP POLICY IF EXISTS "Hospitals readable by authenticated" ON public.hospitals;

CREATE POLICY "Hospitals readable by linked users"
ON public.hospitals
FOR SELECT
TO authenticated
USING (public.user_can_see_hospital(id));