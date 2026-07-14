CREATE OR REPLACE FUNCTION public.tg_sync_doctor_specific_exclusions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Impede recursão: o UPDATE dentro de recompute_ dispara este
  -- trigger de novo; sem este guard, cascata até statement timeout.
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM public.recompute_doctor_specific_exclusions();
  RETURN NULL;
END;
$function$;