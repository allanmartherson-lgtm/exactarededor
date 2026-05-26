ALTER TABLE public.reconciliation_items 
  ADD COLUMN IF NOT EXISTS action_taken text 
    CHECK (action_taken IN ('incorporar_credito','incorporar_debito','marcar_glosa','revisar_manual','ignorar')),
  ADD COLUMN IF NOT EXISTS action_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS action_at timestamptz,
  ADD COLUMN IF NOT EXISTS action_note text,
  ADD COLUMN IF NOT EXISTS applied_payment_item_id uuid REFERENCES public.payment_items(id),
  ADD COLUMN IF NOT EXISTS applied_payment_id uuid REFERENCES public.payments(id),
  ADD COLUMN IF NOT EXISTS valor_regra numeric;

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS item_origem text DEFAULT 'pagamento_atual'
    CHECK (item_origem IN ('pagamento_atual','conciliacao_credito','conciliacao_debito','glosa_debito')),
  ADD COLUMN IF NOT EXISTS origem_referencia text,
  ADD COLUMN IF NOT EXISTS origem_reconciliation_item_id uuid REFERENCES public.reconciliation_items(id);

ALTER TABLE public.conciliation_bases
  ADD COLUMN IF NOT EXISTS tem_itens_aplicados boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS versao int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_anterior_id uuid REFERENCES public.conciliation_bases(id);

CREATE OR REPLACE FUNCTION public.trg_block_archive_conciliation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'arquivado' AND COALESCE(OLD.tem_itens_aplicados, false) = true THEN
    RAISE EXCEPTION 'Esta base de conciliação tem itens aplicados em pagamentos e não pode ser arquivada. Crie uma nova versão da base para atualizar.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_archive_conciliation ON public.conciliation_bases;
CREATE TRIGGER trg_block_archive_conciliation
  BEFORE UPDATE OF status ON public.conciliation_bases
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_archive_conciliation();

UPDATE public.reconciliation_items ri
SET valor_regra = pi.expected_amount
FROM public.payment_items pi
WHERE ri.payment_item_id = pi.id
  AND ri.valor_regra IS NULL
  AND pi.expected_amount IS NOT NULL;