CREATE OR REPLACE FUNCTION public.enforce_hospital_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
BEGIN
  -- 1) valor explícito do chamador manda
  IF NEW.hospital_id IS NULL THEN
    -- 2) sessão de usuário: usa hospital ativo do servidor
    NEW.hospital_id := public.current_active_hospital();
  END IF;

  -- 3) fallback para edge functions (service_role, sem auth.uid()):
  --    se a tabela tiver payment_id preenchido, herda do pagamento.
  --    Cobre analysis_telemetry, analysis_dead_letter, ai_retry_queue,
  --    ai_analysis_versions, payment_job_context, etc.
  IF NEW.hospital_id IS NULL THEN
    BEGIN
      EXECUTE format('SELECT ($1).%I::uuid', 'payment_id') INTO v_payment_id USING NEW;
    EXCEPTION WHEN undefined_column THEN
      v_payment_id := NULL;
    END;
    IF v_payment_id IS NOT NULL THEN
      SELECT p.hospital_id INTO NEW.hospital_id
        FROM public.payments p
       WHERE p.id = v_payment_id;
    END IF;
  END IF;

  IF NEW.hospital_id IS NULL THEN
    RAISE EXCEPTION
      'hospital_id obrigatório em %.% — nenhum hospital ativo na sessão nem derivável do pagamento',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_hospital_scope() IS
  'Trigger BEFORE INSERT: preenche hospital_id na seguinte ordem — (1) valor explícito, (2) current_active_hospital() para sessões de usuário, (3) hospital do payment_id relacionado para inserções via service_role/edge functions. Falha se nenhuma origem resolver.';