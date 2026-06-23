
CREATE OR REPLACE FUNCTION public.change_group_company(
  p_source_group_id uuid,
  p_new_company_id uuid,
  p_new_company_name text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src RECORD;
  v_dest_id uuid;
  v_dest RECORD;
  v_was_approved boolean;
  v_old_name text;
  v_total numeric;
  v_count integer;
  v_source_deleted boolean := false;
BEGIN
  -- Estende o timeout só desta transação (PostgREST tem 8s por padrão).
  PERFORM set_config('statement_timeout', '120000', true);

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, payment_id, company_id, company_name, status,
         COALESCE(approval_version,0) AS approval_version, approved_at, hospital_id
    INTO v_src
    FROM public.payment_company_groups
   WHERE id = p_source_group_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grupo de origem não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_src.company_id = p_new_company_id THEN
    RAISE EXCEPTION 'a empresa selecionada já é a empresa do grupo' USING ERRCODE = 'P0001';
  END IF;

  v_was_approved := (v_src.approval_version > 0) OR (v_src.approved_at IS NOT NULL);
  v_old_name := v_src.company_name;

  IF v_was_approved AND (p_reason IS NULL OR length(btrim(p_reason)) < 4) THEN
    RAISE EXCEPTION 'motivo obrigatório (mínimo 4 caracteres) para trocar empresa de grupo aprovado'
      USING ERRCODE = 'P0001';
  END IF;

  -- Soma totais e conta itens (snapshot ANTES do update para atualizar destino).
  SELECT COALESCE(SUM(gross_amount), 0)::numeric, COUNT(*)::int
    INTO v_total, v_count
    FROM public.payment_items
   WHERE payment_id = v_src.payment_id
     AND company_id = v_src.company_id;

  -- 1) Reatribui todos os itens do grupo de origem (sem listar IDs).
  UPDATE public.payment_items
     SET company_id = p_new_company_id,
         company_name = p_new_company_name
   WHERE payment_id = v_src.payment_id
     AND company_id = v_src.company_id;

  -- 2) Acha/cria grupo destino.
  SELECT id, COALESCE(items_count,0) AS items_count, COALESCE(total_amount,0) AS total_amount
    INTO v_dest
    FROM public.payment_company_groups
   WHERE payment_id = v_src.payment_id
     AND company_id = p_new_company_id
   FOR UPDATE;

  IF FOUND THEN
    v_dest_id := v_dest.id;
    UPDATE public.payment_company_groups
       SET items_count = v_dest.items_count + v_count,
           total_amount = v_dest.total_amount + v_total
     WHERE id = v_dest_id;
  ELSE
    INSERT INTO public.payment_company_groups
      (hospital_id, payment_id, company_id, company_name,
       items_count, total_amount, status)
    VALUES
      (v_src.hospital_id, v_src.payment_id, p_new_company_id, p_new_company_name,
       v_count, v_total, 'em_analise_ia')
    RETURNING id INTO v_dest_id;
  END IF;

  -- 3) Se grupo origem não foi aprovado ainda, apaga. Senão mantém viva a versão anterior.
  IF NOT v_was_approved THEN
    DELETE FROM public.payment_company_groups WHERE id = p_source_group_id;
    v_source_deleted := true;
  ELSE
    -- Marca itens=0 e grava motivo de reapproval nos dois grupos.
    UPDATE public.payment_company_groups
       SET items_count = 0,
           total_amount = 0,
           reapproval_reason = p_reason
     WHERE id = p_source_group_id;
    UPDATE public.payment_company_groups
       SET reapproval_reason = p_reason
     WHERE id = v_dest_id;
  END IF;

  -- 4) Aprende alias na empresa nova.
  UPDATE public.companies
     SET aliases = (
       SELECT array_agg(DISTINCT a)
         FROM unnest(COALESCE(aliases, ARRAY[]::text[]) || ARRAY[v_old_name]::text[]) AS a
        WHERE a IS NOT NULL AND length(btrim(a)) > 0
     )
   WHERE id = p_new_company_id;

  RETURN jsonb_build_object(
    'payment_id', v_src.payment_id,
    'source_group_id', p_source_group_id,
    'source_deleted', v_source_deleted,
    'dest_group_id', v_dest_id,
    'was_approved', v_was_approved,
    'items_moved', v_count,
    'total_moved', v_total,
    'old_company_name', v_old_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.change_group_company(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_group_company(uuid, uuid, text, text) TO authenticated, service_role;
