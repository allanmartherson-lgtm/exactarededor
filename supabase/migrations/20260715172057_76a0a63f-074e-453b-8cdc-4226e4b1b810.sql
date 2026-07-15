
-- 1) intervention_ledger: item_id opcional, adicionar 'glosa_pj' no CHECK e unique parcial por PJ
ALTER TABLE public.intervention_ledger ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.intervention_ledger DROP CONSTRAINT IF EXISTS intervention_ledger_fonte_check;
ALTER TABLE public.intervention_ledger
  ADD CONSTRAINT intervention_ledger_fonte_check
  CHECK (fonte = ANY (ARRAY[
    'cancelamento'::text,'glosa'::text,'glosa_pj'::text,'ajuste_manual'::text,
    'aceite_pago'::text,'aceite_esperado'::text,'sem_intervencao'::text
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_glosa_pj
  ON public.intervention_ledger (payment_id, company_id, approved_at)
  WHERE fonte = 'glosa_pj';

-- 2) materialize_intervention_ledger: remover 'glosa' item-a-item, adicionar 'glosa_pj' agregada por PJ
CREATE OR REPLACE FUNCTION public.materialize_intervention_ledger(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment RECORD;
  v_accept_expected_cutoff timestamptz := '2026-07-01 00:00:00+00';
BEGIN
  SELECT id, hospital_id, approved_at, approved_by
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id;
  IF v_payment.id IS NULL THEN RETURN; END IF;

  DELETE FROM public.intervention_ledger WHERE payment_id = p_payment_id;

  -- Linhas item-a-item (sem mais 'glosa' — coberto agora por 'glosa_pj')
  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name,
    valor_regra, valor_pago_final, delta,
    fonte, cancellation_reason, autor_id,
    approved_at, approved_by
  )
  SELECT
    pi.payment_id,
    pi.id,
    v_payment.hospital_id,
    pi.company_id,
    pi.company_name,
    pi.doctor_name,
    pi.procedure_code,
    pi.procedure_name,
    COALESCE(pi.expected_amount, 0)                        AS valor_regra,
    COALESCE(pi.gross_amount, 0)                           AS valor_pago_final,
    CASE
      WHEN pi.acatado_at IS NOT NULL
        AND pi.acatado_at >= v_accept_expected_cutoff
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        AND pi.gross_amount_original IS NOT NULL
        AND ABS(pi.gross_amount_original - COALESCE(pi.gross_amount, 0)) >= 0.01
        THEN pi.gross_amount_original - COALESCE(pi.gross_amount, 0)
      ELSE COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)
    END                                                    AS delta,
    CASE
      WHEN pi.is_cancelled THEN 'cancelamento'
      WHEN pi.gross_override_at IS NOT NULL
        AND pi.acatado_at IS NOT NULL
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 'aceite_esperado'
      WHEN pi.gross_override_at IS NOT NULL THEN 'ajuste_manual'
      WHEN pi.acatado_at IS NOT NULL
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 'aceite_esperado'
      WHEN pi.acatado_at IS NOT NULL THEN 'aceite_pago'
      WHEN ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 'sem_intervencao'
      ELSE 'ajuste_manual'
    END AS fonte,
    CASE WHEN pi.is_cancelled THEN pi.cancellation_reason::text ELSE NULL END,
    COALESCE(pi.cancelled_by, pi.gross_override_by, pi.acatado_by, v_payment.approved_by) AS autor_id,
    COALESCE(v_payment.approved_at, now()),
    v_payment.approved_by
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  -- Linhas 'glosa_pj' agregadas: uma por PJ com o total aplicado (não revertido)
  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name,
    valor_regra, valor_pago_final, delta,
    fonte, cancellation_reason, autor_id,
    approved_at, approved_by
  )
  SELECT
    p_payment_id,
    NULL::uuid,
    v_payment.hospital_id,
    g.company_id,
    (SELECT c.name FROM public.companies c WHERE c.id = g.company_id),
    NULL, NULL, NULL,
    SUM(g.valor_aplicado) AS valor_regra,
    0 AS valor_pago_final,
    SUM(g.valor_aplicado) AS delta, -- positivo = economia
    'glosa_pj',
    NULL,
    (ARRAY_AGG(COALESCE(g.confirmed_by, g.applied_by, v_payment.approved_by)
               ORDER BY g.applied_at DESC))[1],
    COALESCE(v_payment.approved_at, now()),
    v_payment.approved_by
  FROM public.glosa_payment_applications g
  WHERE g.payment_id = p_payment_id
    AND g.reverted_at IS NULL
    AND g.status <> 'revertido'
    AND g.valor_aplicado > 0
  GROUP BY g.company_id
  HAVING SUM(g.valor_aplicado) > 0;
