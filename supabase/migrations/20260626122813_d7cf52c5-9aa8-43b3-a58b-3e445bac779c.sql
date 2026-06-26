
CREATE OR REPLACE FUNCTION public.conclude_historico_payment(_payment_id uuid)
RETURNS TABLE(updated_count integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_import_mode text;
  v_cur_status text;
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'analista'::app_role) OR
    public.has_role(v_uid, 'admin'::app_role) OR
    public.has_role(v_uid, 'diretor'::app_role)
  ) THEN
    RAISE EXCEPTION 'sem permissão para concluir importação histórica';
  END IF;

  SELECT import_mode, status::text INTO v_import_mode, v_cur_status
  FROM public.payments
  WHERE id = _payment_id;

  IF v_import_mode IS NULL THEN
    RAISE EXCEPTION 'pagamento não encontrado';
  END IF;

  IF v_import_mode <> 'historico' THEN
    RAISE EXCEPTION 'apenas pagamentos de importação histórica podem ser concluídos por esta ação';
  END IF;

  -- Marca grupos ativos como pago, preservando rejeitados/cancelados/arquivados.
  WITH upd AS (
    UPDATE public.payment_company_groups
    SET status = 'pago',
        approved_at = COALESCE(approved_at, now()),
        approved_by = COALESCE(approved_by, v_uid),
        updated_at = now()
    WHERE payment_id = _payment_id
      AND status NOT IN ('pago','rejeitado','cancelado','arquivado')
    RETURNING 1
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  UPDATE public.payments
  SET status = 'pago',
      approved_at = COALESCE(approved_at, now()),
      updated_at = now()
  WHERE id = _payment_id;

  INSERT INTO public.payment_observations(payment_id, author_type, message, status_from, status_to)
  VALUES (_payment_id, 'sistema',
          format('Importação histórica concluída pelo analista: %s grupo(s) marcado(s) como pago.', v_updated),
          v_cur_status::payment_status, 'pago'::payment_status);

  RETURN QUERY SELECT v_updated, format('%s grupo(s) concluído(s).', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.conclude_historico_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conclude_historico_payment(uuid) TO authenticated;
