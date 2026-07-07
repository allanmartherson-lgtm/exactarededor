
-- ============================================================================
-- Escopo por hospital ativo em RPCs de dashboard/KPI (READ-only)
-- Motivo: usuários viam dados de outros hospitais em cards, KPIs e relatórios.
-- Regra: strict scope via current_active_hospital(); sem hospital ativo => vazio.
-- ============================================================================

-- get_ai_accuracy
CREATE OR REPLACE FUNCTION public.get_ai_accuracy(p_days integer DEFAULT 30)
 RETURNS TABLE(total_analyzed bigint, kept_count bigint, overridden_count bigint, accuracy_pct numeric, by_status jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_total BIGINT;
  v_kept BIGINT;
  v_over BIGINT;
  v_h uuid := public.current_active_hospital();
BEGIN
  SELECT COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL),
         COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL AND COALESCE(pi.authorized_exception,false) = false),
         COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL AND COALESCE(pi.authorized_exception,false) = true)
  INTO v_total, v_kept, v_over
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE p.created_at >= now() - (p_days || ' days')::interval
    AND p.hospital_id = v_h;

  RETURN QUERY
  SELECT v_total, v_kept, v_over,
    CASE WHEN v_total > 0 THEN ROUND(100.0 * v_kept / v_total, 2) ELSE 0 END,
    COALESCE((
      SELECT jsonb_object_agg(ai_status, cnt) FROM (
        SELECT pi.ai_status, COUNT(*) AS cnt
        FROM payment_items pi
        JOIN payments p ON p.id = pi.payment_id
        WHERE p.created_at >= now() - (p_days || ' days')::interval
          AND p.hospital_id = v_h
          AND pi.ai_status IS NOT NULL
        GROUP BY pi.ai_status
      ) s
    ), '{}'::jsonb);
END;
$function$;

