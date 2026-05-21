CREATE TABLE public.conciliation_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL,
  competence_month text,
  file_name text,
  sheet_name text DEFAULT 'Cirurgias e Procedimentos',
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz DEFAULT now(),
  total_rows integer DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  raw_data jsonb,
  col_map jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.conciliation_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON public.conciliation_bases FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_conciliation_bases_status ON public.conciliation_bases(status);