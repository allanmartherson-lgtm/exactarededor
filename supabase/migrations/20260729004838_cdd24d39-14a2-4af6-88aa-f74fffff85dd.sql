-- 1) Colunas novas no ledger para contexto de parcelamento
ALTER TABLE public.intervention_ledger
  ADD COLUMN IF NOT EXISTS parcela_numero integer,
  ADD COLUMN IF NOT EXISTS parcelas_total integer;

-- Índice único legado assumia 1 linha por (payment, company) no bloco glosa_pj.
-- Agora gravamos 1 linha por item de glosa (múltiplos itens por empresa/pagamento).
DROP INDEX IF EXISTS public.uq_ledger_glosa_pj;

-- 2) Reescreve materialize_intervention_ledger — só o bloco de glosa_pj muda
CREATE OR REPLACE FUNCTION public.materialize_intervention_ledger(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment RECORD;
BEGIN
  SELECT id, hospital_id, approved_at, approved_by
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id;
  IF v_payment.id IS NULL THEN RETURN; END IF;

  DELETE FROM public.intervention_ledger WHERE payment_id = p_payment_id;

  IF v_payment.approved_at IS NULL THEN
    RETURN;
  END IF;

  -- Bloco 1 (payment_items) — inalterado.
  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name, attendance_number,
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
    pi.attendance_number,
    COALESCE(pi.expected_amount, 0) AS valor_regra,
    COALESCE(pi.gross_amount, 0)    AS valor_pago_final,
    CASE
      WHEN pi.item_origem IN ('conciliacao_credito','conciliacao_debito') THEN 0
      WHEN pi.is_cancelled THEN
        COALESCE(
          (SELECT v.gross_amount_at_time FROM public.ai_analysis_versions v
             WHERE v.item_id = pi.id AND v.gross_amount_at_time IS NOT NULL
             ORDER BY v.version ASC LIMIT 1),
          NULLIF(pi.gross_amount_original, 0),
          pi.gross_amount, 0
        )
      WHEN (pi.gross_override_at IS NOT NULL OR pi.acatado_at IS NOT NULL)
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 0
      WHEN pi.gross_override_at IS NOT NULL OR pi.acatado_at IS NOT NULL THEN
        COALESCE(
          (SELECT v.gross_amount_at_time FROM public.ai_analysis_versions v
             WHERE v.item_id = pi.id AND v.gross_amount_at_time IS NOT NULL
             ORDER BY v.version ASC LIMIT 1),
          NULLIF(pi.gross_amount_original, 0),
          pi.gross_amount, 0
        ) - COALESCE(pi.gross_amount, 0)
      ELSE 0
    END AS delta,
    CASE
      WHEN pi.item_origem = 'conciliacao_credito' THEN 'conciliacao_credito'
      WHEN pi.item_origem = 'conciliacao_debito'  THEN 'conciliacao_debito'
      WHEN pi.is_cancelled THEN 'cancelamento'
      WHEN pi.gross_override_at IS NOT NULL
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
    COALESCE(pi.gross_override_by, pi.cancelled_by, pi.acatado_by) AS autor_id,
    v_payment.approved_at,
    v_payment.approved_by
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  -- Bloco 2 (glosa por PJ) — reescrito.
  -- Uma linha por item de glosa, com valor proporcional ao que foi
  -- efetivamente aplicado NESTE pagamento:
  --   fração = SUM(valor_aplicado neste pagamento, status válido) / total_debt
  --   valor_do_item = fração × gdi.amount
  -- parcelas_total = # de pagamentos distintos que já aplicaram essa dívida
  -- (com status válido), para dar contexto de parcelamento.
  WITH this_payment_apps AS (
    SELECT
      gp.glosa_debt_id,
      SUM(COALESCE(gp.valor_aplicado, 0))              AS sum_this_payment,
      MAX(gp.parcela_numero)                            AS parcela_numero,
      (array_agg(gp.applied_by   ORDER BY gp.applied_at ASC)
         FILTER (WHERE gp.applied_by   IS NOT NULL))[1] AS applied_by,
      (array_agg(gp.confirmed_by ORDER BY gp.applied_at ASC)
         FILTER (WHERE gp.confirmed_by IS NOT NULL))[1] AS confirmed_by
    FROM public.glosa_payment_applications gp
    WHERE gp.payment_id = p_payment_id
      AND gp.status IN ('confirmado','proposto','partial')
    GROUP BY gp.glosa_debt_id
  ),
  debt_total_payments AS (
    SELECT
      gp.glosa_debt_id,
      COUNT(DISTINCT gp.payment_id) AS parcelas_total
    FROM public.glosa_payment_applications gp
    WHERE gp.status IN ('confirmado','proposto','partial')
      AND gp.glosa_debt_id IN (SELECT glosa_debt_id FROM this_payment_apps)
    GROUP BY gp.glosa_debt_id
  )
  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name, attendance_number,
    valor_regra, valor_pago_final, delta,
    fonte, cancellation_reason, autor_id,
    approved_at, approved_by,
    parcela_numero, parcelas_total
  )
  SELECT
    p_payment_id,
    NULL,
    v_payment.hospital_id,
    gd.company_id,
    c.name,
    gi.doctor_name,
    gi.procedure_code,
    gi.procedure_name,
    gi.attendance_number,
    0,
    -((tpa.sum_this_payment / NULLIF(gd.total_debt, 0)) * COALESCE(gdi.amount, 0)),
     ((tpa.sum_this_payment / NULLIF(gd.total_debt, 0)) * COALESCE(gdi.amount, 0)),
    'glosa_pj',
    NULL,
    COALESCE(tpa.applied_by, tpa.confirmed_by),
    v_payment.approved_at,
    v_payment.approved_by,
    tpa.parcela_numero,
    dtp.parcelas_total
  FROM this_payment_apps tpa
  JOIN public.glosa_debts       gd  ON gd.id  = tpa.glosa_debt_id
  JOIN public.companies         c   ON c.id   = gd.company_id
  JOIN public.glosa_debt_items  gdi ON gdi.debt_id = gd.id
  JOIN public.glosa_items       gi  ON gi.id  = gdi.glosa_item_id
  LEFT JOIN debt_total_payments dtp ON dtp.glosa_debt_id = gd.id
  WHERE COALESCE(gdi.amount, 0) > 0
    AND COALESCE(gd.total_debt, 0) > 0
    AND COALESCE(tpa.sum_this_payment, 0) > 0;
