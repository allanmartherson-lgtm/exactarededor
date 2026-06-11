CREATE TABLE public.sheet_column_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  header_signature text NOT NULL,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sheet_column_templates_hospital_signature_key
  ON public.sheet_column_templates(coalesce(hospital_id::text, '__global__'), header_signature);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sheet_column_templates TO authenticated;
GRANT ALL ON public.sheet_column_templates TO service_role;

ALTER TABLE public.sheet_column_templates ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ver templates do(s) hospital(is) a que tem acesso
-- (ou templates globais com hospital_id = NULL).
CREATE POLICY "Read templates of accessible hospitals"
  ON public.sheet_column_templates FOR SELECT TO authenticated
  USING (
    hospital_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = sheet_column_templates.hospital_id
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Insert templates for accessible hospitals"
  ON public.sheet_column_templates FOR INSERT TO authenticated
  WITH CHECK (
    hospital_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = sheet_column_templates.hospital_id
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Update templates of accessible hospitals"
  ON public.sheet_column_templates FOR UPDATE TO authenticated
  USING (
    hospital_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = sheet_column_templates.hospital_id
    )
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Delete templates by admin"
  ON public.sheet_column_templates FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_sheet_column_templates_updated_at
  BEFORE UPDATE ON public.sheet_column_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();