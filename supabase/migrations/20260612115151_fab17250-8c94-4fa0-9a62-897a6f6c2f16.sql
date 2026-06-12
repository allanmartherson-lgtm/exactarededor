-- Fix search_path
ALTER FUNCTION public.lp_set_hash() SET search_path = public;
ALTER FUNCTION public.lp_scope_hash(jsonb) SET search_path = public;

-- Aplica padrões a todos os itens de um pagamento
CREATE OR REPLACE FUNCTION public.apply_learned_hints_for_payment(_payment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- limpa hints antigos do pagamento
  DELETE FROM public.payment_item_hints h
    USING public.payment_items i
    WHERE h.payment_item_id = i.id AND i.payment_id = _payment_id;

  -- exclusao: match por company + tuss + convenio_slug
  WITH ins AS (
    INSERT INTO public.payment_item_hints(payment_item_id, hospital_id, pattern_id, kind, confidence, message)
    SELECT i.id, i.hospital_id, lp.id, lp.kind, lp.confidence,
           format('Histórico: este item foi marcado como exclusão %sx (motivo: %s)',
                  lp.occurrences, coalesce(lp.signal->>'dominant_reason','-'))
    FROM public.payment_items i
    JOIN public.learned_patterns lp
      ON lp.hospital_id = i.hospital_id
     AND lp.kind = 'exclusao'
     AND lp.status = 'ativo'
     AND lp.confidence >= 0.6
     AND lp.scope->>'company_id' = i.company_id::text
     AND lp.scope->>'tuss' = coalesce(i.procedure_code,'')
     AND coalesce(lp.scope->>'convenio_slug','') = coalesce(i.convenio_slug,'')
    WHERE i.payment_id = _payment_id
    ON CONFLICT (payment_item_id, pattern_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_learned_hints_for_payment(uuid) TO authenticated, service_role;