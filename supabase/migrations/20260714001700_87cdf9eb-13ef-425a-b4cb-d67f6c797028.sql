ALTER TABLE public.payment_items
  DROP CONSTRAINT payment_items_item_type_source_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_item_type_source_check
  CHECK (
    item_type_source IS NULL OR item_type_source = ANY (ARRAY[
      'manual','auto_tuss','auto_default','auto_heuristic',
      'backfill_tuss','backfill_default','backfill_from_payment_type',
      'inherit','report_cross','report_cross_dedup',
      'ambiguous_tuss'
    ])
  );