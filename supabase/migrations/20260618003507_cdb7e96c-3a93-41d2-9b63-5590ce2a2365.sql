-- Invalida snapshot de payment_company_financials sempre que os campos
-- que alimentam o cálculo mudarem em payment_items. Garante coerência
-- entre análise/reatribuição de regras e a UI financeira por empresa.
CREATE OR REPLACE FUNCTION public.invalidate_company_financials_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_company uuid;
  v_new_company uuid;
  v_payment uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_payment := OLD.payment_id;
    v_old_company := OLD.company_id;
    IF v_payment IS NOT NULL AND v_old_company IS NOT NULL THEN
      UPDATE public.payment_company_financials
         SET computed_at = NULL
       WHERE payment_id = v_payment AND company_id = v_old_company;
    END IF;
    RETURN OLD;
  END IF;

  v_payment := NEW.payment_id;
  v_new_company := NEW.company_id;
  v_old_company := CASE WHEN TG_OP = 'UPDATE' THEN OLD.company_id ELSE NULL END;

  IF TG_OP = 'INSERT' THEN
    IF v_payment IS NOT NULL AND v_new_company IS NOT NULL THEN
      UPDATE public.payment_company_financials
         SET computed_at = NULL
       WHERE payment_id = v_payment AND company_id = v_new_company;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: invalida se algum campo crítico mudou ou se mudou de empresa.
  IF v_new_company IS DISTINCT FROM v_old_company
     OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount
     OR NEW.applied_rule_id IS DISTINCT FROM OLD.applied_rule_id
     OR NEW.is_cancelled IS DISTINCT FROM OLD.is_cancelled
     OR NEW.package_absorbed IS DISTINCT FROM OLD.package_absorbed
  THEN
    IF v_payment IS NOT NULL AND v_new_company IS NOT NULL THEN
      UPDATE public.payment_company_financials
         SET computed_at = NULL
       WHERE payment_id = v_payment AND company_id = v_new_company;
    END IF;
    IF v_old_company IS NOT NULL AND v_old_company IS DISTINCT FROM v_new_company THEN
      UPDATE public.payment_company_financials
         SET computed_at = NULL
       WHERE payment_id = v_payment AND company_id = v_old_company;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_items_invalidate_financials ON public.payment_items;
CREATE TRIGGER trg_payment_items_invalidate_financials
AFTER INSERT OR UPDATE OR DELETE ON public.payment_items
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_company_financials_snapshot();