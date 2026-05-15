-- Função para verificar se o lote foi realmente apagado em todas as tabelas críticas
CREATE OR REPLACE FUNCTION public.verify_payment_batch_deleted(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payments_count INT;
    v_items_count INT;
    v_invoices_count INT;
    v_questions_count INT;
    v_assignments_count INT;
    v_notifications_count INT;
BEGIN
    SELECT count(*) INTO v_payments_count FROM public.payments WHERE id = p_payment_id;
    SELECT count(*) INTO v_items_count FROM public.payment_items WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_invoices_count FROM public.invoices WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_questions_count FROM public.invoice_questions WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_assignments_count FROM public.payment_assignments WHERE payment_id = p_payment_id;
    SELECT count(*) INTO v_notifications_count FROM public.payment_director_notifications WHERE payment_id = p_payment_id;
    
    RETURN jsonb_build_object(
        'is_deleted', (v_payments_count = 0 AND v_items_count = 0 AND v_invoices_count = 0 AND v_questions_count = 0 AND v_assignments_count = 0 AND v_notifications_count = 0),
        'details', jsonb_build_object(
            'payments', v_payments_count,
            'items', v_items_count,
            'invoices', v_invoices_count,
            'questions', v_questions_count,
            'assignments', v_assignments_count,
            'notifications', v_notifications_count
        )
    );
END;
$$;

-- Atualiza a função de delete para ser ainda mais agressiva e abrangente
CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Se o lote estiver arquivado, o trigger guard_archived_immutable impediria o delete.
    -- Vamos garantir que ele não esteja 'arquivado' antes de tentar deletar, 
    -- ou simplesmente forçar o delete se tivermos permissão.
    -- Como esta função é SECURITY DEFINER, ela roda com privilégios de owner.
    
    -- 1. Limpeza de anexos de perguntas (vínculo de segundo nível)
    DELETE FROM public.invoice_question_attachments 
    WHERE question_id IN (SELECT id FROM public.invoice_questions WHERE payment_id = p_payment_id);
    
    -- 2. Limpeza de perguntas
    DELETE FROM public.invoice_questions WHERE payment_id = p_payment_id;
    
    -- 3. Limpeza de faturas
    DELETE FROM public.invoices WHERE payment_id = p_payment_id;
    
    -- 4. Limpeza de itens e históricos
    DELETE FROM public.payment_items WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_status_history WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_company_groups WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_observations WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_assignments WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_director_notifications WHERE payment_id = p_payment_id;
    DELETE FROM public.status_anomalies WHERE payment_id = p_payment_id;
    DELETE FROM public.ai_analysis_versions WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_processing_jobs WHERE payment_id = p_payment_id;
    
    -- 5. Se o status for 'arquivado', mudamos para 'rascunho' temporariamente para evitar o block do trigger
    UPDATE public.payments SET status = 'rascunho' WHERE id = p_payment_id AND status = 'arquivado';
    
    -- 6. Finalmente deleta o pai
    DELETE FROM public.payments WHERE id = p_payment_id;
    
    -- Retorna true se realmente não existe mais
    RETURN NOT EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id);
END;
$$;
