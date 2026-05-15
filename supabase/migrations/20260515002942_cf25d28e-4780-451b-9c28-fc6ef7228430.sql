-- Garantir que as chaves estrangeiras tenham ON DELETE CASCADE para exclusão atômica
-- Isso evita que registros órfãos ou restrições de chave estrangeira impeçam a exclusão do lote.

DO $$ 
BEGIN
    -- payment_items
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payment_items_payment_id_fkey') THEN
        ALTER TABLE public.payment_items DROP CONSTRAINT payment_items_payment_id_fkey;
    END IF;
    ALTER TABLE public.payment_items ADD CONSTRAINT payment_items_payment_id_fkey 
        FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;

    -- payment_status_history
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payment_status_history_payment_id_fkey') THEN
        ALTER TABLE public.payment_status_history DROP CONSTRAINT payment_status_history_payment_id_fkey;
    END IF;
    ALTER TABLE public.payment_status_history ADD CONSTRAINT payment_status_history_payment_id_fkey 
        FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;

    -- payment_company_groups
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payment_company_groups_payment_id_fkey') THEN
        ALTER TABLE public.payment_company_groups DROP CONSTRAINT payment_company_groups_payment_id_fkey;
    END IF;
    ALTER TABLE public.payment_company_groups ADD CONSTRAINT payment_company_groups_payment_id_fkey 
        FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;

    -- payment_observations
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'payment_observations_payment_id_fkey') THEN
        ALTER TABLE public.payment_observations DROP CONSTRAINT payment_observations_payment_id_fkey;
    END IF;
    ALTER TABLE public.payment_observations ADD CONSTRAINT payment_observations_payment_id_fkey 
        FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;

    -- invoices
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'invoices_payment_id_fkey') THEN
        ALTER TABLE public.invoices DROP CONSTRAINT invoices_payment_id_fkey;
    END IF;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_payment_id_fkey 
        FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;

    -- invoice_questions
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'invoice_questions_payment_id_fkey') THEN
        ALTER TABLE public.invoice_questions DROP CONSTRAINT invoice_questions_payment_id_fkey;
    END IF;
    ALTER TABLE public.invoice_questions ADD CONSTRAINT invoice_questions_payment_id_fkey 
        FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;

    -- audit_logs (se houver referência direta a payment_id)
    -- Nota: Geralmente audit_logs não devem ser deletados em cascata por motivos de compliance, 
    -- mas se houver uma restrição rígida impedindo o delete, ela deve ser tratada.
END $$;

-- Função para garantir exclusão total mesmo se houver triggers ou problemas de cache
CREATE OR REPLACE FUNCTION public.delete_payment_batch(p_payment_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Deleta explicitamente de tabelas filhas para garantir, apesar do CASCADE
    DELETE FROM public.payment_items WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_status_history WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_company_groups WHERE payment_id = p_payment_id;
    DELETE FROM public.payment_observations WHERE payment_id = p_payment_id;
    DELETE FROM public.invoices WHERE payment_id = p_payment_id;
    DELETE FROM public.invoice_questions WHERE payment_id = p_payment_id;
    
    -- Finalmente deleta o pai
    DELETE FROM public.payments WHERE id = p_payment_id;
    
    RETURN NOT EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
