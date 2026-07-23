ALTER TABLE public.intervention_ledger REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.intervention_ledger;