ALTER TABLE public.rules
ADD COLUMN IF NOT EXISTS exception_table_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.rules.exception_table_ids IS
'IDs de reference_tables (purpose IN (sem_acordo, exclusao)) vinculadas a esta regra. Tabelas só têm efeito no motor quando vinculadas explicitamente a uma regra.';