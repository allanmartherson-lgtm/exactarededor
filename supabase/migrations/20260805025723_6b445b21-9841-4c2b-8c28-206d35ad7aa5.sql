ALTER TABLE public.agreement_registrations
  ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'novo_acordo',
  ADD COLUMN IF NOT EXISTS reference_note text,
  ADD COLUMN IF NOT EXISTS related_agreement_id uuid REFERENCES public.agreement_registrations(id);

ALTER TABLE public.agreement_registrations
  DROP CONSTRAINT IF EXISTS agreement_registrations_registration_type_check;
ALTER TABLE public.agreement_registrations
  ADD CONSTRAINT agreement_registrations_registration_type_check
  CHECK (registration_type IN ('novo_acordo','aditivo','retirada'));

CREATE TABLE IF NOT EXISTS public.agreement_registration_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreement_registrations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  doctor_id uuid REFERENCES public.doctors(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_registration_parties TO authenticated;
GRANT ALL ON public.agreement_registration_parties TO service_role;

ALTER TABLE public.agreement_registration_parties ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS agreement_parties_all_doctors_uniq
  ON public.agreement_registration_parties (agreement_id, company_id)
  WHERE doctor_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agreement_parties_doctor_uniq
  ON public.agreement_registration_parties (agreement_id, company_id, doctor_id)
  WHERE doctor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agreement_parties_agreement_idx
  ON public.agreement_registration_parties (agreement_id);

CREATE POLICY "parties_select_scoped"
  ON public.agreement_registration_parties FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agreement_registrations a
    WHERE a.id = agreement_registration_parties.agreement_id
      AND public.hospital_scope_allows(a.hospital_id)
  ));

CREATE POLICY "parties_write_scoped"
  ON public.agreement_registration_parties FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agreement_registrations a
    WHERE a.id = agreement_registration_parties.agreement_id
      AND public.hospital_scope_allows(a.hospital_id)
  ) AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'analista')
    OR public.has_role(auth.uid(),'validador') OR public.has_role(auth.uid(),'diretor')
    OR public.has_role(auth.uid(),'gestao_medica')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agreement_registrations a
    WHERE a.id = agreement_registration_parties.agreement_id
      AND public.hospital_scope_allows(a.hospital_id)
  ) AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'analista')
    OR public.has_role(auth.uid(),'validador') OR public.has_role(auth.uid(),'diretor')
    OR public.has_role(auth.uid(),'gestao_medica')
  ));