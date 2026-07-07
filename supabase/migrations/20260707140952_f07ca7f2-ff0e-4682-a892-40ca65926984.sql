
-- Escopo por hospital em convenios e convenio_aliases.
-- hospital_id NULL = compartilhado (comportamento antigo/compat).
-- hospital_id preenchido = pertence exclusivamente àquele hospital.
-- Permite mesmo slug existir em hospitais diferentes.

-- 1) convenios: adicionar hospital_id e reindexar unicidade
ALTER TABLE public.convenios
  ADD COLUMN IF NOT EXISTS hospital_id uuid NULL REFERENCES public.hospitals(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_convenios_hospital_id ON public.convenios(hospital_id);

-- Índice único composto slug + hospital (NULL tratado como sentinel)
CREATE UNIQUE INDEX IF NOT EXISTS ux_convenios_slug_hospital
  ON public.convenios (lower(slug), COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2) convenio_aliases: mesmo escopo
ALTER TABLE public.convenio_aliases
  ADD COLUMN IF NOT EXISTS hospital_id uuid NULL REFERENCES public.hospitals(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_convenio_aliases_hospital_id ON public.convenio_aliases(hospital_id);

-- Unicidade do alias por (slug, alias_normalized, hospital)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='convenio_aliases_convenio_slug_alias_normalized_key'
  ) THEN
    EXECUTE 'DROP INDEX public.convenio_aliases_convenio_slug_alias_normalized_key';
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_convenio_aliases_slug_norm_hospital
  ON public.convenio_aliases (convenio_slug, alias_normalized, COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON COLUMN public.convenios.hospital_id IS
  'NULL = convênio global (visível a todos os hospitais). UUID = exclusivo daquele hospital. Permite Santa Luzia e Helena terem carteiras diferentes.';
COMMENT ON COLUMN public.convenio_aliases.hospital_id IS
  'NULL = alias global. UUID = alias específico do hospital (não vaza para outros).';
