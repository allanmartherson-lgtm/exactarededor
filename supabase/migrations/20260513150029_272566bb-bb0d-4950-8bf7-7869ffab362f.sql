-- Sub-Onda 2C — Detecção e resolução de duplicidade entre cálculos da mesma regra

-- 1) Novo status do enum item_ai_status: erro de cadastro de regra (não erro de pagamento).
ALTER TYPE public.item_ai_status ADD VALUE IF NOT EXISTS 'erro_duplicidade_calculo';

-- Commit do enum precisa fluir antes da função usá-lo.
COMMIT;
BEGIN;

-- 2) Função SQL de override pelo analista.
-- Valida role autorizada (analista/validador/diretor/admin), justificativa não-vazia e ≥20 chars,
-- chosen_calc_id presente em ai_findings.calc_duplicity.matched_calculations.
-- Atualiza item: applied_calc_id, applied_calc_method, expected_amount, ai_status='pendente'
-- e grava resolution + audit_log.
CREATE OR REPLACE FUNCTION public.apply_calc_duplicity_resolution(
  _item_id uuid,
  _chosen_calc_id uuid,
  _justification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_findings jsonb;
  v_status public.item_ai_status;
  v_match jsonb;
  v_chosen jsonb;
  v_method text;
  v_expected numeric;
  v_new_findings jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'analista'::app_role) OR
    public.has_role(v_actor, 'validador'::app_role) OR
    public.has_role(v_actor, 'diretor'::app_role) OR
    public.has_role(v_actor, 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para resolver duplicidade de cálculo' USING ERRCODE = '42501';
  END IF;

  IF _justification IS NULL OR length(trim(_justification)) < 20 THEN
    RAISE EXCEPTION 'Justificativa obrigatória, mínimo 20 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT pi.ai_findings, pi.ai_status
    INTO v_findings, v_status
  FROM public.payment_items pi
  WHERE pi.id = _item_id;

  IF v_findings IS NULL AND v_status IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IS DISTINCT FROM 'erro_duplicidade_calculo'::public.item_ai_status THEN
    RAISE EXCEPTION 'Item não está em erro_duplicidade_calculo (status atual: %)', v_status USING ERRCODE = 'P0002';
  END IF;

  v_match := COALESCE(v_findings->'calc_duplicity'->'matched_calculations', '[]'::jsonb);
  IF jsonb_typeof(v_match) <> 'array' OR jsonb_array_length(v_match) < 2 THEN
    RAISE EXCEPTION 'Item não tem matched_calculations registrados' USING ERRCODE = 'P0002';
  END IF;

  -- Procura o cálculo escolhido na lista
  SELECT elem
    INTO v_chosen
  FROM jsonb_array_elements(v_match) elem
  WHERE NULLIF(elem->>'calc_id','')::uuid = _chosen_calc_id
  LIMIT 1;

  IF v_chosen IS NULL THEN
    RAISE EXCEPTION 'chosen_calc_id não está em matched_calculations' USING ERRCODE = '22023';
  END IF;

  v_method := public.map_calculation_type_to_method(v_chosen->>'calculation_type');
  v_expected := NULLIF(v_chosen->>'expected','')::numeric;

  v_new_findings := jsonb_set(
    v_findings,
    '{calc_duplicity,resolution}',
    jsonb_build_object(
      'chosen_calc_id', _chosen_calc_id,
      'chosen_by',      v_actor,
      'chosen_at',      to_jsonb(now()),
      'justification',  _justification
    ),
    true
  );

  UPDATE public.payment_items
     SET applied_calc_id    = _chosen_calc_id,
         applied_calc_method= v_method,
         expected_amount    = v_expected,
         applied_at         = now(),
         ai_status          = 'pendente'::public.item_ai_status,
         ai_findings        = v_new_findings
   WHERE id = _item_id;

  INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
  VALUES (v_actor, 'payment_item', _item_id, 'calc_duplicity_resolution',
          jsonb_build_object(
            'chosen_calc_id', _chosen_calc_id,
            'expected', v_expected,
            'method', v_method,
            'justification', _justification
          ));

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', _item_id,
    'chosen_calc_id', _chosen_calc_id,
    'expected_amount', v_expected,
    'applied_calc_method', v_method
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_calc_duplicity_resolution(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_calc_duplicity_resolution(uuid, uuid, text) TO authenticated;
