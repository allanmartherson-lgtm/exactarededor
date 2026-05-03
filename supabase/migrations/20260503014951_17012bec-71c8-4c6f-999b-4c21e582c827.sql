
CREATE TABLE public.procedure_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_tuss text NOT NULL,
  description text,
  sector_classified text NOT NULL DEFAULT 'hemodinamica',
  confidence text NOT NULL DEFAULT 'alta',
  active boolean NOT NULL DEFAULT true,
  observation text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX procedure_classifications_code_sector_uniq
  ON public.procedure_classifications (code_tuss, sector_classified);

CREATE INDEX procedure_classifications_active_idx
  ON public.procedure_classifications (active) WHERE active = true;

ALTER TABLE public.procedure_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_view_authenticated ON public.procedure_classifications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY pc_manage_admin_diretor ON public.procedure_classifications
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_procedure_classifications_updated_at
  BEFORE UPDATE ON public.procedure_classifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
