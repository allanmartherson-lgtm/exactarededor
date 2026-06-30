
ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_payment_type_source_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_payment_type_source_check
  CHECK (
    payment_type_source IS NULL OR payment_type_source = ANY (ARRAY[
      'base','report_cross','report_cross_dedup','manual','company_override',
      'default','base_tipo','auto_parecer_report',
      'auto_tuss','auto_default','auto_heuristic',
      'backfill_tuss','backfill_default','backfill_from_payment_type','inherit'
    ])
  );

-- Mesma constraint para a nova coluna item_type_source
ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_item_type_source_check
  CHECK (
    item_type_source IS NULL OR item_type_source = ANY (ARRAY[
      'manual','auto_tuss','auto_default','auto_heuristic',
      'backfill_tuss','backfill_default','backfill_from_payment_type','inherit',
      'report_cross','report_cross_dedup'
    ])
  );

-- 1) Backfill por TUSS
WITH tuss_map AS (
  SELECT
    nullif(trim(unnest(
      ARRAY[it.tuss_default] || COALESCE(it.tuss_codes_extra, ARRAY[]::text[])
    )), '') AS tuss_code,
    it.id AS item_type_id,
    it.code AS item_type_code
  FROM public.item_types it
  WHERE it.active = true
), tuss_map_distinct AS (
  SELECT DISTINCT ON (tuss_code) tuss_code, item_type_id, item_type_code
  FROM tuss_map
  WHERE tuss_code IS NOT NULL
  ORDER BY tuss_code, item_type_code
), legacy_map AS (
  SELECT code, id AS legacy_id FROM public.payment_types
)
UPDATE public.payment_items pi
SET
  item_type_id = tm.item_type_id,
  item_type_source = 'backfill_tuss',
  payment_type_id = COALESCE(lm.legacy_id, pi.payment_type_id),
  payment_type_source = COALESCE(pi.payment_type_source, 'backfill_tuss')
FROM tuss_map_distinct tm
LEFT JOIN legacy_map lm ON lm.code = tm.item_type_code
WHERE pi.item_type_id IS NULL
  AND pi.procedure_code IS NOT NULL
  AND trim(pi.procedure_code) = tm.tuss_code
  AND COALESCE(pi.payment_type_source, '') NOT IN ('manual','report_cross','report_cross_dedup');

-- 2) Default (Consulta) para os restantes
WITH defaults AS (
  SELECT
    (SELECT id FROM public.item_types WHERE is_default_when_no_tuss = true AND active = true LIMIT 1) AS default_item_type_id,
    (SELECT code FROM public.item_types WHERE is_default_when_no_tuss = true AND active = true LIMIT 1) AS default_code
), legacy_default AS (
  SELECT pt.id AS legacy_id
  FROM public.payment_types pt, defaults d
  WHERE pt.code = d.default_code
)
UPDATE public.payment_items pi
SET
  item_type_id = (SELECT default_item_type_id FROM defaults),
  item_type_source = 'backfill_default',
  payment_type_id = COALESCE(pi.payment_type_id, (SELECT legacy_id FROM legacy_default)),
  payment_type_source = COALESCE(pi.payment_type_source, 'backfill_default')
WHERE pi.item_type_id IS NULL
  AND COALESCE(pi.payment_type_source, '') NOT IN ('manual','report_cross','report_cross_dedup');

DO $$
DECLARE
  v_tuss integer; v_default integer; v_pending integer;
BEGIN
  SELECT count(*) INTO v_tuss FROM public.payment_items WHERE item_type_source = 'backfill_tuss';
  SELECT count(*) INTO v_default FROM public.payment_items WHERE item_type_source = 'backfill_default';
  SELECT count(*) INTO v_pending FROM public.payment_items WHERE item_type_id IS NULL;
  RAISE NOTICE 'Backfill final: tuss=% default=% sem_item_type_restante=%', v_tuss, v_default, v_pending;
END $$;
