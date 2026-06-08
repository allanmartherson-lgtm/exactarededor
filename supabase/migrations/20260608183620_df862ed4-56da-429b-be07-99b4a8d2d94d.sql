-- 1. Enum de motivos
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='payment_cancellation_reason') THEN
    CREATE TYPE public.payment_cancellation_reason AS ENUM (
      'medico_fatura_externamente',
      'contrato_encerrado',
      'glosa_total_quitada',
      'decisao_juridica',
      'duplicidade_externa',
      'outro'
    );
  END IF;
END $$;

-- 2. Colunas de cancelamento em payment_company_groups
ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason public.payment_cancellation_reason,
  ADD COLUMN IF NOT EXISTS cancellation_note text,
  ADD COLUMN IF NOT EXISTS cancellation_reactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reactivated_by uuid REFERENCES auth.users(id);

-- 3. Colunas de cancelamento em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason public.payment_cancellation_reason,
  ADD COLUMN IF NOT EXISTS cancellation_note text,
  ADD COLUMN IF NOT EXISTS cancellation_reactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reactivated_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_items_cancelled ON public.payment_items(payment_id) WHERE is_cancelled = true;
CREATE INDEX IF NOT EXISTS idx_groups_cancelled ON public.payment_company_groups(payment_id) WHERE cancelled_at IS NOT NULL;

-- 4. Helper: verifica se usuário pode cancelar
CREATE OR REPLACE FUNCTION public._can_cancel_payment(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('analista'::app_role,'validador'::app_role,'diretor'::app_role,'admin'::app_role)
  );
$$;

-- 5. Helper: bloqueios de cancelamento (pagamento já pago / NF lançada)
CREATE OR REPLACE FUNCTION public._assert_can_cancel_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_status text;
  v_has_nf boolean;
BEGIN
  SELECT g.payment_id, p.status::text
    INTO v_payment_id, v_status
  FROM public.payment_company_groups g
  JOIN public.payments p ON p.id = g.payment_id
  WHERE g.id = _group_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;

  IF v_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_cancel_paid_payment';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE payment_id = v_payment_id
      AND status IN ('nf_recebida','nf_conciliada','lancado')
  ) INTO v_has_nf;

  IF v_has_nf THEN
    RAISE EXCEPTION 'cannot_cancel_with_active_invoice';
  END IF;
END;
$$;

-- 6. Cancelar GRUPO (cascata: cancela todos itens)
CREATE OR REPLACE FUNCTION public.cancel_company_group_payment(
  p_group_id uuid,
  p_reason public.payment_cancellation_reason,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_old_status text;
  v_items_affected int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  PERFORM public._assert_can_cancel_group(p_group_id);

  SELECT payment_id, company_id, status::text INTO v_payment_id, v_company_id, v_old_status
  FROM public.payment_company_groups WHERE id = p_group_id;

  IF v_old_status = 'cancelado' THEN RAISE EXCEPTION 'group_already_cancelled'; END IF;

  UPDATE public.payment_company_groups
     SET status = 'cancelado'::payment_status,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         cancellation_reactivated_at = NULL,
         cancellation_reactivated_by = NULL,
         updated_at = now()
   WHERE id = p_group_id;

  WITH upd AS (
    UPDATE public.payment_items pi
       SET is_cancelled = true,
           cancelled_at = now(),
           cancelled_by = v_uid,
           cancellation_reason = p_reason,
           cancellation_note = COALESCE(p_note, 'Cancelado em cascata pelo grupo'),
           cancellation_reactivated_at = NULL,
           cancellation_reactivated_by = NULL
     WHERE pi.payment_id = v_payment_id
       AND pi.company_id = v_company_id
       AND pi.is_cancelled = false
    RETURNING 1
  ) SELECT count(*) INTO v_items_affected FROM upd;

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  SELECT v_uid, 'cancel_company_group_payment', 'payment_company_groups', p_group_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'items_affected', v_items_affected),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'items_affected', v_items_affected);
END;
$$;

