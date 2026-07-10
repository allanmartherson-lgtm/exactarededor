ALTER TABLE public.glosa_debts
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'glosa_manual',
  ADD COLUMN IF NOT EXISTS origem_reconciliation_item_id UUID REFERENCES public.reconciliation_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

ALTER TABLE public.glosa_debts
  DROP CONSTRAINT IF EXISTS glosa_debts_origem_check;
ALTER TABLE public.glosa_debts
  ADD CONSTRAINT glosa_debts_origem_check
  CHECK (origem IN ('glosa_manual', 'glosa_hospital', 'conciliacao_residual'));

-- Uma única dívida ativa por médica+hospital para saldos residuais de conciliação
CREATE UNIQUE INDEX IF NOT EXISTS glosa_debts_conc_residual_uidx
  ON public.glosa_debts (doctor_id, hospital_id)
  WHERE status = 'ativo' AND origem = 'conciliacao_residual';

ALTER TABLE public.reconciliation_items
  ADD COLUMN IF NOT EXISTS carry_glosa_debt_id UUID REFERENCES public.glosa_debts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_carry_glosa_debt
  ON public.reconciliation_items(carry_glosa_debt_id)
  WHERE carry_glosa_debt_id IS NOT NULL;