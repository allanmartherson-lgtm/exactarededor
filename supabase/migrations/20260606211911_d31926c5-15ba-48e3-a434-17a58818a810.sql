ALTER TABLE public.doctor_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.doctor_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'doctor_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'doctor_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_messages;
  END IF;
END $$;