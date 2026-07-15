CREATE OR REPLACE FUNCTION public.recalc_payment_priority(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Se outro processo já está recalculando a prioridade deste
  -- payment, PULA em vez de enfileirar no lock da linha.
  -- O recálculo em andamento (ou o próximo) reflete o estado
  -- quase-atual, e o finalize recalcula ao final da análise.
  -- Sem isso, chunks paralelos do analyze-payment serializam na
  -- linha do payments e estouram statement timeout.
  IF NOT pg_try_advisory_xact_lock(hashtext(_payment_id::text)) THEN
    RETURN;
  END IF;

  UPDATE public.payments
     SET priority_score = public.calculate_payment_priority(_payment_id)
   WHERE id = _payment_id;
END;
$function$;