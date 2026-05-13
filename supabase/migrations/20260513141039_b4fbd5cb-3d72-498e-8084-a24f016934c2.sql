-- BUGFIX Sub-Onda 2B — Override de duplicidade com escopo restrito.
-- Atualiza apply_duplicate_override para calcular automaticamente quais
-- itens/lotes a autorização cobre (paired_with_item_ids / paired_with_payment_ids)
-- com base nas colisões existentes no instante da decisão do diretor.

CREATE OR REPLACE FUNCTION public.apply_duplicate_override(_item_id uuid, _justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing jsonb;
  v_new_findings jsonb;
  v_hash text;
  v_payment_id uuid;
  v_paired_items uuid[] := ARRAY[]::uuid[];
  v_paired_payments uuid[] := ARRAY[]::uuid[];
  v_block_statuses text[] := ARRAY[
    'aprovado','aprovado_em_revisao','aprovado_com_ressalva',
    'pedido_nf_enviado','nf_recebida','nf_questionada',
    'nf_divergente','nf_conciliada','lancado','arquivado','pago'
  ];
  v_warn_statuses text[] := ARRAY[
    'rascunho','em_analise_ia','revisao_analista',
    'aguardando_validacao','devolvido_analista','aguardando_aprovacao'
  ];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_actor, 'diretor'::app_role) THEN
    RAISE EXCEPTION 'Apenas perfil diretor pode autorizar override de duplicidade' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(_justification),'') = '' THEN
    RAISE EXCEPTION 'Justificativa obrigatória' USING ERRCODE = '22023';
  END IF;

  SELECT pi.ai_findings, pi.item_hash, pi.payment_id
    INTO v_existing, v_hash, v_payment_id
  FROM public.payment_items pi
  WHERE pi.id = _item_id;

  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'Item sem hash de duplicidade — nada para autorizar' USING ERRCODE = '22023';
  END IF;
  IF v_existing IS NULL THEN
    v_existing := '{}'::jsonb;
  END IF;

  -- Calcula colisões correntes: mesmo hash, OUTRO lote, status que conta como duplicidade.
  SELECT
    COALESCE(array_agg(DISTINCT other.id),  ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT other.payment_id), ARRAY[]::uuid[])
    INTO v_paired_items, v_paired_payments
  FROM public.payment_items other
  JOIN public.payments p ON p.id = other.payment_id
  WHERE other.item_hash = v_hash
    AND other.payment_id <> v_payment_id
    AND p.status::text = ANY (v_block_statuses || v_warn_statuses);

  IF array_length(v_paired_items, 1) IS NULL THEN
    RAISE EXCEPTION 'Item não tem duplicidade pendente para autorizar' USING ERRCODE = '22023';
  END IF;

  v_new_findings := jsonb_set(
    v_existing,
    '{duplicate_detection,override}',
    jsonb_build_object(
      'by', v_actor,
      'at', to_jsonb(now()),
      'justification', _justification,
      'paired_with_item_ids', to_jsonb(v_paired_items),
      'paired_with_payment_ids', to_jsonb(v_paired_payments)
    ),
    true
  );
  v_new_findings := jsonb_set(v_new_findings, '{duplicate_detection,status}',
    to_jsonb('override_applied'::text), true);

  UPDATE public.payment_items
     SET ai_findings = v_new_findings,
         ai_status = 'pendente'::item_ai_status
   WHERE id = _item_id;

  INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
  VALUES (v_actor, 'payment_item', _item_id, 'duplicate_override',
          jsonb_build_object(
            'justification', _justification,
            'paired_with_item_ids', to_jsonb(v_paired_items),
            'paired_with_payment_ids', to_jsonb(v_paired_payments)
          ));

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', _item_id,
    'by', v_actor,
    'paired_with_item_ids', to_jsonb(v_paired_items),
    'paired_with_payment_ids', to_jsonb(v_paired_payments)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_duplicate_override(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_duplicate_override(uuid, text) TO authenticated;