CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.doctor_companies
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS end_reason text;

-- Médico pode voltar à mesma PJ em período futuro: remove unicidade plana
ALTER TABLE public.doctor_companies
  DROP CONSTRAINT IF EXISTS doctor_companies_doctor_id_company_id_key;

-- Exclusividade: vigências não podem se sobrepor para o mesmo médico.
-- Só vale quando start_date NOT NULL (legado sem datas = sempre vigente, fora da exclusão).
ALTER TABLE public.doctor_companies
  DROP CONSTRAINT IF EXISTS doctor_companies_no_overlap;

ALTER TABLE public.doctor_companies
  ADD CONSTRAINT doctor_companies_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (start_date IS NOT NULL);

-- end_date só faz sentido se >= start_date
ALTER TABLE public.doctor_companies
  DROP CONSTRAINT IF EXISTS doctor_companies_dates_chk;
ALTER TABLE public.doctor_companies
  ADD CONSTRAINT doctor_companies_dates_chk
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

CREATE INDEX IF NOT EXISTS doctor_companies_vigencia_idx
  ON public.doctor_companies (doctor_id, start_date, end_date);

-- Resolução com fallback: vínculo sem start_date = sempre vigente.
CREATE OR REPLACE FUNCTION public.companies_for_doctor_at(
  _doctor_id uuid,
  _on_date date
)
RETURNS TABLE(company_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dc.company_id
  FROM public.doctor_companies dc
  WHERE dc.doctor_id = _doctor_id
    AND (
      dc.start_date IS NULL
      OR (
        dc.start_date <= _on_date
        AND (dc.end_date IS NULL OR dc.end_date >= _on_date)
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.companies_for_doctor_at(uuid, date) TO authenticated, service_role;