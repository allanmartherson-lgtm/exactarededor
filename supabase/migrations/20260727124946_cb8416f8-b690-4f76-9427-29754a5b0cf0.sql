CREATE OR REPLACE FUNCTION public.compute_company_financial_aggregates(
  p_payment_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_pool_id uuid;
  v_base text := 'gross_amount';
  v_bruto numeric := 0;
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
    SELECT COALESCE(SUM(COALESCE(pi.gross_amount, 0)), 0)
      INTO v_bruto
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
    'pool_total', round(v_total_pool, 2),
    'minimum_complement', round(v_min_compl, 2),
    'debitos', round(v_deb, 2),
    'creditos', round(v_cred, 2),
    'glosas', round(v_glosas, 2),
    'conciliacao_aplicada', v_recon
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_company_financial_aggregates(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_company_financial_aggregates(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_company_financial_aggregates(uuid, uuid) TO service_role;