-- 1. Novas colunas de origem em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS cancellation_source text
    CHECK (cancellation_source IN ('manual','reconciliacao')),
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid
    REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL;

-- 2. Novas colunas de origem em payment_company_groups
ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS cancellation_source text
    CHECK (cancellation_source IN ('manual','reconciliacao')),
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid
    REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL;

-- 3. Backfill: tudo que já estava cancelado é manual
UPDATE public.payment_items
   SET cancellation_source = 'manual'
 WHERE is_cancelled = true AND cancellation_source IS NULL;

UPDATE public.payment_company_groups
   SET cancellation_source = 'manual'
 WHERE cancelled_at IS NOT NULL AND cancellation_source IS NULL;

-- 4. Índices p/ filtros e relatórios
CREATE INDEX IF NOT EXISTS idx_items_cancel_source
  ON public.payment_items(cancellation_source) WHERE is_cancelled = true;
CREATE INDEX IF NOT EXISTS idx_items_cancel_run
  ON public.payment_items(reconciliation_run_id) WHERE reconciliation_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_groups_cancel_source
  ON public.payment_company_groups(cancellation_source) WHERE cancelled_at IS NOT NULL;

-- 5. RPC: cancelar a partir da conciliação
-- p_scope aceita:
--   {"item_ids":["uuid",...]}
--   {"company_group_id":"uuid"}
--   {"attendance_number":"123", "company_name":"ACME"}  (cancela todos itens do atendimento+empresa)
--   {"company_name":"ACME"}                              (cancela todo o grupo da empresa)
CREATE OR REPLACE FUNCTION public.cancel_by_reconciliation(
  p_run_id uuid,
  p_payment_id uuid,
  p_scope jsonb,
  p_reason public.payment_cancellation_reason,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hospital uuid;
  v_payment_status text;
  v_items_affected int := 0;
  v_groups_affected int := 0;
  v_target_ids uuid[];
  v_recon_marked int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT hospital_id, status::text INTO v_hospital, v_payment_status
    FROM public.payments WHERE id = p_payment_id;
  IF v_hospital IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF v_payment_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_cancel_paid_payment';
  END IF;

  -- bloqueio NF
  IF EXISTS (
    SELECT 1 FROM public.invoices
     WHERE payment_id = p_payment_id
       AND status IN ('nf_recebida','nf_conciliada','lancado')
  ) THEN
    RAISE EXCEPTION 'cannot_cancel_with_active_invoice';
  END IF;

  -- Resolve escopo → lista de payment_item_ids
  IF p_scope ? 'item_ids' THEN
    SELECT array_agg((x)::uuid) INTO v_target_ids
      FROM jsonb_array_elements_text(p_scope->'item_ids') x;
  ELSIF p_scope ? 'company_group_id' THEN
    SELECT array_agg(pi.id) INTO v_target_ids
      FROM public.payment_items pi
      JOIN public.payment_company_groups g
        ON g.payment_id = pi.payment_id AND g.company_id = pi.company_id
     WHERE g.id = (p_scope->>'company_group_id')::uuid
       AND pi.is_cancelled = false;
  ELSIF (p_scope ? 'attendance_number') AND (p_scope ? 'company_name') THEN
    SELECT array_agg(pi.id) INTO v_target_ids
      FROM public.payment_items pi
     WHERE pi.payment_id = p_payment_id
       AND pi.attendance_number = (p_scope->>'attendance_number')
       AND public.normalize_text_for_match(pi.company_name)
           = public.normalize_text_for_match(p_scope->>'company_name')
       AND pi.is_cancelled = false;
  ELSIF p_scope ? 'company_name' THEN
    SELECT array_agg(pi.id) INTO v_target_ids
      FROM public.payment_items pi
     WHERE pi.payment_id = p_payment_id
       AND public.normalize_text_for_match(pi.company_name)
           = public.normalize_text_for_match(p_scope->>'company_name')
       AND pi.is_cancelled = false;
  ELSE
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'items_affected', 0, 'groups_affected', 0, 'note', 'no_targets');
  END IF;

  -- Cancela itens em lote
  WITH upd AS (
    UPDATE public.payment_items
       SET is_cancelled = true,
           cancelled_at = now(),
           cancelled_by = v_uid,
           cancellation_reason = p_reason,
           cancellation_note = COALESCE(p_note, 'Cancelado via conciliação'),
           cancellation_source = 'reconciliacao',
           reconciliation_run_id = p_run_id,
           cancellation_reactivated_at = NULL,
           cancellation_reactivated_by = NULL
     WHERE id = ANY(v_target_ids)
       AND is_cancelled = false
    RETURNING 1
  ) SELECT count(*) INTO v_items_affected FROM upd;

  -- Promove grupos 100% cancelados
  WITH grp_upd AS (
    UPDATE public.payment_company_groups g
       SET status = 'cancelado'::payment_status,
           cancelled_at = COALESCE(g.cancelled_at, now()),
           cancelled_by = COALESCE(g.cancelled_by, v_uid),
           cancellation_reason = COALESCE(g.cancellation_reason, p_reason),
           cancellation_note = COALESCE(g.cancellation_note, 'Cancelado via conciliação'),
           cancellation_source = COALESCE(g.cancellation_source, 'reconciliacao'),
           reconciliation_run_id = COALESCE(g.reconciliation_run_id, p_run_id),
           updated_at = now()
     WHERE g.payment_id = p_payment_id
       AND g.status <> 'cancelado'::payment_status
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = g.payment_id
            AND pi.company_id = g.company_id
            AND pi.is_cancelled = false
       )
       AND EXISTS (
         SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = g.payment_id
            AND pi.company_id = g.company_id
       )
    RETURNING 1
  ) SELECT count(*) INTO v_groups_affected FROM grp_upd;

  -- Marca resolução no relatório de conciliação
  WITH rec_upd AS (
    UPDATE public.reconciliation_items ri
       SET action_taken = 'cancelado_conciliacao',
           action_by = v_uid,
           action_at = now(),
           action_note = COALESCE(p_note, 'Itens cancelados via conciliação')
     WHERE ri.run_id = p_run_id
       AND ri.payment_item_id = ANY(v_target_ids)
    RETURNING 1
  ) SELECT count(*) INTO v_recon_marked FROM rec_upd;

  -- Auditoria
  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  VALUES (
    v_uid, 'cancel_by_reconciliation', 'reconciliation_runs', p_run_id,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'scope', p_scope,
      'reason', p_reason,
      'note', p_note,
      'items_affected', v_items_affected,
      'groups_affected', v_groups_affected,
      'recon_lines_marked', v_recon_marked
    ),
    v_hospital
  );

  RETURN jsonb_build_object(
    'ok', true,
    'items_affected', v_items_affected,
    'groups_affected', v_groups_affected,
    'recon_lines_marked', v_recon_marked
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_by_reconciliation(uuid, uuid, jsonb, public.payment_cancellation_reason, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_by_reconciliation(uuid, uuid, jsonb, public.payment_cancellation_reason, text) FROM anon;