
CREATE OR REPLACE VIEW public.v_payments_flow_scope AS
SELECT
  p.id AS payment_id,
  p.status,
  p.created_at,
  COALESCE(h.transitions, 0) AS transitions_count,
  COALESCE(h.passed_validation, false) AS passed_validation,
  COALESCE(h.passed_approval, false) AS passed_approval,
  (
    p.status::text IN ('pago','aprovado','aprovado_em_revisao','arquivado','nf_conciliada','nf_recebida','pedido_nf_enviado')
    AND COALESCE(h.transitions, 0) <= 2
    AND NOT COALESCE(h.passed_validation, false)
    AND NOT COALESCE(h.passed_approval, false)
  ) AS is_historical
FROM public.payments p
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS transitions,
    BOOL_OR(status_to::text = 'aguardando_validacao') AS passed_validation,
    BOOL_OR(status_to::text IN ('aguardando_aprovacao','aprovado','aprovado_em_revisao')) AS passed_approval
  FROM public.payment_status_history
  WHERE payment_id = p.id
) h ON TRUE;

GRANT SELECT ON public.v_payments_flow_scope TO authenticated, service_role;

COMMENT ON VIEW public.v_payments_flow_scope IS
'Classifica pagamentos como históricos (lançados direto sem passar por validação/aprovação). Use is_historical=false para filtrar métricas de fluxo (SLA, produtividade, intervenções, ciclo NF, anomalias). Lotes históricos continuam válidos para DRE, conciliação, pools/glosas e volumetria.';