-- get_doctors_missing_specialty
CREATE OR REPLACE FUNCTION public.get_doctors_missing_specialty()
 RETURNS TABLE(doctor_name_raw text, doctor_name_norm text, total_gross numeric, n_items bigint, matched_doctor_id uuid, matched_doctor_name text, current_specialties text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH base AS (
    SELECT
      btrim(pi.doctor_name) AS raw,
      lower(btrim(pi.doctor_name)) AS norm,
      pi.gross_amount,
      pi.specialty
    FROM public.payment_items pi
    WHERE pi.doctor_name IS NOT NULL
      AND btrim(pi.doctor_name) <> ''
      AND pi.hospital_id = public.current_active_hospital()
  ),
  resolved AS (
    SELECT
      b.raw, b.norm, b.gross_amount,
      COALESCE(
        nullif(btrim(b.specialty), ''),
        (SELECT (d.specialties)[1] FROM public.doctors d
          WHERE lower(btrim(d.full_name)) = b.norm
          LIMIT 1)
      ) AS especialidade
    FROM base b
  ),
  agg AS (
    SELECT raw, norm, SUM(COALESCE(gross_amount,0)) AS total_gross, COUNT(*) AS n_items
    FROM resolved WHERE especialidade IS NULL
    GROUP BY raw, norm
  )
  SELECT a.raw, a.norm, a.total_gross, a.n_items,
    d.id, d.full_name, COALESCE(d.specialties, ARRAY[]::text[])
  FROM agg a
  LEFT JOIN LATERAL (
    SELECT d.id, d.full_name, d.specialties
    FROM public.doctors d
    WHERE lower(btrim(d.full_name)) = a.norm
    LIMIT 1
  ) d ON true
  ORDER BY a.total_gross DESC;
$function$;

-- get_dre_drilldown (3 args)
CREATE OR REPLACE FUNCTION public.get_dre_drilldown(p_competencia date, p_company_id uuid, p_doctor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(payment_id uuid, reference text, status text, created_at timestamp with time zone, bruto numeric, debitos numeric, creditos numeric, glosas numeric, pool numeric, liquido numeric, items_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  SELECT p.id, p.reference, p.status::TEXT, p.created_at,
    COALESCE(pcf.bruto, 0),
    COALESCE(pcf.debitos, 0),
    COALESCE((
      SELECT SUM(fj.valor) FROM financial_journal fj
      WHERE fj.payment_id = p.id AND fj.company_id = p_company_id AND fj.sinal = 1
        AND fj.hospital_id = v_h
        AND (p_doctor_id IS NULL OR fj.doctor_id = p_doctor_id)
    ), 0),
    COALESCE(pcf.glosas, 0),
    COALESCE((SELECT SUM((d->>'valor')::NUMERIC) FROM jsonb_array_elements(pcf.pool_detalhes) d), 0),
    COALESCE(pcf.liquido, 0),
    (SELECT COUNT(*) FROM payment_items pi WHERE pi.payment_id = p.id
      AND (p_doctor_id IS NULL OR pi.doctor_id = p_doctor_id))::BIGINT
  FROM payments p
  LEFT JOIN payment_company_financials pcf
    ON pcf.payment_id = p.id AND pcf.company_id = p_company_id
   AND pcf.hospital_id = v_h
  WHERE p.competence_month = p_competencia
    AND p.hospital_id = v_h
    AND EXISTS (
      SELECT 1 FROM payment_company_groups pcg
      WHERE pcg.payment_id = p.id AND pcg.company_id = p_company_id
        AND pcg.hospital_id = v_h
    )
    AND (p_doctor_id IS NULL OR EXISTS (
      SELECT 1 FROM payment_items pi WHERE pi.payment_id = p.id AND pi.doctor_id = p_doctor_id
    ))
  ORDER BY p.created_at DESC;
END;
$function$;

-- get_dre_drilldown (4 args - with p_track)
CREATE OR REPLACE FUNCTION public.get_dre_drilldown(p_competencia date, p_company_id uuid, p_doctor_id uuid DEFAULT NULL::uuid, p_track text DEFAULT NULL::text)
 RETURNS TABLE(payment_id uuid, reference text, status text, created_at timestamp with time zone, bruto numeric, debitos numeric, creditos numeric, glosas numeric, pool numeric, liquido numeric, items_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  SELECT p.id, p.reference, p.status::TEXT, p.created_at,
    COALESCE(pcf.bruto, 0),
    COALESCE(pcf.debitos, 0),
    COALESCE((
      SELECT SUM(fj.valor) FROM financial_journal fj
      WHERE fj.payment_id = p.id AND fj.company_id = p_company_id AND fj.sinal = 1
        AND fj.hospital_id = v_h
        AND (p_doctor_id IS NULL OR fj.doctor_id = p_doctor_id)
    ), 0),
    COALESCE(pcf.glosas, 0),
    COALESCE((SELECT SUM((d->>'valor')::NUMERIC) FROM jsonb_array_elements(pcf.pool_detalhes) d), 0),
    COALESCE(pcf.liquido, 0),
    (SELECT COUNT(*) FROM payment_items pi WHERE pi.payment_id = p.id
      AND (p_doctor_id IS NULL OR pi.doctor_id = p_doctor_id))::BIGINT
  FROM payments p
  LEFT JOIN payment_company_financials pcf
    ON pcf.payment_id = p.id AND pcf.company_id = p_company_id
   AND pcf.hospital_id = v_h
  WHERE p.competence_month = p_competencia
    AND p.hospital_id = v_h
    AND EXISTS (
      SELECT 1 FROM payment_company_groups pcg
      WHERE pcg.payment_id = p.id AND pcg.company_id = p_company_id
        AND pcg.hospital_id = v_h
    )
    AND (p_doctor_id IS NULL OR EXISTS (
      SELECT 1 FROM payment_items pi WHERE pi.payment_id = p.id AND pi.doctor_id = p_doctor_id
    ))
    AND (
      p_track IS NULL
      OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
      OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
    )
  ORDER BY p.created_at DESC;
END;
$function$;

-- get_intervention_preview: p_hospital_id default -> current_active_hospital()
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
    'em_questionamento','revisao_pos_aprovacao'
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
    SELECT
      payment_id,
      MAX(description) AS description,
      MAX(reference) AS reference,
      MAX(competence_month::text) AS competence_month,
      MAX(status) AS status,
      COUNT(*)::int AS qtd_itens,
      SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS economia,
      SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS perda,
      SUM(delta) AS saldo
    FROM impacting
    GROUP BY payment_id
  ),
  summary AS (
    SELECT
      COALESCE(SUM(economia), 0) AS economia,
      COALESCE(SUM(perda), 0) AS perda,
      COALESCE(SUM(saldo), 0) AS saldo,
      COALESCE(SUM(qtd_itens), 0)::int AS qtd_itens,
      COUNT(*)::int AS qtd_lotes
    FROM by_payment
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_payment', COALESCE(
      (SELECT jsonb_agg(to_jsonb(bp) ORDER BY bp.saldo DESC) FROM by_payment bp),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- get_intervention_savings: p_hospital_id default -> current_active_hospital()
CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamp with time zone DEFAULT (now() - '30 days'::interval),
  p_end timestamp with time zone DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL::uuid)
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
      item_id, payment_id,
      item_id::text AS obs_id,
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

-- get_journal_balance
CREATE OR REPLACE FUNCTION public.get_journal_balance(
  p_doctor_id uuid DEFAULT NULL::uuid,
  p_company_id uuid DEFAULT NULL::uuid,
  p_competencia_from date DEFAULT NULL::date,
  p_competencia_to date DEFAULT NULL::date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT COALESCE(SUM(sinal * valor), 0)
  FROM public.financial_journal
  WHERE hospital_id = public.current_active_hospital()
    AND (p_doctor_id IS NULL OR doctor_id = p_doctor_id)
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_competencia_from IS NULL OR competencia >= p_competencia_from)
    AND (p_competencia_to IS NULL OR competencia <= p_competencia_to);
$function$;

-- get_money_anomalies
CREATE OR REPLACE FUNCTION public.get_money_anomalies(p_days integer DEFAULT 30)
 RETURNS TABLE(anomaly_type text, severity text, entity_id uuid, entity_name text, metric_value numeric, baseline_value numeric, detected_at timestamp with time zone, details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH company_avg AS (
    SELECT pcg.company_id,
           AVG(COALESCE(pcg.liquido_total, pcg.total_amount, 0)) AS avg_val,
           STDDEV(COALESCE(pcg.liquido_total, pcg.total_amount, 0)) AS sd_val
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE p.created_at >= now() - INTERVAL '180 days'
      AND pcg.company_id IS NOT NULL
      AND p.hospital_id = v_h
    GROUP BY pcg.company_id
    HAVING COUNT(*) >= 3
  ),
  recent AS (
    SELECT pcg.company_id, COALESCE(pcg.liquido_total, pcg.total_amount, 0) AS val,
           p.created_at, p.id AS payment_id
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE p.created_at >= now() - (p_days || ' days')::interval
      AND pcg.company_id IS NOT NULL
      AND p.hospital_id = v_h
  )
  SELECT 'outlier_valor'::TEXT,
    CASE WHEN r.val > ca.avg_val + 3*COALESCE(ca.sd_val,0) THEN 'alta'
         WHEN r.val > ca.avg_val + 2*COALESCE(ca.sd_val,0) THEN 'media' ELSE 'baixa' END,
    c.id, c.name,
    r.val, ca.avg_val,
    r.created_at,
    jsonb_build_object('payment_id', r.payment_id, 'stddev', ca.sd_val)
  FROM recent r
  JOIN company_avg ca ON ca.company_id = r.company_id
  JOIN companies c ON c.id = r.company_id
  WHERE COALESCE(ca.sd_val,0) > 0 AND r.val > ca.avg_val + 2*ca.sd_val

  UNION ALL

  SELECT 'spike_glosa'::TEXT,
    CASE WHEN recent_glosa > 5*hist_avg THEN 'alta'
         WHEN recent_glosa > 3*hist_avg THEN 'media' ELSE 'baixa' END,
    d.id, d.full_name,
    recent_glosa, hist_avg,
    now(),
    jsonb_build_object('crm', d.crm)
  FROM (
    SELECT gi.doctor_crm,
      SUM(CASE WHEN gb.created_at >= now() - (p_days || ' days')::interval THEN COALESCE(gi.valor_glosa,0) ELSE 0 END) AS recent_glosa,
      NULLIF(AVG(CASE WHEN gb.created_at >= now() - INTERVAL '180 days' AND gb.created_at < now() - (p_days || ' days')::interval THEN COALESCE(gi.valor_glosa,0) END),0) AS hist_avg
    FROM glosa_items gi
    JOIN glosa_batches gb ON gb.id = gi.batch_id
    WHERE gi.doctor_crm IS NOT NULL
      AND gb.hospital_id = v_h
      AND gi.hospital_id = v_h
    GROUP BY gi.doctor_crm
    HAVING SUM(CASE WHEN gb.created_at >= now() - (p_days || ' days')::interval THEN COALESCE(gi.valor_glosa,0) ELSE 0 END) > 0
  ) ag
  JOIN doctors d ON d.crm = ag.doctor_crm
  WHERE ag.hist_avg IS NOT NULL AND ag.recent_glosa > 3*ag.hist_avg

  ORDER BY 6 DESC NULLS LAST
  LIMIT 50;
END;
$function$;

-- get_money_funnel (2 args)
CREATE OR REPLACE FUNCTION public.get_money_funnel(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS TABLE(stage text, stage_order integer, payment_count bigint, total_value numeric, avg_age_days numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH stage_map AS (
    SELECT p.id, COALESCE(p.liquido_total, p.total_amount, 0) AS val, p.created_at,
      CASE
        WHEN p.status IN ('rascunho','em_analise_ia') THEN 'Em análise'
        WHEN p.status IN ('revisao_analista','devolvido_analista','concluida_analista') THEN 'Revisão analista'
        WHEN p.status IN ('aguardando_validacao') THEN 'Aguardando validação'
        WHEN p.status IN ('aguardando_aprovacao','aprovado_em_revisao','revisao_pos_aprovacao') THEN 'Aguardando aprovação'
        WHEN p.status IN ('aprovado','aprovado_com_ressalva','aprovado_parcial') THEN 'Aprovado'
        WHEN p.status IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente') THEN 'Ciclo NF'
        WHEN p.status IN ('nf_conciliada','lancado') THEN 'Conciliado'
        WHEN p.status = 'pago' THEN 'Pago'
        WHEN p.status IN ('rejeitado','cancelado','arquivado') THEN 'Encerrado'
        ELSE 'Outro'
      END AS s,
      CASE
        WHEN p.status IN ('rascunho','em_analise_ia') THEN 1
        WHEN p.status IN ('revisao_analista','devolvido_analista','concluida_analista') THEN 2
        WHEN p.status = 'aguardando_validacao' THEN 3
        WHEN p.status IN ('aguardando_aprovacao','aprovado_em_revisao','revisao_pos_aprovacao') THEN 4
        WHEN p.status IN ('aprovado','aprovado_com_ressalva','aprovado_parcial') THEN 5
        WHEN p.status IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente') THEN 6
        WHEN p.status IN ('nf_conciliada','lancado') THEN 7
        WHEN p.status = 'pago' THEN 8
        ELSE 9
      END AS s_order
    FROM payments p
    WHERE p.hospital_id = v_h
      AND (p_start_date IS NULL OR p.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR p.created_at::date <= p_end_date)
  )
  SELECT s, MIN(s_order)::INT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(val),0)::NUMERIC,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))/86400)::NUMERIC, 1)
  FROM stage_map
  GROUP BY s
  ORDER BY MIN(s_order);
END;
$function$;

-- get_money_funnel (3 args - with p_track)
CREATE OR REPLACE FUNCTION public.get_money_funnel(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_track text DEFAULT NULL::text)
 RETURNS TABLE(stage text, stage_order integer, payment_count bigint, total_value numeric, avg_age_days numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH stage_map AS (
    SELECT p.id, COALESCE(p.liquido_total, p.total_amount, 0) AS val, p.created_at,
      CASE
        WHEN p.status IN ('rascunho','em_analise_ia') THEN 'Em análise'
        WHEN p.status IN ('revisao_analista','devolvido_analista','concluida_analista') THEN 'Revisão analista'
        WHEN p.status IN ('aguardando_validacao') THEN 'Aguardando validação'
        WHEN p.status IN ('aguardando_aprovacao','aprovado_em_revisao','revisao_pos_aprovacao') THEN 'Aguardando aprovação'
        WHEN p.status IN ('aprovado','aprovado_com_ressalva','aprovado_parcial') THEN 'Aprovado'
        WHEN p.status IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente') THEN 'Ciclo NF'
        WHEN p.status IN ('nf_conciliada','lancado') THEN 'Conciliado'
        WHEN p.status = 'pago' THEN 'Pago'
        WHEN p.status IN ('rejeitado','cancelado','arquivado') THEN 'Encerrado'
        ELSE 'Outro'
      END AS s,
      CASE
        WHEN p.status IN ('rascunho','em_analise_ia') THEN 1
        WHEN p.status IN ('revisao_analista','devolvido_analista','concluida_analista') THEN 2
        WHEN p.status = 'aguardando_validacao' THEN 3
        WHEN p.status IN ('aguardando_aprovacao','aprovado_em_revisao','revisao_pos_aprovacao') THEN 4
        WHEN p.status IN ('aprovado','aprovado_com_ressalva','aprovado_parcial') THEN 5
        WHEN p.status IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente') THEN 6
        WHEN p.status IN ('nf_conciliada','lancado') THEN 7
        WHEN p.status = 'pago' THEN 8
        ELSE 9
      END AS s_order
    FROM payments p
    WHERE p.hospital_id = v_h
      AND (p_start_date IS NULL OR p.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR p.created_at::date <= p_end_date)
      AND (
        p_track IS NULL
        OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
        OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
      )
  )
  SELECT s, MIN(s_order)::INT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(val),0)::NUMERIC,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))/86400)::NUMERIC, 1)
  FROM stage_map
  GROUP BY s
  ORDER BY MIN(s_order);
