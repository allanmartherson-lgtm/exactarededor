CREATE OR REPLACE FUNCTION public.block_physical_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'DELETE físico proibido em %.%: use encerramento controlado (end_date + end_reason ou active=false). Alterações precisam de rastro auditável.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$function$;