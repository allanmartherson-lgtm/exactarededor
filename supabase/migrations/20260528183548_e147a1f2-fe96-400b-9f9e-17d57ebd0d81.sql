
-- =========================================================================
-- 1) Extensões
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================================================================
-- 2) Coluna priority_score + índice
-- =========================================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS priority_score numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_payments_priority
  ON public.payments (priority_score DESC, created_at DESC);

-- =========================================================================
-- 3) Função pura: calcula score (não persiste)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.calculate_payment_priority(_payment_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.payment_status;
  v_total numeric;
  v_status_entered timestamptz;
  v_sla_business_days int;
  v_sla_warning_pct int;
  v_sla_severity text;
  v_now timestamptz := now();
  v_elapsed_days numeric;
  v_score numeric := 0;
  v_open_q int := 0;
  v_err_items int := 0;
  v_due timestamptz;
  v_pct numeric;
BEGIN
  SELECT status, total_amount INTO v_status, v_total
    FROM public.payments WHERE id = _payment_id;
  IF v_status IS NULL THEN RETURN 0; END IF;

  -- Status finais não recebem prioridade
  IF v_status IN ('pago','arquivado','cancelado','rejeitado') THEN
    RETURN 0;
  END IF;

  SELECT changed_at INTO v_status_entered
    FROM public.payment_status_history
   WHERE payment_id = _payment_id AND status_to = v_status
   ORDER BY changed_at DESC LIMIT 1;
  IF v_status_entered IS NULL THEN
    SELECT created_at INTO v_status_entered FROM public.payments WHERE id = _payment_id;
  END IF;

  v_elapsed_days := EXTRACT(EPOCH FROM (v_now - v_status_entered)) / 86400.0;

  SELECT business_days, warning_pct, severity
    INTO v_sla_business_days, v_sla_warning_pct, v_sla_severity
    FROM public.sla_settings WHERE status = v_status AND active = true;

  -- Componente SLA (0-50)
  IF v_sla_business_days IS NOT NULL AND v_sla_business_days > 0 THEN
    -- aproximação: dias corridos / (business_days * 1.4) para considerar fim de semana
    v_due := v_status_entered + (v_sla_business_days * INTERVAL '1.4 day');
    v_pct := CASE WHEN v_due > v_status_entered
                  THEN EXTRACT(EPOCH FROM (v_now - v_status_entered)) /
                       NULLIF(EXTRACT(EPOCH FROM (v_due - v_status_entered)), 0) * 100
                  ELSE 0 END;
    IF v_now > v_due THEN
      v_score := v_score + 50;
    ELSIF v_pct >= COALESCE(v_sla_warning_pct, 80) THEN
      v_score := v_score + 25;
    END IF;
  END IF;

  -- Tempo parado (0-15)
  IF v_elapsed_days > 7 THEN v_score := v_score + 15;
  ELSIF v_elapsed_days > 3 THEN v_score := v_score + 8;
  ELSIF v_elapsed_days > 1 THEN v_score := v_score + 3;
  END IF;

  -- Itens com erro/duplicidade (0-30)
  SELECT count(*) INTO v_err_items
    FROM public.payment_items
   WHERE payment_id = _payment_id
     AND ai_status IN ('alerta','reprovado','erro_duplicidade_pagamento','erro_duplicidade_calculo');
  IF v_err_items >= 20 THEN v_score := v_score + 30;
  ELSIF v_err_items >= 5 THEN v_score := v_score + 15;
  ELSIF v_err_items >= 1 THEN v_score := v_score + 8;
  END IF;

  -- Perguntas abertas (0-10)
  SELECT count(*) INTO v_open_q
    FROM public.payment_observations
   WHERE payment_id = _payment_id AND is_question = true AND resolved_at IS NULL;
  IF v_open_q >= 3 THEN v_score := v_score + 10;
  ELSIF v_open_q >= 1 THEN v_score := v_score + 5;
  END IF;

  -- Valor alto (0-5)
  IF v_total > 500000 THEN v_score := v_score + 5;
  ELSIF v_total > 100000 THEN v_score := v_score + 2;
  END IF;

  RETURN LEAST(100, GREATEST(0, v_score));
END;
$$;

-- =========================================================================
-- 4) Função que recalcula e persiste
-- =========================================================================
CREATE OR REPLACE FUNCTION public.recalc_payment_priority(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payments
     SET priority_score = public.calculate_payment_priority(_payment_id)
   WHERE id = _payment_id;
END;
$$;

-- =========================================================================
-- 5) Triggers
-- =========================================================================
CREATE OR REPLACE FUNCTION public.trg_recalc_priority_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.priority_score := public.calculate_payment_priority(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_recalc_priority ON public.payments;
CREATE TRIGGER trg_payments_recalc_priority
BEFORE UPDATE OF status, total_amount ON public.payments
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status OR NEW.total_amount IS DISTINCT FROM OLD.total_amount)
EXECUTE FUNCTION public.trg_recalc_priority_payments();

