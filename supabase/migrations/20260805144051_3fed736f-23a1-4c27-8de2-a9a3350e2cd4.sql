CREATE OR REPLACE FUNCTION public.sync_payment_company_group(p_payment_id uuid, p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count int;
  v_total numeric;
  v_reprovado numeric;
  v_name text;
  v_hospital_id uuid;
  v_mode public.payment_analysis_mode;
  v_payment_mode text;
  v_payment_status public.payment_status;
  v_updated int;
  v_initial_status public.payment_status;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT hospital_id, analysis_mode, payment_mode, status
    INTO v_hospital_id, v_mode, v_payment_mode, v_payment_status
    FROM public.payments
   WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_payment_mode = 'rateio' THEN
    RETURN;
  END IF;

  SELECT count(*)::int,
         coalesce(sum(gross_amount), 0),
         coalesce(sum(
           CASE WHEN ai_status = 'reprovado'
                 AND NOT coalesce(is_cancelled, false)
                 AND NOT coalesce(package_absorbed, false)
             THEN coalesce(gross_amount, 0) ELSE 0 END
         ), 0),
         max(company_name)
    INTO v_count, v_total, v_reprovado, v_name
    FROM public.payment_items
   WHERE payment_id = p_payment_id AND company_id = p_company_id;

  IF v_hospital_id IS NULL THEN
    SELECT hospital_id INTO v_hospital_id
      FROM public.payment_items
     WHERE payment_id = p_payment_id AND hospital_id IS NOT NULL
     LIMIT 1;
  END IF;

  IF v_count = 0 THEN
    UPDATE public.payment_company_groups
       SET items_count = 0,
           total_amount = 0,
           bruto_total = 0,
           reprovado_total = 0,
           confeccao_status = CASE WHEN v_mode = 'confeccao' THEN confeccao_status ELSE NULL END,
           updated_at = now()
     WHERE payment_id = p_payment_id AND company_id = p_company_id;
    PERFORM public.ensure_payment_company_financials_row(p_payment_id, p_company_id);
    RETURN;
  END IF;

  UPDATE public.payment_company_groups
     SET items_count = v_count,
         total_amount = v_total,
         bruto_total = v_total,
         reprovado_total = v_reprovado,
         company_name = COALESCE(company_name, v_name),
         confeccao_status = CASE
           WHEN v_mode = 'confeccao' THEN confeccao_status
           ELSE NULL
         END,
         updated_at = now()
   WHERE payment_id = p_payment_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    PERFORM public.ensure_payment_company_financials_row(p_payment_id, p_company_id);
    RETURN;
  END IF;

  IF v_hospital_id IS NULL THEN RETURN; END IF;

  v_initial_status := CASE
    WHEN v_mode = 'confeccao' THEN 'rascunho'::public.payment_status
    WHEN v_payment_status = 'em_analise_ia' THEN 'em_analise_ia'::public.payment_status
    ELSE 'revisao_analista'::public.payment_status
  END;

  INSERT INTO public.payment_company_groups (
    payment_id, hospital_id, company_id, company_name,
    items_count, total_amount, bruto_total, reprovado_total, status,
    confeccao_status
  )
  VALUES (
    p_payment_id, v_hospital_id, p_company_id, coalesce(v_name, '—'),
    v_count, v_total, v_total, v_reprovado, v_initial_status,
    CASE WHEN v_mode = 'confeccao' THEN 'em_confeccao'::public.confeccao_status ELSE NULL END
  );

  PERFORM public.ensure_payment_company_financials_row(p_payment_id, p_company_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_company_financial_aggregates(p_payment_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pool_id uuid;
  v_base text := 'gross_amount';
  v_bruto numeric := 0;
  v_reprovados numeric := 0;
  v_total_pool numeric := 0;
  v_min_compl numeric := 0;
  v_deb numeric := 0;
  v_cred numeric := 0;
  v_glosas numeric := 0;
  v_recon boolean := false;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_id e company_id obrigatórios');
  END IF;

  SELECT pool_id INTO v_pool_id FROM public.payments WHERE id = p_payment_id;

  IF v_pool_id IS NOT NULL THEN
    SELECT CASE WHEN base_calculo = 'soma_expected' THEN 'expected_amount' ELSE 'gross_amount' END
      INTO v_base
    FROM public.pools WHERE id = v_pool_id;

    SELECT
      COALESCE(SUM(
        CASE WHEN NOT COALESCE(pi.is_cancelled, false)
              AND NOT COALESCE(pi.package_absorbed, false)
              AND COALESCE(pi.item_origin, '') <> 'complemento_minimo'
          THEN CASE
                 WHEN pi.gross_override_reason = 'acatado_pago' THEN COALESCE(pi.gross_amount, 0)
                 WHEN v_base = 'expected_amount' THEN COALESCE(pi.expected_amount, 0)
                 ELSE COALESCE(pi.gross_amount, 0)
               END
          ELSE 0 END
      ), 0),
      COALESCE(SUM(
        CASE WHEN NOT COALESCE(pi.is_cancelled, false)
              AND pi.item_origin = 'complemento_minimo'
              AND pi.company_id = p_company_id
          THEN COALESCE(pi.gross_amount, 0) ELSE 0 END
      ), 0)
    INTO v_total_pool, v_min_compl
    FROM public.payment_items pi
    WHERE pi.payment_id = p_payment_id AND pi.is_pool_item = true;
  ELSE
    SELECT
      COALESCE(SUM(COALESCE(pi.gross_amount, 0)), 0),
      COALESCE(SUM(CASE WHEN pi.ai_status = 'reprovado'
                        THEN COALESCE(pi.gross_amount, 0) ELSE 0 END), 0)
      INTO v_bruto, v_reprovados
    FROM public.payment_items pi
    WHERE pi.payment_id = p_payment_id
      AND pi.company_id = p_company_id
      AND NOT COALESCE(pi.is_cancelled, false)
      AND NOT COALESCE(pi.package_absorbed, false);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN a.tipo = 'credito' THEN COALESCE(caa.valor_aplicado, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.tipo = 'credito' THEN 0 ELSE COALESCE(caa.valor_aplicado, 0) END), 0)
  INTO v_cred, v_deb
  FROM public.company_adjustment_applications caa
  JOIN public.company_financial_adjustments a ON a.id = caa.adjustment_id
  WHERE caa.payment_id = p_payment_id
    AND caa.company_id = p_company_id
    AND caa.status IS DISTINCT FROM 'revertido';

  SELECT COALESCE(SUM(COALESCE(valor_aplicado, 0)), 0)
    INTO v_glosas
  FROM public.glosa_payment_applications
  WHERE payment_id = p_payment_id
    AND company_id = p_company_id
    AND COALESCE(status, '') NOT IN ('revertido', 'pending_manual_resolution');

  SELECT EXISTS (
    SELECT 1 FROM public.reconciliation_runs
    WHERE payment_id = p_payment_id AND status = 'done'
  ) INTO v_recon;

  RETURN jsonb_build_object(
    'ok', true,
    'pool_id', v_pool_id,
    'base_field', v_base,
    'bruto_simple', round(v_bruto, 2),
    'reprovados', round(v_reprovados, 2),
    'pool_total', round(v_total_pool, 2),
    'minimum_complement', round(v_min_compl, 2),
    'debitos', round(v_deb, 2),
    'creditos', round(v_cred, 2),
    'glosas', round(v_glosas, 2),
    'conciliacao_aplicada', v_recon
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_payment_company_financials_snapshot(
  p_payment_id uuid, p_company_id uuid, p_bruto numeric, p_debitos numeric,
  p_creditos numeric, p_glosas numeric, p_pool numeric, p_pool_aplicado boolean,
  p_pool_preview boolean, p_pool_detalhes jsonb, p_conciliacao numeric,
  p_conciliacao_aplicada boolean, p_liquido numeric,
  p_computed_at timestamp with time zone DEFAULT now(),
  p_computed_by uuid DEFAULT NULL::uuid,
  p_reprovados numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_id e company_id obrigatórios');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 0));

  INSERT INTO public.payment_company_financials (
    payment_id, company_id, bruto, reprovados, debitos, creditos, glosas,
    pool, pool_aplicado, pool_preview, pool_detalhes,
    conciliacao, conciliacao_aplicada, liquido, computed_at, computed_by
  ) VALUES (
    p_payment_id, p_company_id, COALESCE(p_bruto, 0), COALESCE(p_reprovados, 0),
    COALESCE(p_debitos, 0), COALESCE(p_creditos, 0), COALESCE(p_glosas, 0),
    COALESCE(p_pool, 0), COALESCE(p_pool_aplicado, false), COALESCE(p_pool_preview, false),
    COALESCE(p_pool_detalhes, '[]'::jsonb), COALESCE(p_conciliacao, 0),
    COALESCE(p_conciliacao_aplicada, false), COALESCE(p_liquido, 0),
    COALESCE(p_computed_at, now()), p_computed_by
  )
  ON CONFLICT (payment_id, company_id) DO UPDATE SET
    bruto = EXCLUDED.bruto,
    reprovados = EXCLUDED.reprovados,
    debitos = EXCLUDED.debitos,
    creditos = EXCLUDED.creditos,
    glosas = EXCLUDED.glosas,
    pool = EXCLUDED.pool,
    pool_aplicado = EXCLUDED.pool_aplicado,
    pool_preview = EXCLUDED.pool_preview,
    pool_detalhes = EXCLUDED.pool_detalhes,
    conciliacao = EXCLUDED.conciliacao,
    conciliacao_aplicada = EXCLUDED.conciliacao_aplicada,
    liquido = EXCLUDED.liquido,
    computed_at = EXCLUDED.computed_at,
    computed_by = EXCLUDED.computed_by,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_payment_liquido(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Bruto = soma dos itens (lastro da base, inclui reprovados).
  -- Reprovado = itens ai_status='reprovado' ativos e não absorvidos em pacote.
  -- Líquido = snapshot financeiro quando existir, senão bruto − reprovado.
  WITH brutos AS (
    SELECT
      pcg.id AS group_id,
      pcg.payment_id,
      pcg.company_id,
      COALESCE(SUM(pi.gross_amount), 0)::numeric(14,2) AS bruto,
      COALESCE(SUM(
        CASE WHEN pi.ai_status = 'reprovado'
              AND NOT COALESCE(pi.is_cancelled, false)
              AND NOT COALESCE(pi.package_absorbed, false)
          THEN COALESCE(pi.gross_amount, 0) ELSE 0 END
      ), 0)::numeric(14,2) AS reprovado
    FROM public.payment_company_groups pcg
    LEFT JOIN public.payment_items pi
      ON pi.payment_id = pcg.payment_id
     AND ((pcg.company_id IS NOT NULL AND pi.company_id = pcg.company_id)
          OR (pcg.company_id IS NULL AND lower(pi.company_name) = lower(pcg.company_name)))
    WHERE pcg.payment_id = _payment_id
    GROUP BY pcg.id, pcg.payment_id, pcg.company_id
  ),
  composto AS (
    SELECT
      b.group_id,
      b.bruto,
      b.reprovado,
      COALESCE(pcf.liquido, b.bruto - b.reprovado)::numeric(14,2) AS liquido
    FROM brutos b
    LEFT JOIN public.payment_company_financials pcf
      ON pcf.payment_id = b.payment_id AND pcf.company_id = b.company_id
  )
  UPDATE public.payment_company_groups pcg
     SET bruto_total = c.bruto,
         reprovado_total = c.reprovado,
         liquido_total = c.liquido,
         updated_at = now()
    FROM composto c
   WHERE pcg.id = c.group_id;

  UPDATE public.payments p
     SET bruto_total = COALESCE(s.bruto, 0),
         reprovado_total = COALESCE(s.reprovado, 0),
         liquido_total = COALESCE(s.liquido, 0),
         updated_at = now()
    FROM (
      SELECT
        payment_id,
        SUM(bruto_total)::numeric(14,2) AS bruto,
        SUM(reprovado_total)::numeric(14,2) AS reprovado,
        SUM(liquido_total)::numeric(14,2) AS liquido
      FROM public.payment_company_groups
      WHERE payment_id = _payment_id
      GROUP BY payment_id
    ) s
   WHERE p.id = _payment_id AND p.id = s.payment_id;
END;
$function$;