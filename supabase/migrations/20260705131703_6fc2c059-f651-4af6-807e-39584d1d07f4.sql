-- Reduz deadlocks entre payment_items, payment_company_financials,
-- payment_company_groups e payments usando uma ordem canônica de locks.

-- 1) Garante que recomputar prioridade rode por último nos triggers AFTER UPDATE
-- de payment_items. Antes ele pegava lock em payments antes do fluxo financeiro
-- pegar payment_company_financials/payment_company_groups, invertendo a ordem
-- contra compute-company-financials.
DROP TRIGGER IF EXISTS trg_items_recalc_priority ON public.payment_items;
DROP TRIGGER IF EXISTS zzz_items_recalc_priority ON public.payment_items;

CREATE TRIGGER zzz_items_recalc_priority
AFTER UPDATE ON public.payment_items
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_recalc_priority_related_statement();

-- 2) Ordena os pares pagamento/empresa afetados. Em statements que mexem em
-- múltiplas empresas, todos os processos passam a tentar locks na mesma ordem.
CREATE OR REPLACE FUNCTION public.invalidate_company_financials_snapshot_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN
      SELECT DISTINCT payment_id, company_id
      FROM new_rows
      WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
      ORDER BY payment_id, company_id
    LOOP
      UPDATE public.payment_company_financials
         SET updated_at = now()
       WHERE payment_id = r.payment_id AND company_id = r.company_id;
    END LOOP;

  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN
      SELECT DISTINCT payment_id, company_id
      FROM old_rows
      WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
      ORDER BY payment_id, company_id
    LOOP
      UPDATE public.payment_company_financials
         SET updated_at = now()
       WHERE payment_id = r.payment_id AND company_id = r.company_id;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' THEN
    FOR r IN
      SELECT DISTINCT payment_id, company_id
      FROM (
        SELECT n.payment_id, n.company_id
        FROM new_rows n
        JOIN old_rows o USING (id)
        WHERE n.company_id IS DISTINCT FROM o.company_id
           OR n.gross_amount IS DISTINCT FROM o.gross_amount
           OR n.expected_amount IS DISTINCT FROM o.expected_amount
           OR n.applied_rule_id IS DISTINCT FROM o.applied_rule_id
           OR n.is_cancelled IS DISTINCT FROM o.is_cancelled
           OR n.package_absorbed IS DISTINCT FROM o.package_absorbed
        UNION
        SELECT o.payment_id, o.company_id
        FROM new_rows n
        JOIN old_rows o USING (id)
        WHERE n.company_id IS DISTINCT FROM o.company_id
           OR n.gross_amount IS DISTINCT FROM o.gross_amount
           OR n.expected_amount IS DISTINCT FROM o.expected_amount
           OR n.applied_rule_id IS DISTINCT FROM o.applied_rule_id
           OR n.is_cancelled IS DISTINCT FROM o.is_cancelled
           OR n.package_absorbed IS DISTINCT FROM o.package_absorbed
      ) changed
      WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
      ORDER BY payment_id, company_id
    LOOP
      UPDATE public.payment_company_financials
         SET updated_at = now()
       WHERE payment_id = r.payment_id AND company_id = r.company_id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_sync_company_groups_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    FOR r IN
      SELECT DISTINCT payment_id, company_id
      FROM new_rows
      WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
      ORDER BY payment_id, company_id
    LOOP
      PERFORM public.sync_payment_company_group(r.payment_id, r.company_id);
    END LOOP;
  END IF;

  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    FOR r IN
      SELECT DISTINCT payment_id, company_id
      FROM old_rows
      WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
      ORDER BY payment_id, company_id
    LOOP
      PERFORM public.sync_payment_company_group(r.payment_id, r.company_id);
    END LOOP;
  END IF;

  RETURN NULL;
END;
$function$;