END;
$function$;

-- 3) Expõe parcela_numero/parcelas_total no items[] do RPC
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
    SELECT
      l.*,
      COALESCE(
        (
          SELECT ur.role::text
          FROM public.user_roles ur
          WHERE ur.user_id = l.autor_id
            AND ur.role IN ('diretor'::app_role,'validador'::app_role,'analista'::app_role,'admin'::app_role)
          ORDER BY CASE ur.role::text
            WHEN 'analista'  THEN 1
            WHEN 'validador' THEN 2
            WHEN 'diretor'   THEN 3
            WHEN 'admin'     THEN 4
            ELSE 5
          END
          LIMIT 1
        ),
        'sistema'
      ) AS papel_autor
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
  by_papel AS (
    SELECT papel_autor,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN NOT is_neutro AND delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(CASE WHEN NOT is_neutro THEN delta ELSE 0 END), 0) AS saldo,
      COUNT(*) AS qtd
    FROM neutro GROUP BY papel_autor
  ),
  by_user AS (
    SELECT
      autor_id AS user_id,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = autor_id), 'Sistema') AS nome,
      MIN(fonte) AS role,
      MIN(papel_autor) AS papel_autor,
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
      papel_autor,
      approved_at AS obs_at,
      approved_at AS acatado_at,
      doctor_name, procedure_code, procedure_name, company_name,
      NULL::uuid AS company_group_id,
      cancellation_reason,
      parcela_numero,
      parcelas_total
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
    'by_role',  COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role  br), '[]'::jsonb),
    'by_papel', COALESCE((SELECT jsonb_agg(to_jsonb(bp)) FROM by_papel bp), '[]'::jsonb),
    'by_user',  COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user  bu), '[]'::jsonb),
    'items',    COALESCE((SELECT jsonb_agg(to_jsonb(i))  FROM items    i),  '[]'::jsonb),
    'window',   jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', v_h)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 4) Backfill do histórico
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.payments WHERE approved_at IS NOT NULL LOOP
    PERFORM public.materialize_intervention_ledger(r.id);
  END LOOP;
END$$;