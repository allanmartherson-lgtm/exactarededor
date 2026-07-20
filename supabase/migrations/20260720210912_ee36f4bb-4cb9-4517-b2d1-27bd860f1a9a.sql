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
    'AT TIME ZONE ''America/Sao_Paulo'')::date',
    'AT TIME ZONE ''UTC'')::date'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'no BRT cast found — abort to avoid silent no-op';
  END IF;

  EXECUTE v_new;
END
$mig$;