CREATE OR REPLACE FUNCTION public.trg_recalc_priority_related()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  pid := COALESCE(NEW.payment_id, OLD.payment_id);
  IF pid IS NOT NULL THEN
    PERFORM public.recalc_payment_priority(pid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_obs_recalc_priority ON public.payment_observations;
CREATE TRIGGER trg_obs_recalc_priority
AFTER INSERT OR UPDATE OF is_question, resolved_at OR DELETE ON public.payment_observations
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_priority_related();

DROP TRIGGER IF EXISTS trg_pcg_recalc_priority ON public.payment_company_groups;
CREATE TRIGGER trg_pcg_recalc_priority
AFTER UPDATE OF status ON public.payment_company_groups
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.trg_recalc_priority_related();

DROP TRIGGER IF EXISTS trg_items_recalc_priority ON public.payment_items;
CREATE TRIGGER trg_items_recalc_priority
AFTER UPDATE OF ai_status ON public.payment_items
FOR EACH ROW
WHEN (NEW.ai_status IS DISTINCT FROM OLD.ai_status)
EXECUTE FUNCTION public.trg_recalc_priority_related();

-- =========================================================================
-- 6) View materializada de flags
-- =========================================================================
DROP MATERIALIZED VIEW IF EXISTS public.mv_payments_flags;
CREATE MATERIALIZED VIEW public.mv_payments_flags AS
SELECT
  p.id AS payment_id,
  EXISTS(
    SELECT 1 FROM public.payment_observations o
    WHERE o.payment_id = p.id AND o.is_question = true AND o.resolved_at IS NULL
  ) AS has_open_question,
  EXISTS(
    SELECT 1 FROM public.invoices i
    WHERE i.payment_id = p.id AND i.status = 'divergente'
  ) AS has_divergence,
  EXISTS(
    SELECT 1 FROM public.payment_items pi
    WHERE pi.payment_id = p.id
      AND pi.ai_status IN ('alerta','reprovado','erro_duplicidade_pagamento','erro_duplicidade_calculo')
  ) AS has_items_error,
  -- "atrasado" = priority_score >= 50 (já incorpora SLA)
  (p.priority_score >= 50) AS is_overdue
FROM public.payments p;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_payments_flags_payment
  ON public.mv_payments_flags (payment_id);

GRANT SELECT ON public.mv_payments_flags TO authenticated, service_role;

