CREATE TABLE public.analysis_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX analysis_groups_hospital_name_uidx
  ON public.analysis_groups (hospital_id, lower(name));
CREATE INDEX analysis_groups_hospital_idx ON public.analysis_groups (hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_groups TO authenticated;
GRANT ALL ON public.analysis_groups TO service_role;

ALTER TABLE public.analysis_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY ang_select_internal ON public.analysis_groups
FOR SELECT TO authenticated
USING (
  public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
  )
);

CREATE POLICY ang_write_internal ON public.analysis_groups
FOR ALL TO authenticated
USING (
  hospital_id = public.current_active_hospital()
  AND public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
)
WITH CHECK (
  hospital_id = public.current_active_hospital()
  AND public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
);

CREATE TRIGGER trg_analysis_groups_updated_at
BEFORE UPDATE ON public.analysis_groups
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.analysis_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.analysis_groups(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  member_type text NOT NULL CHECK (member_type IN ('specialty','doctor','company')),
  specialty_code text REFERENCES public.specialties(code) ON UPDATE CASCADE,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analysis_group_members_one_ref_chk CHECK (
    (member_type = 'specialty' AND specialty_code IS NOT NULL AND doctor_id IS NULL AND company_id IS NULL)
    OR (member_type = 'doctor' AND doctor_id IS NOT NULL AND specialty_code IS NULL AND company_id IS NULL)
    OR (member_type = 'company' AND company_id IS NOT NULL AND specialty_code IS NULL AND doctor_id IS NULL)
  )
);

CREATE UNIQUE INDEX agm_unique_specialty_uidx
  ON public.analysis_group_members (group_id, specialty_code) WHERE specialty_code IS NOT NULL;
CREATE UNIQUE INDEX agm_unique_doctor_uidx
  ON public.analysis_group_members (group_id, doctor_id) WHERE doctor_id IS NOT NULL;
CREATE UNIQUE INDEX agm_unique_company_uidx
  ON public.analysis_group_members (group_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX agm_group_idx ON public.analysis_group_members (group_id);
CREATE INDEX agm_hospital_idx ON public.analysis_group_members (hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analysis_group_members TO authenticated;
GRANT ALL ON public.analysis_group_members TO service_role;

ALTER TABLE public.analysis_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY agm_select_internal ON public.analysis_group_members
FOR SELECT TO authenticated
USING (
  public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
  )
);

CREATE POLICY agm_write_internal ON public.analysis_group_members
FOR ALL TO authenticated
USING (
  hospital_id = public.current_active_hospital()
  AND public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
)
WITH CHECK (
  hospital_id = public.current_active_hospital()
  AND public.hospital_scope_allows(hospital_id)
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
);

-- hospital_id do membro SEMPRE vem do grupo pai (nunca do body do cliente)
CREATE OR REPLACE FUNCTION public.agm_hospital_from_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_h uuid;
BEGIN
  SELECT hospital_id INTO v_h FROM public.analysis_groups WHERE id = NEW.group_id;
  IF v_h IS NULL THEN
    RAISE EXCEPTION 'Grupo de análise inexistente';
  END IF;
  NEW.hospital_id := v_h;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agm_hospital_from_group
BEFORE INSERT OR UPDATE ON public.analysis_group_members
FOR EACH ROW EXECUTE FUNCTION public.agm_hospital_from_group();