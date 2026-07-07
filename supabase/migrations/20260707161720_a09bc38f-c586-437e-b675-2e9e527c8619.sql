-- 1) Backfill: preencher hospital_id nas tabelas de telemetria a partir do pagamento.
UPDATE public.analysis_telemetry t
   SET hospital_id = p.hospital_id
  FROM public.payments p
 WHERE t.hospital_id IS NULL
   AND t.payment_id = p.id
   AND p.hospital_id IS NOT NULL;

UPDATE public.analysis_dead_letter d
   SET hospital_id = p.hospital_id
  FROM public.payments p
 WHERE d.hospital_id IS NULL
   AND d.payment_id = p.id
   AND p.hospital_id IS NOT NULL;

-- 2) Trigger genérica: se hospital_id vier NULL num INSERT, preenche com
--    current_active_hospital(). Nunca sobrescreve valor explícito. Se ainda
--    assim resultar NULL (sessão sem hospital ativo), levanta EXCEPTION —
--    impede vazamento e força o chamador a resolver.
CREATE OR REPLACE FUNCTION public.enforce_hospital_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL THEN
    NEW.hospital_id := public.current_active_hospital();
  END IF;

  IF NEW.hospital_id IS NULL THEN
    RAISE EXCEPTION
      'hospital_id obrigatório em %.% — nenhum hospital ativo na sessão do usuário',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Aplicar a trigger nas tabelas operacionais críticas.
--    (Já existiam policies restrictive; agora existe também um preenchimento
--    proativo que fecha a fresta de "código esqueceu de passar hospital_id".)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'analysis_telemetry',
    'analysis_dead_letter',
    'ai_retry_queue',
    'ai_analysis_versions',
    'learned_patterns',
    'match_telemetry',
    'payment_job_context',
    'payment_pivot_cache',
    'payment_processing_jobs',
    'payments',
    'payment_items',
    'payment_company_groups'
  ]
  LOOP
    -- Só cria se a tabela existir e tiver coluna hospital_id (defensivo)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=tbl AND column_name='hospital_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.%I', tbl);
      EXECUTE format(
        'CREATE TRIGGER trg_enforce_hospital_scope
           BEFORE INSERT ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope()',
        tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- 4) Endurecer telemetria: agora que está preenchida, exigir NOT NULL nas
--    linhas novas via CHECK (evita voltar a poluir por bug futuro que
--    contorne a trigger via service_role sem sessão).
--    Backfill 100% garantido acima; se sobrar algum órfão sem payment_id,
--    apaga (é lixo de execução falha sem vínculo).
DELETE FROM public.analysis_telemetry WHERE hospital_id IS NULL;
DELETE FROM public.analysis_dead_letter WHERE hospital_id IS NULL;

ALTER TABLE public.analysis_telemetry  ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.analysis_dead_letter ALTER COLUMN hospital_id SET NOT NULL;

COMMENT ON FUNCTION public.enforce_hospital_scope() IS
  'Trigger BEFORE INSERT que preenche hospital_id a partir de current_active_hospital() quando o código chamador não passar. Se não houver hospital ativo, levanta EXCEPTION — nunca deixa linha nascer sem hospital. Ver .lovable/mem/constraints/hospital-scope-invariant.md';