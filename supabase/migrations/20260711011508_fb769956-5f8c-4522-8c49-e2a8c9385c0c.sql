
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'validation_rules',
    'reference_tables',
    'reference_table_items',
    'reference_table_port_values',
    'payout_model_rubrics',
    'feature_flags'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_block_physical_delete ON public.%I;
       CREATE TRIGGER trg_block_physical_delete
         BEFORE DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();',
      t, t
    );
  END LOOP;
END $$;
