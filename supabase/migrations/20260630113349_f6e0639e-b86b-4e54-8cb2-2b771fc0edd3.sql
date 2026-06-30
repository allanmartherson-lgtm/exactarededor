DROP TRIGGER IF EXISTS trg_sync_rules_type_columns ON public.rules;
DROP FUNCTION IF EXISTS public.sync_rules_type_columns();

DROP VIEW IF EXISTS public.v_legacy_payment_type_orphans;
DROP VIEW IF EXISTS public.v_legacy_payment_type_divergence;

CREATE OR REPLACE VIEW public.v_legacy_payment_type_divergence AS
WITH base AS (
  SELECT 'payments'::text AS table_name, p.id AS row_id, p.id::text AS context_id,
         p.payment_type_id AS legacy_id, p.payment_model_id AS new_id,
         pt.code AS legacy_code, pm.code AS new_code,
         EXISTS (SELECT 1 FROM public.payment_models pm2 WHERE pm2.code = pt.code) AS legacy_has_new_equivalent
  FROM public.payments p
  LEFT JOIN public.payment_types pt ON pt.id = p.payment_type_id
  LEFT JOIN public.payment_models pm ON pm.id = p.payment_model_id
  WHERE (p.payment_type_id IS NOT NULL OR p.payment_model_id IS NOT NULL)
    AND (p.payment_type_id IS NULL OR p.payment_model_id IS NULL OR COALESCE(pt.code,'') <> COALESCE(pm.code,''))
)
SELECT *,
  CASE
    WHEN legacy_code IS NULL AND new_code IS NOT NULL THEN 'out_of_sync'
    WHEN new_code IS NULL AND legacy_has_new_equivalent IS FALSE THEN 'legacy_only_concept'
    WHEN legacy_has_new_equivalent IS FALSE THEN 'legacy_only_concept'
    ELSE 'out_of_sync'
  END AS divergence_kind
FROM base;

GRANT SELECT ON public.v_legacy_payment_type_divergence TO authenticated;
GRANT SELECT ON public.v_legacy_payment_type_divergence TO service_role;

CREATE OR REPLACE VIEW public.v_legacy_payment_type_orphans AS
SELECT * FROM public.v_legacy_payment_type_divergence
WHERE divergence_kind = 'legacy_only_concept' AND new_id IS NULL;

GRANT SELECT ON public.v_legacy_payment_type_orphans TO authenticated;
GRANT SELECT ON public.v_legacy_payment_type_orphans TO service_role;

ALTER TABLE public.rules DROP COLUMN IF EXISTS payment_type_id;
ALTER TABLE public.rules DROP COLUMN IF EXISTS payment_model_id;