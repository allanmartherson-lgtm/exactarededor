-- =====================================================================
-- Hardening: funções SECURITY DEFINER do fluxo de aprovação/validação
-- deixam de confiar no parâmetro de identidade informado pelo chamador.
-- Ator real = auth.uid(). Chamadas internas (service_role) continuam
-- podendo informar o ator via parâmetro.
-- Assinaturas inalteradas.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_service_role_call()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role'
$$;

GRANT EXECUTE ON FUNCTION public.is_service_role_call() TO authenticated, service_role;

-- ---------------------------------------------------------------- 1
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  END IF;

  IF NOT (public.has_role(v_actor, 'diretor'::public.app_role) OR public.has_role(v_actor, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas diretor pode realizar a aprovação final.';
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'revisao_pos_aprovacao',
      approved_by = v_actor,
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
      p_payment_id, v_actor, 'diretor'::public.observation_author, p_note,
      'aguardando_aprovacao'::public.payment_status,
      'revisao_pos_aprovacao'::public.payment_status,
      'informativo'::public.observation_type
    );
  END IF;

  UPDATE public.payments p
  SET approved_at = now(),
      approved_by = COALESCE(p.approved_by, v_actor)
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

  BEGIN
    PERFORM public.materialize_intervention_ledger(p_payment_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'approve_payment: materialize_intervention_ledger falhou para %: %', p_payment_id, SQLERRM;
  END;
END;
$function$;

-- ---------------------------------------------------------------- 2
CREATE OR REPLACE FUNCTION public.conclude_groups_at_validator(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
  v_hospital_id uuid;
  v_module text;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT hospital_id INTO v_hospital_id FROM public.payments WHERE id = p_payment_id;
  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access(v_hospital_id);
  END IF;

  SELECT workflow_module INTO v_module FROM public.hospital_settings WHERE hospital_id = v_hospital_id;
  IF v_module IS DISTINCT FROM 'validacao' THEN
    RAISE EXCEPTION 'Esta ação só é permitida em hospitais no módulo Validação.';
  END IF;

  IF NOT (public.has_role(v_actor, 'validador'::public.app_role) OR public.has_role(v_actor, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas validador pode concluir a validação.';
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'concluido_validacao',
      validated_by = v_actor,
      validated_at = now(),
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status IN ('aguardando_validacao', 'em_questionamento', 'devolvido_analista');

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> COALESCE(array_length(p_group_ids, 1), 0) THEN
    RAISE EXCEPTION 'Conclusão bloqueada: todas as empresas precisam estar na etapa de validação.';
  END IF;

  IF p_note IS NOT NULL AND btrim(p_note) <> '' THEN
    INSERT INTO public.payment_observations(
      payment_id, author_id, author_type, message,
      status_from, status_to, observation_type
    ) VALUES (
      p_payment_id, v_actor, 'validador'::public.observation_author, p_note,
      'aguardando_validacao'::public.payment_status,
      'concluido_validacao'::public.payment_status,
      'informativo'::public.observation_type
    );
  END IF;

  UPDATE public.payments p
  SET approved_at = now(),
      approved_by = COALESCE(p.approved_by, v_actor)
  WHERE p.id = p_payment_id
    AND p.approved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_company_groups g
      WHERE g.payment_id = p.id
      AND g.status NOT IN (
        'concluido_validacao','rejeitado','cancelado','arquivado'
      )
    );

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);

  BEGIN
    PERFORM public.materialize_intervention_ledger(p_payment_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conclude_groups_at_validator: materialize_intervention_ledger falhou para %: %', p_payment_id, SQLERRM;
  END;
END;
$function$;

-- ---------------------------------------------------------------- 3
CREATE OR REPLACE FUNCTION public.forward_groups_to_director(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  END IF;

  IF NOT (public.has_role(v_actor, 'validador'::public.app_role) OR public.has_role(v_actor, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas validador pode encaminhar para aprovação do diretor.';
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'aguardando_aprovacao',
      validated_by = v_actor,
      validated_at = now(),
      updated_at = now()
  WHERE id = ANY(p_group_ids)
    AND payment_id = p_payment_id
    AND status IN ('aguardando_validacao', 'em_questionamento', 'devolvido_analista');

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> COALESCE(array_length(p_group_ids, 1), 0) THEN
    RAISE EXCEPTION 'Encaminhamento bloqueado: todas as empresas precisam estar na etapa de validação.';
  END IF;

  IF p_note IS NOT NULL AND btrim(p_note) <> '' THEN
    INSERT INTO public.payment_observations(
      payment_id, author_id, author_type, message,
      status_from, status_to, observation_type
    ) VALUES (
      p_payment_id, v_actor, 'validador'::public.observation_author, p_note,
      'aguardando_validacao'::public.payment_status,
      'aguardando_aprovacao'::public.payment_status,
      'informativo'::public.observation_type
    );
  END IF;

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$function$;

-- ---------------------------------------------------------------- 4
CREATE OR REPLACE FUNCTION public.register_external_approval(p_payment_id uuid, p_group_ids uuid[], p_registered_by uuid, p_director_name text, p_source text, p_evidence_path text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
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

  UPDATE public.payment_company_groups
  SET status = 'revisao_pos_aprovacao',
      approved_by = v_actor,
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

-- ---------------------------------------------------------------- 5
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

-- ---------------------------------------------------------------- 6
CREATE OR REPLACE FUNCTION public.register_external_validation(p_payment_id uuid, p_group_ids uuid[], p_registered_by uuid, p_supervisor_name text, p_source text, p_evidence_path text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  updated_count integer;
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

  UPDATE public.payment_company_groups
  SET status = 'aguardando_aprovacao',
      validated_by = v_actor,
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

-- ---------------------------------------------------------------- 7
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

-- ---------------------------------------------------------------- 8
CREATE OR REPLACE FUNCTION public.question_company_group(p_company_group_id uuid, p_author_id uuid, p_author_name text, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_payment_id uuid;
  v_question_id uuid;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT payment_id INTO v_payment_id FROM public.payment_company_groups WHERE id = p_company_group_id;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = v_payment_id));
  END IF;

  INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
  VALUES (v_payment_id, p_company_group_id, v_actor, p_author_name, p_message)
  RETURNING id INTO v_question_id;

  UPDATE public.payment_company_groups
  SET status = 'em_questionamento', updated_at = now()
  WHERE id = p_company_group_id;

  PERFORM public.recompute_payment_status_from_groups(v_payment_id);

  RETURN v_question_id;
END;
$function$;

-- ---------------------------------------------------------------- 9
CREATE OR REPLACE FUNCTION public.reply_question(p_company_group_id uuid, p_author_id uuid, p_author_name text, p_message text, p_is_analista boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_payment_id uuid;
  v_prev_status public.payment_status;
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT payment_id INTO v_payment_id
  FROM public.payment_company_groups
  WHERE id = p_company_group_id;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = v_payment_id));
  END IF;

  INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
  VALUES (v_payment_id, p_company_group_id, v_actor, p_author_name, p_message);

  IF p_is_analista THEN
    SELECT status INTO v_prev_status FROM public.payments WHERE id = v_payment_id;

    IF v_prev_status IN ('aguardando_aprovacao', 'em_questionamento') THEN
      IF EXISTS (
        SELECT 1 FROM public.payment_company_groups
        WHERE payment_id = v_payment_id
        AND id != p_company_group_id
        AND status = 'aguardando_aprovacao'
      ) THEN
        UPDATE public.payment_company_groups
        SET status = 'aguardando_aprovacao', updated_at = now()
        WHERE id = p_company_group_id;
      ELSE
        UPDATE public.payment_company_groups
        SET status = 'aguardando_validacao', updated_at = now()
        WHERE id = p_company_group_id;
      END IF;
    END IF;

    PERFORM public.recompute_payment_status_from_groups(v_payment_id);
  END IF;
END;
$function$;

-- ---------------------------------------------------------------- 10
CREATE OR REPLACE FUNCTION public.return_groups_to_analyst(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  END IF;

  INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
  SELECT p_payment_id, g, v_actor, p_author_name, p_message
  FROM unnest(p_group_ids) g;

  UPDATE public.payment_company_groups
  SET status = 'devolvido_analista', updated_at = now()
  WHERE id = ANY(p_group_ids) AND payment_id = p_payment_id;

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$function$;

-- ---------------------------------------------------------------- 11
CREATE OR REPLACE FUNCTION public.return_groups_to_analyst(p_payment_id uuid, p_group_ids uuid[], p_author_id uuid, p_author_name text, p_message text, p_lot_level boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid;
  v_internal boolean := public.is_service_role_call();
BEGIN
  v_actor := COALESCE(auth.uid(), CASE WHEN v_internal THEN p_author_id END);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT v_internal THEN
    PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = p_payment_id));
  END IF;

  -- Quando devolução é do lote completo, registra UMA única observação no nível
  -- do lote (company_group_id = NULL) em vez de duplicar a mesma mensagem em
  -- cada empresa — caso contrário a caixa de Conversas fica poluída com 100+
  -- threads idênticas. Devolução parcial mantém o comportamento original.
  IF p_lot_level THEN
    INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
    VALUES (p_payment_id, NULL, v_actor, p_author_name, p_message);
  ELSE
    INSERT INTO public.payment_questions(payment_id, company_group_id, author_id, author_name, message)
    SELECT p_payment_id, g, v_actor, p_author_name, p_message
    FROM unnest(p_group_ids) g;
  END IF;

  UPDATE public.payment_company_groups
  SET status = 'devolvido_analista', updated_at = now()
  WHERE id = ANY(p_group_ids) AND payment_id = p_payment_id;

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$function$;