-- 3) Gravação canônica do snapshot financeiro: pega o advisory lock do pagamento
-- ANTES de fazer o upsert em payment_company_financials. Assim, compute-company-
-- financials e acatar/desfazer acate não entram mais em ordem inversa de locks.
CREATE OR REPLACE FUNCTION public.upsert_payment_company_financials_snapshot(
  p_payment_id uuid,
  p_company_id uuid,
  p_bruto numeric,
  p_debitos numeric,
  p_creditos numeric,
  p_glosas numeric,
  p_pool numeric,
  p_pool_aplicado boolean,
  p_pool_preview boolean,
  p_pool_detalhes jsonb,
  p_conciliacao numeric,
  p_conciliacao_aplicada boolean,
  p_liquido numeric,
  p_computed_at timestamptz DEFAULT now(),
  p_computed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_id e company_id obrigatórios');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 0));

  INSERT INTO public.payment_company_financials (
    payment_id,
    company_id,
    bruto,
    debitos,
    creditos,
    glosas,
    pool,
    pool_aplicado,
    pool_preview,
    pool_detalhes,
    conciliacao,
    conciliacao_aplicada,
    liquido,
    computed_at,
    computed_by
  ) VALUES (
    p_payment_id,
    p_company_id,
    COALESCE(p_bruto, 0),
    COALESCE(p_debitos, 0),
    COALESCE(p_creditos, 0),
    COALESCE(p_glosas, 0),
    COALESCE(p_pool, 0),
    COALESCE(p_pool_aplicado, false),
    COALESCE(p_pool_preview, false),
    COALESCE(p_pool_detalhes, '[]'::jsonb),
    COALESCE(p_conciliacao, 0),
    COALESCE(p_conciliacao_aplicada, false),
    COALESCE(p_liquido, 0),
    COALESCE(p_computed_at, now()),
    p_computed_by
  )
  ON CONFLICT (payment_id, company_id) DO UPDATE SET
    bruto = EXCLUDED.bruto,
    debitos = EXCLUDED.debitos,
    creditos = EXCLUDED.creditos,
    glosas = EXCLUDED.glosas,
    pool = EXCLUDED.pool,
    pool_aplicado = EXCLUDED.pool_aplicado,
    pool_preview = EXCLUDED.pool_preview,
    pool_detalhes = EXCLUDED.pool_detalhes,
    conciliacao = EXCLUDED.conciliacao,
    conciliacao_aplicada = EXCLUDED.conciliacao_aplicada,
    liquido = EXCLUDED.liquido,
    computed_at = EXCLUDED.computed_at,
    computed_by = EXCLUDED.computed_by,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_payment_company_financials_snapshot(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric, boolean, boolean, jsonb, numeric, boolean, numeric, timestamptz, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_payment_company_financials_snapshot(
  uuid, uuid, numeric, numeric, numeric, numeric, numeric, boolean, boolean, jsonb, numeric, boolean, numeric, timestamptz, uuid
) TO service_role;

-- 4) Aplica o mesmo advisory lock limpo aos fluxos relacionados ao acate.
CREATE OR REPLACE FUNCTION public.accept_payment_item_keep_paid(_item_id uuid, _justification text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid;
  v_status text;
  v_gross numeric;
  v_expected numeric;
  v_gross_original numeric;
  v_override_reason text;
  v_effective_paid numeric;
BEGIN
  SELECT payment_id INTO v_payment_id FROM public.payment_items WHERE id = _item_id;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment_id::text, 0));

  SELECT ai_status::text, gross_amount, expected_amount, gross_amount_original, gross_override_reason
    INTO v_status, v_gross, v_expected, v_gross_original, v_override_reason
  FROM public.payment_items
  WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF _justification IS NULL OR length(btrim(_justification)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Justificativa muito curta (mín. 20 caracteres).');
  END IF;

  IF v_status NOT IN ('reprovado', 'alerta')
     AND NOT (v_status = 'acatado' AND v_override_reason = 'acatado_esperado' AND v_gross_original IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Não é possível manter pago para item com status "%s".', v_status));
  END IF;

  v_effective_paid := CASE
    WHEN v_status = 'acatado' AND v_override_reason = 'acatado_esperado' AND v_gross_original IS NOT NULL THEN v_gross_original
    ELSE v_gross
  END;

  UPDATE public.payment_items SET
    acatado_status_original = CASE
      WHEN ai_status::text = 'acatado' THEN acatado_status_original
      ELSE ai_status::text
    END,
    ai_status = 'acatado'::item_ai_status,
    acatado_by = auth.uid(),
    acatado_at = NOW(),
    gross_amount = v_effective_paid,
    expected_amount = v_effective_paid,
    ai_findings = CASE
      WHEN ai_findings IS NULL THEN jsonb_build_object('expected_amount', v_effective_paid, 'alerts', '[]'::jsonb)
      ELSE jsonb_set(
             jsonb_set(ai_findings, '{expected_amount}', to_jsonb(v_effective_paid), true),
             '{alerts}', '[]'::jsonb, true)
    END,
    gross_amount_original = CASE
      WHEN v_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_amount_original
    END,
    gross_override_at = NOW(),
    gross_override_by = auth.uid(),
    gross_override_reason = 'acatado_pago'
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', CASE WHEN v_status = 'acatado' THEN 'acate_convertido_para_pago' ELSE 'acatado_mantendo_pago' END,
      'status_anterior', v_status,
      'gross_anterior', v_gross,
      'gross_mantido', v_effective_paid,
      'esperado_anterior', v_expected,
      'esperado_alinhado', v_effective_paid,
      'override_anterior', v_override_reason,
      'justificativa', _justification
    ));

  RETURN jsonb_build_object('ok', true, 'gross_mantido', v_effective_paid, 'expected_amount', v_effective_paid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_accept_payment_item(_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid;
  v_status text;
  v_original text;
  v_gross_original numeric;
  v_gross_current numeric;
BEGIN
  SELECT payment_id INTO v_payment_id FROM public.payment_items WHERE id = _item_id;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment_id::text, 0));

  SELECT ai_status::text, acatado_status_original, gross_amount_original, gross_amount
    INTO v_status, v_original, v_gross_original, v_gross_current
  FROM public.payment_items
  WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_status <> 'acatado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não está acatado');
  END IF;

  UPDATE public.payment_items SET
    ai_status = COALESCE(v_original, 'reprovado')::item_ai_status,
    acatado_by = NULL,
    acatado_at = NULL,
    acatado_status_original = NULL,
    gross_amount = CASE
      WHEN gross_override_reason = 'acatado_esperado' AND gross_amount_original IS NOT NULL THEN gross_amount_original
      ELSE gross_amount
    END,
    gross_amount_original = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_amount_original
    END,
    gross_override_at = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_override_at
    END,
    gross_override_by = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_override_by
    END,
    gross_override_reason = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_override_reason
    END
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', 'acate_desfeito',
      'status_restaurado', COALESCE(v_original, 'reprovado'),
      'gross_restaurado', COALESCE(v_gross_original, v_gross_current)
    ));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.accept_payment_item_keep_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_payment_item_keep_paid(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.undo_accept_payment_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_accept_payment_item(uuid) TO authenticated;