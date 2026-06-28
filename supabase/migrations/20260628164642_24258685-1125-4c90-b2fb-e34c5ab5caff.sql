
-- =====================================================================
-- 1) Tabela de auditoria + gate: "o motor leu esta fonte?"
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.payment_engine_sources (
  payment_id     uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  source         text NOT NULL,
  read_at        timestamptz,
  applied_count  integer NOT NULL DEFAULT 0,
  total_value    numeric NOT NULL DEFAULT 0,
  job_id         uuid,
  applicable     boolean NOT NULL DEFAULT true,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, source)
);

GRANT SELECT ON public.payment_engine_sources TO authenticated;
GRANT ALL    ON public.payment_engine_sources TO service_role;

ALTER TABLE public.payment_engine_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engine_sources_select_by_hospital" ON public.payment_engine_sources;
CREATE POLICY "engine_sources_select_by_hospital"
  ON public.payment_engine_sources FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_engine_sources.payment_id
        AND (
          p.hospital_id IN (SELECT hospital_id FROM public.user_hospitals WHERE user_id = auth.uid())
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

CREATE INDEX IF NOT EXISTS idx_pes_payment ON public.payment_engine_sources(payment_id);
CREATE INDEX IF NOT EXISTS idx_pes_pending ON public.payment_engine_sources(payment_id) WHERE read_at IS NULL AND applicable = true;

-- =====================================================================
-- 2) Helpers — leitura/marcação/invalidação
-- =====================================================================
CREATE OR REPLACE FUNCTION public.engine_sources_ready(_payment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.payment_engine_sources
    WHERE payment_id = _payment_id
      AND applicable = true
      AND read_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.engine_sources_pending(_payment_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ARRAY_AGG(source ORDER BY source), '{}'::text[])
  FROM public.payment_engine_sources
  WHERE payment_id = _payment_id AND applicable = true AND read_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.mark_engine_source(
  _payment_id uuid,
  _source text,
  _applied_count integer DEFAULT 0,
  _total_value numeric DEFAULT 0,
  _job_id uuid DEFAULT NULL,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.payment_engine_sources(payment_id, source, read_at, applied_count, total_value, job_id, applicable, details, updated_at)
  VALUES (_payment_id, _source, now(), COALESCE(_applied_count,0), COALESCE(_total_value,0), _job_id, true, COALESCE(_details,'{}'::jsonb), now())
  ON CONFLICT (payment_id, source) DO UPDATE
     SET read_at       = EXCLUDED.read_at,
         applied_count = EXCLUDED.applied_count,
         total_value   = EXCLUDED.total_value,
         job_id        = EXCLUDED.job_id,
         applicable    = true,
         details       = EXCLUDED.details,
         updated_at    = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.declare_engine_source_applicable(
  _payment_id uuid,
  _source text,
  _applicable boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.payment_engine_sources(payment_id, source, applicable, updated_at)
  VALUES (_payment_id, _source, _applicable, now())
  ON CONFLICT (payment_id, source) DO UPDATE
     SET applicable = EXCLUDED.applicable,
         updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_engine_source(
  _payment_id uuid,
  _source text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_engine_sources
     SET read_at = NULL, updated_at = now()
   WHERE payment_id = _payment_id AND source = _source;
  IF NOT FOUND THEN
    INSERT INTO public.payment_engine_sources(payment_id, source, read_at, applicable, updated_at)
    VALUES (_payment_id, _source, NULL, true, now())
    ON CONFLICT (payment_id, source) DO NOTHING;
  END IF;
END;
$$;

-- =====================================================================
-- 3) Triggers de invalidação — quando fonte muda, lote em aberto fica "stale"
-- =====================================================================

-- Lotes "em aberto" que ainda podem absorver re-aplicação
CREATE OR REPLACE FUNCTION public._open_payment_ids_for_company(_company_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.id
    FROM public.payments p
    JOIN public.payment_company_groups g ON g.payment_id = p.id
   WHERE g.company_id = _company_id
     AND p.status IN ('rascunho','em_analise_ia','revisao_analista','devolvido_analista',
                      'aguardando_aprovacao','revisao_pos_aprovacao');
$$;

CREATE OR REPLACE FUNCTION public._open_payment_ids_for_pool(_pool_id uuid, _competence date DEFAULT NULL)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id
    FROM public.payments p
   WHERE p.pool_id = _pool_id
     AND (_competence IS NULL OR p.competence_month = _competence)
     AND p.status IN ('rascunho','em_analise_ia','revisao_analista','devolvido_analista',
                      'aguardando_aprovacao','revisao_pos_aprovacao');
$$;

-- company_financial_adjustments → company_adjustments
CREATE OR REPLACE FUNCTION public.tg_invalidate_company_adjustments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cid uuid; _pid uuid;
BEGIN
  _cid := COALESCE(NEW.company_id, OLD.company_id);
  IF _cid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  FOR _pid IN SELECT * FROM public._open_payment_ids_for_company(_cid) LOOP
    PERFORM public.invalidate_engine_source(_pid, 'company_adjustments');
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_invalidate_company_adjustments ON public.company_financial_adjustments;
CREATE TRIGGER trg_invalidate_company_adjustments
AFTER INSERT OR UPDATE OR DELETE ON public.company_financial_adjustments
FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_company_adjustments();

-- glosa_debts → glosa_debts
CREATE OR REPLACE FUNCTION public.tg_invalidate_glosa_debts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cid uuid; _pid uuid;
BEGIN
  _cid := COALESCE(NEW.company_id, OLD.company_id);
  IF _cid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  FOR _pid IN SELECT * FROM public._open_payment_ids_for_company(_cid) LOOP
    PERFORM public.invalidate_engine_source(_pid, 'glosa_debts');
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_invalidate_glosa_debts ON public.glosa_debts;
CREATE TRIGGER trg_invalidate_glosa_debts
AFTER INSERT OR UPDATE OR DELETE ON public.glosa_debts
FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_glosa_debts();

-- pool_deductions → pool_deductions
CREATE OR REPLACE FUNCTION public.tg_invalidate_pool_deductions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pool uuid; _pid uuid;
BEGIN
  _pool := COALESCE(NEW.pool_id, OLD.pool_id);
  IF _pool IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  FOR _pid IN SELECT * FROM public._open_payment_ids_for_pool(_pool, NULL) LOOP
    PERFORM public.invalidate_engine_source(_pid, 'pool_deductions');
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_invalidate_pool_deductions ON public.pool_deductions;
CREATE TRIGGER trg_invalidate_pool_deductions
AFTER INSERT OR UPDATE OR DELETE ON public.pool_deductions
FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_pool_deductions();

-- pool_deduction_values → pool_deductions (mesmo source — valor mensal afeta o cálculo)
CREATE OR REPLACE FUNCTION public.tg_invalidate_pool_deduction_values()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pool uuid; _comp date; _pid uuid;
BEGIN
  _pool := COALESCE(NEW.pool_id, OLD.pool_id);
  _comp := COALESCE(NEW.competence_month, OLD.competence_month);
  IF _pool IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  FOR _pid IN SELECT * FROM public._open_payment_ids_for_pool(_pool, _comp) LOOP
    PERFORM public.invalidate_engine_source(_pid, 'pool_deductions');
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_invalidate_pool_deduction_values ON public.pool_deduction_values;
CREATE TRIGGER trg_invalidate_pool_deduction_values
AFTER INSERT OR UPDATE OR DELETE ON public.pool_deduction_values
FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_pool_deduction_values();

-- =====================================================================
-- 4) Helper para inicializar/registrar fontes aplicáveis a um lote
-- =====================================================================
CREATE OR REPLACE FUNCTION public.init_engine_sources_for_payment(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _has_pool boolean;
  _has_companies boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.payments WHERE id = _payment_id AND pool_id IS NOT NULL)
    INTO _has_pool;
  SELECT EXISTS(SELECT 1 FROM public.payment_company_groups WHERE payment_id = _payment_id AND company_id IS NOT NULL)
    INTO _has_companies;

  -- Fontes sempre aplicáveis
  PERFORM public.declare_engine_source_applicable(_payment_id, 'rules', true);
  PERFORM public.declare_engine_source_applicable(_payment_id, 'payout_model', true);
  PERFORM public.declare_engine_source_applicable(_payment_id, 'minimum_guarantee', true);

  -- PJ-dependentes
  IF _has_companies THEN
    PERFORM public.declare_engine_source_applicable(_payment_id, 'company_adjustments', true);
    PERFORM public.declare_engine_source_applicable(_payment_id, 'glosa_debts', true);
  ELSE
    PERFORM public.declare_engine_source_applicable(_payment_id, 'company_adjustments', false);
    PERFORM public.declare_engine_source_applicable(_payment_id, 'glosa_debts', false);
  END IF;

  -- Pool-dependentes
  IF _has_pool THEN
    PERFORM public.declare_engine_source_applicable(_payment_id, 'pool_deductions', true);
  ELSE
    PERFORM public.declare_engine_source_applicable(_payment_id, 'pool_deductions', false);
  END IF;

  -- Conciliação retroativa / casos especiais: aplicáveis somente quando houver itens pendentes
  PERFORM public.declare_engine_source_applicable(
    _payment_id, 'retroactive_reconciliation',
    EXISTS(SELECT 1 FROM public.retroactive_reconciliation_items WHERE target_payment_id = _payment_id)
  );
  PERFORM public.declare_engine_source_applicable(
    _payment_id, 'special_case_marks',
    EXISTS(SELECT 1 FROM public.special_case_marks WHERE payment_id = _payment_id AND status = 'approved')
  );
END;
$$;
