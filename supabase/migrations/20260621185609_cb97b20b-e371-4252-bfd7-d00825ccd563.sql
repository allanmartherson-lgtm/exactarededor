CREATE OR REPLACE FUNCTION public.check_group_reconciliation_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blocking_statuses text[] := ARRAY[
    'aguardando_aprovacao','aprovado','aprovado_com_ressalva','aprovado_parcial',
    'pedido_nf_enviado','nf_recebida','nf_conciliada','lancado','pago'
  ];
  v_bruto_regra numeric; v_bruto_pedido numeric; v_diferenca numeric;
  v_diff_pct numeric; v_pct numeric; v_abs numeric; v_has_override boolean;
  v_company_label text;
BEGIN
  IF NEW.status::text = OLD.status::text THEN RETURN NEW; END IF;
  IF NOT (NEW.status::text = ANY(v_blocking_statuses)) THEN RETURN NEW; END IF;

  SELECT bruto_regra_total, COALESCE(bruto_pedido_total,0)
    INTO v_bruto_regra, v_bruto_pedido
  FROM public.vw_group_rule_totals WHERE group_id = NEW.id;

  v_bruto_regra := COALESCE(v_bruto_regra, 0);
  v_diferenca := v_bruto_pedido - v_bruto_regra;
  v_diff_pct := CASE WHEN v_bruto_pedido = 0 THEN 0 ELSE ABS(v_diferenca / v_bruto_pedido) * 100 END;

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

  RAISE EXCEPTION 'Aprovação bloqueada em "%": bruto pedido R$ % difere do bruto da regra R$ % em R$ % (%.2f%%). Abra a empresa e registre liberação com justificativa antes de avançar.',
    v_company_label,
    to_char(v_bruto_pedido,'FM999999990.00'),
    to_char(v_bruto_regra,'FM999999990.00'),
    to_char(v_diferenca,'FM999999990.00'),
    v_diff_pct
    USING ERRCODE = 'check_violation';
END $$;