END $$;

-- 3) get_intervention_savings: sintetizar obs_id/item_id p/ linhas glosa_pj (sem item_id real)
CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamp with time zone DEFAULT (now() - '30 days'::interval),
  p_end   timestamp with time zone DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
  v_h uuid := COALESCE(p_hospital_id, public.current_active_hospital());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('diretor'::app_role,'admin'::app_role,'validador'::app_role,'analista'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH rows AS (
    SELECT l.*
    FROM public.intervention_ledger l
    JOIN public.payments p ON p.id = l.payment_id
    WHERE l.approved_at BETWEEN p_start AND p_end
      AND l.reverted_at IS NULL
      AND l.hospital_id = v_h
      AND p.hospital_id = v_h
      AND l.fonte <> 'sem_intervencao'
      AND COALESCE(p.import_mode, 'normal') <> 'historico'
  ),
  neutro AS (
    SELECT *,
      CASE
        WHEN fonte = 'cancelamento'
         AND (cancellation_reason IS NULL
              OR cancellation_reason NOT IN (
                'medico_fatura_externamente','contrato_encerrado','glosa_total_quitada',
                'decisao_juridica','duplicidade_externa','economia_real'
              ))
        THEN true ELSE false
      END AS is_neutro
    FROM rows
  ),
  summary AS (
    SELECT
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(CASE WHEN is_neutro THEN ABS(delta) ELSE 0 END), 0) AS neutro,
      COUNT(*) AS qtd_itens
    FROM neutro
  ),
  by_role AS (
    SELECT fonte AS role,
      COALESCE(SUM(CASE WHEN NOT is_neutro THEN delta ELSE 0 END), 0) AS saldo,
      COUNT(*) AS qtd
    FROM neutro GROUP BY fonte
  ),
  by_user AS (
    SELECT
      autor_id AS user_id,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = autor_id), 'Sistema') AS nome,
      MIN(fonte) AS role,
      COUNT(*) AS qtd_itens,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(CASE WHEN NOT is_neutro THEN delta ELSE 0 END), 0) AS saldo
    FROM neutro
    WHERE autor_id IS NOT NULL
    GROUP BY autor_id
  ),
  items AS (
    SELECT
      COALESCE(item_id::text, 'glosa_pj:' || payment_id::text || ':' || COALESCE(company_id::text,'null')) AS item_id,
      payment_id,
      COALESCE(item_id::text, 'glosa_pj:' || payment_id::text || ':' || COALESCE(company_id::text,'null')) AS obs_id,
      valor_regra, valor_pago_final, delta,
      autor_id AS author_id,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = autor_id), 'Sistema') AS autor,
      fonte AS role,
      approved_at AS obs_at,
      approved_at AS acatado_at,
      doctor_name, procedure_code, procedure_name, company_name,
      NULL::uuid AS company_group_id,
      cancellation_reason
    FROM neutro
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'economia', (SELECT economia FROM summary),
      'perda',    (SELECT perda    FROM summary),
      'neutro',   (SELECT neutro   FROM summary),
      'saldo',    (SELECT economia - perda FROM summary),
      'qtd_itens',(SELECT qtd_itens FROM summary)
    ),
    'by_role', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role br), '[]'::jsonb),
    'by_user', COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user bu), '[]'::jsonb),
    'items',   COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM items i), '[]'::jsonb),
    'window',  jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', v_h)
  ) INTO v_result;

  RETURN v_result;
END $function$;

