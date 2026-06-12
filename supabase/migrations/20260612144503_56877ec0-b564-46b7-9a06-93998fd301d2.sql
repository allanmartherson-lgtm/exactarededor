CREATE OR REPLACE FUNCTION public.trg_recompute_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.recompute_payment_status_from_groups(COALESCE(NEW.payment_id, OLD.payment_id));
  EXCEPTION WHEN OTHERS THEN
    -- Não derruba a mudança no grupo se o recálculo do status do pagamento
    -- esbarrar em uma guarda (ex.: trg_payments_historico_guard recusa
    -- 'lancado' para pagamentos históricos). O grupo segue atualizado; o
    -- pagamento mantém o status que já tinha.
    RAISE NOTICE 'recompute_payment_status_from_groups falhou (pcg trigger): %', SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$function$;