-- =========================================================================
-- 7) Índices pg_trgm para busca textual
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_payments_reference_trgm
  ON public.payments USING gin (reference gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
  ON public.companies USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_doctors_fullname_trgm
  ON public.doctors USING gin (full_name gin_trgm_ops);

-- =========================================================================
-- 8) RPC list_payments — paginação + filtros + ordenação server-side
-- =========================================================================
CREATE OR REPLACE FUNCTION public.list_payments(
  _filters jsonb DEFAULT '{}'::jsonb,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _sort text DEFAULT 'priority'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_statuses text[];
  v_company_ids uuid[];
  v_doctor_ids uuid[];
  v_competence_from date;
  v_competence_to date;
  v_search text;
  v_only_overdue boolean;
  v_only_open_q boolean;
  v_only_divergence boolean;
  v_only_items_error boolean;
  v_assigned_to uuid;
  v_order text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  v_statuses        := CASE WHEN jsonb_typeof(_filters->'statuses') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'statuses')) END;
  v_company_ids     := CASE WHEN jsonb_typeof(_filters->'company_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'company_ids'))::uuid) END;
  v_doctor_ids      := CASE WHEN jsonb_typeof(_filters->'doctor_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'doctor_ids'))::uuid) END;
  v_competence_from := NULLIF(_filters->>'competence_from','')::date;
  v_competence_to   := NULLIF(_filters->>'competence_to','')::date;
  v_search          := NULLIF(trim(_filters->>'search'),'');
  v_only_overdue    := COALESCE((_filters->>'only_overdue')::boolean, false);
  v_only_open_q     := COALESCE((_filters->>'only_open_questions')::boolean, false);
  v_only_divergence := COALESCE((_filters->>'only_divergence')::boolean, false);
  v_only_items_error:= COALESCE((_filters->>'only_items_error')::boolean, false);
  v_assigned_to     := NULLIF(_filters->>'assigned_to','')::uuid;

  v_order := CASE _sort
    WHEN 'created'   THEN 'p.created_at DESC'
    WHEN 'competence'THEN 'p.competence_month DESC NULLS LAST'
    WHEN 'amount'    THEN 'p.total_amount DESC'
    WHEN 'status'    THEN 'p.status::text, p.priority_score DESC'
    ELSE 'p.priority_score DESC, p.created_at DESC'
  END;

  CREATE TEMP TABLE _filtered ON COMMIT DROP AS
  SELECT p.id
  FROM public.payments p
  LEFT JOIN public.mv_payments_flags f ON f.payment_id = p.id
  WHERE
    (v_statuses IS NULL OR p.status::text = ANY(v_statuses))
    AND (v_competence_from IS NULL OR p.competence_month >= v_competence_from)
    AND (v_competence_to   IS NULL OR p.competence_month <= v_competence_to)
    AND (NOT v_only_overdue     OR f.is_overdue)
    AND (NOT v_only_open_q      OR f.has_open_question)
    AND (NOT v_only_divergence  OR f.has_divergence)
    AND (NOT v_only_items_error OR f.has_items_error)
    AND (v_company_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_company_groups g
          WHERE g.payment_id = p.id AND g.company_id = ANY(v_company_ids)))
    AND (v_doctor_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = p.id AND pi.doctor_id = ANY(v_doctor_ids)))
    AND (v_assigned_to IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_assignments pa
          WHERE pa.payment_id = p.id AND pa.assignee_id = v_assigned_to))
    AND (v_search IS NULL OR (
          p.reference ILIKE '%'||v_search||'%'
          OR EXISTS (SELECT 1 FROM public.payment_company_groups g
                     JOIN public.companies c ON c.id = g.company_id
                     WHERE g.payment_id = p.id AND c.name ILIKE '%'||v_search||'%')
          OR EXISTS (SELECT 1 FROM public.payment_items pi
                     WHERE pi.payment_id = p.id
                       AND pi.doctor_name ILIKE '%'||v_search||'%')
        ));

  SELECT count(*) INTO v_total FROM _filtered;

  EXECUTE format($f$
    SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', p.id,
        'reference', p.reference,
        'description', p.description,
        'status', p.status,
        'total_amount', p.total_amount,
        'bruto_total', p.bruto_total,
        'liquido_total', p.liquido_total,
        'items_count', p.items_count,
        'competence_month', p.competence_month,
        'payment_due_date', p.payment_due_date,
        'payment_type', p.payment_type,
        'payment_kind', p.payment_kind,
        'sectors', p.sectors,
        'specialties', p.specialties,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'approved_at', p.approved_at,
        'priority_score', p.priority_score,
        'has_open_question', COALESCE(f.has_open_question,false),
        'has_divergence',    COALESCE(f.has_divergence,false),
        'has_items_error',   COALESCE(f.has_items_error,false),
        'is_overdue',        COALESCE(f.is_overdue,false)
      ) AS row
      FROM _filtered fl
      JOIN public.payments p ON p.id = fl.id
      LEFT JOIN public.mv_payments_flags f ON f.payment_id = p.id
      ORDER BY %s
      LIMIT %s OFFSET %s
    ) t
  $f$, v_order, _limit, _offset) INTO v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_payments(jsonb,int,int,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_payment_priority(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_payment_priority(uuid) TO authenticated;

-- =========================================================================
-- 9) Função de refresh da MV (chamada por cron)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.refresh_mv_payments_flags()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_payments_flags;
END;
$$;

-- =========================================================================
-- 10) Backfill
-- =========================================================================
UPDATE public.payments SET priority_score = public.calculate_payment_priority(id);
REFRESH MATERIALIZED VIEW public.mv_payments_flags;
