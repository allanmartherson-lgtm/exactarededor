
CREATE OR REPLACE FUNCTION public.get_cancellation_report_detailed(
  p_start timestamptz DEFAULT (now() - interval '90 days'),
  p_end   timestamptz DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('analista'::app_role,'validador'::app_role,'diretor'::app_role,'admin'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH g AS (
    SELECT
      pg.id              AS group_id,
      pg.payment_id,
      pg.company_id,
      pg.company_name,
      pg.bruto_total,
      pg.liquido_total,
      pg.total_amount,
      pg.cancellation_reason,
      pg.cancellation_note,
      pg.cancelled_at,
      pg.cancelled_by,
      pg.cancellation_reactivated_at,
      p.hospital_id,
      p.competencia,
      p.reference_month,
      p.created_at       AS payment_created_at,
      au.email           AS autor_email,
      pr.full_name       AS autor_nome,
      (SELECT count(*) FROM public.payment_items pi
        WHERE pi.payment_id = pg.payment_id
          AND pi.company_id = pg.company_id
          AND pi.is_cancelled = true) AS items_cancelados
    FROM public.payment_company_groups pg
    JOIN public.payments p ON p.id = pg.payment_id
    LEFT JOIN auth.users au ON au.id = pg.cancelled_by
    LEFT JOIN public.profiles pr ON pr.user_id = pg.cancelled_by
    WHERE pg.cancelled_at IS NOT NULL
      AND pg.cancelled_at BETWEEN p_start AND p_end
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  by_company AS (
    SELECT
      company_id,
      max(company_name) AS company_name,
      count(*)                                                    AS qtd_grupos,
      count(*) FILTER (WHERE cancellation_reactivated_at IS NULL) AS qtd_ativos,
      count(*) FILTER (WHERE cancellation_reactivated_at IS NOT NULL) AS qtd_reativados,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount,
      sum(items_cancelados)          AS itens_cancelados,
      jsonb_agg(DISTINCT cancellation_reason::text)
        FILTER (WHERE cancellation_reason IS NOT NULL) AS motivos
    FROM g
    GROUP BY company_id
  ),
  by_payment AS (
    SELECT
      payment_id,
      max(competencia)::text     AS competencia,
      max(reference_month)       AS reference_month,
      count(*)                   AS grupos_afetados,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount,
      sum(items_cancelados)          AS itens_cancelados,
      jsonb_agg(DISTINCT cancellation_reason::text)
        FILTER (WHERE cancellation_reason IS NOT NULL) AS motivos,
      jsonb_agg(jsonb_build_object(
        'group_id', group_id,
        'company_id', company_id,
        'company_name', company_name,
        'bruto_total', bruto_total,
        'liquido_total', liquido_total,
        'total_amount', total_amount,
        'reason', cancellation_reason,
        'note', cancellation_note,
        'cancelled_at', cancelled_at,
        'reactivated', cancellation_reactivated_at IS NOT NULL,
        'autor', coalesce(autor_nome, autor_email),
        'items_cancelados', items_cancelados
      ) ORDER BY company_name) AS grupos
    FROM g
    GROUP BY payment_id
  ),
  by_reason AS (
    SELECT
      cancellation_reason::text AS reason,
      count(*)                       AS qtd,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount
    FROM g
    GROUP BY cancellation_reason
  ),
  totals AS (
    SELECT
      count(*)                                                    AS qtd_grupos,
      count(DISTINCT payment_id)                                  AS qtd_pagamentos,
      count(DISTINCT company_id)                                  AS qtd_empresas,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount,
      sum(items_cancelados)          AS itens_cancelados,
      count(*) FILTER (WHERE cancellation_reactivated_at IS NOT NULL) AS qtd_reativados
    FROM g
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', p_hospital_id),
    'totals', (SELECT to_jsonb(t.*) FROM totals t),
    'by_reason', coalesce((SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.bruto_total DESC) FROM by_reason r), '[]'::jsonb),
    'by_company', coalesce((SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.bruto_total DESC) FROM by_company c), '[]'::jsonb),
    'by_payment', coalesce((SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.bruto_total DESC) FROM by_payment p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cancellation_report_detailed(timestamptz, timestamptz, uuid) TO authenticated;
