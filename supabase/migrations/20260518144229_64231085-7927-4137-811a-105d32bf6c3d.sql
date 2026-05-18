CREATE OR REPLACE FUNCTION public.calculate_payment_audit(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_total_expected INT;
    v_total_processed INT;
    v_audit_results JSONB;
BEGIN
    SELECT COALESCE(items_count, 0) INTO v_total_expected
    FROM public.payments
    WHERE id = p_payment_id;

    SELECT count(*) INTO v_total_processed
    FROM public.payment_items
    WHERE payment_id = p_payment_id;

    WITH expected_groups AS (
        SELECT
            company_name,
            COALESCE(items_count, 0) as expected_count,
            status::text as group_status
        FROM public.payment_company_groups
        WHERE payment_id = p_payment_id
    ),
    processed_stats AS (
        SELECT
            company_name,
            count(*) as processed_count,
            sum(gross_amount) as total_gross,
            sum(COALESCE(expected_amount, gross_amount)) as total_expected,
            count(*) FILTER (WHERE ai_status = 'reprovado') as count_rejected,
            count(*) FILTER (WHERE ai_status = 'alerta') as count_alert
        FROM public.payment_items
        WHERE payment_id = p_payment_id
        GROUP BY company_name
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'company_name', COALESCE(e.company_name, p.company_name),
            'expected_items', COALESCE(e.expected_count, 0),
            'processed_items', COALESCE(p.processed_count, 0),
            'missing_items', GREATEST(0, COALESCE(e.expected_count, 0) - COALESCE(p.processed_count, 0)),
            'total_gross', COALESCE(p.total_gross, 0),
            'total_expected', COALESCE(p.total_expected, 0),
            'discrepancy_amount', COALESCE(p.total_gross, 0) - COALESCE(p.total_expected, 0),
            'rejected_items', COALESCE(p.count_rejected, 0),
            'alert_items', COALESCE(p.count_alert, 0),
            'status', COALESCE(e.group_status, 'pendente'),
            'reason', CASE
                WHEN COALESCE(p.processed_count, 0) = 0 THEN 'Aguardando processamento'
                WHEN COALESCE(e.expected_count, 0) > COALESCE(p.processed_count, 0) THEN 'Itens filtrados ou não encontrados na planilha'
                WHEN COALESCE(p.total_gross, 0) <> COALESCE(p.total_expected, 0) THEN 'Divergência de valores detectada'
                ELSE 'Processado com sucesso'
            END
        )
    ) INTO v_audit_results
    FROM expected_groups e
    FULL OUTER JOIN processed_stats p ON e.company_name = p.company_name;

    RETURN jsonb_build_object(
        'payment_id', p_payment_id,
        'summary', jsonb_build_object(
            'expected_total', v_total_expected,
            'processed_total', v_total_processed,
            'missing_total', GREATEST(0, v_total_expected - v_total_processed),
            'audit_timestamp', now()
        ),
        'by_company', COALESCE(v_audit_results, '[]'::jsonb)
    );
END;
$function$;