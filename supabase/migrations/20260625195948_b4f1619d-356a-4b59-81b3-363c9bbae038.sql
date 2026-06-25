ALTER TABLE public.minimum_guarantee_applications
  ALTER COLUMN doctor_id DROP NOT NULL;

DROP INDEX IF EXISTS public.uq_mga_active;

-- Unicidade quando há médico (escopo medico_empresa)
CREATE UNIQUE INDEX uq_mga_active_doctor
  ON public.minimum_guarantee_applications (rule_id, doctor_id, company_id, competence_month)
  WHERE status = 'aplicado' AND doctor_id IS NOT NULL;

-- Unicidade quando NÃO há médico (escopo empresa)
CREATE UNIQUE INDEX uq_mga_active_company
  ON public.minimum_guarantee_applications (rule_id, company_id, competence_month)
  WHERE status = 'aplicado' AND doctor_id IS NULL;