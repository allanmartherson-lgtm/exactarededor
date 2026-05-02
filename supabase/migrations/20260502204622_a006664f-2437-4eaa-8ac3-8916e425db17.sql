-- =========================================================
-- Security hardening: restringir SELECT em tabelas sensíveis
-- a usuários com roles válidos do workflow.
-- =========================================================

-- 1) PROFILES — remover policy permissiva; manter self + admin/diretor
DROP POLICY IF EXISTS profiles_all_select_authenticated ON public.profiles;

CREATE POLICY profiles_admin_select_all
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
);

-- Workflow roles também precisam ler nomes para exibir autores em observações,
-- mas SEM expor email. Concedemos via policy restrita a colunas via view não é
-- possível em RLS; mantemos acesso amplo para roles do workflow.
CREATE POLICY profiles_workflow_select
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
);

-- 2) AUDIT_LOG — restringir SELECT a admin/diretor; INSERT continua self
DROP POLICY IF EXISTS audit_log_view_authenticated ON public.audit_log;

CREATE POLICY audit_log_view_admin_diretor
ON public.audit_log
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
);

-- 3) PAYMENT_ITEMS — restringir SELECT a roles do workflow
DROP POLICY IF EXISTS items_view_authenticated ON public.payment_items;

CREATE POLICY items_view_workflow
ON public.payment_items
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 4) INVOICES — restringir SELECT a roles do workflow
-- (portal público usa edge function com service role, não é afetado)
DROP POLICY IF EXISTS invoices_view_authenticated ON public.invoices;

CREATE POLICY invoices_view_workflow
ON public.invoices
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 5) COMPANIES — restringir SELECT a roles do workflow
DROP POLICY IF EXISTS companies_view_authenticated ON public.companies;

CREATE POLICY companies_view_workflow
ON public.companies
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 6) INVOICE_QUESTIONS — restringir SELECT a roles do workflow
-- (portal público lê via edge function)
DROP POLICY IF EXISTS iq_view_authenticated ON public.invoice_questions;

CREATE POLICY iq_view_workflow
ON public.invoice_questions
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Idem anexos
DROP POLICY IF EXISTS iqa_view_authenticated ON public.invoice_question_attachments;

CREATE POLICY iqa_view_workflow
ON public.invoice_question_attachments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- =========================================================
-- 7) STORAGE — restringir buckets sensíveis a roles do workflow
-- =========================================================
DROP POLICY IF EXISTS payment_files_auth_read ON storage.objects;
DROP POLICY IF EXISTS payment_files_auth_write ON storage.objects;
DROP POLICY IF EXISTS payment_files_auth_update ON storage.objects;

CREATE POLICY payment_files_workflow_read
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id IN ('payment-files','approval-pdfs','invoices')
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE POLICY payment_files_workflow_write
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('payment-files','approval-pdfs','invoices')
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE POLICY payment_files_workflow_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('payment-files','approval-pdfs','invoices')
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
)
WITH CHECK (
  bucket_id IN ('payment-files','approval-pdfs','invoices')
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- DELETE explícito apenas para admin/diretor
CREATE POLICY payment_files_admin_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id IN ('payment-files','approval-pdfs','invoices')
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
  )
);

-- =========================================================
-- 8) Revogar EXECUTE de funções DEFINER chamáveis pelo cliente
-- has_role / handle_new_user / trg_recompute_payment_status são uso interno
-- recompute_payment_status_from_groups e revert_cost_center_import devem ser
-- chamadas só pelo backend/edge functions.
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.recompute_payment_status_from_groups(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revert_cost_center_import(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
