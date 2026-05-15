CREATE OR REPLACE FUNCTION public.calculate_payment_audit(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_expected INT;
    v_total_processed INT;
    v_audit_results JSONB;
BEGIN
    -- Obter totais gerais do lote
    SELECT items_count INTO v_total_expected FROM public.payments WHERE id = p_payment_id;
    SELECT count(*) INTO v_total_processed FROM public.payment_items WHERE payment_id = p_payment_id;

    -- Agrupar por empresa para detalhar faltas
    WITH company_stats AS (
        SELECT 
            company_name,
            count(*) as processed_count,
            sum(gross_amount) as total_gross,
            sum(expected_amount) as total_expected
        FROM public.payment_items
        WHERE payment_id = p_payment_id
        GROUP BY company_name
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'company_name', company_name,
            'processed_items', processed_count,
            'total_gross', total_gross,
            'total_expected', total_expected,
            'discrepancy', total_gross - total_expected
        )
    ) INTO v_audit_results
    FROM company_stats;

    RETURN jsonb_build_object(
        'payment_id', p_payment_id,
        'summary', jsonb_build_object(
            'expected_total', v_total_expected,
            'processed_total', v_total_processed,
            'missing_items', v_total_expected - v_total_processed,
            'audit_timestamp', now()
        ),
        'by_company', v_audit_results
    );
END;
$$;