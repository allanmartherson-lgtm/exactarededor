
WITH candidates AS (
  SELECT
    rri.id AS rri_id,
    (ARRAY_AGG(pi.company_id ORDER BY pi.created_at DESC))[1] AS company_id
  FROM public.retroactive_reconciliation_items rri
  JOIN public.payment_items pi
    ON pi.attendance_number = rri.attendance
   AND pi.procedure_code    = rri.tuss_code
   AND lower(regexp_replace(coalesce(pi.doctor_name,''), '\s+', ' ', 'g')) =
       lower(regexp_replace(coalesce(rri.raw->>'doctor_name',''), '\s+', ' ', 'g'))
  WHERE rri.reconciliation_id = 'ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
    AND rri.company_id IS NULL
    AND pi.company_id IS NOT NULL
  GROUP BY rri.id
)
UPDATE public.retroactive_reconciliation_items rri
SET company_id = c.company_id, updated_at = now()
FROM candidates c
WHERE rri.id = c.rri_id;

UPDATE public.retroactive_reconciliation_items rri
SET company_id = pi.company_id, updated_at = now()
FROM public.payment_items pi
WHERE rri.reconciliation_id = 'ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
  AND rri.company_id IS NULL
  AND rri.payment_item_id = pi.id
  AND pi.company_id IS NOT NULL;

INSERT INTO public.audit_log (action, entity_type, entity_id, hospital_id, diff)
SELECT
  'backfill_company_id',
  'retroactive_reconciliation',
  'ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'::uuid,
  '28dffeb5-e0d2-48fb-951b-58419d41e372'::uuid,
  jsonb_build_object(
    'reason', 'company_id NULL bloqueava encaminhamento por PJ (Orthos e outras)',
    'items_with_company', (
      SELECT count(*) FROM public.retroactive_reconciliation_items
      WHERE reconciliation_id='ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
        AND company_id IS NOT NULL
    ),
    'items_total', (
      SELECT count(*) FROM public.retroactive_reconciliation_items
      WHERE reconciliation_id='ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
    )
  );