-- 7. Cancelar ITEM (e promover grupo se 100% cancelado)
CREATE OR REPLACE FUNCTION public.cancel_item_payment(
  p_item_id uuid,
  p_reason public.payment_cancellation_reason,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_group_id uuid;
  v_total int; v_cancel int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT pi.payment_id, pi.company_id INTO v_payment_id, v_company_id
  FROM public.payment_items pi WHERE pi.id = p_item_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;

  SELECT id INTO v_group_id FROM public.payment_company_groups
   WHERE payment_id = v_payment_id AND company_id = v_company_id LIMIT 1;

  IF v_group_id IS NOT NULL THEN
    PERFORM public._assert_can_cancel_group(v_group_id);
  END IF;

  UPDATE public.payment_items
     SET is_cancelled = true,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         cancellation_reactivated_at = NULL,
         cancellation_reactivated_by = NULL
   WHERE id = p_item_id AND is_cancelled = false;

  -- promove grupo se 100% cancelado
  IF v_group_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE is_cancelled)
      INTO v_total, v_cancel
      FROM public.payment_items
     WHERE payment_id = v_payment_id AND company_id = v_company_id;

    IF v_total > 0 AND v_cancel = v_total THEN
      UPDATE public.payment_company_groups
         SET status = 'cancelado'::payment_status,
             cancelled_at = COALESCE(cancelled_at, now()),
             cancelled_by = COALESCE(cancelled_by, v_uid),
             cancellation_reason = COALESCE(cancellation_reason, p_reason),
             cancellation_note = COALESCE(cancellation_note, 'Cancelado automaticamente — todos os itens cancelados'),
             updated_at = now()
       WHERE id = v_group_id AND status <> 'cancelado'::payment_status;
    END IF;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  SELECT v_uid, 'cancel_item_payment', 'payment_items', p_item_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'group_promoted', (v_total > 0 AND v_cancel = v_total)),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'group_promoted', (v_total > 0 AND v_cancel = v_total));
END;
$$;

