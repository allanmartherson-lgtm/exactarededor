ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.payment_company_groups REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_company_groups;