END;
$function$;

-- get_return_rate
CREATE OR REPLACE FUNCTION public.get_return_rate(p_days integer DEFAULT 30)
 RETURNS TABLE(return_status text, return_count bigint, total_in_stage bigint, return_rate_pct numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH returns AS (
    SELECT status_to::text AS status_to, COUNT(*) AS c
    FROM payment_status_history
    WHERE changed_at >= now() - (p_days || ' days')::interval
      AND status_to::text IN ('devolvido_analista','aprovado_em_revisao','revisao_pos_aprovacao')
      AND hospital_id = v_h
    GROUP BY status_to
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM payment_status_history
        WHERE status_to::text IN ('aguardando_validacao','devolvido_analista')
          AND changed_at >= now() - (p_days || ' days')::interval
          AND hospital_id = v_h) AS validacao_total,
      (SELECT COUNT(*) FROM payment_status_history
        WHERE status_to::text IN ('aprovado','aprovado_em_revisao')
          AND changed_at >= now() - (p_days || ' days')::interval
          AND hospital_id = v_h) AS aprovacao_total,
      (SELECT COUNT(*) FROM payment_status_history
        WHERE status_to::text IN ('aprovado','revisao_pos_aprovacao')
          AND changed_at >= now() - (p_days || ' days')::interval
          AND hospital_id = v_h) AS pos_aprov_total
  )
  SELECT r.status_to,
    r.c::BIGINT,
    CASE r.status_to
      WHEN 'devolvido_analista' THEN t.validacao_total
      WHEN 'aprovado_em_revisao' THEN t.aprovacao_total
      WHEN 'revisao_pos_aprovacao' THEN t.pos_aprov_total
    END::BIGINT,
    CASE r.status_to
      WHEN 'devolvido_analista' THEN ROUND(100.0 * r.c / NULLIF(t.validacao_total,0), 2)
      WHEN 'aprovado_em_revisao' THEN ROUND(100.0 * r.c / NULLIF(t.aprovacao_total,0), 2)
      WHEN 'revisao_pos_aprovacao' THEN ROUND(100.0 * r.c / NULLIF(t.pos_aprov_total,0), 2)
    END
  FROM returns r CROSS JOIN totals t
  ORDER BY r.c DESC;
