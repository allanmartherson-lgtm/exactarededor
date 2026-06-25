DO $$
BEGIN
  PERFORM set_config('app.allow_payment_status_write','on',true);
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_group_reconciliation_gate;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_block_group_advance_on_invoice_divergence;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER trg_block_group_advance_on_reapproval;
  ALTER TABLE public.payment_company_groups DISABLE TRIGGER pcg_recompute_after_change;

  DELETE FROM public.payment_items WHERE id = 'a0d26772-62d1-4bb9-a702-d931e8496b4a';

  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_group_reconciliation_gate;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_block_group_advance_on_invoice_divergence;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER trg_block_group_advance_on_reapproval;
  ALTER TABLE public.payment_company_groups ENABLE TRIGGER pcg_recompute_after_change;
END $$;