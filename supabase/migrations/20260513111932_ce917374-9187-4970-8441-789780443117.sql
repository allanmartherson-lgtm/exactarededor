-- Sub-Onda 2A: colunas SQL nativas para rastreabilidade do motor de regras (retry)

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS applied_rule_id    uuid NULL,
  ADD COLUMN IF NOT EXISTS applied_rule_label text NULL,
  ADD COLUMN IF NOT EXISTS applied_calc_id    uuid NULL,
  ADD COLUMN IF NOT EXISTS applied_calc_method text NULL,
  ADD COLUMN IF NOT EXISTS expected_amount    numeric NULL,
  ADD COLUMN IF NOT EXISTS applied_at         timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_items_applied_rule_id_fkey') THEN
    ALTER TABLE public.payment_items
      ADD CONSTRAINT payment_items_applied_rule_id_fkey
      FOREIGN KEY (applied_rule_id) REFERENCES public.rules(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_items_applied_calc_id_fkey') THEN
    ALTER TABLE public.payment_items
      ADD CONSTRAINT payment_items_applied_calc_id_fkey
      FOREIGN KEY (applied_calc_id) REFERENCES public.rule_calculations(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS applied_calc_method_valid;
ALTER TABLE public.payment_items
  ADD CONSTRAINT applied_calc_method_valid CHECK (
    applied_calc_method IS NULL OR applied_calc_method IN (
      'percentual_convenio', 'regra_vias', 'pacote', 'valor_fixo',
      'tabela_diferenciada', 'bonus', 'complemento', 'exclusao'
    )
  );

CREATE INDEX IF NOT EXISTS payment_items_applied_rule_id_idx ON public.payment_items(applied_rule_id);
CREATE INDEX IF NOT EXISTS payment_items_applied_calc_method_idx ON public.payment_items(applied_calc_method);

CREATE OR REPLACE FUNCTION public.map_calculation_type_to_method(_ctype text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Mapeamento do enum interno do motor para os 8 valores estáveis de applied_calc_method.
  -- COLAPSOS:
  --   pacote / pacote_fechado / pacote_com_extras / pacote_por_atendimento / pacote_fixo -> 'pacote'
  --   tabela_diferenciada / tabela_referencia                                              -> 'tabela_diferenciada'
  --   informativo / default_geral / default_hemodinamica / desconhecido                    -> NULL
  SELECT CASE
    WHEN _ctype IS NULL THEN NULL
    WHEN _ctype IN ('pacote','pacote_fechado','pacote_com_extras','pacote_por_atendimento','pacote_fixo') THEN 'pacote'
    WHEN _ctype IN ('tabela_diferenciada','tabela_referencia') THEN 'tabela_diferenciada'
    WHEN _ctype = 'percentual_sobre_convenio' THEN 'percentual_convenio'
    WHEN _ctype = 'regra_vias' THEN 'regra_vias'
    WHEN _ctype = 'valor_fixo' THEN 'valor_fixo'
    WHEN _ctype = 'bonus' THEN 'bonus'
    WHEN _ctype = 'complemento' THEN 'complemento'
    WHEN _ctype = 'exclusao' THEN 'exclusao'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_payment_items_engine_columns(_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_with_findings int;
  v_would_fill int;
  v_filled int;
  v_orphans int;
  v_dist jsonb;
BEGIN
  SELECT count(*) INTO v_total FROM public.payment_items;
  SELECT count(*) INTO v_with_findings FROM public.payment_items WHERE ai_findings IS NOT NULL;

  WITH src AS (
    SELECT
      pi.id,
      pi.ai_findings->'matched_rule_ids'->>0 AS rid_text,
      pi.ai_findings->'matched_rules'->>0 AS rname,
      public.map_calculation_type_to_method(pi.ai_findings->'engine'->>'calculation_type_used') AS method
    FROM public.payment_items pi
    WHERE pi.ai_findings IS NOT NULL
  )
  SELECT count(*) INTO v_would_fill
  FROM src
  WHERE rid_text IS NOT NULL OR rname IS NOT NULL OR method IS NOT NULL;

  WITH src AS (
    SELECT public.map_calculation_type_to_method(pi.ai_findings->'engine'->>'calculation_type_used') AS method
    FROM public.payment_items pi WHERE pi.ai_findings IS NOT NULL
  )
  SELECT jsonb_object_agg(coalesce(method,'NULL'), c) INTO v_dist
  FROM (SELECT method, count(*) AS c FROM src GROUP BY method) t;

  RAISE NOTICE 'backfill preview: total=% with_findings=% would_fill=% distribution=%',
    v_total, v_with_findings, v_would_fill, v_dist;

  IF _dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'total', v_total,
      'with_findings', v_with_findings,
      'would_fill', v_would_fill,
      'distribution', v_dist
    );
  END IF;

  WITH src AS (
    SELECT
      pi.id,
      NULLIF(pi.ai_findings->'matched_rule_ids'->>0,'')::uuid AS rid_raw,
      NULLIF(pi.ai_findings->'matched_rules'->>0,'')          AS rname,
      CASE
        WHEN jsonb_typeof(pi.ai_findings->'calculation_breakdown') = 'array' THEN (
          SELECT NULLIF(elem->>'calc_id','')::uuid
          FROM jsonb_array_elements(pi.ai_findings->'calculation_breakdown') elem
          WHERE COALESCE((elem->>'matched')::boolean,false) = true
          LIMIT 1
        )
        ELSE NULL
      END AS calc_id_raw,
      public.map_calculation_type_to_method(pi.ai_findings->'engine'->>'calculation_type_used') AS method,
      CASE
        WHEN jsonb_typeof(pi.ai_findings->'expected_amount') = 'number'
          THEN (pi.ai_findings->>'expected_amount')::numeric
        ELSE NULL
      END AS exp_amt
    FROM public.payment_items pi
    WHERE pi.ai_findings IS NOT NULL
  ),
  resolved AS (
    SELECT
      s.id,
      r.id  AS rule_id,
      s.rname AS rule_label,
      rc.id AS calc_id,
      s.method,
      s.exp_amt
    FROM src s
    LEFT JOIN public.rules r ON r.id = s.rid_raw
    LEFT JOIN public.rule_calculations rc ON rc.id = s.calc_id_raw
  ),
  upd AS (
    UPDATE public.payment_items pi
       SET applied_rule_id    = COALESCE(pi.applied_rule_id, x.rule_id),
           applied_rule_label = COALESCE(pi.applied_rule_label, x.rule_label),
           applied_calc_id    = COALESCE(pi.applied_calc_id, x.calc_id),
           applied_calc_method= COALESCE(pi.applied_calc_method, x.method),
           expected_amount    = COALESCE(pi.expected_amount, x.exp_amt),
           applied_at         = COALESCE(pi.applied_at, now())
      FROM resolved x
     WHERE pi.id = x.id
       AND (pi.applied_rule_id IS NULL AND pi.applied_rule_label IS NULL
            AND pi.applied_calc_id IS NULL AND pi.applied_calc_method IS NULL
            AND pi.expected_amount IS NULL)
       AND (x.rule_id IS NOT NULL OR x.rule_label IS NOT NULL
            OR x.calc_id IS NOT NULL OR x.method IS NOT NULL OR x.exp_amt IS NOT NULL)
     RETURNING pi.id
  )
  SELECT count(*) INTO v_filled FROM upd;

  SELECT count(*) INTO v_orphans
  FROM public.payment_items
  WHERE applied_rule_id IS NULL AND applied_rule_label IS NOT NULL;

  RAISE NOTICE 'backfill applied: filled=% orphans_label_preserved=%', v_filled, v_orphans;

  RETURN jsonb_build_object(
    'dry_run', false,
    'total', v_total,
    'with_findings', v_with_findings,
    'would_fill', v_would_fill,
    'filled_this_run', v_filled,
    'orphans_label_preserved', v_orphans,
    'distribution', v_dist
  );
END;
$$;

DO $$
DECLARE
  r_dry jsonb; r1 jsonb; r2 jsonb;
  filled_after_1 int; filled_after_2 int;
BEGIN
  RAISE NOTICE '--- DRY RUN ---';
  r_dry := public.backfill_payment_items_engine_columns(_dry_run := true);
  RAISE NOTICE 'dry_run result: %', r_dry;

  RAISE NOTICE '--- REAL RUN #1 ---';
  r1 := public.backfill_payment_items_engine_columns(_dry_run := false);
  RAISE NOTICE 'run #1 result: %', r1;
  SELECT count(*) INTO filled_after_1
    FROM public.payment_items
   WHERE applied_rule_id IS NOT NULL OR applied_rule_label IS NOT NULL
      OR applied_calc_method IS NOT NULL OR expected_amount IS NOT NULL;

  RAISE NOTICE '--- REAL RUN #2 (idempotência) ---';
  r2 := public.backfill_payment_items_engine_columns(_dry_run := false);
  RAISE NOTICE 'run #2 result: %', r2;
  SELECT count(*) INTO filled_after_2
    FROM public.payment_items
   WHERE applied_rule_id IS NOT NULL OR applied_rule_label IS NOT NULL
      OR applied_calc_method IS NOT NULL OR expected_amount IS NOT NULL;

  IF filled_after_1 <> filled_after_2 THEN
    RAISE EXCEPTION 'Backfill NÃO é idempotente: count após run#1=% vs run#2=%',
      filled_after_1, filled_after_2;
  END IF;
  IF (r2->>'filled_this_run')::int <> 0 THEN
    RAISE EXCEPTION 'Backfill NÃO é idempotente: run#2 ainda preencheu % linhas',
      (r2->>'filled_this_run')::int;
  END IF;

  RAISE NOTICE 'OK: idempotência confirmada (count=% após ambas, run#2 filled=0)', filled_after_1;
END $$;