DO $$
BEGIN
  PERFORM set_config('app.allow_payment_status_write', 'on', true);

  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_group_reconciliation_gate;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_block_group_advance_on_invoice_divergence;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_block_group_advance_on_reapproval;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER pcg_recompute_after_change;

  UPDATE public.payment_company_groups
     SET status = 'pago', updated_at = now()
   WHERE payment_id = 'cf8b7307-fbec-4864-a7ee-8709a1f99db3';

  UPDATE public.payments
     SET status = 'pago',
         import_mode = 'historico',
         origem = 'historico',
         historico_window_start = '2026-01-01',
         historico_window_end = '2026-02-28',
         updated_at = now()
   WHERE id = 'cf8b7307-fbec-4864-a7ee-8709a1f99db3';

  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_group_reconciliation_gate;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_block_group_advance_on_invoice_divergence;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_block_group_advance_on_reapproval;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER pcg_recompute_after_change;
END $$;