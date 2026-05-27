
-- 1) Dropar constraint antiga primeiro
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.reconciliation_items'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%so_medpay%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reconciliation_items DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

-- 2) Migrar dados
UPDATE public.reconciliation_items SET status = 'so_exacta' WHERE status = 'so_medpay';

-- 3) Recriar constraint
ALTER TABLE public.reconciliation_items
  ADD CONSTRAINT reconciliation_items_status_check
  CHECK (status IN ('conciliado','valor_divergente','so_hospital','so_exacta'));

-- 4) Renomear colunas
ALTER TABLE public.reconciliation_runs RENAME COLUMN so_medpay TO so_exacta;
ALTER TABLE public.reconciliation_items RENAME COLUMN valor_medpay TO valor_exacta;
