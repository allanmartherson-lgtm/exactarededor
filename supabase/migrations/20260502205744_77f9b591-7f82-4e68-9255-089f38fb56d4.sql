-- Garante REPLICA IDENTITY FULL para que payloads UPDATE/DELETE tragam todos os campos
ALTER TABLE public.payment_observations REPLICA IDENTITY FULL;
ALTER TABLE public.invoice_questions REPLICA IDENTITY FULL;

-- Adiciona à publication do realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_observations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_questions;