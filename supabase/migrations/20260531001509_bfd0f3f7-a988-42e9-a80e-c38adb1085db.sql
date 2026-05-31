
CREATE TYPE public.user_company_marker AS ENUM ('pinned', 'waiting', 'reviewed');

CREATE TABLE public.user_company_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.payment_company_groups(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  marker public.user_company_marker NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_id)
);

CREATE INDEX idx_user_company_notes_user_payment ON public.user_company_notes(user_id, payment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_notes TO authenticated;
GRANT ALL ON public.user_company_notes TO service_role;

ALTER TABLE public.user_company_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notes"
  ON public.user_company_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own notes"
  ON public.user_company_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own notes"
  ON public.user_company_notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own notes"
  ON public.user_company_notes FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_company_notes_updated_at
  BEFORE UPDATE ON public.user_company_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
