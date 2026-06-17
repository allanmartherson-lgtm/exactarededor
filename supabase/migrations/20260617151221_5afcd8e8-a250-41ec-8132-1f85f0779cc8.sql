
CREATE TABLE IF NOT EXISTS public.payment_group_reconciliation_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.payment_company_groups(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL,
  bruto_regra_snapshot numeric NOT NULL,
  bruto_pedido_snapshot numeric NOT NULL,
  diferenca_snapshot numeric NOT NULL,
  justification text NOT NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pgro_group ON public.payment_group_reconciliation_overrides(group_id, created_at DESC);

GRANT SELECT, INSERT ON public.payment_group_reconciliation_overrides TO authenticated;
GRANT ALL ON public.payment_group_reconciliation_overrides TO service_role;

ALTER TABLE public.payment_group_reconciliation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read overrides in their hospital"
  ON public.payment_group_reconciliation_overrides FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_hospitals uh WHERE uh.user_id = auth.uid() AND uh.hospital_id = payment_group_reconciliation_overrides.hospital_id));

CREATE POLICY "directors_admins_insert_overrides"
  ON public.payment_group_reconciliation_overrides FOR INSERT TO authenticated
  WITH CHECK (
    approved_by = auth.uid()
    AND (public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'diretor'::public.app_role))
    AND EXISTS (SELECT 1 FROM public.user_hospitals uh WHERE uh.user_id = auth.uid() AND uh.hospital_id = payment_group_reconciliation_overrides.hospital_id)
  );

CREATE OR REPLACE VIEW public.vw_group_rule_totals AS
SELECT
  g.id AS group_id,
  g.payment_id,
  g.company_id,
  g.hospital_id,
  g.status,
  g.bruto_total AS bruto_pedido_total,
  COALESCE(SUM(pi.expected_amount), 0) AS bruto_regra_total,
  (g.bruto_total - COALESCE(SUM(pi.expected_amount), 0)) AS diferenca,
  CASE WHEN COALESCE(g.bruto_total,0) = 0 THEN NULL
       ELSE ((g.bruto_total - COALESCE(SUM(pi.expected_amount),0)) / g.bruto_total) * 100
  END AS diferenca_pct,
  COUNT(*) FILTER (WHERE pi.applied_calc_id IS NULL) AS itens_sem_regra,
  COUNT(*) FILTER (WHERE pi.expected_amount IS NOT NULL
                   AND pi.gross_amount IS NOT NULL
                   AND ABS(COALESCE(pi.expected_amount,0) - COALESCE(pi.gross_amount,0)) > 0.01) AS itens_divergentes,
  COUNT(pi.id) AS itens_total
FROM public.payment_company_groups g
LEFT JOIN public.payment_items pi
  ON pi.payment_id = g.payment_id AND pi.company_id = g.company_id
GROUP BY g.id;

GRANT SELECT ON public.vw_group_rule_totals TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_group_block_thresholds(_hospital_id uuid)
RETURNS TABLE(block_pct numeric, block_abs numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.system_configurations WHERE key = 'divergence_thresholds' LIMIT 1;
  IF v IS NULL THEN v := '{}'::jsonb; END IF;
  block_pct := COALESCE((v->>'group_block_pct')::numeric, 0.5);
  block_abs := COALESCE((v->>'group_block_abs')::numeric, 1.0);
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.check_group_reconciliation_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blocking_statuses text[] := ARRAY[
    'aguardando_aprovacao','aprovado','aprovado_com_ressalva','aprovado_parcial',
    'pedido_nf_enviado','nf_recebida','nf_conciliada','lancado','pago'
  ];
  v_bruto_regra numeric; v_bruto_pedido numeric; v_diferenca numeric;
  v_diff_pct numeric; v_pct numeric; v_abs numeric; v_has_override boolean;
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

  RAISE EXCEPTION 'Aprovação bloqueada: bruto pedido R$ % difere do bruto da regra R$ % em R$ % (%.2f%%). Registre liberação com justificativa antes de avançar.',
    to_char(v_bruto_pedido,'FM999999990.00'),
    to_char(v_bruto_regra,'FM999999990.00'),
    to_char(v_diferenca,'FM999999990.00'),
    v_diff_pct
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS trg_group_reconciliation_gate ON public.payment_company_groups;
CREATE TRIGGER trg_group_reconciliation_gate
  BEFORE UPDATE OF status ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.check_group_reconciliation_gate();

INSERT INTO public.system_configurations(key, value)
VALUES ('divergence_thresholds', jsonb_build_object('group_block_pct', 0.5, 'group_block_abs', 1.0))
ON CONFLICT (key) DO UPDATE
SET value = public.system_configurations.value
  || jsonb_build_object(
       'group_block_pct', COALESCE((public.system_configurations.value->>'group_block_pct')::numeric, 0.5),
       'group_block_abs', COALESCE((public.system_configurations.value->>'group_block_abs')::numeric, 1.0)
     );
