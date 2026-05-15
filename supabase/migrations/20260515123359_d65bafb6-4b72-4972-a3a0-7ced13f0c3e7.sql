CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_status text;
BEGIN
  -- 1. Aumentar timeout para operações de delete em lote grande
  SET LOCAL statement_timeout = '60s';

  -- 2. Verificar status atual ANTES de qualquer operação
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

  -- 4. Deletar dependentes em ordem (filhos antes do pai)
  -- Quebrar referências circulares primeiro
  UPDATE public.payment_observations
    SET answered_by_observation_id = NULL
    WHERE payment_id = p_payment_id;

  -- Limpar filhos de filhos
  DELETE FROM public.invoice_question_attachments WHERE payment_id = p_payment_id;
  DELETE FROM public.invoice_questions WHERE payment_id = p_payment_id;
  DELETE FROM public.invoices WHERE payment_id = p_payment_id;
  DELETE FROM public.payment_observations WHERE payment_id = p_payment_id;
  DELETE FROM public.payment_status_history WHERE payment_id = p_payment_id;
  DELETE FROM public.payment_company_groups WHERE payment_id = p_payment_id;
  DELETE FROM public.payment_assignments WHERE payment_id = p_payment_id;
  DELETE FROM public.payment_director_notifications WHERE payment_id = p_payment_id;
  DELETE FROM public.status_anomalies WHERE payment_id = p_payment_id;
  
  -- Deletar ai_analysis_versions em batches de 500 para evitar lock longo e timeout
  LOOP
    DELETE FROM public.ai_analysis_versions
    WHERE id IN (
      SELECT id FROM public.ai_analysis_versions
      WHERE payment_id = p_payment_id
      LIMIT 500
    );
    EXIT WHEN NOT FOUND;
  END LOOP;

  DELETE FROM public.payment_processing_jobs WHERE payment_id = p_payment_id;
  DELETE FROM public.payment_items WHERE payment_id = p_payment_id;
  DELETE FROM public.audit_log
    WHERE entity_type = 'payment' AND entity_id = p_payment_id;

  -- 5. Deletar o pai
  DELETE FROM public.payments WHERE id = p_payment_id;

  -- 6. Retornar sucesso
  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;