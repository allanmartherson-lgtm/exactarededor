-- 1. enum
ALTER TYPE rule_sector ADD VALUE IF NOT EXISTS 'sadt_endoscopia';

-- 2. extensão para normalização
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 3. tabela sectors
CREATE TABLE IF NOT EXISTS public.sectors (
  slug text PRIMARY KEY,
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY sectors_view_authenticated ON public.sectors FOR SELECT TO authenticated USING (true);
CREATE POLICY sectors_manage_admin_diretor ON public.sectors FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_sectors_updated_at BEFORE UPDATE ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. normalização: lower + unaccent + colapsa whitespace
CREATE OR REPLACE FUNCTION public.normalize_sector(input text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  needle text;
  result text;
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN RETURN NULL; END IF;
  needle := lower(btrim(regexp_replace(unaccent(input), '\s+', ' ', 'g')));

  -- match exato em slug
  SELECT s.slug INTO result FROM public.sectors s
   WHERE s.active AND lower(unaccent(s.slug)) = needle LIMIT 1;
  IF result IS NOT NULL THEN RETURN result; END IF;

  -- match exato em name
  SELECT s.slug INTO result FROM public.sectors s
   WHERE s.active AND lower(unaccent(s.name)) = needle LIMIT 1;
  IF result IS NOT NULL THEN RETURN result; END IF;

  -- match exato em algum alias
  SELECT s.slug INTO result FROM public.sectors s
   WHERE s.active AND EXISTS (
     SELECT 1 FROM unnest(s.aliases) a WHERE lower(unaccent(a)) = needle
   ) LIMIT 1;
  IF result IS NOT NULL THEN RETURN result; END IF;

  -- match parcial (alias contido na string ou string contém alias) — útil para "Centro Cirúrgico (DFStar)"
  SELECT s.slug INTO result FROM public.sectors s
   WHERE s.active AND EXISTS (
     SELECT 1 FROM unnest(s.aliases || ARRAY[s.name]) a
      WHERE lower(unaccent(a)) <> ''
        AND (needle LIKE '%' || lower(unaccent(a)) || '%')
   )
   ORDER BY s.sort_order LIMIT 1;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_sector(text) TO authenticated, anon;