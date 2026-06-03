ALTER TABLE public.doctor_companies REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_companies;