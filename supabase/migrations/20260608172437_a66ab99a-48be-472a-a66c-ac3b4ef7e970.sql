CREATE OR REPLACE FUNCTION public.bulk_conclude_analyst_groups(
  _payment_id uuid,
  _group_ids uuid[]
) RETURNS TABLE(updated_count integer, skipped_count integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_updated integer := 0;
  v_skipped integer := 0;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    public.has_role(v_user, 'analista'::app_role)
    OR public.has_role(v_user, 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'apenas analista/admin podem concluir em massa' USING ERRCODE = '42501';
  END IF;

  -- Itera só nos grupos elegíveis (revisao_analista) do pagamento informado.
  FOR r IN
    SELECT id, status, company_name
      FROM public.payment_company_groups
     WHERE payment_id = _payment_id
       AND id = ANY(_group_ids)
       AND status = 'revisao_analista'
  LOOP
    UPDATE public.payment_company_groups
       SET status = 'concluida_analista'
     WHERE id = r.id;

    INSERT INTO public.payment_observations
      (payment_id, author_type, author_id, message, status_from, status_to)
    VALUES (
      _payment_id, 'analista', v_user,
      format('[%s] Análise concluída pelo analista (em massa).', r.company_name),
      r.status, 'concluida_analista'
    );

    v_updated := v_updated + 1;
  END LOOP;

  v_skipped := array_length(_group_ids, 1) - v_updated;
  RETURN QUERY SELECT v_updated, v_skipped,
    CASE
      WHEN v_updated = 0 THEN 'Nenhuma empresa elegível (status diferente de revisão pelo analista).'
      WHEN v_skipped > 0 THEN format('%s concluída(s); %s ignorada(s) por status incompatível.', v_updated, v_skipped)
      ELSE format('%s empresa(s) concluída(s).', v_updated)
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_conclude_analyst_groups(uuid, uuid[]) TO authenticated;