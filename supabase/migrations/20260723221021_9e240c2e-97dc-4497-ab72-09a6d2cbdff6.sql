-- 1) Rematerializa o ledger do lote 98d7c9e0 (aprovado às 22:02 sem entradas)
SELECT public.materialize_intervention_ledger('98d7c9e0-edca-4bd9-930d-191e6402a555'::uuid);

-- 2) Defesa: approve_payment passa a chamar materialize_intervention_ledger
--    explicitamente ao final. Se o trigger de status já materializou, o próprio
--    materialize faz DELETE+INSERT (idempotente). Se por qualquer motivo o
--    trigger não rodou (setting local perdido, exceção silenciosa), garantimos
--    que a aprovação sempre deixa o ledger em dia.
CREATE OR REPLACE FUNCTION public.approve_payment(
  p_payment_id uuid, p_group_ids uuid[], p_author_id uuid,
  p_author_name text, p_note text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  updated_count integer;
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  IF NOT (public.has_role(p_author_id, 'diretor'::public.app_role) OR public.has_role(p_author_id, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas diretor pode realizar a aprovação final.';
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'revisao_pos_aprovacao',
      approved_by = p_author_id,
      approved_at = now(),
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status = 'aguardando_aprovacao';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> COALESCE(array_length(p_group_ids, 1), 0) THEN
    RAISE EXCEPTION 'Aprovação final bloqueada: todas as empresas precisam estar na etapa de aprovação do diretor.';
  END IF;

  IF p_note IS NOT NULL AND btrim(p_note) <> '' THEN
    INSERT INTO public.payment_observations(
      payment_id, author_id, author_type, message,
      status_from, status_to, observation_type
    ) VALUES (
      p_payment_id, p_author_id, 'diretor'::public.observation_author, p_note,
      'aguardando_aprovacao'::public.payment_status,
      'revisao_pos_aprovacao'::public.payment_status,
      'informativo'::public.observation_type
    );
  END IF;

  UPDATE public.payments p
  SET approved_at = now(),
      approved_by = COALESCE(p.approved_by, p_author_id)
  WHERE p.id = p_payment_id
    AND p.approved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_company_groups g
      WHERE g.payment_id = p.id
      AND g.status NOT IN (
        'revisao_pos_aprovacao','aprovado','aprovado_com_ressalva',
        'pedido_nf_enviado','nf_recebida','nf_questionada',
        'nf_divergente','nf_conciliada','lancado','pago',
        'arquivado','rejeitado','cancelado','aprovado_parcial',
        'aprovado_em_revisao'
      )
    );

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);

  -- Garantia final: idempotente (materialize faz DELETE+INSERT). Cobre casos
  -- em que o trigger de status não populou o ledger por qualquer motivo.
  BEGIN
    PERFORM public.materialize_intervention_ledger(p_payment_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'approve_payment: materialize_intervention_ledger falhou para %: %', p_payment_id, SQLERRM;
  END;
END;
$function$;