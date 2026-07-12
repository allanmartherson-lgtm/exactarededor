CREATE OR REPLACE FUNCTION public.check_group_reconciliation_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_blocking_statuses text[] := ARRAY[
    'aguardando_validacao',
    'aguardando_aprovacao','aprovado','aprovado_com_ressalva','aprovado_parcial',
    'pedido_nf_enviado','nf_recebida','nf_conciliada','lancado','pago'
  ];
  v_bruto_regra numeric;
  v_bruto_pedido numeric;
  v_absorbido numeric;
  v_bruto_pedido_ajustado numeric;
  v_diferenca numeric;
  v_diff_pct numeric;
  v_pct numeric;
  v_abs numeric;
  v_has_override boolean;
  v_company_label text;
  v_diff_pct_str text;
  v_detail jsonb;
  v_import_mode text;
BEGIN
  IF NEW.status::text = OLD.status::text THEN RETURN NEW; END IF;
  IF NOT (NEW.status::text = ANY(v_blocking_statuses)) THEN RETURN NEW; END IF;

  -- Histórico: lote importado retroativamente para popular DRE não passa
  -- pelo fluxo de validação/aprovação/conciliação — vai direto para 'pago'.
  -- Aplicar o gate aqui travaria o motor (analyze-payment) silenciosamente.
  SELECT import_mode INTO v_import_mode FROM public.payments WHERE id = NEW.payment_id;
  IF COALESCE(v_import_mode, '') = 'historico' THEN RETURN NEW; END IF;

  -- IMPORTANTE: usar a mesma diferença calculada pela view, que já desconta
  -- gross_amount de itens absorvidos por pacote/regra fixa. A versão anterior
  -- lia a view, mas recalculava pedido - regra ignorando absorbido_total,
  -- reintroduzindo o bloqueio fantasma que a tela não mostrava.
  SELECT
    COALESCE(bruto_regra_total, 0),
    COALESCE(bruto_pedido_total, 0),
    COALESCE(absorbido_total, 0),
    COALESCE(diferenca, 0)
  INTO v_bruto_regra, v_bruto_pedido, v_absorbido, v_diferenca
  FROM public.vw_group_rule_totals
  WHERE group_id = NEW.id;

  v_bruto_regra := COALESCE(v_bruto_regra, 0);
  v_bruto_pedido := COALESCE(v_bruto_pedido, 0);
  v_absorbido := COALESCE(v_absorbido, 0);
  v_diferenca := COALESCE(v_diferenca, v_bruto_pedido - v_absorbido - v_bruto_regra);
  v_bruto_pedido_ajustado := v_bruto_pedido - v_absorbido;
  v_diff_pct := CASE
    WHEN v_bruto_pedido_ajustado = 0 THEN 0
    ELSE ABS(v_diferenca / v_bruto_pedido_ajustado) * 100
  END;

  SELECT block_pct, block_abs INTO v_pct, v_abs FROM public.get_group_block_thresholds(NEW.hospital_id);

  IF ABS(v_diferenca) <= v_abs OR v_diff_pct <= v_pct THEN RETURN NEW; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.payment_group_reconciliation_overrides o
     WHERE o.group_id = NEW.id
       AND ABS(o.bruto_regra_snapshot - v_bruto_regra) < 0.01
       AND ABS(o.bruto_pedido_snapshot - v_bruto_pedido) < 0.01
  ) INTO v_has_override;

  IF v_has_override THEN RETURN NEW; END IF;

  v_company_label := COALESCE(NULLIF(NEW.company_name, ''), 'empresa ' || COALESCE(NEW.company_id::text, NEW.id::text));
  v_diff_pct_str := to_char(round(v_diff_pct, 2), 'FM990.00');

  v_detail := jsonb_build_object(
    'kind', 'reconciliation_block',
    'group_id', NEW.id,
    'payment_id', NEW.payment_id,
    'hospital_id', NEW.hospital_id,
    'company_id', NEW.company_id,
    'company_name', v_company_label,
    'bruto_pedido', v_bruto_pedido,
    'absorbido_total', v_absorbido,
    'bruto_pedido_ajustado', v_bruto_pedido_ajustado,
    'bruto_regra', v_bruto_regra,
    'diferenca', v_diferenca,
    'diff_pct', round(v_diff_pct, 4),
    'attempted_status', NEW.status::text
  );

  RAISE EXCEPTION 'Aprovação bloqueada em "%": bruto pedido ajustado R$ % difere do bruto da regra R$ % em R$ % (%%%). Abra a empresa e registre liberação com justificativa antes de avançar.',
    v_company_label,
    to_char(v_bruto_pedido_ajustado, 'FM999999990.00'),
    to_char(v_bruto_regra,          'FM999999990.00'),
    to_char(v_diferenca,            'FM999999990.00'),
    v_diff_pct_str
    USING ERRCODE = 'check_violation', DETAIL = v_detail::text;
END
$function$;