ALTER TYPE public.reference_table_kind ADD VALUE IF NOT EXISTS 'tabela_propria';
ALTER TYPE public.reference_table_kind ADD VALUE IF NOT EXISTS 'lista_codigos';

ALTER TABLE public.reference_tables
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS notes text;