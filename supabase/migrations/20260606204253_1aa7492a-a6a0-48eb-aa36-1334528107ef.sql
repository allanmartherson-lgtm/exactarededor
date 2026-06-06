ALTER TABLE public.pendencias REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pendencias;