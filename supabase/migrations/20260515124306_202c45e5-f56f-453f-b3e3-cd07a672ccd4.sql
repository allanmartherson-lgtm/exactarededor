-- 1. Criar função de retenção
CREATE OR REPLACE FUNCTION public.retain_latest_ai_analysis_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.ai_analysis_versions
  WHERE item_id = NEW.item_id
    AND id <> NEW.id;
  RETURN NEW;
END;
$$;

-- 2. Criar trigger
DROP TRIGGER IF EXISTS trg_retain_ai_analysis_version ON public.ai_analysis_versions;
CREATE TRIGGER trg_retain_ai_analysis_version
  AFTER INSERT ON public.ai_analysis_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.retain_latest_ai_analysis_version();

-- 3. Limpeza dos dados históricos existentes
DELETE FROM public.ai_analysis_versions
WHERE id NOT IN (
  SELECT DISTINCT ON (item_id) id
  FROM public.ai_analysis_versions
  ORDER BY item_id, created_at DESC
);

-- 4. Asserção pós-limpeza
DO $$
DECLARE v_duplicates int;
BEGIN
  SELECT COUNT(*) INTO v_duplicates
  FROM (
    SELECT item_id FROM ai_analysis_versions
    GROUP BY item_id HAVING COUNT(*) > 1
  ) t;
  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'Limpeza incompleta: % item_ids ainda têm mais de 1 versão', v_duplicates;
  END IF;
END $$;

-- 5. Atualizar delete_payment_batch (remover redundâncias e batch loop)
CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_status text;
BEGIN
  -- Aumentar timeout e preparar ambiente
  SET LOCAL statement_timeout = '60s';
  SET LOCAL session_replication_role = 'replica';

  SELECT status INTO v_status FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lote não encontrado');
  END IF;

  IF v_status NOT IN ('rascunho', 'em_analise_ia', 'revisao_analista') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Lote não pode ser excluído no status "%s". Apenas lotes em rascunho ou análise podem ser excluídos.', v_status)
    );
  END IF;

  -- Limpeza mínima necessária
  UPDATE public.payment_observations
    SET answered_by_observation_id = NULL
    WHERE payment_id = p_payment_id;

  DELETE FROM public.audit_log
    WHERE entity_type = 'payment' AND entity_id = p_payment_id;

  -- Agora com volume controlado, deletar versões é seguro e rápido
  DELETE FROM public.ai_analysis_versions WHERE payment_id = p_payment_id;

  -- Deletar o pai (aciona cascateamento para o resto)
  DELETE FROM public.payments WHERE id = p_payment_id;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;