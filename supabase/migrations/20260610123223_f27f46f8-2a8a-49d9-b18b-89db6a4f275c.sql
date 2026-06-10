CREATE OR REPLACE FUNCTION public.create_glosa_debt_with_items(
  p_company_id uuid,
  p_doctor_crm text,
  p_doctor_name text,
  p_parcelas integer,
  p_item_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_debt_id uuid;
  v_total numeric;
  v_count integer;
  v_doctor_key text;
  v_hospital_id uuid;
  v_company_name text;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id obrigatório'; END IF;
  IF p_parcelas IS NULL OR p_parcelas < 1 THEN RAISE EXCEPTION 'parcelas inválidas'; END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids,1) IS NULL THEN RAISE EXCEPTION 'sem itens'; END IF;

  v_doctor_key := COALESCE(NULLIF(p_doctor_crm,''), p_doctor_name);
  IF v_doctor_key IS NULL OR v_doctor_key = '' THEN
    RAISE EXCEPTION 'doctor_crm ou doctor_name obrigatório';
  END IF;

  SELECT COALESCE(SUM(gi.valor_glosa),0), count(*)
    INTO v_total, v_count
    FROM public.glosa_items gi
   WHERE gi.id = ANY(p_item_ids)
     AND gi.status = 'vinculado'
     AND gi.matched_company_id = p_company_id
     AND COALESCE(NULLIF(gi.doctor_crm,''), gi.doctor_name) = v_doctor_key
     AND NOT EXISTS (SELECT 1 FROM public.glosa_debt_items di WHERE di.glosa_item_id = gi.id);

  IF v_count <> array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'Itens não elegíveis (já vinculados a outro débito, status alterado ou empresa/médico divergente). Recarregue o painel.';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Soma dos itens é zero';
  END IF;

  SELECT gi.hospital_id INTO v_hospital_id
    FROM public.glosa_items gi
   WHERE gi.id = ANY(p_item_ids) AND gi.hospital_id IS NOT NULL
   LIMIT 1;

  SELECT name INTO v_company_name FROM public.companies WHERE id = p_company_id;

  INSERT INTO public.glosa_debts(
    doctor_crm, doctor_name, total_debt, status,
    company_id, resolution_status, parcelas_default, hospital_id
  )
  VALUES (
    NULLIF(p_doctor_crm,''), p_doctor_name, v_total, 'ativo',
    p_company_id, 'vinculada', p_parcelas, v_hospital_id
  )
  RETURNING id INTO v_debt_id;

  INSERT INTO public.glosa_debt_items(debt_id, glosa_item_id, amount, hospital_id)
  SELECT v_debt_id, gi.id, gi.valor_glosa, gi.hospital_id
    FROM public.glosa_items gi
   WHERE gi.id = ANY(p_item_ids);

  INSERT INTO public.audit_log
    (entity_type, entity_id, action, actor_id, company_id, company_name, hospital_id, diff)
  VALUES
    ('glosa_debt', v_debt_id, 'create_manual', auth.uid(),
     p_company_id, v_company_name, v_hospital_id,
     jsonb_build_object(
       'doctor_crm', NULLIF(p_doctor_crm,''),
       'doctor_name', p_doctor_name,
       'parcelas', p_parcelas,
       'total', v_total,
       'item_count', v_count,
       'glosa_item_ids', to_jsonb(p_item_ids)
     ));

  RETURN v_debt_id;
END;
$function$;