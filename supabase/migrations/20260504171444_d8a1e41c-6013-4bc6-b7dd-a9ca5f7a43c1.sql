-- Finalidade da tabela de referência
ALTER TABLE public.reference_tables
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'calculo',
  ADD COLUMN IF NOT EXISTS exclusion_severity text NOT NULL DEFAULT 'bloqueio',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- valida valores aceitos
DO $$ BEGIN
  ALTER TABLE public.reference_tables
    ADD CONSTRAINT reference_tables_purpose_chk
    CHECK (purpose IN ('calculo','classificacao','exclusao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reference_tables
    ADD CONSTRAINT reference_tables_excl_sev_chk
    CHECK (exclusion_severity IN ('bloqueio','aviso','info'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- índice para varredura de exclusão por código
CREATE INDEX IF NOT EXISTS idx_ref_items_code ON public.reference_table_items (code);