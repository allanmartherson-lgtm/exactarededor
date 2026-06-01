-- Função genérica: copia hospital_id do payment pai
CREATE OR REPLACE FUNCTION public.inherit_hospital_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL AND NEW.payment_id IS NOT NULL THEN
    SELECT hospital_id INTO NEW.hospital_id FROM public.payments WHERE id = NEW.payment_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Aplica em todas as tabelas filhas que têm payment_id
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'payment_items','payment_company_groups','payment_observations',
    'payment_status_history','payment_assignments','payment_unmatched_items',
    'payment_processing_jobs','ai_analysis_versions','payment_pivot_cache',
    'payment_company_financials','payment_director_notifications',
    'payment_job_context','payment_questions',
    'invoices','reconciliation_runs'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    -- Só cria trigger se a tabela tem coluna payment_id
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='payment_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_inherit_hospital ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_inherit_hospital BEFORE INSERT OR UPDATE OF payment_id ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.inherit_hospital_from_payment()', t
      );
    END IF;
  END LOOP;
END $$;

-- Trigger análogo para itens de invoice/reconciliação cujo pai não é payment direto
CREATE OR REPLACE FUNCTION public.inherit_hospital_from_invoice()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT hospital_id INTO NEW.hospital_id FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_tables text[] := ARRAY['invoice_questions','invoice_question_attachments'];
  t text;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='invoice_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_inherit_hospital ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_inherit_hospital BEFORE INSERT ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.inherit_hospital_from_invoice()', t
      );
    END IF;
  END LOOP;
END $$;

-- Item de reconciliação herda do run
CREATE OR REPLACE FUNCTION public.inherit_hospital_from_recon_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL AND NEW.run_id IS NOT NULL THEN
    SELECT hospital_id INTO NEW.hospital_id FROM public.reconciliation_runs WHERE id = NEW.run_id;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reconciliation_items' AND column_name='run_id') THEN
    DROP TRIGGER IF EXISTS trg_inherit_hospital ON public.reconciliation_items;
    CREATE TRIGGER trg_inherit_hospital BEFORE INSERT ON public.reconciliation_items
    FOR EACH ROW EXECUTE FUNCTION public.inherit_hospital_from_recon_run();
  END IF;
END $$;

-- Itens de glosa herdam do batch
CREATE OR REPLACE FUNCTION public.inherit_hospital_from_glosa_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL AND NEW.batch_id IS NOT NULL THEN
    SELECT hospital_id INTO NEW.hospital_id FROM public.glosa_batches WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='glosa_items' AND column_name='batch_id') THEN
    DROP TRIGGER IF EXISTS trg_inherit_hospital ON public.glosa_items;
    CREATE TRIGGER trg_inherit_hospital BEFORE INSERT ON public.glosa_items
    FOR EACH ROW EXECUTE FUNCTION public.inherit_hospital_from_glosa_batch();
  END IF;
END $$;