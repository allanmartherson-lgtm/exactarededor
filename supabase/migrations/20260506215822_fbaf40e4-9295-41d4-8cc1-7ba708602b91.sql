CREATE OR REPLACE FUNCTION public.enforce_segregation_of_duties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  creator uuid;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    creator := NEW.created_by;
  ELSE
    SELECT created_by INTO creator FROM public.payments WHERE id = NEW.payment_id;
  END IF;

  IF NEW.validated_by IS NOT NULL AND NEW.validated_by = creator THEN
    RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode validá-lo.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = creator THEN
    RAISE EXCEPTION 'Segregação de funções: quem cria o lote não pode aprová-lo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seg_duties_payments ON public.payments;
CREATE TRIGGER trg_seg_duties_payments
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_segregation_of_duties();

DROP TRIGGER IF EXISTS trg_seg_duties_groups ON public.payment_company_groups;
CREATE TRIGGER trg_seg_duties_groups
BEFORE INSERT OR UPDATE ON public.payment_company_groups
FOR EACH ROW EXECUTE FUNCTION public.enforce_segregation_of_duties();