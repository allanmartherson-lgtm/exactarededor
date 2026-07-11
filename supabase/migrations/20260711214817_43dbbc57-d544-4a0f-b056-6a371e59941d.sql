
UPDATE public.retroactive_reconciliation_items rri
SET company_id = ((raw->'tvr_result'->>'matched_company_id')::uuid),
    updated_at = now()
WHERE rri.reconciliation_id = 'ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
  AND rri.company_id IS NULL
  AND raw->'tvr_result'->>'matched_company_id' IS NOT NULL
  AND raw->'tvr_result'->>'matched_company_id' <> ''
  AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = (raw->'tvr_result'->>'matched_company_id')::uuid
  );

-- Fallback via tasy_resolved_company_id (empresa vinda do TASY)
UPDATE public.retroactive_reconciliation_items rri
SET company_id = ((raw->'tvr_result'->>'tasy_resolved_company_id')::uuid),
    updated_at = now()
WHERE rri.reconciliation_id = 'ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
  AND rri.company_id IS NULL
  AND raw->'tvr_result'->>'tasy_resolved_company_id' IS NOT NULL
  AND raw->'tvr_result'->>'tasy_resolved_company_id' <> ''
  AND EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = (raw->'tvr_result'->>'tasy_resolved_company_id')::uuid
  );

INSERT INTO public.audit_log (action, entity_type, entity_id, hospital_id, diff)
VALUES (
  'backfill_company_id_from_raw',
  'retroactive_reconciliation',
  'ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'::uuid,
  '28dffeb5-e0d2-48fb-951b-58419d41e372'::uuid,
  jsonb_build_object(
    'reason', 'raw.tvr_result.matched_company_id não estava sendo persistido em rri.company_id',
    'items_with_company', (
      SELECT count(*) FROM public.retroactive_reconciliation_items
      WHERE reconciliation_id='ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
        AND company_id IS NOT NULL
    ),
    'items_total', (
      SELECT count(*) FROM public.retroactive_reconciliation_items
      WHERE reconciliation_id='ae5de1cf-61b6-4f6c-8665-df50d6a3e7c0'
    )
  )
);
