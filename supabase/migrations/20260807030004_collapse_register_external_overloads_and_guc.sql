-- 1) Colapsa as 2 sobrecargas de register_external_approval (7 e 8
--    parâmetros) em uma única assinatura (8 parâmetros, p_decisor_id
--    opcional). A versão de 7 parâmetros era um subconjunto exato da de 8
--    (v_approver := COALESCE(p_decisor_id, v_actor) já degrada para v_actor
--    quando p_decisor_id é NULL) — mantê-las como funções separadas só
--    duplicava ~80 linhas de SQL idênticas por função. Chamadas via
--    supabase-js usam parâmetros nomeados, então remover a sobrecarga de 7
--    parâmetros é seguro: quem não envia p_decisor_id continua funcionando
--    igual, agora resolvido pela função única com o default.
--
-- 2) Adiciona o GUC app.allow_external_workflow_write ao redor do UPDATE em
--    payment_company_groups, no mesmo padrão já usado por
--    recompute_payment_status_from_groups com app.allow_payment_status_write.
--    Necessário porque a migration seguinte (guard_group_workflow_transition)
--    passa a exigir esse GUC para pular o gate de papel — sem isso, um
--    analista registrando aprovação/validação externa (fluxo intencional,
--    usado enquanto o sistema não roda 100% digital) seria bloqueado pela
--    trigger por não ter papel de diretor/validador.

DROP FUNCTION IF EXISTS public.register_external_approval(uuid, uuid[], uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.register_external_validation(uuid, uuid[], uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.register_external_approval(p_payment_id uuid, p_group_ids uuid[], p_registered_by uuid, p_director_name text, p_source text, p_evidence_path text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_decisor_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
  v_approver uuid;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_registered_by END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  END IF;

  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
       OR public.has_role(v_actor, 'analista'::public.app_role)
       OR public.has_role(v_actor, 'diretor'::public.app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para registrar aprovação externa.';
  END IF;

  IF p_source NOT IN ('email','whatsapp','outro') THEN
    RAISE EXCEPTION 'Origem inválida para aprovação externa: %', p_source;
  END IF;

  IF COALESCE(btrim(p_director_name), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do diretor que aprovou externamente.';
  END IF;

  -- p_decisor_id é apenas atribuição de indicador (quem decidiu fora do sistema),
  -- nunca autorização: o registro segue creditado ao operador real (v_actor).
  v_approver := COALESCE(p_decisor_id, v_actor);

  PERFORM set_config('app.allow_external_workflow_write', 'on', true);

  UPDATE public.payment_company_groups
  SET status = 'revisao_pos_aprovacao',
      approved_by = v_approver,
      approved_at = now(),
      approval_source = p_source,
      approval_on_behalf_of = p_director_name,
      approval_evidence_path = p_evidence_path,
      approval_external_note = p_note,
      approval_registered_by = v_actor,
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status = 'aguardando_aprovacao';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  PERFORM set_config('app.allow_external_workflow_write', 'off', true);

  IF updated_count <> COALESCE(array_length(p_group_ids, 1), 0) THEN
    RAISE EXCEPTION 'Aprovação externa bloqueada: todas as empresas precisam estar em aguardando_aprovacao.';
  END IF;

  INSERT INTO public.payment_observations(
    payment_id, author_id, author_type, message,
    status_from, status_to, observation_type
  ) VALUES (
    p_payment_id, v_actor, 'diretor'::public.observation_author,
    format('Aprovação externa registrada (%s) em nome de %s.%s',
      p_source, p_director_name, CASE WHEN COALESCE(btrim(p_note),'')='' THEN '' ELSE ' Nota: '||p_note END),
    'aguardando_aprovacao'::public.payment_status,
    'revisao_pos_aprovacao'::public.payment_status,
    'informativo'::public.observation_type
  );

  UPDATE public.payments p
  SET approved_at = now()
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
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_external_validation(p_payment_id uuid, p_group_ids uuid[], p_registered_by uuid, p_supervisor_name text, p_source text, p_evidence_path text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_decisor_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
  v_validator uuid;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_registered_by END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  END IF;

  IF NOT (public.has_role(v_actor, 'admin'::public.app_role)
       OR public.has_role(v_actor, 'analista'::public.app_role)
       OR public.has_role(v_actor, 'validador'::public.app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para registrar validação externa.';
  END IF;

  IF p_source NOT IN ('email','whatsapp','outro') THEN
    RAISE EXCEPTION 'Origem inválida para validação externa: %', p_source;
  END IF;

  IF COALESCE(btrim(p_supervisor_name), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do supervisor que validou externamente.';
  END IF;

  v_validator := COALESCE(p_decisor_id, v_actor);

  PERFORM set_config('app.allow_external_workflow_write', 'on', true);

  UPDATE public.payment_company_groups
  SET status = 'aguardando_aprovacao',
      validated_by = v_validator,
      validated_at = now(),
      validation_source = p_source,
      validation_on_behalf_of = p_supervisor_name,
      validation_evidence_path = p_evidence_path,
      validation_external_note = p_note,
      validation_registered_by = v_actor,
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status = 'aguardando_validacao';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  PERFORM set_config('app.allow_external_workflow_write', 'off', true);

  IF updated_count <> COALESCE(array_length(p_group_ids, 1), 0) THEN
    RAISE EXCEPTION 'Validação externa bloqueada: todas as empresas precisam estar em aguardando_validacao.';
  END IF;

  INSERT INTO public.payment_observations(
    payment_id, author_id, author_type, message,
    status_from, status_to, observation_type
  ) VALUES (
    p_payment_id, v_actor, 'validador'::public.observation_author,
    format('Validação externa registrada (%s) em nome de %s.%s',
      p_source, p_supervisor_name, CASE WHEN COALESCE(btrim(p_note),'')='' THEN '' ELSE ' Nota: '||p_note END),
    'aguardando_validacao'::public.payment_status,
    'aguardando_aprovacao'::public.payment_status,
    'informativo'::public.observation_type
  );

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$function$;
