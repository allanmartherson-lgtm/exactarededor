CREATE OR REPLACE FUNCTION public.bulk_send_groups_to_validation(
  _payment_id uuid,
  _group_ids  uuid[]
)
RETURNS TABLE(updated_count integer, skipped_count integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_total   integer := 0;
BEGIN
  IF _payment_id IS NULL OR _group_ids IS NULL OR array_length(_group_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0, 'Parâmetros inválidos'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_total
    FROM public.payment_company_groups
   WHERE payment_id = _payment_id
     AND id = ANY(_group_ids);

  -- Atualiza tudo em uma única instrução — atômico, sem risco de
  -- aborto parcial (que era o que deixava grupos presos em
  -- 'concluida_analista' quando o front fazia UPDATE em loop).
  WITH upd AS (
    UPDATE public.payment_company_groups g
       SET status = 'aguardando_validacao'::public.payment_status,
           updated_at = now()
     WHERE g.payment_id = _payment_id
       AND g.id = ANY(_group_ids)
       AND g.status IN (
             'concluida_analista'::public.payment_status,
             'devolvido_analista'::public.payment_status,
             'revisao_analista'::public.payment_status
           )
    RETURNING g.id
  )
  SELECT count(*) INTO v_updated FROM upd;

  -- Recalcula o status do pagamento a partir dos grupos.
  PERFORM public.recompute_payment_status_from_groups(_payment_id);

  RETURN QUERY SELECT
    v_updated,
    GREATEST(v_total - v_updated, 0),
    CASE
      WHEN v_updated = 0 THEN 'Nenhuma empresa elegível foi encontrada (já enviadas ou status não permitido).'
      ELSE format('%s empresa(s) enviadas para validação', v_updated)
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_send_groups_to_validation(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_send_groups_to_validation(uuid, uuid[]) TO service_role;