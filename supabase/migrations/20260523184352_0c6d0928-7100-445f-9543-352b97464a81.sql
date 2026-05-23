
CREATE OR REPLACE FUNCTION public.forward_groups_to_director(
  p_payment_id uuid,
  p_group_ids uuid[],
  p_author_id uuid,
  p_author_name text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Validador encaminha empresas para aprovação do diretor.
  -- Só transiciona grupos que estão em estados elegíveis (validador acabou de revisar).
  UPDATE public.payment_company_groups
  SET status = 'aguardando_aprovacao',
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status IN ('aguardando_validacao','aprovado_em_revisao','em_questionamento','devolvido_analista');

  IF p_note IS NOT NULL AND p_note <> '' THEN
    INSERT INTO public.payment_observations(payment_id, author_id, author_name, role, message)
    VALUES (p_payment_id, p_author_id, p_author_name, 'validador', p_note);
  END IF;

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.forward_groups_to_director(uuid, uuid[], uuid, text, text) TO authenticated;
