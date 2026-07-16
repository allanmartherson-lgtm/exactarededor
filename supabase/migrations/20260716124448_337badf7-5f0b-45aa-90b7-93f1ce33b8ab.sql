-- 1) Campos de reversão em glosa_debts
ALTER TABLE public.glosa_debts
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS reverted_reason text;

-- 2) Amplia CHECK de status para aceitar 'revertido'
ALTER TABLE public.glosa_debts DROP CONSTRAINT IF EXISTS glosa_debts_status_check;
ALTER TABLE public.glosa_debts
  ADD CONSTRAINT glosa_debts_status_check
  CHECK (status = ANY (ARRAY['ativo'::text,'quitado'::text,'parcial'::text,'revertido'::text]));

-- 3) RPC de reversão
CREATE OR REPLACE FUNCTION public.revert_glosa_debt(
  p_debt_id uuid,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_debt          public.glosa_debts%ROWTYPE;
  v_hospital      uuid;
  v_locked_count  int;
  v_reopened_item boolean := false;
  v_source_status text;
  v_affected      uuid[];
  v_pid           uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_debt_id IS NULL THEN
    RAISE EXCEPTION 'debt_id_required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  -- Lock defensivo
  SELECT * INTO v_debt FROM public.glosa_debts WHERE id = p_debt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'debt_not_found'; END IF;

  v_hospital := v_debt.hospital_id;

  -- Hospital ativo do usuário deve casar (defesa em profundidade além da RLS)
  IF v_hospital IS DISTINCT FROM public.current_active_hospital() THEN
    RAISE EXCEPTION 'wrong_hospital_scope';
  END IF;

  -- Short-circuit se já revertido
  IF v_debt.status = 'revertido' THEN
    RETURN jsonb_build_object(
      'debt_id', v_debt.id,
      'already_reverted', true,
      'affected_payment_ids', '[]'::jsonb
    );
  END IF;

  -- Bloqueio: aplicações confirmadas em lote lançado/arquivado/pago
  SELECT count(*) INTO v_locked_count
  FROM public.glosa_payment_applications gpa
  JOIN public.payments p ON p.id = gpa.payment_id
  WHERE gpa.glosa_debt_id = p_debt_id
    AND gpa.status IN ('confirmado','partial')
    AND p.status IN ('lancado','arquivado','pago');

  IF v_locked_count > 0 THEN
    RAISE EXCEPTION 'glosa_locked_in_finalized_payment';
  END IF;

  -- Coleta lotes afetados antes de reverter
  SELECT COALESCE(array_agg(DISTINCT gpa.payment_id), ARRAY[]::uuid[]) INTO v_affected
  FROM public.glosa_payment_applications gpa
  WHERE gpa.glosa_debt_id = p_debt_id
    AND gpa.status IN ('proposto','confirmado','partial','postponed','pending_manual_resolution');

  -- Reverte todas as aplicações ativas
  UPDATE public.glosa_payment_applications
     SET status          = 'revertido',
         reverted_at     = now(),
         reverted_by     = v_uid,
         reverted_reason = p_reason
   WHERE glosa_debt_id = p_debt_id
     AND status IN ('proposto','confirmado','partial','postponed','pending_manual_resolution');

  -- Marca a dívida como revertida
  UPDATE public.glosa_debts
     SET status          = 'revertido',
         reverted_at     = now(),
         reverted_by     = v_uid,
         reverted_reason = p_reason,
         updated_at      = now()
   WHERE id = p_debt_id;

  -- Se veio da conciliação, tenta devolver o item para "Só no Exacta"
  IF v_debt.origem = 'conciliacao_residual'
     AND v_debt.origem_reconciliation_item_id IS NOT NULL
     AND v_debt.origem_payment_id IS NOT NULL THEN

    SELECT p.status INTO v_source_status
      FROM public.payments p WHERE p.id = v_debt.origem_payment_id;

    -- Só reabre se o lote de origem ainda está na etapa de análise
    -- (o trigger enforce_recon_action_analysis_stage bloquearia fora disso).
    IF v_source_status IN (
      'rascunho','em_confeccao','em_analise_ia','revisao_analista',
      'concluida_analista','devolvido_analista','aprovado_em_revisao',
      'aguardando_validacao','aguardando_aprovacao'
    ) THEN
      UPDATE public.reconciliation_items
         SET action_taken    = NULL,
             action_note     = COALESCE(action_note,'') ||
                              CASE WHEN COALESCE(action_note,'')='' THEN '' ELSE ' | ' END ||
                              'Glosa revertida em ' || to_char(now(),'DD/MM/YYYY HH24:MI') ||
                              ' — item devolvido à conciliação'
       WHERE id = v_debt.origem_reconciliation_item_id
         AND action_taken = 'marcar_glosa';
      GET DIAGNOSTICS v_reopened_item = ROW_COUNT;
      v_reopened_item := v_reopened_item::int > 0;
    END IF;
  END IF;

  -- Auditoria: um evento por lote afetado (ou 1 evento sem payment se nada afetado)
  IF array_length(v_affected, 1) IS NULL THEN
    INSERT INTO public.deduction_application_events
      (hospital_id, user_id, user_email, payment_id, company_id, debt_id, action, reason, metadata)
    VALUES
      (v_hospital, v_uid,
       (SELECT email FROM auth.users WHERE id = v_uid),
       NULL, v_debt.company_id, v_debt.id, 'glosa_revertida', p_reason,
       jsonb_build_object(
         'origem', v_debt.origem,
         'reconciliation_item_reopened', v_reopened_item,
         'total_debt', v_debt.total_debt
       ));
  ELSE
    FOREACH v_pid IN ARRAY v_affected LOOP
      INSERT INTO public.deduction_application_events
        (hospital_id, user_id, user_email, payment_id, company_id, debt_id, action, reason, metadata)
      VALUES
        (v_hospital, v_uid,
         (SELECT email FROM auth.users WHERE id = v_uid),
         v_pid, v_debt.company_id, v_debt.id, 'glosa_revertida', p_reason,
         jsonb_build_object(
           'origem', v_debt.origem,
           'reconciliation_item_reopened', v_reopened_item,
           'total_debt', v_debt.total_debt
         ));
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'debt_id', v_debt.id,
    'already_reverted', false,
    'reconciliation_item_reopened', v_reopened_item,
    'affected_payment_ids', to_jsonb(v_affected)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revert_glosa_debt(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_glosa_debt(uuid, text) TO authenticated;