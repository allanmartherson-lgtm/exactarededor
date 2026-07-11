WITH candidatos AS (
  SELECT cfa.id
  FROM public.company_financial_adjustments cfa
  JOIN public.companies c ON c.id = cfa.company_id
  WHERE c.name ILIKE '%OTOEX%'
    AND cfa.origem ILIKE '%auto:%'
    AND EXISTS (
      SELECT 1
      FROM public.company_adjustment_applications caa
      JOIN public.payments p ON p.id = caa.payment_id
      WHERE caa.adjustment_id = cfa.id
        AND caa.status = 'proposto'
        AND p.status IN ('pago','arquivado','lancado','nf_conciliada','pedido_nf_enviado','nf_recebida','aprovado','aprovado_com_ressalva','aprovado_parcial','cancelado','rejeitado')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_adjustment_applications caa
      JOIN public.payments p ON p.id = caa.payment_id
      WHERE caa.adjustment_id = cfa.id
        AND p.reference ILIKE '%mai%2026%'
    )
), snapshots AS (
  SELECT
    cfa.*,
    COALESCE(jsonb_agg(to_jsonb(caa) ORDER BY caa.applied_at DESC) FILTER (WHERE caa.id IS NOT NULL), '[]'::jsonb) AS apps_snapshot
  FROM public.company_financial_adjustments cfa
  JOIN candidatos x ON x.id = cfa.id
  LEFT JOIN public.company_adjustment_applications caa ON caa.adjustment_id = cfa.id
  GROUP BY cfa.id
)
INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, company_id, hospital_id, diff, created_at)
SELECT
  'company',
  company_id,
  'delete',
  NULL,
  company_id,
  hospital_id,
  jsonb_build_object(
    'entity', 'company_financial_adjustment',
    'adjustment_id', id,
    'reason', 'Limpeza de propostas indevidas OTOEX em lotes finalizados',
    'adjustment_snapshot', to_jsonb(snapshots) - 'apps_snapshot',
    'applications_deleted', apps_snapshot
  ),
  now()
FROM snapshots;

WITH candidatos AS (
  SELECT cfa.id
  FROM public.company_financial_adjustments cfa
  JOIN public.companies c ON c.id = cfa.company_id
  WHERE c.name ILIKE '%OTOEX%'
    AND cfa.origem ILIKE '%auto:%'
    AND EXISTS (
      SELECT 1
      FROM public.company_adjustment_applications caa
      JOIN public.payments p ON p.id = caa.payment_id
      WHERE caa.adjustment_id = cfa.id
        AND caa.status = 'proposto'
        AND p.status IN ('pago','arquivado','lancado','nf_conciliada','pedido_nf_enviado','nf_recebida','aprovado','aprovado_com_ressalva','aprovado_parcial','cancelado','rejeitado')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_adjustment_applications caa
      JOIN public.payments p ON p.id = caa.payment_id
      WHERE caa.adjustment_id = cfa.id
        AND p.reference ILIKE '%mai%2026%'
    )
)
DELETE FROM public.company_financial_adjustments cfa
USING candidatos x
WHERE cfa.id = x.id;