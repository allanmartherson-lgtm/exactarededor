CREATE OR REPLACE FUNCTION public.get_portal_competencia_detail(p_doctor_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bruto numeric := 0;
  v_esperado numeric := 0;
  v_glosas numeric := 0;
  v_itens jsonb;
  v_glosa_breakdown jsonb;
  v_payments jsonb;
  v_empresa_tem_pool boolean := false;
  v_empresa_liquido_total numeric;
  v_rateio_itens jsonb;
  v_rateio_quota jsonb;
  v_company_id uuid;
  v_adjust_glosas numeric := 0;
  v_adjust_breakdown jsonb := '[]'::jsonb;
  v_glosa_apps_breakdown jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Empresa vigente do médico na competência (vínculo doctor_companies).
  SELECT dc.company_id
    INTO v_company_id
    FROM public.doctor_companies dc
   WHERE dc.doctor_id = p_doctor_id
     AND (dc.start_date IS NULL OR dc.start_date <= p_competencia)
     AND (dc.end_date IS NULL OR dc.end_date >= p_competencia)
   ORDER BY dc.start_date DESC NULLS LAST
   LIMIT 1;

  -- Totais brutos e esperados do médico.
  SELECT
    COALESCE(SUM(pi.gross_amount), 0),
    COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
    INTO v_bruto, v_esperado
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.doctor_id = p_doctor_id
    AND p.competence_month = p_competencia;

  -- Glosas: aplicações de glosa direta (proposto/confirmado).
  SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
    INTO v_glosas
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND p.competence_month = p_competencia;

  -- Breakdown das glosas existentes, agora com descricao/total_parcelas (legado mantido).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'origem', 'glosa',
    'descricao', COALESCE('Glosa: ' || gd.doctor_name, 'Glosa'),
    'parcela', gpa.parcela_numero,
    'total_parcelas', COALESCE(gd.parcelas_default, 1),
    'valor', gpa.valor_aplicado,
    -- legado
    'parcela_numero', gpa.parcela_numero,
    'valor_aplicado', gpa.valor_aplicado,
    'status', gpa.status,
    'company_id', gpa.company_id,
    'applied_at', gpa.applied_at,
    'glosa_debt_id', gpa.glosa_debt_id
  )), '[]'::jsonb)
    INTO v_glosa_apps_breakdown
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
    LEFT JOIN public.glosa_debts gd ON gd.id = gpa.glosa_debt_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND p.competence_month = p_competencia;

  -- Descontos cadastrados na empresa (mensalidade, taxa, parcelamentos, etc.)
  -- atribuídos ao médico na competência. Calcula parcela vigente a partir
  -- de data_inicio + meses até a competência.
  IF v_company_id IS NOT NULL THEN
    WITH active_adjust AS (
      SELECT
        cfa.id,
        cfa.descricao,
        cfa.tipo,
        cfa.valor_total,
        cfa.parcelas_total,
        cfa.data_inicio,
        -- número da parcela vigente nessa competência (1-based)
        (
          (EXTRACT(YEAR FROM p_competencia)::int - EXTRACT(YEAR FROM cfa.data_inicio)::int) * 12
          + (EXTRACT(MONTH FROM p_competencia)::int - EXTRACT(MONTH FROM cfa.data_inicio)::int)
          + 1
        ) AS parcela_vigente,
        ROUND(cfa.valor_total / NULLIF(cfa.parcelas_total, 0), 2) AS valor_parcela
      FROM public.company_financial_adjustments cfa
      WHERE cfa.company_id = v_company_id
        AND cfa.ativo = true
        AND cfa.tipo IN ('debito','glosa_parcelada','acordo')
        AND cfa.data_inicio <= p_competencia
    )
    SELECT
      COALESCE(SUM(a.valor_parcela), 0),
      COALESCE(jsonb_agg(jsonb_build_object(
        'origem', 'desconto_empresa',
        'descricao', a.descricao,
        'parcela', a.parcela_vigente,
        'total_parcelas', a.parcelas_total,
        'valor', a.valor_parcela,
        'tipo', a.tipo,
        'adjustment_id', a.id
      )), '[]'::jsonb)
      INTO v_adjust_glosas, v_adjust_breakdown
      FROM active_adjust a
     WHERE a.parcela_vigente BETWEEN 1 AND a.parcelas_total;
  END IF;

  v_glosas := v_glosas + COALESCE(v_adjust_glosas, 0);
  v_glosa_breakdown := COALESCE(v_glosa_apps_breakdown, '[]'::jsonb)
                       || COALESCE(v_adjust_breakdown, '[]'::jsonb);

  -- Itens detalhados do médico.
  SELECT jsonb_agg(jsonb_build_object(
    'id', pi.id,
    'payment_id', pi.payment_id,
    'procedure_code', pi.procedure_code,
    'procedure_name', pi.procedure_name,
    'procedure_date', pi.procedure_date,
    'patient_name', pi.patient_name,
    'company_name', pi.company_name,
    'sector', pi.sector,
    'gross_amount', pi.gross_amount,
    'expected_amount', pi.expected_amount,
    'payment_status', p.status,
    'reference', p.reference,
    'empresa_tem_pool', COALESCE(pi.empresa_tem_pool, false),
    'empresa_liquido_total', pi.empresa_liquido_total,
    'rateio', pi.rateio
  ) ORDER BY pi.procedure_date DESC NULLS LAST)
    INTO v_itens
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month = p_competencia;

  -- Pagamentos (header).
  SELECT jsonb_agg(DISTINCT jsonb_build_object(
    'id', p.id,
    'reference', p.reference,
    'status', p.status,
    'approved_at', p.approved_at
  ))
    INTO v_payments
    FROM public.payments p
    JOIN public.payment_items pi ON pi.payment_id = p.id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month = p_competencia;

  -- Pool: só é considerado quando existe regra de rateio ATIVA na competência
  -- que vincule a empresa do médico como participante E exista um cálculo
  -- (pool_calculation_runs) para um pagamento dessa competência.
  IF v_company_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.pool_calculation_runs pcr
        JOIN public.pools pl ON pl.id = pcr.pool_id
        JOIN public.pool_participants pp
          ON pp.pool_id = pl.id
         AND pp.participant_type = 'company'
         AND pp.company_id = v_company_id
        JOIN public.payments p ON p.id = pcr.payment_id
       WHERE pl.ativo = true
         AND (pl.vigencia_inicio IS NULL OR pl.vigencia_inicio <= p_competencia)
         AND (pl.vigencia_fim    IS NULL OR pl.vigencia_fim    >= p_competencia)
         AND p.competence_month = p_competencia
         AND pcr.status <> 'revertido'
    ) INTO v_empresa_tem_pool;
  END IF;

  IF COALESCE(v_empresa_tem_pool, false) THEN
    -- Bolo líquido total (soma entre runs ativos da empresa na competência).
    SELECT COALESCE(SUM(pcr.bolo_liquido), 0)
      INTO v_empresa_liquido_total
      FROM public.pool_calculation_runs pcr
      JOIN public.pools pl ON pl.id = pcr.pool_id
      JOIN public.pool_participants pp
        ON pp.pool_id = pl.id
       AND pp.participant_type = 'company'
       AND pp.company_id = v_company_id
      JOIN public.payments p ON p.id = pcr.payment_id
     WHERE pl.ativo = true
       AND (pl.vigencia_inicio IS NULL OR pl.vigencia_inicio <= p_competencia)
       AND (pl.vigencia_fim    IS NULL OR pl.vigencia_fim    >= p_competencia)
       AND p.competence_month = p_competencia
       AND pcr.status <> 'revertido';

    -- Quota(s) do médico/empresa: extrai do array quotas a entrada cujo
    -- company_id = empresa do médico. Constrói shape detalhada por pool.
    WITH runs AS (
      SELECT pcr.id AS run_id,
             pl.id  AS pool_id,
             pl.nome AS pool_nome,
             pcr.base_amount,
             pcr.bolo_liquido,
             pcr.quotas
        FROM public.pool_calculation_runs pcr
        JOIN public.pools pl ON pl.id = pcr.pool_id
        JOIN public.pool_participants pp
          ON pp.pool_id = pl.id
         AND pp.participant_type = 'company'
         AND pp.company_id = v_company_id
        JOIN public.payments p ON p.id = pcr.payment_id
       WHERE pl.ativo = true
         AND (pl.vigencia_inicio IS NULL OR pl.vigencia_inicio <= p_competencia)
         AND (pl.vigencia_fim    IS NULL OR pl.vigencia_fim    >= p_competencia)
         AND p.competence_month = p_competencia
         AND pcr.status <> 'revertido'
    ),
    quota_rows AS (
      SELECT
        r.pool_id,
        r.pool_nome,
        r.base_amount,
        r.bolo_liquido,
        (q.elem->>'percentual')::numeric AS percentual,
        (q.elem->>'quota')::numeric      AS valor
        FROM runs r,
             LATERAL jsonb_array_elements(COALESCE(r.quotas, '[]'::jsonb)) AS q(elem)
       WHERE (q.elem->>'company_id')::uuid = v_company_id
    ),
    quota_objs AS (
      SELECT jsonb_build_object(
        'pool_id', pool_id,
        'pool_nome', pool_nome,
        'percentual', percentual,
        'valor', valor,
        'base', base_amount,
        'bolo_liquido', bolo_liquido
      ) AS obj
        FROM quota_rows
    )
    SELECT CASE
      WHEN COUNT(*) = 0 THEN NULL
      WHEN COUNT(*) = 1 THEN (SELECT obj FROM quota_objs LIMIT 1)
      ELSE jsonb_agg(obj)
    END
      INTO v_rateio_quota
      FROM quota_objs;

    -- Itens do bolo (inclusive de outros médicos): de payment_items com
    -- empresa_tem_pool=true do mesmo payment, todos os doctors da empresa.
    WITH pool_payments AS (
      SELECT DISTINCT pcr.payment_id
        FROM public.pool_calculation_runs pcr
        JOIN public.pools pl ON pl.id = pcr.pool_id
        JOIN public.pool_participants pp
          ON pp.pool_id = pl.id
         AND pp.participant_type = 'company'
         AND pp.company_id = v_company_id
        JOIN public.payments p ON p.id = pcr.payment_id
       WHERE pl.ativo = true
         AND (pl.vigencia_inicio IS NULL OR pl.vigencia_inicio <= p_competencia)
         AND (pl.vigencia_fim    IS NULL OR pl.vigencia_fim    >= p_competencia)
         AND p.competence_month = p_competencia
         AND pcr.status <> 'revertido'
    ),
    origin AS (
      SELECT DISTINCT ON (pi.id) jsonb_build_object(
        'id', pi.id,
        'data', pi.procedure_date,
        'descricao', COALESCE(pi.procedure_name, pi.description, pi.procedure_code),
        'valor', COALESCE(pi.expected_amount, pi.gross_amount, 0),
        'paciente', pi.patient_name,
        'convenio', pi.agreement_text,
        'guia', pi.attendance_number,
        'doctor_name', pi.doctor_name
      ) AS elem,
      pi.procedure_date AS sort_date
      FROM public.payment_items pi
      JOIN pool_payments pp ON pp.payment_id = pi.payment_id
      WHERE pi.company_id = v_company_id
    )
    SELECT COALESCE(jsonb_agg(elem ORDER BY sort_date DESC NULLS LAST), '[]'::jsonb)
      INTO v_rateio_itens
      FROM origin;
  END IF;

  RETURN jsonb_build_object(
    'competencia', p_competencia,
    'bruto', v_bruto,
    'esperado', v_esperado,
    'glosas', v_glosas,
    'liquido_estimado', v_esperado - v_glosas,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'glosa_breakdown', COALESCE(v_glosa_breakdown, '[]'::jsonb),
    'payments', COALESCE(v_payments, '[]'::jsonb),
    'empresa_tem_pool', COALESCE(v_empresa_tem_pool, false),
    'empresa_liquido_total', CASE WHEN COALESCE(v_empresa_tem_pool, false) THEN v_empresa_liquido_total ELSE NULL END,
    'rateio_itens', CASE WHEN COALESCE(v_empresa_tem_pool, false) THEN COALESCE(v_rateio_itens, '[]'::jsonb) ELSE NULL END,
    'rateio_quota', CASE WHEN COALESCE(v_empresa_tem_pool, false) THEN v_rateio_quota ELSE NULL END,
    'company_id', v_company_id
  );
END;
$function$;