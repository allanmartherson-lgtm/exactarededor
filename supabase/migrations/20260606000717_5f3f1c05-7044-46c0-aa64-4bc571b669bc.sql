
DROP POLICY IF EXISTS "empresa lê payments via invoice liberada" ON public.payments;
CREATE POLICY "empresa lê payments via invoice liberada"
ON public.payments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.invoices i
  JOIN public.company_portal_users cpu ON cpu.company_id = i.company_id
  WHERE i.payment_id = payments.id
    AND i.sent_at IS NOT NULL
    AND i.status <> 'cancelada'
    AND cpu.user_id = auth.uid()
    AND cpu.active
));

DROP POLICY IF EXISTS "empresa lê seus payment_items via invoice liberada" ON public.payment_items;
CREATE POLICY "empresa lê seus payment_items via invoice liberada"
ON public.payment_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.invoices i
  JOIN public.company_portal_users cpu ON cpu.company_id = i.company_id
  WHERE i.payment_id = payment_items.payment_id
    AND i.company_id = payment_items.company_id
    AND i.sent_at IS NOT NULL
    AND i.status <> 'cancelada'
    AND cpu.user_id = auth.uid()
    AND cpu.active
));

DROP POLICY IF EXISTS "empresa lê seu snapshot financeiro" ON public.payment_company_financials;
CREATE POLICY "empresa lê seu snapshot financeiro"
ON public.payment_company_financials FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.invoices i
  JOIN public.company_portal_users cpu ON cpu.company_id = i.company_id
  WHERE i.payment_id = payment_company_financials.payment_id
    AND i.company_id = payment_company_financials.company_id
    AND i.sent_at IS NOT NULL
    AND i.status <> 'cancelada'
    AND cpu.user_id = auth.uid()
    AND cpu.active
));
