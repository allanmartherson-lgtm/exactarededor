-- 1. Novo valor no enum
ALTER TYPE public.reference_table_kind ADD VALUE IF NOT EXISTS 'pacote_combinacao';

-- 2. Configuração na tabela
ALTER TABLE public.reference_tables
  ADD COLUMN IF NOT EXISTS package_only_main_surgeon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_apply_auxiliaries boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS package_apply_particular boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS package_apply_intl_insurance boolean NOT NULL DEFAULT true;

-- 3. Itens — campos de pacote
ALTER TABLE public.reference_table_items
  ADD COLUMN IF NOT EXISTS package_id text,
  ADD COLUMN IF NOT EXISTS tuss_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS package_amount numeric,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_rti_package_id ON public.reference_table_items(package_id);
CREATE INDEX IF NOT EXISTS idx_rti_tuss_codes ON public.reference_table_items USING GIN(tuss_codes);