CREATE OR REPLACE FUNCTION public.finalize_confeccao(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  pay public.payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % não encontrado', _payment_id;
  END IF;

  IF pay.analysis_mode IS DISTINCT FROM 'confeccao' THEN
    RAISE EXCEPTION 'Pagamento % não está em modo confecção (mode=%)', _payment_id, pay.analysis_mode;
  END IF;

  UPDATE public.payment_company_groups
  SET confeccao_status = 'confeccao_concluida',
      confeccao_finalized_at = COALESCE(confeccao_finalized_at, now()),
      confeccao_finalized_by = COALESCE(confeccao_finalized_by, uid),
      updated_at = now()
  WHERE payment_id = _payment_id
    AND (confeccao_status IS NULL OR confeccao_status = 'em_confeccao');

  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
  SET analysis_mode = 'padrao',
      confeccao_status = 'confeccao_concluida',
      confeccao_finalized_at = COALESCE(confeccao_finalized_at, now()),
      confeccao_finalized_by = COALESCE(confeccao_finalized_by, uid),
      status = 'em_analise_ia',
      updated_at = now()
  WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);

  UPDATE public.payment_company_groups
  SET status = 'revisao_analista',
      updated_at = now()
  WHERE payment_id = _payment_id
    AND status IN ('rascunho');

  -- Usa colunas existentes (diff jsonb, action enumerada). audit_log não tem payload.
  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment', _payment_id, 'updated', uid,
          jsonb_build_object(
            'event', 'confeccao_finalizada',
            'from_mode', 'confeccao',
            'to_mode', 'padrao'
          ));
END;
$function$;