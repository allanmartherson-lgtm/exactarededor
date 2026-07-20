-- Limpeza de payment_items órfãos (payment_id sem pai em payments).
-- Triggers de recomputo são desabilitados apenas durante o DELETE porque
-- não há payment/company_group para recomputar; ao terminar, restaura.

DO $$
DECLARE
  v_deleted bigint;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  DELETE FROM public.payment_items
   WHERE payment_id NOT IN (SELECT id FROM public.payments);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'Órfãos removidos: %', v_deleted;

  SET LOCAL session_replication_role = 'origin';
END $$;