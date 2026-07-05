-- Complementa a correção de deadlock: item updates paralelos do mesmo lote
-- (reanálise em chunks) também passam pelos triggers de financials/groups/payments.
-- O advisory lock por payment_id no trigger serializa esses efeitos colaterais.

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
      PERFORM pg_advisory_xact_lock(hashtextextended(r.payment_id::text, 0));
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
      PERFORM pg_advisory_xact_lock(hashtextextended(r.payment_id::text, 0));
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
      PERFORM pg_advisory_xact_lock(hashtextextended(r.payment_id::text, 0));
      UPDATE public.payment_company_financials
         SET updated_at = now()
       WHERE payment_id = r.payment_id AND company_id = r.company_id;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$function$;