-- 8. Reativar grupo
CREATE OR REPLACE FUNCTION public.reactivate_cancelled_group(
  p_group_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid; v_company_id uuid; v_p_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT g.payment_id, g.company_id, p.status::text
    INTO v_payment_id, v_company_id, v_p_status
  FROM public.payment_company_groups g
  JOIN public.payments p ON p.id = g.payment_id
  WHERE g.id = p_group_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF v_p_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_reactivate_paid_payment';
  END IF;

  UPDATE public.payment_company_groups
     SET status = 'em_analise_ia'::payment_status,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid,
         updated_at = now()
   WHERE id = p_group_id AND status = 'cancelado'::payment_status;

  UPDATE public.payment_items
     SET is_cancelled = false,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid
   WHERE payment_id = v_payment_id
     AND company_id = v_company_id
     AND is_cancelled = true;

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  SELECT v_uid, 'reactivate_cancelled_group', 'payment_company_groups', p_group_id,
         jsonb_build_object('note', p_note),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 9. Reativar item
CREATE OR REPLACE FUNCTION public.reactivate_cancelled_item(
  p_item_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid; v_p_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT pi.payment_id, p.status::text INTO v_payment_id, v_p_status
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.id = p_item_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF v_p_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_reactivate_paid_payment';
  END IF;

  UPDATE public.payment_items
     SET is_cancelled = false,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid
   WHERE id = p_item_id AND is_cancelled = true;

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  SELECT v_uid, 'reactivate_cancelled_item', 'payment_items', p_item_id,
         jsonb_build_object('note', p_note),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 10. Atualizar get_intervention_savings para EXCLUIR cancelados
CREATE OR REPLACE FUNCTION public.get_intervention_savings(
  p_start timestamptz DEFAULT (now() - interval '30 days'),
  p_end   timestamptz DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('diretor'::app_role,'admin'::app_role,'validador'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH intervenors AS (
    SELECT ur.user_id, ur.role::text AS role FROM public.user_roles ur
    WHERE ur.role IN ('diretor'::app_role,'validador'::app_role)
  ),
  obs AS (
    SELECT o.id, o.payment_id, o.item_id, o.author_id, o.created_at, i.role
    FROM public.payment_observations o
    JOIN intervenors i ON i.user_id = o.author_id
    WHERE o.created_at BETWEEN p_start AND p_end
      AND (o.status_to = 'devolvido_analista'
        OR (o.item_id IS NOT NULL AND o.observation_type IN ('reprovacao','divergencia','alerta')))
  ),
  candidate_items AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings, pi.is_cancelled,
           o.id AS obs_id, o.author_id, o.role, o.created_at AS obs_at
    FROM obs o
    JOIN public.payment_items pi ON pi.id = o.item_id
    WHERE o.item_id IS NOT NULL
    UNION ALL
    SELECT pi.id, pi.payment_id, pi.company_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings, pi.is_cancelled,
           o.id, o.author_id, o.role, o.created_at
    FROM obs o
    JOIN public.payment_items pi ON pi.payment_id = o.payment_id
    WHERE o.item_id IS NULL
      AND pi.validation_findings IS NOT NULL
      AND jsonb_typeof(pi.validation_findings) = 'array'
      AND jsonb_array_length(pi.validation_findings) > 0
  ),
  eligible AS (
    SELECT ci.*
    FROM candidate_items ci
    JOIN public.payments p ON p.id = ci.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = ci.payment_id AND g.company_id = ci.company_id
    WHERE ci.acatado_at IS NOT NULL
      AND ci.acatado_at > ci.obs_at
      AND ci.expected_amount IS NOT NULL AND ci.expected_amount > 0
      AND ci.gross_amount    IS NOT NULL AND ci.gross_amount    > 0
      AND ci.is_cancelled = false
      AND (g.status IS NULL OR g.status <> 'cancelado'::payment_status)
      AND p.status IN ('pago','arquivado','aprovado','aprovado_em_revisao')
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY item_id ORDER BY obs_at DESC) AS rn FROM eligible
  ),
  final_items AS (
    SELECT item_id, payment_id, obs_id, author_id, role, obs_at, acatado_at,
           expected_amount AS valor_regra, gross_amount AS valor_pago_final,
           (expected_amount - gross_amount) AS delta
    FROM ranked WHERE rn = 1
  ),
  summary AS (
    SELECT COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0)::numeric AS economia,
           COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0)::numeric AS perda,
           COALESCE(SUM(delta),0)::numeric AS saldo,
           COUNT(*)::int AS qtd_itens FROM final_items
  ),
  by_role AS (
    SELECT role, COALESCE(SUM(delta),0)::numeric AS saldo, COUNT(*)::int AS qtd
    FROM final_items GROUP BY role
  ),
  by_user AS (
    SELECT fi.author_id AS user_id,
           COALESCE(pr.full_name, pr.email, fi.author_id::text) AS nome,
           fi.role, COUNT(*)::int AS qtd_itens,
           COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0)::numeric AS economia,
           COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0)::numeric AS perda,
           COALESCE(SUM(delta),0)::numeric AS saldo
    FROM final_items fi LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    GROUP BY fi.author_id, pr.full_name, pr.email, fi.role
    ORDER BY saldo DESC
  ),
  items_list AS (
    SELECT fi.item_id, fi.payment_id, fi.obs_id, fi.valor_regra, fi.valor_pago_final, fi.delta,
           fi.author_id, COALESCE(pr.full_name, pr.email, fi.author_id::text) AS autor, fi.role,
           fi.obs_at, fi.acatado_at,
           pi.doctor_name, pi.procedure_code, pi.procedure_name, pi.company_name
    FROM final_items fi
    LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    LEFT JOIN public.payment_items pi ON pi.id = fi.item_id
    ORDER BY fi.acatado_at DESC LIMIT 5000
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_role', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role br), '[]'::jsonb),
    'by_user', COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user bu), '[]'::jsonb),
    'items',   COALESCE((SELECT jsonb_agg(to_jsonb(il)) FROM items_list il), '[]'::jsonb),
    'window',  jsonb_build_object('start',p_start,'end',p_end,'hospital_id',p_hospital_id)
  ) INTO v_result;
  RETURN v_result;
END; $$;

