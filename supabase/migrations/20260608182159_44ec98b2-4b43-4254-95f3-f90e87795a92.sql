CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamptz DEFAULT (now() - interval '30 days'),
  p_end   timestamptz DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('diretor'::app_role, 'admin'::app_role, 'validador'::app_role)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH intervenors AS (
    SELECT ur.user_id, ur.role::text AS role
    FROM public.user_roles ur
    WHERE ur.role IN ('diretor'::app_role, 'validador'::app_role)
  ),
  obs AS (
    SELECT o.id, o.payment_id, o.item_id, o.author_id, o.created_at, i.role
    FROM public.payment_observations o
    JOIN intervenors i ON i.user_id = o.author_id
    WHERE o.created_at BETWEEN p_start AND p_end
      AND (
        o.status_to = 'devolvido_analista'
        OR (o.item_id IS NOT NULL AND o.observation_type IN ('reprovacao','divergencia','alerta'))
      )
  ),
  candidate_items AS (
    -- item-level obs: direct binding
    SELECT pi.id AS item_id, pi.payment_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings,
           o.id AS obs_id, o.author_id, o.role, o.created_at AS obs_at
    FROM obs o
    JOIN public.payment_items pi ON pi.id = o.item_id
    WHERE o.item_id IS NOT NULL

    UNION ALL

    -- lot-level obs: items with findings, in same payment, acatado after obs
    SELECT pi.id AS item_id, pi.payment_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings,
           o.id AS obs_id, o.author_id, o.role, o.created_at AS obs_at
    FROM obs o
    JOIN public.payment_items pi ON pi.payment_id = o.payment_id
    WHERE o.item_id IS NULL
      AND pi.validation_findings IS NOT NULL
      AND jsonb_typeof(pi.validation_findings) = 'array'
      AND jsonb_array_length(pi.validation_findings) > 0
  ),
  eligible AS (
    SELECT ci.*
    FROM candidate_items ci
    JOIN public.payments p ON p.id = ci.payment_id
    WHERE ci.acatado_at IS NOT NULL
      AND ci.acatado_at > ci.obs_at
      AND ci.expected_amount IS NOT NULL AND ci.expected_amount > 0
      AND ci.gross_amount    IS NOT NULL AND ci.gross_amount    > 0
      AND p.status IN ('pago','arquivado','aprovado','aprovado_em_revisao')
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  -- attribute item to MOST RECENT obs before acatamento
  ranked AS (
    SELECT *,
      row_number() OVER (
        PARTITION BY item_id
        ORDER BY obs_at DESC
      ) AS rn
    FROM eligible
  ),
  final_items AS (
    SELECT
      item_id, payment_id, obs_id, author_id, role, obs_at, acatado_at,
      expected_amount AS valor_regra,
      gross_amount    AS valor_pago_final,
      (expected_amount - gross_amount) AS delta -- positivo = economia (pagou menos que regra previa)
    FROM ranked
    WHERE rn = 1
  ),
  summary AS (
    SELECT
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)::numeric AS economia,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0)::numeric AS perda,
      COALESCE(SUM(delta), 0)::numeric AS saldo,
      COUNT(*)::int AS qtd_itens
    FROM final_items
  ),
  by_role AS (
    SELECT role,
      COALESCE(SUM(delta), 0)::numeric AS saldo,
      COUNT(*)::int AS qtd
    FROM final_items
    GROUP BY role
  ),
  by_user AS (
    SELECT
      fi.author_id AS user_id,
      COALESCE(pr.full_name, pr.email, fi.author_id::text) AS nome,
      fi.role,
      COUNT(*)::int AS qtd_itens,
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)::numeric AS economia,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0)::numeric AS perda,
      COALESCE(SUM(delta), 0)::numeric AS saldo
    FROM final_items fi
    LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    GROUP BY fi.author_id, pr.full_name, pr.email, fi.role
    ORDER BY saldo DESC
  ),
  items_list AS (
    SELECT
      fi.item_id, fi.payment_id, fi.obs_id,
      fi.valor_regra, fi.valor_pago_final, fi.delta,
      fi.author_id,
      COALESCE(pr.full_name, pr.email, fi.author_id::text) AS autor,
      fi.role,
      fi.obs_at, fi.acatado_at,
      pi.doctor_name, pi.procedure_code, pi.procedure_name, pi.company_name
    FROM final_items fi
    LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    LEFT JOIN public.payment_items pi ON pi.id = fi.item_id
    ORDER BY fi.acatado_at DESC
    LIMIT 5000
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_role', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role br), '[]'::jsonb),
    'by_user', COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user bu), '[]'::jsonb),
    'items',   COALESCE((SELECT jsonb_agg(to_jsonb(il)) FROM items_list il), '[]'::jsonb),
    'window',  jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', p_hospital_id)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_intervention_savings(timestamptz, timestamptz, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_intervention_savings(timestamptz, timestamptz, uuid) FROM anon;