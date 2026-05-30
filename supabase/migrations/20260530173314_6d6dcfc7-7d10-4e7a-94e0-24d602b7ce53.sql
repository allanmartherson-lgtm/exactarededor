CREATE TABLE public.convenios (
  slug          text PRIMARY KEY,
  name          text NOT NULL,
  aliases       text[] NOT NULL DEFAULT '{}',
  active        boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  operator_code text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.convenios TO authenticated;
GRANT ALL ON public.convenios TO service_role;

ALTER TABLE public.convenios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "convenios_view_authenticated" ON public.convenios
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "convenios_manage_admin_diretor" ON public.convenios
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE INDEX idx_convenios_name ON public.convenios (lower(name));
CREATE INDEX idx_convenios_aliases ON public.convenios USING GIN (aliases);

CREATE TRIGGER trg_convenios_updated_at
  BEFORE UPDATE ON public.convenios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();