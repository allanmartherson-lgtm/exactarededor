-- Filtra payment_ids órfãos no agregado do RPC get_overlap_audit
-- para que a UI não gere links quebrados para lotes já removidos.
-- Não altera contagens de risco, pacientes, dias ou itens.

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'get_overlap_audit'
    AND pg_function_is_visible(oid);

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_overlap_audit not found';
  END IF;

  v_new := replace(
    v_def,
    'array_agg(DISTINCT payment_id)                                          AS payment_ids',
    'array_agg(DISTINCT payment_id) FILTER (WHERE EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_id)) AS payment_ids'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'payment_ids agg line not found — abort to avoid silent no-op';
  END IF;

  EXECUTE v_new;
END
$mig$;