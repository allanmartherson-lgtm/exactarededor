-- Enum tipo de regra
CREATE TYPE public.rule_type AS ENUM ('informativo','pacote','tabela_diferenciada','bonus','complemento');

ALTER TABLE public.rules
  ADD COLUMN rule_type public.rule_type NOT NULL DEFAULT 'informativo',
  ADD COLUMN package_amount numeric,
  ADD COLUMN bonus_amount numeric,
  ADD COLUMN bonus_pct numeric,
  ADD COLUMN target_amount numeric,
  ADD COLUMN reference_table_id uuid,
  ADD COLUMN multiplier numeric,
  ADD COLUMN deflator_pct numeric,
  ADD COLUMN procedure_codes text[];

-- Tabelas de referência
CREATE TABLE public.reference_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  year integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reference_table_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_table_id uuid NOT NULL REFERENCES public.reference_tables(id) ON DELETE CASCADE,
  code text NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ref_items_table ON public.reference_table_items(reference_table_id);
CREATE INDEX idx_ref_items_code ON public.reference_table_items(reference_table_id, code);

ALTER TABLE public.rules
  ADD CONSTRAINT rules_reference_table_fk FOREIGN KEY (reference_table_id)
  REFERENCES public.reference_tables(id) ON DELETE SET NULL;

ALTER TABLE public.reference_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_table_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ref_tables_view_authenticated" ON public.reference_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_tables_manage_admin_diretor" ON public.reference_tables FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor'));

CREATE POLICY "ref_items_view_authenticated" ON public.reference_table_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_items_manage_admin_diretor" ON public.reference_table_items FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'diretor'));

CREATE TRIGGER ref_tables_touch BEFORE UPDATE ON public.reference_tables
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();