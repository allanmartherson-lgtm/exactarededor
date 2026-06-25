CREATE OR REPLACE FUNCTION public.enforce_segregation_of_duties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  creator uuid;
  v_approval_source text;
  v_validation_source text;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    creator := NEW.created_by;
    v_approval_source := 'system';
    v_validation_source := 'system';
  ELSE
    SELECT created_by INTO creator FROM public.payments WHERE id = NEW.payment_id;
    v_approval_source := COALESCE(NEW.approval_source, 'system');
    v_validation_source := COALESCE(NEW.validation_source, 'system');
  END IF;

  IF v_validation_source = 'system'
     AND NEW.validated_by IS NOT NULL
     AND NEW.validated_by = creator THEN
    RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode validá-lo.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_approval_source = 'system'
     AND NEW.approved_by IS NOT NULL
     AND NEW.approved_by = creator THEN
    RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode aprová-lo.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;