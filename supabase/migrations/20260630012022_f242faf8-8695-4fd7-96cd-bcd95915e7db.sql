
DROP VIEW IF EXISTS public.v_legacy_payment_type_divergence;

CREATE OR REPLACE VIEW public.v_legacy_payment_type_divergence AS
WITH base AS (
  -- payment_items: legacy é payment_type, novo é item_type
  SELECT 'payment_items'::text AS table_name, pi.id AS row_id, pi.payment_id::text AS context_id,
         pi.payment_type_id AS legacy_id, pi.item_type_id AS new_id,
         pt.code AS legacy_code, it.code AS new_code,
         EXISTS (SELECT 1 FROM public.item_types it2 WHERE it2.code = pt.code) AS legacy_has_new_equivalent
  FROM public.payment_items pi
  LEFT JOIN public.payment_types pt ON pt.id = pi.payment_type_id
  LEFT JOIN public.item_types it ON it.id = pi.item_type_id
  WHERE (pi.payment_type_id IS NOT NULL OR pi.item_type_id IS NOT NULL)
    AND (pi.payment_type_id IS NULL OR pi.item_type_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(it.code,''))
  UNION ALL
  -- payments: legacy é payment_type, novo é payment_model
  SELECT 'payments', p.id, p.id::text, p.payment_type_id, p.payment_model_id, pt.code, pm.code,
         EXISTS (SELECT 1 FROM public.payment_models pm2 WHERE pm2.code = pt.code)
  FROM public.payments p
  LEFT JOIN public.payment_types pt ON pt.id = p.payment_type_id
  LEFT JOIN public.payment_models pm ON pm.id = p.payment_model_id
  WHERE (p.payment_type_id IS NOT NULL OR p.payment_model_id IS NOT NULL)
    AND (p.payment_type_id IS NULL OR p.payment_model_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(pm.code,''))
  UNION ALL
  SELECT 'rules', r.id, r.id::text, r.payment_type_id, r.payment_model_id, pt.code, pm.code,
         EXISTS (SELECT 1 FROM public.payment_models pm2 WHERE pm2.code = pt.code)
  FROM public.rules r
  LEFT JOIN public.payment_types pt ON pt.id = r.payment_type_id
  LEFT JOIN public.payment_models pm ON pm.id = r.payment_model_id
  WHERE (r.payment_type_id IS NOT NULL OR r.payment_model_id IS NOT NULL)
    AND (r.payment_type_id IS NULL OR r.payment_model_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(pm.code,''))
)
SELECT *,
  CASE
    -- legacy nulo, novo setado: sempre out_of_sync (trigger deveria ter resolvido)
    WHEN legacy_code IS NULL AND new_code IS NOT NULL THEN 'out_of_sync'
    -- legacy setado mas sem equivalente no lado novo: incompatibilidade conceitual herdada
    WHEN new_code IS NULL AND legacy_has_new_equivalent IS FALSE THEN 'legacy_only_concept'
    -- legacy setado, novo setado, mas codes diferentes E o legacy não tem equivalente:
    -- correção intencional do refactor (ex: producao → consulta)
    WHEN legacy_has_new_equivalent IS FALSE THEN 'legacy_only_concept'
    -- caso restante: deveria ter sincronizado mas não está
    ELSE 'out_of_sync'
  END AS divergence_kind
FROM base;

GRANT SELECT ON public.v_legacy_payment_type_divergence TO authenticated;
GRANT SELECT ON public.v_legacy_payment_type_divergence TO service_role;

-- View focada: só os órfãos que precisam decisão manual
CREATE OR REPLACE VIEW public.v_legacy_payment_type_orphans AS
SELECT * FROM public.v_legacy_payment_type_divergence
WHERE divergence_kind = 'legacy_only_concept' AND new_id IS NULL;

GRANT SELECT ON public.v_legacy_payment_type_orphans TO authenticated;
GRANT SELECT ON public.v_legacy_payment_type_orphans TO service_role;
