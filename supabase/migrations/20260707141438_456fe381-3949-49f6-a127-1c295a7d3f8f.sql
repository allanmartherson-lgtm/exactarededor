
ALTER TABLE public.sectors
  ADD COLUMN IF NOT EXISTS hospital_id uuid NULL REFERENCES public.hospitals(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sectors_hospital_id ON public.sectors(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sectors_slug_hospital
  ON public.sectors (lower(slug), COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.sector_aliases
  ADD COLUMN IF NOT EXISTS hospital_id uuid NULL REFERENCES public.hospitals(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sector_aliases_hospital_id ON public.sector_aliases(hospital_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='sector_aliases_sector_slug_alias_normalized_key') THEN
    EXECUTE 'DROP INDEX public.sector_aliases_sector_slug_alias_normalized_key';
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sector_aliases_slug_norm_hospital
  ON public.sector_aliases (sector_slug, alias_normalized, COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON COLUMN public.sectors.hospital_id IS
  'NULL = setor global (visível a todos os hospitais). UUID = exclusivo daquele hospital.';
COMMENT ON COLUMN public.sector_aliases.hospital_id IS
  'NULL = alias global. UUID = alias específico do hospital (não vaza para outros).';
