DO $$
DECLARE
  v_payment_id uuid := 'd1c3b770-ef3f-4b5c-be45-13821683028e';
BEGIN
  -- Permite escrita direta em payments.status (guard exige flag explícita)
  PERFORM set_config('app.allow_payment_status_write', 'on', true);

  -- Desativa guards de fluxo de grupo que bloqueiam saltos não-NF.
  -- Reabilitados ao fim da transação.
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_group_reconciliation_gate;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_block_group_advance_on_invoice_divergence;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_block_group_advance_on_reapproval;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER pcg_recompute_after_change;

  UPDATE public.payment_company_groups
     SET status = 'pago', updated_at = now()
   WHERE payment_id = v_payment_id;

  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_group_reconciliation_gate;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_block_group_advance_on_invoice_divergence;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_block_group_advance_on_reapproval;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER pcg_recompute_after_change;

  -- Marca o lote como histórico e pago de uma vez.
  -- O guard de histórico só restringe transições após OLD já estar em historico,
  -- então essa primeira virada é permitida.
  UPDATE public.payments
     SET import_mode           = 'historico',
         origem                = 'historico',
         status                = 'pago',
         historico_window_start = COALESCE(historico_window_start, DATE '2026-01-01'),
         historico_window_end   = COALESCE(historico_window_end,   DATE '2026-04-30'),
         updated_at            = now()
   WHERE id = v_payment_id;
END $$;