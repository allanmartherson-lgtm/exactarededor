
-- 1. Novos campos em glosa_debts
ALTER TABLE public.glosa_debts
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS adjustment_id uuid,
  ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'pendente_resolucao',
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS parcelas_default integer NOT NULL DEFAULT 12;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'glosa_debts_resolution_status_check'
  ) THEN
    ALTER TABLE public.glosa_debts
      ADD CONSTRAINT glosa_debts_resolution_status_check
      CHECK (resolution_status IN ('vinculada', 'pendente_resolucao'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_glosa_debts_company ON public.glosa_debts(company_id);
CREATE INDEX IF NOT EXISTS idx_glosa_debts_resolution ON public.glosa_debts(resolution_status);

-- 2. Função de resolução automática
CREATE OR REPLACE FUNCTION public.resolve_glosa_to_company(_debt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _debt RECORD;
  _doctor_id uuid;
  _company_ids uuid[];
  _company_id uuid;
  _company_name text;
  _adj_id uuid;
BEGIN
  SELECT * INTO _debt FROM public.glosa_debts WHERE id = _debt_id;
  IF _debt IS NULL THEN RETURN; END IF;
  IF _debt.status <> 'ativo' THEN RETURN; END IF;
  IF _debt.total_debt <= 0 THEN RETURN; END IF;

  -- Localiza médico (CRM com ou sem UF)
  SELECT id INTO _doctor_id
  FROM public.doctors
  WHERE active = true
    AND (
      (_debt.doctor_crm IS NOT NULL AND (
        crm = _debt.doctor_crm
        OR (crm || '/' || crm_uf) = _debt.doctor_crm
        OR crm = split_part(_debt.doctor_crm, '/', 1)
      ))
      OR upper(full_name) = upper(_debt.doctor_name)
    )
  LIMIT 1;

  IF _doctor_id IS NULL THEN
    UPDATE public.glosa_debts
      SET resolution_status = 'pendente_resolucao',
          resolution_reason = 'crm_nao_encontrado',
          updated_at = now()
      WHERE id = _debt_id;
    RETURN;
  END IF;

  -- Resolve PJs vinculadas
  SELECT array_agg(DISTINCT dc.company_id) INTO _company_ids
  FROM public.doctor_companies dc
  WHERE dc.doctor_id = _doctor_id;

  IF _company_ids IS NULL OR array_length(_company_ids, 1) = 0 THEN
    UPDATE public.glosa_debts
      SET resolution_status = 'pendente_resolucao',
          resolution_reason = 'sem_pj_vinculada',
          updated_at = now()
      WHERE id = _debt_id;
    RETURN;
  END IF;

  IF array_length(_company_ids, 1) > 1 THEN
    UPDATE public.glosa_debts
      SET resolution_status = 'pendente_resolucao',
          resolution_reason = 'multiplas_pjs',
          updated_at = now()
      WHERE id = _debt_id;
    RETURN;
  END IF;

  _company_id := _company_ids[1];
  SELECT name INTO _company_name FROM public.companies WHERE id = _company_id;

  -- Reaproveita ou cria adjustment
  IF _debt.adjustment_id IS NOT NULL THEN
    UPDATE public.company_financial_adjustments
      SET valor_total = _debt.total_debt,
          company_id = _company_id,
          ativo = true,
          updated_at = now()
      WHERE id = _debt.adjustment_id;
    _adj_id := _debt.adjustment_id;
  ELSE
    INSERT INTO public.company_financial_adjustments
      (company_id, tipo, descricao, valor_total, parcelas_total, parcelas_pagas, data_inicio, ativo, origem)
    VALUES
      (_company_id, 'glosa_parcelada',
       'Glosa Dr(a). ' || _debt.doctor_name || COALESCE(' (' || _debt.doctor_crm || ')', ''),
       _debt.total_debt, COALESCE(_debt.parcelas_default, 12), 0, CURRENT_DATE, true,
       'glosa_debt:' || _debt_id::text)
    RETURNING id INTO _adj_id;
  END IF;

  UPDATE public.glosa_debts
    SET company_id = _company_id,
        adjustment_id = _adj_id,
        resolution_status = 'vinculada',
        resolution_reason = NULL,
        updated_at = now()
    WHERE id = _debt_id;
END;
$$;

-- 3. Resolução manual (analista escolhe PJ em casos ambíguos)
CREATE OR REPLACE FUNCTION public.link_glosa_to_company(
  _debt_id uuid, _company_id uuid, _parcelas integer DEFAULT 12
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _debt RECORD;
  _adj_id uuid;
BEGIN
  SELECT * INTO _debt FROM public.glosa_debts WHERE id = _debt_id;
  IF _debt IS NULL THEN RAISE EXCEPTION 'glosa_debt não encontrada'; END IF;

  IF _debt.adjustment_id IS NOT NULL THEN
    UPDATE public.company_financial_adjustments
      SET company_id = _company_id,
          valor_total = _debt.total_debt,
          parcelas_total = GREATEST(_parcelas, COALESCE(parcelas_pagas, 0)),
          ativo = true,
          updated_at = now()
      WHERE id = _debt.adjustment_id
      RETURNING id INTO _adj_id;
  ELSE
    INSERT INTO public.company_financial_adjustments
      (company_id, tipo, descricao, valor_total, parcelas_total, parcelas_pagas, data_inicio, ativo, origem)
    VALUES
      (_company_id, 'glosa_parcelada',
       'Glosa Dr(a). ' || _debt.doctor_name || COALESCE(' (' || _debt.doctor_crm || ')', ''),
       _debt.total_debt, _parcelas, 0, CURRENT_DATE, true,
       'glosa_debt:' || _debt_id::text)
    RETURNING id INTO _adj_id;
  END IF;

  UPDATE public.glosa_debts
    SET company_id = _company_id,
        adjustment_id = _adj_id,
        parcelas_default = _parcelas,
        resolution_status = 'vinculada',
        resolution_reason = NULL,
        updated_at = now()
    WHERE id = _debt_id;

  RETURN _adj_id;
END;
$$;

-- 4. Trigger de auto-resolução
CREATE OR REPLACE FUNCTION public.trg_glosa_debt_auto_resolve_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ativo' AND NEW.total_debt > 0
     AND (NEW.resolution_status IS NULL OR NEW.resolution_status = 'pendente_resolucao')
  THEN
    PERFORM public.resolve_glosa_to_company(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_glosa_debt_auto_resolve ON public.glosa_debts;
CREATE TRIGGER trg_glosa_debt_auto_resolve
  AFTER INSERT OR UPDATE OF total_debt, status ON public.glosa_debts
  FOR EACH ROW EXECUTE FUNCTION public.trg_glosa_debt_auto_resolve_fn();
