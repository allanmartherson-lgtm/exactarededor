
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'producao',
  ADD COLUMN IF NOT EXISTS pool_id uuid REFERENCES public.pools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pool_deduction_id uuid REFERENCES public.pool_deductions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rateio_source text,
  ADD COLUMN IF NOT EXISTS rateio_valor_total numeric;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_mode_chk;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_mode_chk CHECK (payment_mode IN ('producao','rateio'));

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_rateio_source_chk;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_rateio_source_chk CHECK (rateio_source IS NULL OR rateio_source IN ('planilha','sintetico'));

CREATE INDEX IF NOT EXISTS idx_payments_pool_id ON public.payments(pool_id) WHERE pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_pool_deduction_id ON public.payments(pool_deduction_id) WHERE pool_deduction_id IS NOT NULL;

-- Sync: pagamento de plantão vinculado a dedução variável de pool
-- alimenta automaticamente pool_deduction_values na competência.
CREATE OR REPLACE FUNCTION public.sync_plantao_to_pool_deduction_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competence date;
  v_amount numeric;
BEGIN
  IF NEW.pool_deduction_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_competence := COALESCE(NEW.competence_month, NULLIF(NEW.competence_months[1], NULL));
  IF v_competence IS NULL THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.rateio_valor_total, NEW.total_amount, 0);

  INSERT INTO public.pool_deduction_values (
    pool_deduction_id, competence_month, valor, observacao, created_by
  ) VALUES (
    NEW.pool_deduction_id,
    v_competence,
    v_amount,
    'Auto-sincronizado do pagamento ' || COALESCE(NEW.reference, NEW.id::text),
    NEW.created_by
  )
  ON CONFLICT (pool_deduction_id, competence_month)
  DO UPDATE SET
    valor = EXCLUDED.valor,
    observacao = EXCLUDED.observacao,
    updated_at = now();

  RETURN NEW;
END;
$$;

-- Garante unicidade por (dedução, competência) para suportar upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pool_deduction_values_ded_comp_uniq'
  ) THEN
    ALTER TABLE public.pool_deduction_values
      ADD CONSTRAINT pool_deduction_values_ded_comp_uniq
      UNIQUE (pool_deduction_id, competence_month);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sync_plantao_pdv ON public.payments;
CREATE TRIGGER trg_sync_plantao_pdv
AFTER INSERT OR UPDATE OF pool_deduction_id, rateio_valor_total, total_amount, competence_month
ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_plantao_to_pool_deduction_value();
