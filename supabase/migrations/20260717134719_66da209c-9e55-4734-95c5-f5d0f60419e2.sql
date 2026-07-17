-- Atualiza get_intervention_savings para adicionar `papel_autor` (analista / validador / diretor / admin / sistema)
-- em cada linha de items e uma agregação `by_papel`. Mantém `role` = `fonte` (sem breaking change).
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
      -- Papel do autor derivado de user_roles no momento da leitura.
      -- Prioridade: diretor > validador > analista > admin. Fallback 'sistema'
      -- para eventos sem autor (glosas automáticas, cancelamentos por conciliação, etc).
      COALESCE(
        (
          SELECT ur.role::text
          FROM public.user_roles ur
          WHERE ur.user_id = l.autor_id
            AND ur.role IN ('diretor'::app_role,'validador'::app_role,'analista'::app_role,'admin'::app_role)
          ORDER BY CASE ur.role::text
            WHEN 'diretor' THEN 1
            WHEN 'validador' THEN 2
            WHEN 'analista' THEN 3
            WHEN 'admin' THEN 4
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
    'by_role',  COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role  br), '[]'::jsonb),
    'by_papel', COALESCE((SELECT jsonb_agg(to_jsonb(bp)) FROM by_papel bp), '[]'::jsonb),
    'by_user',  COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user  bu), '[]'::jsonb),
    'items',    COALESCE((SELECT jsonb_agg(to_jsonb(i))  FROM items    i),  '[]'::jsonb),
    'window',   jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', v_h)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;