
ALTER TABLE public.invoice_questions REPLICA IDENTITY FULL;
ALTER TABLE public.payment_observations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_questions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_observations;
