-- Adiciona lista de e-mails de solicitação de NF por empresa.
-- Usado pelo send-invoice-request para enviar o pedido para a empresa
-- (TO) com cópia para o médico (CC).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS invoice_emails text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.companies.invoice_emails IS
  'E-mails de destino para pedidos de Nota Fiscal (TO). O e-mail do médico vai como CC.';