-- 11. Resumo de cancelamentos para o relatório
CREATE OR REPLACE FUNCTION public.get_cancelled_payments_summary(
  p_start timestamptz DEFAULT (now() - interval '30 days'),
  p_end   timestamptz DEFAULT now(),
  p_hospital_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('analista'::app_role,'validador'::app_role,'diretor'::app_role,'admin'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH groups_c AS (
    SELECT g.id AS group_id, g.payment_id, g.company_id, g.company_name,
           g.total_amount AS valor, g.cancelled_at, g.cancelled_by,
           g.cancellation_reason, g.cancellation_note,
           g.cancellation_reactivated_at,
           p.hospital_id
    FROM public.payment_company_groups g
    JOIN public.payments p ON p.id = g.payment_id
    WHERE g.cancelled_at IS NOT NULL
      AND g.cancelled_at BETWEEN p_start AND p_end
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  items_c AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.company_name,
           pi.doctor_name, pi.procedure_code, pi.procedure_name,
           COALESCE(pi.gross_amount, pi.procedure_amount, 0) AS valor,
           pi.cancelled_at, pi.cancelled_by, pi.cancellation_reason, pi.cancellation_note,
           pi.cancellation_reactivated_at,
           p.hospital_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = pi.payment_id AND g.company_id = pi.company_id
    WHERE pi.is_cancelled = true
      AND pi.cancelled_at BETWEEN p_start AND p_end
      AND (g.cancelled_at IS NULL) -- exclui itens cancelados em cascata (já contados no grupo)
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
  ),
  by_reason AS (
    SELECT COALESCE(cancellation_reason::text,'outro') AS reason,
           COALESCE(SUM(valor),0)::numeric AS valor,
           COUNT(*)::int AS qtd
    FROM (
      SELECT cancellation_reason, valor FROM groups_c
      UNION ALL
      SELECT cancellation_reason, valor FROM items_c
    ) u
    GROUP BY 1 ORDER BY valor DESC
  ),
  summary AS (
    SELECT
      COALESCE((SELECT SUM(valor) FROM groups_c),0)
      + COALESCE((SELECT SUM(valor) FROM items_c),0) AS valor_total,
      (SELECT COUNT(*) FROM groups_c) AS qtd_grupos,
      (SELECT COUNT(*) FROM items_c)  AS qtd_itens
  ),
  list AS (
    SELECT 'grupo' AS nivel, gc.group_id AS id, gc.payment_id,
           gc.company_name, NULL::text AS doctor_name,
           NULL::text AS procedure_code, NULL::text AS procedure_name,
           gc.valor, gc.cancelled_at, gc.cancelled_by,
           gc.cancellation_reason::text AS reason, gc.cancellation_note AS note,
           (gc.cancellation_reactivated_at IS NOT NULL) AS reactivated,
           COALESCE(pr.full_name, pr.email, gc.cancelled_by::text) AS autor
    FROM groups_c gc LEFT JOIN public.profiles pr ON pr.id = gc.cancelled_by
    UNION ALL
    SELECT 'item', ic.item_id, ic.payment_id,
           ic.company_name, ic.doctor_name,
           ic.procedure_code, ic.procedure_name,
           ic.valor, ic.cancelled_at, ic.cancelled_by,
           ic.cancellation_reason::text, ic.cancellation_note,
           (ic.cancellation_reactivated_at IS NOT NULL),
           COALESCE(pr.full_name, pr.email, ic.cancelled_by::text)
    FROM items_c ic LEFT JOIN public.profiles pr ON pr.id = ic.cancelled_by
    ORDER BY cancelled_at DESC LIMIT 5000
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_reason', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_reason br),'[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM list l),'[]'::jsonb),
    'window', jsonb_build_object('start',p_start,'end',p_end,'hospital_id',p_hospital_id)
  ) INTO v_result;
  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_company_group_payment(uuid, public.payment_cancellation_reason, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_item_payment(uuid, public.payment_cancellation_reason, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_cancelled_group(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_cancelled_item(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cancelled_payments_summary(timestamptz, timestamptz, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_company_group_payment(uuid, public.payment_cancellation_reason, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_item_payment(uuid, public.payment_cancellation_reason, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_cancelled_group(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_cancelled_item(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_cancelled_payments_summary(timestamptz, timestamptz, uuid) FROM anon;