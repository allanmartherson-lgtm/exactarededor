CREATE TABLE IF NOT EXISTS public.payment_question_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.payment_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_question_reads TO authenticated;
GRANT ALL ON public.payment_question_reads TO service_role;

ALTER TABLE public.payment_question_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own reads"
  ON public.payment_question_reads
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pqr_user ON public.payment_question_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_pqr_message ON public.payment_question_reads(message_id);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_question_reads;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END$$;