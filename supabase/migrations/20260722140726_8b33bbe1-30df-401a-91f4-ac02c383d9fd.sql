CREATE OR REPLACE FUNCTION public.unlearn_company_alias(_company_id uuid, _raw_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  trimmed text;
BEGIN
  trimmed := btrim(coalesce(_raw_name, ''));
  IF trimmed = '' OR _company_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.companies
     SET aliases = COALESCE(
           array_remove(aliases, trimmed),
           '{}'::text[]
         ),
         updated_at = now()
   WHERE id = _company_id
     AND trimmed = ANY(COALESCE(aliases, '{}'::text[]));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unlearn_company_alias(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.unlearn_company_alias(uuid, text) FROM anon;