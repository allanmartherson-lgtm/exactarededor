CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamp with time zone DEFAULT (now() - '30 days'::interval),
  p_end timestamp with time zone DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
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
      AND (p_hospital_id IS NULL OR l.hospital_id = p_hospital_id)
      AND l.fonte <> 'sem_intervencao'
      -- Lotes históricos foram carregados só para compor DRE e não devem entrar no KPI de intervenção.
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
    'window',  jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', p_hospital_id)
  ) INTO v_result;

  RETURN v_result;
END $function$;