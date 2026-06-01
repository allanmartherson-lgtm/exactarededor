
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.normalize_alias(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
    regexp_replace(
      lower(unaccent(coalesce(t, ''))),
      '\s+', ' ', 'g'
    ),
    ''
  )
$$;

-- doctor_aliases
CREATE TABLE IF NOT EXISTS public.doctor_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  alias_text text NOT NULL,
  alias_normalized text GENERATED ALWAYS AS (public.normalize_alias(alias_text)) STORED,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','import')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS doctor_aliases_norm_uq ON public.doctor_aliases(alias_normalized);
CREATE INDEX IF NOT EXISTS doctor_aliases_doctor_idx ON public.doctor_aliases(doctor_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_aliases TO authenticated;
GRANT ALL ON public.doctor_aliases TO service_role;
ALTER TABLE public.doctor_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_aliases_select_auth" ON public.doctor_aliases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "doctor_aliases_write_staff" ON public.doctor_aliases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analista'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analista'));

-- convenio_aliases (parent uses slug as PK)
CREATE TABLE IF NOT EXISTS public.convenio_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_slug text NOT NULL REFERENCES public.convenios(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  alias_text text NOT NULL,
  alias_normalized text GENERATED ALWAYS AS (public.normalize_alias(alias_text)) STORED,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','import')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS convenio_aliases_norm_uq ON public.convenio_aliases(alias_normalized);
CREATE INDEX IF NOT EXISTS convenio_aliases_convenio_idx ON public.convenio_aliases(convenio_slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.convenio_aliases TO authenticated;
GRANT ALL ON public.convenio_aliases TO service_role;
ALTER TABLE public.convenio_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "convenio_aliases_select_auth" ON public.convenio_aliases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "convenio_aliases_write_staff" ON public.convenio_aliases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analista'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analista'));

-- sector_aliases (parent uses slug as PK)
CREATE TABLE IF NOT EXISTS public.sector_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_slug text NOT NULL REFERENCES public.sectors(slug) ON DELETE CASCADE ON UPDATE CASCADE,
  alias_text text NOT NULL,
  alias_normalized text GENERATED ALWAYS AS (public.normalize_alias(alias_text)) STORED,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','import')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sector_aliases_norm_uq ON public.sector_aliases(alias_normalized);
CREATE INDEX IF NOT EXISTS sector_aliases_sector_idx ON public.sector_aliases(sector_slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sector_aliases TO authenticated;
GRANT ALL ON public.sector_aliases TO service_role;
ALTER TABLE public.sector_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sector_aliases_select_auth" ON public.sector_aliases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sector_aliases_write_staff" ON public.sector_aliases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analista'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'analista'));

-- Resolution columns on payment_items (additive, nullable)
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id),
  ADD COLUMN IF NOT EXISTS convenio_slug text REFERENCES public.convenios(slug) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS sector_slug text REFERENCES public.sectors(slug) ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS doctor_matched_by text,
  ADD COLUMN IF NOT EXISTS convenio_matched_by text,
  ADD COLUMN IF NOT EXISTS sector_matched_by text;

CREATE INDEX IF NOT EXISTS payment_items_doctor_id_idx ON public.payment_items(doctor_id);
CREATE INDEX IF NOT EXISTS payment_items_convenio_slug_idx ON public.payment_items(convenio_slug);
CREATE INDEX IF NOT EXISTS payment_items_sector_slug_idx ON public.payment_items(sector_slug);

-- Seed convenio_aliases from existing convenios.aliases array (best-effort, ignores duplicates)
INSERT INTO public.convenio_aliases (convenio_slug, alias_text, source)
SELECT c.slug, a.alias, 'import'
FROM public.convenios c, LATERAL unnest(coalesce(c.aliases, ARRAY[]::text[])) AS a(alias)
WHERE public.normalize_alias(a.alias) IS NOT NULL
ON CONFLICT (alias_normalized) DO NOTHING;

-- Also seed convenio name itself as alias so name match path works through the same table
INSERT INTO public.convenio_aliases (convenio_slug, alias_text, source)
SELECT c.slug, c.name, 'import'
FROM public.convenios c
WHERE public.normalize_alias(c.name) IS NOT NULL
ON CONFLICT (alias_normalized) DO NOTHING;

-- Seed sector_aliases from existing sectors.aliases array
INSERT INTO public.sector_aliases (sector_slug, alias_text, source)
SELECT s.slug, a.alias, 'import'
FROM public.sectors s, LATERAL unnest(coalesce(s.aliases, ARRAY[]::text[])) AS a(alias)
WHERE public.normalize_alias(a.alias) IS NOT NULL
ON CONFLICT (alias_normalized) DO NOTHING;

INSERT INTO public.sector_aliases (sector_slug, alias_text, source)
SELECT s.slug, s.name, 'import'
FROM public.sectors s
WHERE public.normalize_alias(s.name) IS NOT NULL
ON CONFLICT (alias_normalized) DO NOTHING;

-- Seed doctor_aliases from doctors.full_name
INSERT INTO public.doctor_aliases (doctor_id, alias_text, source)
SELECT d.id, d.full_name, 'import'
FROM public.doctors d
WHERE public.normalize_alias(d.full_name) IS NOT NULL
ON CONFLICT (alias_normalized) DO NOTHING;
