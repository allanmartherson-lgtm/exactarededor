CREATE OR REPLACE FUNCTION public.return_groups_to_analyst(
  p_payment_id uuid,
  p_group_ids uuid[],
  p_author_id uuid,
  p_author_name text,
  p_message text,
  p_lot_level boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Quando devolução é do lote completo, registra UMA única observação no nível
  -- do lote (company_group_id = NULL) em vez de duplicar a mesma mensagem em
  -- cada empresa — caso contrário a caixa de Conversas fica poluída com 100+
  -- threads idênticas. Devolução parcial mantém o comportamento original
  -- (uma mensagem por empresa selecionada) porque cada caso pode exigir
  -- contexto/resposta individual.
  IF p_lot_level THEN
    INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
    VALUES (p_payment_id, NULL, p_author_id, p_author_name, p_message);
  ELSE
    INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
    SELECT p_payment_id, g, p_author_id, p_author_name, p_message
    FROM unnest(p_group_ids) g;
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'devolvido_analista', updated_at = now()
  WHERE id = ANY(p_group_ids) AND payment_id = p_payment_id;

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$function$;