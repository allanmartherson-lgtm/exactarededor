CREATE TABLE public.agreement_registration_hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreement_registrations(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'aguardando_diretor' CHECK (status IN ('aguardando_diretor','aprovado','rejeitado')),
  director_id uuid REFERENCES auth.users(id),
  director_approved_at timestamptz,
  director_notes text,
  rejection_reason text,
  linked_rule_id uuid REFERENCES public.rules(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, hospital_id)
);

CREATE INDEX idx_arh_agreement ON public.agreement_registration_hospitals(agreement_id);
CREATE INDEX idx_arh_hospital ON public.agreement_registration_hospitals(hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_registration_hospitals TO authenticated;
GRANT ALL ON public.agreement_registration_hospitals TO service_role;

ALTER TABLE public.agreement_registration_hospitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY hospital_scope_restrictive
  ON public.agreement_registration_hospitals
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.hospital_scope_allows(hospital_id))
  WITH CHECK (public.hospital_scope_allows(hospital_id));

CREATE POLICY agreement_registration_hospitals_view_internal
  ON public.agreement_registration_hospitals
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
  );

CREATE POLICY agreement_registration_hospitals_manage_admin_diretor
  ON public.agreement_registration_hospitals
  FOR ALL
  TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
    AND public.hospital_scope_allows(hospital_id)
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
    AND public.hospital_scope_allows(hospital_id)
  );

-- Analistas também precisam registrar a replicação ao montar o rascunho do acordo
CREATE POLICY agreement_registration_hospitals_write_internal
  ON public.agreement_registration_hospitals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'analista'::app_role) OR public.has_role(auth.uid(), 'validador'::app_role) OR public.has_role(auth.uid(), 'gestao_medica'::app_role))
    AND public.hospital_scope_allows(hospital_id)
  );

CREATE POLICY agreement_registration_hospitals_delete_internal
  ON public.agreement_registration_hospitals
  FOR DELETE
  TO authenticated
  USING (
    (public.has_role(auth.uid(), 'analista'::app_role) OR public.has_role(auth.uid(), 'validador'::app_role) OR public.has_role(auth.uid(), 'gestao_medica'::app_role))
    AND public.hospital_scope_allows(hospital_id)
    AND status = 'aguardando_diretor'
  );

-- Popula automaticamente o hospital de origem quando o acordo é criado
CREATE OR REPLACE FUNCTION public.seed_agreement_primary_hospital()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NOT NULL THEN
    INSERT INTO public.agreement_registration_hospitals (agreement_id, hospital_id, is_primary)
    VALUES (NEW.id, NEW.hospital_id, true)
    ON CONFLICT (agreement_id, hospital_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_agreement_primary_hospital
AFTER INSERT ON public.agreement_registrations
FOR EACH ROW EXECUTE FUNCTION public.seed_agreement_primary_hospital();