END;
$function$;

-- get_stage_dwell_time
CREATE OR REPLACE FUNCTION public.get_stage_dwell_time(p_days integer DEFAULT 90)
 RETURNS TABLE(status text, transitions bigint, avg_hours numeric, p50_hours numeric, p90_hours numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH ordered AS (
    SELECT payment_id, status_to::text AS st, changed_at,
      LEAD(changed_at) OVER (PARTITION BY payment_id ORDER BY changed_at) AS next_at
    FROM payment_status_history
    WHERE changed_at >= now() - (p_days || ' days')::interval
      AND hospital_id = v_h
  ),
  durations AS (
    SELECT st,
      EXTRACT(EPOCH FROM (COALESCE(next_at, now()) - changed_at))/3600 AS hours
    FROM ordered
    WHERE next_at IS NOT NULL
  )
  SELECT d.st,
    COUNT(*)::BIGINT,
    ROUND(AVG(hours)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY hours)::NUMERIC, 2)
  FROM durations d
  GROUP BY d.st
  ORDER BY AVG(hours) DESC;
END;
$function$;

-- get_stuck_companies
CREATE OR REPLACE FUNCTION public.get_stuck_companies(p_limit integer DEFAULT 10)
 RETURNS TABLE(company_id uuid, company_name text, stuck_count bigint, total_stuck_value numeric, max_age_days integer, worst_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH stuck AS (
    SELECT pcg.company_id, pcg.status::TEXT AS status, COALESCE(pcg.liquido_total, pcg.total_amount, 0) AS val,
      EXTRACT(EPOCH FROM (now() - p.created_at))/86400 AS age_days
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE pcg.status::TEXT NOT IN ('pago','rejeitado','cancelado','arquivado','nf_conciliada','lancado')
      AND p.created_at < now() - INTERVAL '7 days'
      AND pcg.company_id IS NOT NULL
      AND p.hospital_id = v_h
      AND pcg.hospital_id = v_h
  )
  SELECT c.id, c.name,
    COUNT(*)::BIGINT,
    COALESCE(SUM(s.val),0)::NUMERIC,
    MAX(s.age_days)::INT,
    (ARRAY_AGG(s.status ORDER BY s.age_days DESC))[1]
  FROM stuck s
  JOIN companies c ON c.id = s.company_id
  GROUP BY c.id, c.name
  ORDER BY MAX(s.age_days) DESC
  LIMIT p_limit;
END;
$function$;
