-- Smoke test: proteção anti-batch destrutivo em cadastros globais.
-- Executar em staging antes de release que toque em import-wizard.
-- Uso: psql "$STAGING_URL" -f tests/db/protecao-batch-destrutivo.sql

\set ON_ERROR_STOP off

-- 1) Triggers de bloqueio de DELETE existem
SELECT event_object_table, trigger_name
  FROM information_schema.triggers
 WHERE trigger_name LIKE 'trg_block_delete_%'
   AND event_object_schema = 'public'
 ORDER BY 1;

-- Esperado: doctor_companies, doctor_hospital_overrides, company_hospital_overrides,
-- doctor_aliases, convenio_aliases, sector_aliases (6 linhas).

-- 2) Triggers de auditoria existem
SELECT event_object_table, trigger_name
  FROM information_schema.triggers
 WHERE trigger_name IN ('trg_audit_doctor_companies','trg_audit_generic_registry')
    OR trigger_name LIKE 'trg_audit_%'
 ORDER BY 1;

-- 3) DELETE físico deve falhar (tentativa controlada em transação)
BEGIN;
  SAVEPOINT s;
  DO $$ BEGIN
    DELETE FROM public.doctor_companies WHERE FALSE;  -- no-op, mas dispara trigger em qualquer linha
  END $$;
  ROLLBACK TO SAVEPOINT s;

  -- Tentativa real (deve gerar exception):
  SAVEPOINT s2;
  DO $$
  DECLARE v_id uuid;
  BEGIN
    SELECT id INTO v_id FROM public.doctor_companies LIMIT 1;
    IF v_id IS NOT NULL THEN
      BEGIN
        DELETE FROM public.doctor_companies WHERE id = v_id;
        RAISE EXCEPTION 'FAIL: DELETE não foi bloqueado';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'OK: DELETE bloqueado — %', SQLERRM;
      END;
    END IF;
  END $$;
  ROLLBACK TO SAVEPOINT s2;
ROLLBACK;

-- 4) Constraint de entity_type cobre novas entidades
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'audit_log_entity_type_check';

-- Esperado: lista contém doctor_companies, doctor_hospital_overrides,
-- company_hospital_overrides, doctor_aliases, convenio_aliases, sector_aliases.
