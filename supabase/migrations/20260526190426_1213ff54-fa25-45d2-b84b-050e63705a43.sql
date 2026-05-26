
DROP FUNCTION IF EXISTS public.link_glosa_to_company(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.link_glosa_to_company(
  _debt_id uuid, _company_id uuid, _parcelas int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debt public.glosa_debts%ROWTYPE;
  v_adj  uuid;
BEGIN
  IF _parcelas IS NULL OR _parcelas < 1 THEN
    RAISE EXCEPTION 'Informe um número de parcelas válido (>=1)';
  END IF;

  SELECT * INTO v_debt FROM public.glosa_debts WHERE id = _debt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Glosa % não encontrada', _debt_id; END IF;

  INSERT INTO public.company_financial_adjustments
    (company_id, tipo, descricao, valor_total, parcelas_total, parcelas_pagas,
     data_inicio, origem, ativo, created_by)
  VALUES
    (_company_id, 'glosa_parcelada',
     'Glosa Dr(a). ' || v_debt.doctor_name || COALESCE(' (' || v_debt.doctor_crm || ')', ''),
     v_debt.total_debt, _parcelas, 0, CURRENT_DATE,
     'glosa_debt:' || v_debt.id::text, true, auth.uid())
  RETURNING id INTO v_adj;

  UPDATE public.glosa_debts
     SET company_id = _company_id,
         adjustment_id = v_adj,
         resolution_status = 'vinculada',
         resolution_reason = NULL,
         updated_at = now()
   WHERE id = _debt_id;

  RETURN v_adj;
END;
$$;
