CREATE OR REPLACE FUNCTION public.glosa_recompute_debt_for_doctor(p_crm text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := COALESCE(NULLIF(p_crm,''), p_name);
  r RECORD;
  v_total numeric;
BEGIN
  IF v_key IS NULL OR v_key = '' THEN RETURN; END IF;

  -- Recalcula cada débito EXISTENTE individualmente a partir APENAS dos
  -- glosa_debt_items vinculados (amount - applied_amount). Itens matched
  -- sem vínculo a um débito NUNCA afetam total_debt — só entram via
  -- create_glosa_debt_with_items, sob comando do analista.
  FOR r IN
    SELECT id FROM public.glosa_debts
     WHERE doctor_crm = v_key AND status = 'ativo'
  LOOP
    SELECT COALESCE(SUM(GREATEST(amount - COALESCE(applied_amount,0), 0)), 0)
      INTO v_total
      FROM public.glosa_debt_items
     WHERE debt_id = r.id;

    IF v_total <= 0 THEN
      UPDATE public.glosa_debts
         SET total_debt = 0, status = 'quitado',
             doctor_name = COALESCE(p_name, doctor_name),
             updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.glosa_debts
         SET total_debt = v_total,
             doctor_name = COALESCE(p_name, doctor_name),
             updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
END;
$function$;