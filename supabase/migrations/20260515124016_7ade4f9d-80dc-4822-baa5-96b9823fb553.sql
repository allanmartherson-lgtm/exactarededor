CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_status text;
BEGIN
  -- 1. Aumentar timeout e preparar ambiente de alta performance
  SET LOCAL statement_timeout = '60s';
  SET LOCAL session_replication_role = 'replica'; -- Desabilita triggers e RLS (apenas nesta transação)

  -- 2. Verificar status atual
  SELECT status INTO v_status FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lote não encontrado');
  END IF;

  -- 3. Bloquear se status não permitir deleção
  IF v_status NOT IN ('rascunho', 'em_analise_ia', 'revisao_analista') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Lote não pode ser excluído no status "%s". Apenas lotes em rascunho ou análise podem ser excluídos.', v_status)
    );
  END IF;

  -- 4. Limpeza mínima necessária (referências circulares ou tabelas sem cascade)
  
  -- Quebrar referências circulares em observações
  UPDATE public.payment_observations
    SET answered_by_observation_id = NULL
    WHERE payment_id = p_payment_id;

  -- Deletar logs de auditoria (não costumam ter FK com CASCADE)
  DELETE FROM public.audit_log
    WHERE entity_type = 'payment' AND entity_id = p_payment_id;

  -- 5. DELEÇÃO ATÔMICA
  -- Como quase todas as tabelas (items, versions, invoices, etc) têm ON DELETE CASCADE,
  -- deletar o registro pai é a forma mais rápida e eficiente (engine do PG).
  DELETE FROM public.payments WHERE id = p_payment_id;

  -- 6. Retornar sucesso
  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;