-- 4) get_intervention_preview: remover revisao_pos_aprovacao dos estados pendentes
CREATE OR REPLACE FUNCTION public.get_intervention_preview(p_hospital_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
  v_h uuid := COALESCE(p_hospital_id, public.current_active_hospital());
  v_pending_states text[] := ARRAY[
    'em_analise_ia','revisao_analista','concluida_analista',
    'aguardando_validacao','devolvido_analista','aguardando_aprovacao',
    'em_questionamento'
  ];
  v_accept_expected_cutoff constant timestamptz := '2026-07-04 00:00:00+00';
BEGIN
  WITH candidate_payments AS (
    SELECT p.id, p.description, p.reference, p.competence_month, p.status::text AS status, p.hospital_id
    FROM public.payments p
    WHERE p.status::text = ANY(v_pending_states)
      AND COALESCE(p.import_mode, 'normal') <> 'historico'
      AND p.hospital_id = v_h
  ),
  glosa_by_payment AS (
    SELECT payment_id, jsonb_object_agg(company_id::text, true) AS by_company
    FROM (
      SELECT DISTINCT payment_id, company_id
      FROM public.glosa_payment_applications
      WHERE reverted_at IS NULL
        AND payment_id IN (SELECT id FROM candidate_payments)
    ) g
    GROUP BY payment_id
  ),
  item_rows AS (
    SELECT
      cp.id AS payment_id, cp.description, cp.reference, cp.competence_month, cp.status,
      pi.id AS item_id, pi.is_cancelled, pi.acatado_at, pi.gross_override_at,
      COALESCE(pi.expected_amount, 0) AS expected_amount,
      COALESCE(pi.gross_amount, 0) AS gross_amount,
      pi.gross_amount_original,
      CASE
        WHEN pi.acatado_at IS NOT NULL
          AND pi.acatado_at >= v_accept_expected_cutoff
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          AND pi.gross_amount_original IS NOT NULL
          AND ABS(pi.gross_amount_original - COALESCE(pi.gross_amount, 0)) >= 0.01
          THEN pi.gross_amount_original - COALESCE(pi.gross_amount, 0)
        ELSE COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)
      END AS delta,
      CASE
        WHEN pi.is_cancelled THEN 'cancelamento'
        WHEN pi.company_id IS NOT NULL
          AND (COALESCE((SELECT by_company FROM glosa_by_payment gb WHERE gb.payment_id = cp.id), '{}'::jsonb) ? pi.company_id::text)
          THEN 'glosa'
        WHEN pi.gross_override_at IS NOT NULL
          AND pi.acatado_at IS NOT NULL
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'aceite_esperado'
        WHEN pi.gross_override_at IS NOT NULL THEN 'ajuste_manual'
        WHEN pi.acatado_at IS NOT NULL
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'aceite_esperado'
        WHEN pi.acatado_at IS NOT NULL THEN 'aceite_pago'
        WHEN ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'sem_intervencao'
        ELSE 'ajuste_manual'
      END AS fonte
    FROM candidate_payments cp
    JOIN public.payment_items pi ON pi.payment_id = cp.id
  ),
  impacting AS (
    SELECT * FROM item_rows
    WHERE fonte <> 'sem_intervencao'
      AND (is_cancelled OR acatado_at IS NOT NULL OR gross_override_at IS NOT NULL)
      AND ABS(delta) > 0.005
  ),
  by_payment AS (
    SELECT payment_id, description, reference, competence_month, status,
      COUNT(*) AS qtd_itens,
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(delta), 0) AS saldo
    FROM impacting
    GROUP BY payment_id, description, reference, competence_month, status
  ),
  totals AS (
    SELECT
      COUNT(*)::int AS qtd_lotes,
      COALESCE(SUM(qtd_itens),0)::int AS qtd_itens,
      COALESCE(SUM(economia),0) AS economia,
      COALESCE(SUM(perda),0) AS perda,
      COALESCE(SUM(saldo),0) AS saldo
    FROM by_payment
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(t) FROM totals t),
    'payments', COALESCE((SELECT jsonb_agg(to_jsonb(bp) ORDER BY ABS(bp.saldo) DESC) FROM by_payment bp), '[]'::jsonb),
    'window', jsonb_build_object('hospital_id', v_h)
  ) INTO v_result;

  RETURN v_result;
END $function$;

-- 5) Backfill: rematerializar lotes aprovados/downstream não-históricos
DO $$
DECLARE
  v_states text[] := ARRAY[
    'aprovado','aprovado_com_ressalva','aprovado_em_revisao','aprovado_parcial',
    'revisao_pos_aprovacao',
    'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente',
    'nf_conciliada','lancado','arquivado','pago'
  ];
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.payments
     WHERE status::text = ANY(v_states)
       AND (import_mode IS NULL OR import_mode <> 'historico')
  LOOP
    PERFORM public.materialize_intervention_ledger(r.id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % lotes rematerializados', v_count;
END $$;
