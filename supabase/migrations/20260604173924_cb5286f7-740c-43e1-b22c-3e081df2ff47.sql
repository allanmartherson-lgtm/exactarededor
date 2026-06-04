
CREATE OR REPLACE FUNCTION public.payments_kpis(_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_statuses text[]    := NULLIF(ARRAY(SELECT jsonb_array_elements_text(_filters->'statuses')), ARRAY[]::text[]);
  v_types text[]       := NULLIF(ARRAY(SELECT jsonb_array_elements_text(_filters->'payment_types')), ARRAY[]::text[]);
  v_created uuid[]     := NULLIF(ARRAY(SELECT (jsonb_array_elements_text(_filters->'created_by_ids'))::uuid), ARRAY[]::uuid[]);
  v_companies uuid[]   := NULLIF(ARRAY(SELECT (jsonb_array_elements_text(_filters->'company_ids'))::uuid), ARRAY[]::uuid[]);
  v_doctors uuid[]     := NULLIF(ARRAY(SELECT (jsonb_array_elements_text(_filters->'doctor_ids'))::uuid), ARRAY[]::uuid[]);
  v_comp_from date     := NULLIF(_filters->>'competence_from','')::date;
  v_comp_to date       := NULLIF(_filters->>'competence_to','')::date;
  v_search text        := NULLIF(_filters->>'search','');
  v_only_overdue bool  := COALESCE((_filters->>'only_overdue')::bool, false);
  v_only_open_q bool   := COALESCE((_filters->>'only_open_questions')::bool, false);
  v_only_div bool      := COALESCE((_filters->>'only_divergence')::bool, false);
  v_with_q text        := NULLIF(_filters->>'with_questions','');
  result jsonb;
BEGIN
  WITH base AS (
    SELECT p.*
    FROM payments p
    LEFT JOIN mv_payments_flags f ON f.payment_id = p.id
    WHERE (v_statuses IS NULL OR p.status::text = ANY(v_statuses))
      AND (v_types IS NULL OR p.payment_type::text = ANY(v_types))
      AND (v_created IS NULL OR p.created_by = ANY(v_created))
      AND (v_comp_from IS NULL OR (p.competence_month >= v_comp_from OR EXISTS (
        SELECT 1 FROM unnest(p.competence_months) cm WHERE cm::date >= v_comp_from
      )))
      AND (v_comp_to IS NULL OR (p.competence_month <= v_comp_to OR EXISTS (
        SELECT 1 FROM unnest(p.competence_months) cm WHERE cm::date <= v_comp_to
      )))
      AND (v_companies IS NULL OR EXISTS (
        SELECT 1 FROM payment_company_groups g WHERE g.payment_id = p.id AND g.company_id = ANY(v_companies)
      ))
      AND (v_doctors IS NULL OR EXISTS (
        SELECT 1 FROM payment_items pi WHERE pi.payment_id = p.id AND pi.doctor_id = ANY(v_doctors)
      ))
      AND (v_search IS NULL OR p.reference ILIKE '%'||v_search||'%' OR p.reference % v_search)
      AND (NOT v_only_overdue OR COALESCE(f.is_overdue, false))
      AND (NOT v_only_open_q OR COALESCE(f.has_open_question, false))
      AND (NOT v_only_div OR COALESCE(f.has_divergence, false))
      AND (v_with_q IS NULL OR v_with_q = 'all'
           OR (v_with_q = 'with' AND COALESCE(f.has_open_question, false))
           OR (v_with_q = 'without' AND NOT COALESCE(f.has_open_question, false)))
  ),
  comp_counts AS (
    SELECT to_char(COALESCE(competence_month, competence_months[1])::date, 'YYYY-MM') AS c, count(*) n
    FROM base
    WHERE competence_month IS NOT NULL OR (competence_months IS NOT NULL AND array_length(competence_months,1) > 0)
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'totalOpen', COALESCE((SELECT sum(total_amount) FROM base), 0),
    'activeTotal', (SELECT count(*) FROM base),
    -- Fila do analista/validador: inclui estados intermediários equivalentes
    'waitingValidation', (SELECT count(*) FROM base WHERE status::text IN (
        'revisao_analista','concluida_analista','aguardando_validacao','devolvido_analista'
    )),
    -- Fila do diretor: inclui aprovação em revisão/parcial
    'waitingApproval', (SELECT count(*) FROM base WHERE status::text IN (
        'aguardando_aprovacao','aprovado_em_revisao','aprovado_parcial'
    )),
    -- Pós-aprovação: ciclo de NF
    'postApproval', (SELECT count(*) FROM base WHERE status::text IN (
        'aprovado','aprovado_com_ressalva','revisao_pos_aprovacao',
        'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente','nf_conciliada'
    )),
    'delayed', (SELECT count(*) FROM base b
                LEFT JOIN mv_payments_flags f ON f.payment_id = b.id
                WHERE COALESCE(f.is_overdue, false)),
    'competence', (SELECT c FROM comp_counts)
  ) INTO result;

  RETURN result;
END;
$function$;
