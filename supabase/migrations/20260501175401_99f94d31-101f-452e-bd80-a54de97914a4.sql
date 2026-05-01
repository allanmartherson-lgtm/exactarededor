
-- Tabela porte → valor (CBHPM e similares)
CREATE TABLE public.reference_table_port_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_table_id UUID NOT NULL REFERENCES public.reference_tables(id) ON DELETE CASCADE,
  port TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (reference_table_id, port)
);

CREATE INDEX idx_ref_port_values_table ON public.reference_table_port_values(reference_table_id);

ALTER TABLE public.reference_table_port_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY ref_port_values_view_authenticated ON public.reference_table_port_values
  FOR SELECT TO authenticated USING (true);

CREATE POLICY ref_port_values_manage_admin_diretor ON public.reference_table_port_values
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

-- Itens da tabela: adicionar porte (CBHPM) e nº de auxiliares; tornar amount opcional
ALTER TABLE public.reference_table_items
  ADD COLUMN IF NOT EXISTS port TEXT,
  ADD COLUMN IF NOT EXISTS aux_count INTEGER,
  ALTER COLUMN amount DROP NOT NULL,
  ALTER COLUMN amount DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ref_items_code ON public.reference_table_items(reference_table_id, code);

-- Tipo de tabela: simples (valor por código) ou cbhpm (porte → valor)
DO $$ BEGIN
  CREATE TYPE public.reference_table_kind AS ENUM ('simples','cbhpm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.reference_tables
  ADD COLUMN IF NOT EXISTS kind public.reference_table_kind NOT NULL DEFAULT 'simples';

-- Regra: se deve incluir auxiliares no valor esperado (CBHPM)
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS include_auxiliaries BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auxiliary_pct NUMERIC;
