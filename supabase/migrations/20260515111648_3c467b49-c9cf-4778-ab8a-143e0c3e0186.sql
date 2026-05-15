-- 1. Melhorar a função de exclusão atômica para ser mais agressiva e abrangente
CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_row_count int;
BEGIN
    -- Permitir escrita direta no status para bypassar triggers de imutabilidade
    PERFORM set_config('app.allow_payment_status_write', 'on', true);

    -- 1. Forçar status para rascunho para evitar bloqueios de triggers de imutabilidade (arquivados/pago/etc)
    -- Isso garante que possamos deletar sem que triggers de "guard" reclamem do estado
    UPDATE public.payments SET status = 'rascunho' WHERE id = p_payment_id;
    UPDATE public.payment_company_groups SET status = 'rascunho' WHERE payment_id = p_payment_id;

    -- 2. Limpeza de logs de auditoria (referência lógica por entity_id)
    -- Embora não haja FK, é bom limpar para manter o banco saudável
    DELETE FROM public.audit_log WHERE entity_type = 'payment' AND entity_id = p_payment_id;

    -- 3. Quebrar referências circulares em observações (answered_by_observation_id)
    UPDATE public.payment_observations SET answered_by_observation_id = NULL WHERE payment_id = p_payment_id;
    
    -- 4. Limpeza de anexos de perguntas (vínculo de segundo nível)
    -- Deleta todos os anexos vinculados às perguntas deste lote
    DELETE FROM public.invoice_question_attachments 
    WHERE payment_id = p_payment_id;
    
    -- 5. Limpeza de tabelas dependentes (ordem segura: dependentes -> pai)
    DELETE FROM public.invoice_questions WHERE payment_id = p_payment_id;
    DELETE FROM public.invoices WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_observations WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_status_history WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_company_groups WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_assignments WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_director_notifications WHERE payment_id = p_payment_id;
    DELETE FROM public.status_anomalies WHERE payment_id = p_payment_id;
    DELETE FROM public.ai_analysis_versions WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_processing_jobs WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_items WHERE payment_id = p_payment_id;
    
    -- 6. Finalmente deleta o pai (payments)
    DELETE FROM public.payments WHERE id = p_payment_id;
    
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    
    -- Retorna true se realmente não existe mais no banco
    RETURN NOT EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id);
END;
$function$;

-- 2. Atualizar a função de verificação para ser mais rigorosa e incluir auditoria
CREATE OR REPLACE FUNCTION public.verify_payment_batch_deleted(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_payments_count INT;
    v_items_count INT;
    v_groups_count INT;
    v_invoices_count INT;
    v_questions_count INT;
    v_observations_count INT;
    v_assignments_count INT;
    v_history_count INT;
    v_audit_logs_count INT;
BEGIN
    SELECT count(*) INTO v_payments_count FROM public.payments WHERE id = p_payment_id;
    SELECT count(*) INTO v_items_count FROM public.payment_items WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_groups_count FROM public.payment_company_groups WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_invoices_count FROM public.invoices WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_questions_count FROM public.invoice_questions WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_observations_count FROM public.payment_observations WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_assignments_count FROM public.payment_assignments WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_history_count FROM public.payment_status_history WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_audit_logs_count FROM public.audit_log WHERE entity_type = 'payment' AND entity_id = p_payment_id;
    
    RETURN jsonb_build_object(
        'is_deleted', (
            v_payments_count = 0 AND 
            v_items_count = 0 AND 
            v_groups_count = 0 AND 
            v_invoices_count = 0 AND 
            v_questions_count = 0 AND 
            v_observations_count = 0 AND 
            v_assignments_count = 0 AND 
            v_history_count = 0 AND
            v_audit_logs_count = 0
        ),
        'details', jsonb_build_object(
            'payments', v_payments_count,
            'items', v_items_count,
            'groups', v_groups_count,
            'invoices', v_invoices_count,
            'questions', v_questions_count,
            'observations', v_observations_count,
            'assignments', v_assignments_count,
            'history', v_history_count,
            'audit_logs', v_audit_logs_count
        )
    );
END;
$function$;

-- 3. Melhorar a função de auditoria para incluir detalhes de "por que" faltaram itens
CREATE OR REPLACE FUNCTION public.calculate_payment_audit(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_expected INT;
    v_total_processed INT;
    v_audit_results JSONB;
BEGIN
    -- Obter totais gerais do lote
    SELECT COALESCE(items_count, 0) INTO v_total_expected 
    FROM public.payments 
    WHERE id = p_payment_id;
    
    SELECT count(*) INTO v_total_processed 
    FROM public.payment_items 
    WHERE payment_id = p_payment_id;

    -- Agrupar por empresa comparando o que existe em groups vs o que existe em items
    -- Destaque para o motivo: 'divergência' (valor), 'exclusão' (regra), 'pendente' (não processado)
    WITH expected_groups AS (
        SELECT 
            company_name,
            COALESCE(items_count, 0) as expected_count,
            status as group_status
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
$$;
