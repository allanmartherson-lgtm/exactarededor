
-- =========================================================================
-- ONDA 2 — Blindagem multi-tenant
-- =========================================================================

-- 1) Backfill status_anomalies a partir do payment
UPDATE public.status_anomalies sa
SET hospital_id = p.hospital_id
FROM public.payments p
WHERE sa.payment_id = p.id
  AND sa.hospital_id IS NULL
  AND p.hospital_id IS NOT NULL;

-- 2) NOT NULL nas tabelas operacionais críticas
-- (faz em bloco; se alguma falhar por orfão remanescente, a migration aborta inteira)
ALTER TABLE public.payments              ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.payment_items         ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.payment_company_groups     ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.payment_company_financials ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.payment_observations  ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.rules                 ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.rule_calculations     ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.rule_snapshots        ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.validation_rules      ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.conciliation_bases    ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.invoices              ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.financial_journal     ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.pendencias            ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.comm_campaigns        ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.pools                 ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.glosa_batches         ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.glosa_debts           ALTER COLUMN hospital_id SET NOT NULL;
ALTER TABLE public.status_anomalies      ALTER COLUMN hospital_id SET NOT NULL;

-- 3) Função genérica: herda hospital_id do pai e bloqueia divergência
CREATE OR REPLACE FUNCTION public.enforce_hospital_id_from_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_table TEXT := TG_ARGV[0];
  parent_fk    TEXT := TG_ARGV[1];
  child_fk_val UUID;
  parent_hid   UUID;
BEGIN
  EXECUTE format('SELECT ($1).%I', parent_fk) INTO child_fk_val USING NEW;
  IF child_fk_val IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT hospital_id FROM public.%I WHERE id = $1', parent_table)
    INTO parent_hid USING child_fk_val;

  IF parent_hid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.hospital_id IS NULL THEN
    NEW.hospital_id := parent_hid;
  ELSIF NEW.hospital_id <> parent_hid THEN
    RAISE EXCEPTION 'Multi-tenant violation: % % (hospital_id=%) does not match parent %.% (hospital_id=%)',
      TG_TABLE_NAME, NEW.id, NEW.hospital_id, parent_table, child_fk_val, parent_hid;
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Triggers de herança em tabelas-filho
DROP TRIGGER IF EXISTS trg_enforce_hospital_payment_items ON public.payment_items;
CREATE TRIGGER trg_enforce_hospital_payment_items
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.payment_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

DROP TRIGGER IF EXISTS trg_enforce_hospital_payment_company_groups ON public.payment_company_groups;
CREATE TRIGGER trg_enforce_hospital_payment_company_groups
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.payment_company_groups
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

DROP TRIGGER IF EXISTS trg_enforce_hospital_payment_company_financials ON public.payment_company_financials;
CREATE TRIGGER trg_enforce_hospital_payment_company_financials
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.payment_company_financials
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

DROP TRIGGER IF EXISTS trg_enforce_hospital_payment_observations ON public.payment_observations;
CREATE TRIGGER trg_enforce_hospital_payment_observations
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.payment_observations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

DROP TRIGGER IF EXISTS trg_enforce_hospital_rule_calculations ON public.rule_calculations;
CREATE TRIGGER trg_enforce_hospital_rule_calculations
  BEFORE INSERT OR UPDATE OF hospital_id, rule_id ON public.rule_calculations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('rules', 'rule_id');

DROP TRIGGER IF EXISTS trg_enforce_hospital_rule_snapshots ON public.rule_snapshots;
CREATE TRIGGER trg_enforce_hospital_rule_snapshots
  BEFORE INSERT OR UPDATE OF hospital_id, rule_id ON public.rule_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('rules', 'rule_id');

DROP TRIGGER IF EXISTS trg_enforce_hospital_status_anomalies ON public.status_anomalies;
CREATE TRIGGER trg_enforce_hospital_status_anomalies
  BEFORE INSERT OR UPDATE OF hospital_id, payment_id ON public.status_anomalies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_id_from_parent('payments', 'payment_id');

-- 5) Índices em hospital_id (onde faltam)
CREATE INDEX IF NOT EXISTS idx_payments_hospital_id              ON public.payments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_hospital_id         ON public.payment_items(hospital_id);
CREATE INDEX IF NOT EXISTS idx_payment_company_groups_hospital_id     ON public.payment_company_groups(hospital_id);
CREATE INDEX IF NOT EXISTS idx_payment_company_financials_hospital_id ON public.payment_company_financials(hospital_id);
CREATE INDEX IF NOT EXISTS idx_payment_observations_hospital_id  ON public.payment_observations(hospital_id);
CREATE INDEX IF NOT EXISTS idx_rules_hospital_id                 ON public.rules(hospital_id);
CREATE INDEX IF NOT EXISTS idx_rule_calculations_hospital_id     ON public.rule_calculations(hospital_id);
CREATE INDEX IF NOT EXISTS idx_rule_snapshots_hospital_id        ON public.rule_snapshots(hospital_id);
CREATE INDEX IF NOT EXISTS idx_validation_rules_hospital_id      ON public.validation_rules(hospital_id);
CREATE INDEX IF NOT EXISTS idx_conciliation_bases_hospital_id    ON public.conciliation_bases(hospital_id);
CREATE INDEX IF NOT EXISTS idx_invoices_hospital_id              ON public.invoices(hospital_id);
CREATE INDEX IF NOT EXISTS idx_financial_journal_hospital_id     ON public.financial_journal(hospital_id);
CREATE INDEX IF NOT EXISTS idx_pendencias_hospital_id            ON public.pendencias(hospital_id);
CREATE INDEX IF NOT EXISTS idx_comm_campaigns_hospital_id        ON public.comm_campaigns(hospital_id);
CREATE INDEX IF NOT EXISTS idx_pools_hospital_id                 ON public.pools(hospital_id);
CREATE INDEX IF NOT EXISTS idx_glosa_batches_hospital_id         ON public.glosa_batches(hospital_id);
CREATE INDEX IF NOT EXISTS idx_glosa_debts_hospital_id           ON public.glosa_debts(hospital_id);
CREATE INDEX IF NOT EXISTS idx_status_anomalies_hospital_id      ON public.status_anomalies(hospital_id);
