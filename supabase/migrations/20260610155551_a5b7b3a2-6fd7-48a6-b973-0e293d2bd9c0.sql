ALTER TABLE public.glosa_debts ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE public.glosa_debts ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_glosa_debts_confirmed_at ON public.glosa_debts(confirmed_at) WHERE status='ativo';