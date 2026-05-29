CREATE OR REPLACE FUNCTION public.expire_validations_on_phase_advance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_analyst CONSTANT text[] := ARRAY['rascunho','em_analise_ia','revisao_analista','concluida_analista','devolvido_analista'];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status::text = ANY(v_analyst)
     AND NOT (NEW.status::text = ANY(v_analyst))
  THEN
    UPDATE public.production_validations
       SET status = 'expirado',
           expires_at = LEAST(COALESCE(expires_at, now()), now())
     WHERE payment_id = NEW.id
       AND status = 'aguardando';
  END IF;
  RETURN NEW;
END;
$function$;