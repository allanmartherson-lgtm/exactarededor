CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamptz DEFAULT (now() - interval '30 days'),
  p_end   timestamptz DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
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

  WITH intervenors AS (
    SELECT ur.user_id, ur.role::text AS role FROM public.user_roles ur
    WHERE ur.role IN ('diretor'::app_role,'validador'::app_role)
  ),
  obs AS (
    SELECT o.id, o.payment_id, o.item_id, o.author_id, o.created_at, i.role
    FROM public.payment_observations o
    JOIN intervenors i ON i.user_id = o.author_id
    WHERE o.created_at BETWEEN p_start AND p_end
      AND (o.status_to = 'devolvido_analista'
        OR (o.item_id IS NOT NULL AND o.observation_type = 'impacta_aprovacao'::observation_type))
  ),
  candidate_items AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings, pi.is_cancelled,
           o.id AS obs_id, o.author_id, o.role, o.created_at AS obs_at
    FROM obs o JOIN public.payment_items pi ON pi.id = o.item_id
    WHERE o.item_id IS NOT NULL
    UNION ALL
    SELECT pi.id, pi.payment_id, pi.company_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings, pi.is_cancelled,
           o.id, o.author_id, o.role, o.created_at
    FROM obs o JOIN public.payment_items pi ON pi.payment_id = o.payment_id
    WHERE o.item_id IS NULL
      AND pi.validation_findings IS NOT NULL
      AND jsonb_typeof(pi.validation_findings) = 'array'
      AND jsonb_array_length(pi.validation_findings) > 0
  ),
  eligible AS (
    SELECT ci.*
    FROM candidate_items ci
    JOIN public.payments p ON p.id = ci.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = ci.payment_id
     AND (g.company_id = ci.company_id OR g.company_name = (SELECT company_name FROM public.payment_items x WHERE x.id = ci.item_id))
    WHERE ci.acatado_at IS NOT NULL
      AND ci.acatado_at > ci.obs_at
      AND ci.expected_amount IS NOT NULL AND ci.expected_amount > 0
      AND ci.gross_amount    IS NOT NULL AND ci.gross_amount    > 0
      AND ci.is_cancelled = false
      AND (g.status IS NULL OR g.status <> 'cancelado'::payment_status)
      AND p.status IN ('pago','arquivado','aprovado','aprovado_em_revisao')
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY item_id ORDER BY obs_at DESC) AS rn FROM eligible
  ),
  final_intervention AS (
    SELECT item_id, payment_id, company_id, obs_id::text AS obs_id, author_id, role, obs_at, acatado_at,
           expected_amount AS valor_regra,
           gross_amount    AS valor_pago_final,
           (expected_amount - gross_amount) AS delta
    FROM ranked WHERE rn = 1
  ),
  analyst_edits_raw AS (
    SELECT o.id AS obs_id, o.payment_id, o.item_id, o.author_id, o.created_at AS obs_at,
           NULLIF((regexp_match(o.message, 'valor:\s*([0-9]+(?:[\.,][0-9]+)?)\s*[→>]\s*([0-9]+(?:[\.,][0-9]+)?)'))[1], '') AS old_s,
           NULLIF((regexp_match(o.message, 'valor:\s*([0-9]+(?:[\.,][0-9]+)?)\s*[→>]\s*([0-9]+(?:[\.,][0-9]+)?)'))[2], '') AS new_s
    FROM public.payment_observations o
    WHERE o.created_at BETWEEN p_start AND p_end
      AND o.author_type = 'analista'::observation_author
      AND o.item_id IS NOT NULL
      AND o.message ILIKE 'Item editado pelo analista%'
  ),
  analyst_edits AS (
    SELECT ae.obs_id, ae.payment_id, ae.item_id, ae.author_id, ae.obs_at,
           replace(ae.old_s, ',', '.')::numeric AS old_val,
           replace(ae.new_s, ',', '.')::numeric AS new_val
    FROM analyst_edits_raw ae
    WHERE ae.old_s IS NOT NULL AND ae.new_s IS NOT NULL
  ),
  analyst_final AS (
    SELECT ae.item_id, ae.payment_id, pi.company_id, ae.obs_id::text AS obs_id, ae.author_id,
           'analista'::text AS role, ae.obs_at, ae.obs_at AS acatado_at,
           ae.old_val AS valor_regra, ae.new_val AS valor_pago_final,
           (ae.old_val - ae.new_val) AS delta
    FROM analyst_edits ae
    JOIN public.payment_items pi ON pi.id = ae.item_id
    JOIN public.payments p ON p.id = ae.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = ae.payment_id
     AND (g.company_id = pi.company_id OR g.company_name = pi.company_name)
    WHERE ae.old_val IS NOT NULL AND ae.new_val IS NOT NULL
      AND ae.old_val <> ae.new_val
      AND pi.is_cancelled = false
      AND (g.status IS NULL OR g.status <> 'cancelado'::payment_status)
      AND p.status <> 'cancelado'::payment_status
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  group_cancels AS (
    SELECT pi.id AS item_id, g.payment_id, pi.company_id, g.id::text AS obs_id,
           g.cancelled_by AS author_id,
           CASE WHEN g.cancellation_source = 'reconciliacao'
                THEN 'cancelamento_conciliacao'::text
                ELSE 'cancelamento_empresa'::text END AS role,
           g.cancelled_at AS obs_at, g.cancelled_at AS acatado_at,
           COALESCE(pi.gross_amount, 0) AS valor_regra,
           0::numeric AS valor_pago_final,
           COALESCE(pi.gross_amount, 0) AS delta
    FROM public.payment_company_groups g
    JOIN public.payments p ON p.id = g.payment_id
    JOIN public.payment_items pi
      ON pi.payment_id = g.payment_id
     AND (pi.company_id = g.company_id OR pi.company_name = g.company_name)
    WHERE g.cancelled_at IS NOT NULL
      AND g.cancelled_at BETWEEN p_start AND p_end
      AND g.cancellation_reactivated_at IS NULL
      AND COALESCE(pi.gross_amount, 0) > 0
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  item_cancels AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.id::text AS obs_id,
           pi.cancelled_by AS author_id,
           CASE WHEN pi.cancellation_source = 'reconciliacao'
                THEN 'cancelamento_conciliacao'::text
                ELSE 'cancelamento_item'::text END AS role,
           pi.cancelled_at AS obs_at, pi.cancelled_at AS acatado_at,
           COALESCE(pi.gross_amount, 0) AS valor_regra,
           0::numeric AS valor_pago_final,
           COALESCE(pi.gross_amount, 0) AS delta
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = pi.payment_id
     AND (g.company_id = pi.company_id OR g.company_name = pi.company_name)
    WHERE pi.is_cancelled = true
      AND pi.cancelled_at IS NOT NULL
      AND pi.cancelled_at BETWEEN p_start AND p_end
      AND pi.cancellation_reactivated_at IS NULL
      AND COALESCE(pi.gross_amount, 0) > 0
      AND (g.cancelled_at IS NULL
           OR g.cancelled_at NOT BETWEEN p_start AND p_end
           OR g.cancellation_reactivated_at IS NOT NULL)
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  final_items AS (
    SELECT * FROM final_intervention
    UNION ALL SELECT * FROM analyst_final
    UNION ALL SELECT * FROM group_cancels
    UNION ALL SELECT * FROM item_cancels
  ),
  summary AS (
    SELECT COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0)::numeric AS economia,
           COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0)::numeric AS perda,
           COALESCE(SUM(delta),0)::numeric AS saldo,
           COUNT(*)::int AS qtd_itens FROM final_items
  ),
  by_role AS (
    SELECT role, COALESCE(SUM(delta),0)::numeric AS saldo, COUNT(*)::int AS qtd
    FROM final_items GROUP BY role
  ),
  by_user AS (
    SELECT fi.author_id AS user_id,
           COALESCE(pr.full_name, pr.email, fi.author_id::text, 'Sistema') AS nome,
           fi.role, COUNT(*)::int AS qtd_itens,
           COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0)::numeric AS economia,
           COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0)::numeric AS perda,
           COALESCE(SUM(delta),0)::numeric AS saldo
    FROM final_items fi LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    WHERE fi.author_id IS NOT NULL
    GROUP BY fi.author_id, pr.full_name, pr.email, fi.role
    ORDER BY saldo DESC
  ),
  items_list AS (
    SELECT fi.item_id, fi.payment_id, fi.obs_id, fi.valor_regra, fi.valor_pago_final, fi.delta,
           fi.author_id, COALESCE(pr.full_name, pr.email, fi.author_id::text, 'Sistema') AS autor, fi.role,
           fi.obs_at, fi.acatado_at,
           pi.doctor_name, pi.procedure_code, pi.procedure_name, pi.company_name,
           pcg.id AS company_group_id
    FROM final_items fi
    LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    LEFT JOIN public.payment_items pi ON pi.id = fi.item_id
    LEFT JOIN public.payment_company_groups pcg
      ON pcg.payment_id = fi.payment_id
     AND (pcg.company_id = fi.company_id OR pcg.company_name = pi.company_name)
    ORDER BY fi.acatado_at DESC LIMIT 5000
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_role', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role br), '[]'::jsonb),
    'by_user', COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user bu), '[]'::jsonb),
    'items',   COALESCE((SELECT jsonb_agg(to_jsonb(il)) FROM items_list il), '[]'::jsonb),
    'window',  jsonb_build_object('start',p_start,'end',p_end,'hospital_id',p_hospital_id)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_intervention_savings(timestamptz, timestamptz, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_intervention_savings(timestamptz, timestamptz, uuid) FROM anon;