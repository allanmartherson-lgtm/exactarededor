DROP FUNCTION IF EXISTS public.get_specialty_payments_agg(uuid, date, date);

CREATE OR REPLACE FUNCTION public.get_specialty_payments_agg(p_hospital uuid, p_from date, p_to date)
 RETURNS TABLE(competence date, payment_id uuid, company_id uuid, doctor_id uuid, item_type_id uuid, gross numeric, items bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Mesma checagem de escopo usada no resto do sistema (levanta exceção).
  PERFORM public.assert_hospital_access(p_hospital);

  RETURN QUERY
  SELECT
    date_trunc('month', pi.item_competence)::date AS competence,
    pi.payment_id,
    pi.company_id,
    pi.doctor_id,
    pi.item_type_id,
    SUM(COALESCE(pi.gross_amount, 0))::numeric AS gross,
    COUNT(*)::bigint AS items
  FROM public.payment_items pi
  WHERE pi.hospital_id = p_hospital
    AND pi.item_competence IS NOT NULL
    AND pi.item_competence >= p_from
    AND pi.item_competence <= p_to
    AND COALESCE(pi.is_cancelled, false) = false
  GROUP BY 1, 2, 3, 4, 5
  -- Ordem determinística: a tela pagina o resultado em blocos de 1000 linhas
  -- (limite max-rows do PostgREST). Sem ORDER BY as páginas não são estáveis.
  ORDER BY 1, 2, 3, 4, 5;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_specialty_payments_agg(uuid, date, date) TO authenticated;