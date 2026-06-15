
-- 1) Colunas externas nos grupos
ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS approval_source text NOT NULL DEFAULT 'system'
    CHECK (approval_source IN ('system','magic_link','email','whatsapp','outro')),
  ADD COLUMN IF NOT EXISTS approval_on_behalf_of text,
  ADD COLUMN IF NOT EXISTS approval_evidence_path text,
  ADD COLUMN IF NOT EXISTS approval_external_note text,
  ADD COLUMN IF NOT EXISTS approval_registered_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS validation_source text NOT NULL DEFAULT 'system'
    CHECK (validation_source IN ('system','email','whatsapp','outro')),
  ADD COLUMN IF NOT EXISTS validation_on_behalf_of text,
  ADD COLUMN IF NOT EXISTS validation_evidence_path text,
  ADD COLUMN IF NOT EXISTS validation_external_note text,
  ADD COLUMN IF NOT EXISTS validation_registered_by uuid REFERENCES auth.users(id);

-- 2) Limpa colunas erradas em production_validations
ALTER TABLE public.production_validations
  DROP COLUMN IF EXISTS validation_source,
  DROP COLUMN IF EXISTS validated_on_behalf_of,
  DROP COLUMN IF EXISTS external_evidence_path,
  DROP COLUMN IF EXISTS external_note,
  DROP COLUMN IF EXISTS registered_by;

-- 3) RPC: aprovação externa do diretor
CREATE OR REPLACE FUNCTION public.register_external_approval(
  p_payment_id uuid,
  p_group_ids uuid[],
  p_registered_by uuid,
  p_director_name text,
  p_source text,
  p_evidence_path text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF NOT (public.has_role(p_registered_by, 'admin'::public.app_role)
       OR public.has_role(p_registered_by, 'analista'::public.app_role)
       OR public.has_role(p_registered_by, 'diretor'::public.app_role)) THEN
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
      approved_by = p_registered_by,
      approved_at = now(),
      approval_source = p_source,
      approval_on_behalf_of = p_director_name,
      approval_evidence_path = p_evidence_path,
      approval_external_note = p_note,
      approval_registered_by = p_registered_by,
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
    p_payment_id, p_registered_by, 'diretor'::public.observation_author,
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
$$;

GRANT EXECUTE ON FUNCTION public.register_external_approval(uuid, uuid[], uuid, text, text, text, text) TO authenticated;

-- 4) RPC: validação externa do supervisor
CREATE OR REPLACE FUNCTION public.register_external_validation(
  p_payment_id uuid,
  p_group_ids uuid[],
  p_registered_by uuid,
  p_supervisor_name text,
  p_source text,
  p_evidence_path text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF NOT (public.has_role(p_registered_by, 'admin'::public.app_role)
       OR public.has_role(p_registered_by, 'analista'::public.app_role)
       OR public.has_role(p_registered_by, 'validador'::public.app_role)) THEN
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
      validated_by = p_registered_by,
      validated_at = now(),
      validation_source = p_source,
      validation_on_behalf_of = p_supervisor_name,
      validation_evidence_path = p_evidence_path,
      validation_external_note = p_note,
      validation_registered_by = p_registered_by,
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
    p_payment_id, p_registered_by, 'validador'::public.observation_author,
    format('Validação externa registrada (%s) em nome de %s.%s',
      p_source, p_supervisor_name, CASE WHEN COALESCE(btrim(p_note),'')='' THEN '' ELSE ' Nota: '||p_note END),
    'aguardando_validacao'::public.payment_status,
    'aguardando_aprovacao'::public.payment_status,
    'informativo'::public.observation_type
  );

  PERFORM public.recompute_payment_status_from_groups(p_payment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_external_validation(uuid, uuid[], uuid, text, text, text, text) TO authenticated;
