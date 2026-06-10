
-- 1) Patch glosa_recompute_debt_for_doctor: NUNCA mais cria glosa_debts automaticamente.
-- Mantém apenas o comportamento de UPDATE (recalcula total e fecha quitados).
CREATE OR REPLACE FUNCTION public.glosa_recompute_debt_for_doctor(p_crm text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric;
  v_key text := COALESCE(NULLIF(p_crm,''), p_name);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN RETURN; END IF;

  -- Só atua sobre débitos JÁ existentes (criados manualmente via create_glosa_debt_with_items).
  IF NOT EXISTS (SELECT 1 FROM public.glosa_debts WHERE doctor_crm = v_key) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(valor_glosa), 0) INTO v_total
    FROM public.glosa_items
   WHERE COALESCE(NULLIF(doctor_crm,''), doctor_name) = v_key
     AND status NOT IN ('quitado','ignorado');

  IF v_total <= 0 THEN
    UPDATE public.glosa_debts
       SET total_debt = 0, status = 'quitado', updated_at = now()
     WHERE doctor_crm = v_key AND status = 'ativo';
  ELSE
    UPDATE public.glosa_debts
       SET total_debt = v_total,
           doctor_name = COALESCE(p_name, doctor_name),
           updated_at = now()
     WHERE doctor_crm = v_key AND status = 'ativo';
  END IF;
END;
$function$;

-- 2) Limpeza idempotente: remove débitos órfãos (sem itens vinculados e sem aplicações).
-- Critério explícito: NÃO deleta nada com aplicação registrada.
DO $$
DECLARE
  v_deleted int;
BEGIN
  WITH orfaos AS (
    SELECT d.id
      FROM public.glosa_debts d
     WHERE NOT EXISTS (SELECT 1 FROM public.glosa_debt_items i WHERE i.debt_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM public.glosa_payment_applications a WHERE a.glosa_debt_id = d.id)
  ),
  del AS (
    DELETE FROM public.glosa_debts d
      USING orfaos o
     WHERE d.id = o.id
     RETURNING d.id
  )
  SELECT count(*) INTO v_deleted FROM del;
  RAISE NOTICE 'glosa_debts órfãos removidos: %', v_deleted;
END $$;

-- 3) Novo RPC manual: cria glosa_debts + glosa_debt_items em uma transação,
--    a partir da seleção do analista no painel "Débitos potenciais".
CREATE OR REPLACE FUNCTION public.create_glosa_debt_with_items(
  p_company_id uuid,
  p_doctor_crm text,
  p_doctor_name text,
  p_parcelas integer,
  p_item_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_debt_id uuid;
  v_total numeric;
  v_count int;
  v_hospital_id uuid;
  v_doctor_key text := COALESCE(NULLIF(p_doctor_crm,''), p_doctor_name);
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatório';
  END IF;
  IF p_parcelas IS NULL OR p_parcelas < 1 OR p_parcelas > 24 THEN
    RAISE EXCEPTION 'parcelas deve estar entre 1 e 24';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos 1 item';
  END IF;
  IF v_doctor_key IS NULL OR v_doctor_key = '' THEN
    RAISE EXCEPTION 'CRM ou nome do médico obrigatório';
  END IF;

  -- Soma os valores dos itens selecionados e valida que pertencem ao mesmo médico/empresa
  -- e que ainda não estão em outro débito.
  SELECT COALESCE(SUM(valor_glosa), 0), count(*), max(hospital_id)
    INTO v_total, v_count, v_hospital_id
  FROM public.glosa_items gi
  WHERE gi.id = ANY(p_item_ids)
    AND gi.status = 'vinculado'
    AND gi.matched_company_id = p_company_id
    AND COALESCE(NULLIF(gi.doctor_crm,''), gi.doctor_name) = v_doctor_key
    AND NOT EXISTS (SELECT 1 FROM public.glosa_debt_items di WHERE di.glosa_item_id = gi.id);

  IF v_count <> array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'Alguns itens não estão elegíveis (já em outro débito, status diferente ou empresa/médico divergente)';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Soma dos itens é zero';
  END IF;

  INSERT INTO public.glosa_debts(
    doctor_crm, doctor_name, total_debt, status,
    company_id, resolution_status, parcelas_default, hospital_id
  )
  VALUES (
    NULLIF(p_doctor_crm,''), p_doctor_name, v_total, 'ativo',
    p_company_id, 'resolvido', p_parcelas, v_hospital_id
  )
  RETURNING id INTO v_debt_id;

  INSERT INTO public.glosa_debt_items(debt_id, glosa_item_id, amount, hospital_id)
  SELECT v_debt_id, gi.id, gi.valor_glosa, gi.hospital_id
    FROM public.glosa_items gi
   WHERE gi.id = ANY(p_item_ids);

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('glosa_debt', v_debt_id, 'create_manual', auth.uid(),
          jsonb_build_object(
            'company_id', p_company_id,
            'doctor', v_doctor_key,
            'parcelas', p_parcelas,
            'itens', v_count,
            'total', v_total
          ));

  RETURN v_debt_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_glosa_debt_with_items(uuid, text, text, integer, uuid[]) TO authenticated;
