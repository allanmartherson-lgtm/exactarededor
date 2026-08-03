CREATE OR REPLACE FUNCTION public.guard_payment_author_spoof()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF public.is_service_role_call() OR v_uid IS NULL
     OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.validated_by IS DISTINCT FROM OLD.validated_by
     AND NEW.validated_by IS NOT NULL AND NEW.validated_by <> v_uid THEN
    RAISE EXCEPTION 'Não é permitido registrar validação em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> v_uid THEN
    RAISE EXCEPTION 'Não é permitido registrar aprovação em nome de outro usuário.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_payment_author_spoof ON public.payments;
CREATE TRIGGER trg_guard_payment_author_spoof
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_author_spoof();