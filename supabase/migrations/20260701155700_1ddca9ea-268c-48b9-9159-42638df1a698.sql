CREATE INDEX IF NOT EXISTS idx_payment_items_payment_company_id
  ON public.payment_items (payment_id, company_id);

CREATE OR REPLACE FUNCTION public.trg_recalc_priority_related_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR r IN
      SELECT DISTINCT COALESCE(n.payment_id, o.payment_id) AS payment_id
      FROM new_rows n
      FULL JOIN old_rows o USING (id)
      WHERE n.ai_status IS DISTINCT FROM o.ai_status
        AND COALESCE(n.payment_id, o.payment_id) IS NOT NULL
    LOOP
      PERFORM public.recalc_payment_priority(r.payment_id);
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_items_recalc_priority ON public.payment_items;

CREATE TRIGGER trg_items_recalc_priority
AFTER UPDATE ON public.payment_items
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.trg_recalc_priority_related_statement();

CREATE OR REPLACE FUNCTION public.invalidate_company_financials_snapshot_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN
      SELECT DISTINCT payment_id, company_id
      FROM new_rows
      WHERE payment_id IS NOT NULL AND company_id IS NOT NULL
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
    LOOP
      UPDATE public.payment_company_financials
         SET updated_at = now()
       WHERE payment_id = r.payment_id AND company_id = r.company_id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_items_invalidate_financials ON public.payment_items;
DROP TRIGGER IF EXISTS trg_payment_items_invalidate_financials_ins ON public.payment_items;
DROP TRIGGER IF EXISTS trg_payment_items_invalidate_financials_upd ON public.payment_items;
DROP TRIGGER IF EXISTS trg_payment_items_invalidate_financials_del ON public.payment_items;

CREATE TRIGGER trg_payment_items_invalidate_financials_ins
AFTER INSERT ON public.payment_items
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.invalidate_company_financials_snapshot_statement();

CREATE TRIGGER trg_payment_items_invalidate_financials_upd
AFTER UPDATE ON public.payment_items
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.invalidate_company_financials_snapshot_statement();

CREATE TRIGGER trg_payment_items_invalidate_financials_del
AFTER DELETE ON public.payment_items
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.invalidate_company_financials_snapshot_statement();

CREATE OR REPLACE FUNCTION public.apply_zeev_bulk_manual(
  _item_ids uuid[],
  _reason_id uuid,
  _notes text,
  _source text DEFAULT 'zeev_bulk'::text,
  _override_reason text DEFAULT 'zeev_bulk_manual'::text
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid := auth.uid();
  _now timestamptz := now();
  _reason_code text;
  _count int := 0;
  _notes_clean text := NULLIF(btrim(_notes), '');
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _item_ids IS NULL OR array_length(_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no items provided';
  END IF;
  IF _reason_id IS NULL THEN
    RAISE EXCEPTION 'reason_id required';
  END IF;

  IF NOT (
    public.has_role(_actor, 'admin')
    OR public.has_role(_actor, 'diretor')
    OR public.has_role(_actor, 'validador')
    OR public.has_role(_actor, 'analista')
    OR public.has_role(_actor, 'gestao_medica')
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT code INTO _reason_code
  FROM public.manual_intervention_reasons
  WHERE id = _reason_id;

  WITH target AS (
    SELECT DISTINCT unnest(_item_ids) AS id
  ),
  updated AS (
    UPDATE public.payment_items pi
       SET manual_intervention_reason_id = _reason_id,
           manual_intervention_notes = _notes_clean,
           manual_intervention_by = _actor,
           manual_intervention_source = _source,
           ai_status = 'aprovado',
           expected_amount = COALESCE(pi.procedure_amount, pi.expected_amount),
           gross_amount = COALESCE(pi.procedure_amount, pi.gross_amount),
           gross_amount_original = CASE
             WHEN pi.procedure_amount IS NOT NULL AND pi.gross_override_at IS NULL THEN pi.gross_amount
             ELSE pi.gross_amount_original
           END,
           gross_override_at = CASE
             WHEN pi.procedure_amount IS NOT NULL THEN _now
             ELSE pi.gross_override_at
           END,
           gross_override_by = CASE
             WHEN pi.procedure_amount IS NOT NULL THEN _actor
             ELSE pi.gross_override_by
           END,
           gross_override_reason = CASE
             WHEN pi.procedure_amount IS NOT NULL THEN _override_reason
             ELSE pi.gross_override_reason
           END
      FROM target t
     WHERE pi.id = t.id
       AND (
            pi.manual_intervention_reason_id IS DISTINCT FROM _reason_id
         OR pi.manual_intervention_notes IS DISTINCT FROM _notes_clean
         OR pi.manual_intervention_by IS DISTINCT FROM _actor
         OR pi.manual_intervention_source IS DISTINCT FROM _source
         OR pi.ai_status IS DISTINCT FROM 'aprovado'
         OR (pi.procedure_amount IS NOT NULL AND pi.expected_amount IS DISTINCT FROM pi.procedure_amount)
         OR (pi.procedure_amount IS NOT NULL AND pi.gross_amount IS DISTINCT FROM pi.procedure_amount)
         OR (pi.procedure_amount IS NOT NULL AND pi.gross_override_by IS DISTINCT FROM _actor)
         OR (pi.procedure_amount IS NOT NULL AND pi.gross_override_reason IS DISTINCT FROM _override_reason)
       )
     RETURNING pi.id, pi.hospital_id
  ),
  audit_ins AS (
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, hospital_id, diff)
    SELECT 'payment_item',
           u.id,
           'update',
           _actor,
           u.hospital_id,
           jsonb_build_object(
             '__op', jsonb_build_object('before', NULL, 'after', 'zeev_bulk_apply:' || COALESCE(_reason_code, _reason_id::text)),
             'manual_intervention_reason_id', jsonb_build_object('before', NULL, 'after', _reason_id)
           )
    FROM updated u
    RETURNING 1
  )
  SELECT count(*)::int INTO _count FROM audit_ins;

  RETURN QUERY SELECT _count;
END;
$$;