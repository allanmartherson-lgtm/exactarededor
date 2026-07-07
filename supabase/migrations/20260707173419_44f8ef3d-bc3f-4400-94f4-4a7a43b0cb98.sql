-- ============================================================================
-- LOTE 1 — Isolamento por hospital (banco)
-- ============================================================================

-- 1. Adiciona hospital_id em tabelas de log/auxiliares que faltavam
ALTER TABLE public.pendencia_notification_log ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id);
ALTER TABLE public.pendencia_routing_log ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id);
ALTER TABLE public.company_access_log ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id);
ALTER TABLE public.learned_pattern_events ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id);
ALTER TABLE public.specialty_audit_log ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id);
ALTER TABLE public.payment_recompute_failures ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id);

-- 2. Backfill: assume DF Star para registros históricos
DO $$
DECLARE
  v_df uuid;
BEGIN
  SELECT id INTO v_df FROM public.hospitals WHERE slug = 'df-star' LIMIT 1;
  IF v_df IS NOT NULL THEN
    UPDATE public.pendencia_notification_log SET hospital_id = v_df WHERE hospital_id IS NULL;
    UPDATE public.pendencia_routing_log     SET hospital_id = v_df WHERE hospital_id IS NULL;
    UPDATE public.company_access_log        SET hospital_id = v_df WHERE hospital_id IS NULL;
    UPDATE public.learned_pattern_events    SET hospital_id = v_df WHERE hospital_id IS NULL;
    UPDATE public.specialty_audit_log       SET hospital_id = v_df WHERE hospital_id IS NULL;
    UPDATE public.payment_recompute_failures SET hospital_id = v_df WHERE hospital_id IS NULL;
  END IF;
END $$;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_pendencia_notif_log_hospital ON public.pendencia_notification_log(hospital_id);
CREATE INDEX IF NOT EXISTS idx_pendencia_routing_log_hospital ON public.pendencia_routing_log(hospital_id);
CREATE INDEX IF NOT EXISTS idx_company_access_log_hospital ON public.company_access_log(hospital_id);
CREATE INDEX IF NOT EXISTS idx_learned_pattern_events_hospital ON public.learned_pattern_events(hospital_id);
CREATE INDEX IF NOT EXISTS idx_specialty_audit_log_hospital ON public.specialty_audit_log(hospital_id);
CREATE INDEX IF NOT EXISTS idx_payment_recompute_failures_hospital ON public.payment_recompute_failures(hospital_id);

-- 4. Triggers enforce_hospital_scope (deriva de pai + sessão ativa)
DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.pendencia_notification_log;
CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.pendencia_notification_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope();

DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.pendencia_routing_log;
CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.pendencia_routing_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope();

DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.company_access_log;
CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.company_access_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope();

DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.learned_pattern_events;
CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.learned_pattern_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope();

DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.specialty_audit_log;
CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.specialty_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope();

DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.payment_recompute_failures;
CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.payment_recompute_failures
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope();

-- 5. RLS restritiva de hospital (mantém policies existentes; adiciona escopo)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'pendencia_notification_log',
    'pendencia_routing_log',
    'company_access_log',
    'learned_pattern_events',
    'specialty_audit_log',
    'payment_recompute_failures'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS hospital_scope_restrictive ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY hospital_scope_restrictive ON public.%I AS RESTRICTIVE TO authenticated USING (public.hospital_scope_allows(hospital_id)) WITH CHECK (public.hospital_scope_allows(hospital_id))',
      t
    );
  END LOOP;
END $$;

-- 6. Enforce trigger em tabelas operacionais que já têm hospital_id mas faltavam trigger
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'special_case_marks',
    'export_log',
    'system_parameter_overrides',
    'cost_centers',
    'payout_models',
    'payout_tier_tables',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_hospital_scope ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_enforce_hospital_scope BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope()',
      t
    );
  END LOOP;
END $$;

-- 7. GRANTs (idempotente — cobre casos onde ainda não haviam sido concedidos)
GRANT SELECT, INSERT ON public.pendencia_notification_log TO authenticated;
GRANT SELECT, INSERT ON public.pendencia_routing_log TO authenticated;
GRANT SELECT, INSERT ON public.company_access_log TO authenticated;
GRANT SELECT, INSERT ON public.learned_pattern_events TO authenticated;
GRANT SELECT, INSERT ON public.specialty_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.payment_recompute_failures TO authenticated;
GRANT ALL ON public.pendencia_notification_log TO service_role;
GRANT ALL ON public.pendencia_routing_log TO service_role;
GRANT ALL ON public.company_access_log TO service_role;
GRANT ALL ON public.learned_pattern_events TO service_role;
GRANT ALL ON public.specialty_audit_log TO service_role;
GRANT ALL ON public.payment_recompute_failures TO service_role;