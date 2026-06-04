
CREATE TABLE public.reconciliation_company_mappings (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  reconciliation_run_id uuid null references public.reconciliation_runs(id) on delete set null,
  hospital_company_raw text not null,
  hospital_company_norm text not null,
  exacta_company_id uuid null references public.companies(id) on delete set null,
  previous_exacta_company_id uuid null,
  decision text not null check (decision in ('auto','manual','ignored','unmatched')),
  reason text null,
  version int not null default 1,
  is_current boolean not null default true,
  changed_by uuid null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

CREATE INDEX idx_rcm_payment_current ON public.reconciliation_company_mappings(payment_id, is_current);
CREATE INDEX idx_rcm_payment_key ON public.reconciliation_company_mappings(payment_id, hospital_company_norm, version desc);

GRANT SELECT, INSERT ON public.reconciliation_company_mappings TO authenticated;
GRANT ALL ON public.reconciliation_company_mappings TO service_role;

ALTER TABLE public.reconciliation_company_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcm_select_by_payment_hospital"
ON public.reconciliation_company_mappings
FOR SELECT
TO authenticated
USING (
  exists (
    select 1
    from public.payments p
    join public.user_hospitals uh on uh.hospital_id = p.hospital_id
    where p.id = reconciliation_company_mappings.payment_id
      and uh.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "rcm_insert_by_payment_hospital"
ON public.reconciliation_company_mappings
FOR INSERT
TO authenticated
WITH CHECK (
  exists (
    select 1
    from public.payments p
    join public.user_hospitals uh on uh.hospital_id = p.hospital_id
    where p.id = reconciliation_company_mappings.payment_id
      and uh.user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- Trigger: versiona e marca anteriores como não-corrente
CREATE OR REPLACE FUNCTION public.rcm_version_and_supersede()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_v int;
  prev_exacta uuid;
BEGIN
  SELECT COALESCE(MAX(version), 0), MAX(exacta_company_id) FILTER (WHERE is_current)
    INTO max_v, prev_exacta
  FROM public.reconciliation_company_mappings
  WHERE payment_id = NEW.payment_id
    AND hospital_company_norm = NEW.hospital_company_norm;

  NEW.version := max_v + 1;
  NEW.is_current := true;
  IF NEW.previous_exacta_company_id IS NULL THEN
    NEW.previous_exacta_company_id := prev_exacta;
  END IF;

  UPDATE public.reconciliation_company_mappings
     SET is_current = false
   WHERE payment_id = NEW.payment_id
     AND hospital_company_norm = NEW.hospital_company_norm
     AND is_current = true;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rcm_version
BEFORE INSERT ON public.reconciliation_company_mappings
FOR EACH ROW EXECUTE FUNCTION public.rcm_version_and_supersede();
