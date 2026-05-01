CREATE OR REPLACE FUNCTION public.only_digits(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT regexp_replace(COALESCE(txt,''), '\D', '', 'g') $$;
