
-- =====================================================================
-- D3.e.4 — Remoção das colunas legadas payment_type_id e afins
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Snapshots de segurança (rollback manual em até 30 dias)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_d3e4_payments AS
  SELECT id, payment_type_id, payment_model_id,
         mixed_parecer_payment_type_id, mixed_parecer_item_type_id,
         now() AS backed_up_at
    FROM public.payments;

CREATE TABLE IF NOT EXISTS public._backup_d3e4_companies AS
  SELECT id, default_payment_type_id, default_item_type_id,
         now() AS backed_up_at
    FROM public.companies;

CREATE TABLE IF NOT EXISTS public._backup_d3e4_cfa AS
  SELECT id, payment_type_ids, payment_model_ids,
         now() AS backed_up_at
    FROM public.company_financial_adjustments;

COMMENT ON TABLE public._backup_d3e4_payments  IS 'Snapshot D3.e.4 (jun/2026). Drop manual após 30 dias.';
COMMENT ON TABLE public._backup_d3e4_companies IS 'Snapshot D3.e.4 (jun/2026). Drop manual após 30 dias.';
COMMENT ON TABLE public._backup_d3e4_cfa       IS 'Snapshot D3.e.4 (jun/2026). Drop manual após 30 dias.';

-- ---------------------------------------------------------------------
-- 2) Drop dos triggers e funções de sincronização
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS sync_payments_mixed_parecer_columns        ON public.payments;
DROP TRIGGER IF EXISTS trg_sync_payments_mixed_parecer_columns    ON public.payments;
DROP FUNCTION IF EXISTS public.sync_payments_mixed_parecer_columns() CASCADE;

DROP TRIGGER IF EXISTS sync_companies_default_type_columns        ON public.companies;
DROP TRIGGER IF EXISTS trg_sync_companies_default_type_columns    ON public.companies;
DROP FUNCTION IF EXISTS public.sync_companies_default_type_columns() CASCADE;

DROP TRIGGER IF EXISTS sync_cfa_payment_model_ids                 ON public.company_financial_adjustments;
DROP TRIGGER IF EXISTS trg_sync_cfa_payment_model_ids             ON public.company_financial_adjustments;
DROP FUNCTION IF EXISTS public.sync_cfa_payment_model_ids()       CASCADE;

-- Caso ainda exista o sync legado payments.payment_type_id ↔ payment_model_id
DROP TRIGGER  IF EXISTS sync_payments_type_columns       ON public.payments;
DROP TRIGGER  IF EXISTS trg_sync_payments_type_columns   ON public.payments;
DROP FUNCTION IF EXISTS public.sync_payments_type_columns() CASCADE;

-- ---------------------------------------------------------------------
-- 3) Drop das colunas legadas
--    (CASCADE remove FKs e índices dedicados)
-- ---------------------------------------------------------------------
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS payment_type_id CASCADE,
  DROP COLUMN IF EXISTS mixed_parecer_payment_type_id CASCADE;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS default_payment_type_id CASCADE;

ALTER TABLE public.company_financial_adjustments
  DROP COLUMN IF EXISTS payment_type_ids CASCADE;

-- ---------------------------------------------------------------------
-- 4) Comentários canônicos
-- ---------------------------------------------------------------------
COMMENT ON COLUMN public.payments.payment_model_id IS
  'Modelo de pagamento do lote (FK payment_models). Coluna única após D3.e.4 (jun/2026); substituiu payment_type_id.';

COMMENT ON COLUMN public.payments.mixed_parecer_item_type_id IS
  'Subtipo de parecer destino quando lote misto. Coluna única após D3.e.4; substituiu mixed_parecer_payment_type_id.';

COMMENT ON COLUMN public.companies.default_item_type_id IS
  'Default de tipo de item para a empresa. Coluna única após D3.e.4; substituiu default_payment_type_id.';

COMMENT ON COLUMN public.company_financial_adjustments.payment_model_ids IS
  'Restringe aplicação do ajuste a modelos de pagamento específicos. Coluna única após D3.e.4; substituiu payment_type_ids.';

COMMIT;
