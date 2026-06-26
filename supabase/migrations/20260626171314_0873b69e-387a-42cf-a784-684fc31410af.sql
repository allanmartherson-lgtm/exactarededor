CREATE OR REPLACE FUNCTION public.recompute_doctor_specific_exclusions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  bound_ids uuid[];
BEGIN
  SELECT COALESCE(ARRAY_AGG(DISTINCT d), ARRAY[]::uuid[]) INTO bound_ids
  FROM (
    SELECT target_doctor_id AS d
      FROM public.rules
     WHERE active = true AND target_doctor_id IS NOT NULL
    UNION
    SELECT (gd->>'id')::uuid AS d
      FROM public.rules r2,
           LATERAL jsonb_array_elements(COALESCE(r2.group_doctors, '[]'::jsonb)) gd
     WHERE r2.active = true
       AND gd ? 'id'
       AND length(gd->>'id') = 36
  ) s
  WHERE d IS NOT NULL;

  UPDATE public.rules r
     SET group_company_links = (
       SELECT COALESCE(jsonb_agg(
         jsonb_set(link, ARRAY['auto_excluded_doctor_ids'], to_jsonb(bound_ids), true)
       ), '[]'::jsonb)
       FROM jsonb_array_elements(r.group_company_links) link
     )
   WHERE r.group_company_links IS NOT NULL
     AND jsonb_typeof(r.group_company_links) = 'array'
     AND jsonb_array_length(r.group_company_links) > 0;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_sync_doctor_specific_exclusions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
BEGIN
  PERFORM public.recompute_doctor_specific_exclusions();
  RETURN NULL;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_sync_doctor_specific_exclusions ON public.rules;
CREATE TRIGGER trg_sync_doctor_specific_exclusions
AFTER INSERT OR DELETE OR UPDATE OF active, target_doctor_id, group_doctors, target_type
ON public.rules
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_sync_doctor_specific_exclusions();

SELECT public.recompute_doctor_specific_exclusions();