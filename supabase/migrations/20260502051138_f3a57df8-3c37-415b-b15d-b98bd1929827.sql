-- 1) Tabela de thread de questionamentos da NF
CREATE TABLE public.invoice_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL,
  payment_id   uuid NOT NULL,
  author_type  text NOT NULL CHECK (author_type IN ('recebedor', 'analista')),
  author_id    uuid,            -- null quando author_type='recebedor'
  author_name  text,            -- nome livre informado pelo recebedor
  message      text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  read_at      timestamptz,     -- quando o analista marcou como lida
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_questions_invoice ON public.invoice_questions(invoice_id, created_at);
CREATE INDEX idx_invoice_questions_payment ON public.invoice_questions(payment_id, created_at);

ALTER TABLE public.invoice_questions ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado vê (segue padrão das outras tabelas do app)
CREATE POLICY "iq_view_authenticated"
  ON public.invoice_questions
  FOR SELECT
  TO authenticated
  USING (true);

-- Apenas papéis internos podem inserir respostas como 'analista'.
-- Mensagens do recebedor são inseridas via edge function (service role).
CREATE POLICY "iq_insert_internal"
  ON public.invoice_questions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_type = 'analista'
    AND auth.uid() = author_id
    AND (
      public.has_role(auth.uid(), 'analista'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
    )
  );

-- Marcar como lida (apenas papéis internos)
CREATE POLICY "iq_update_read_internal"
  ON public.invoice_questions
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  );

-- 2) Campos para guardar a análise automática da NF pela IA
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ai_validation       jsonb,
  ADD COLUMN IF NOT EXISTS ai_validated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ai_extracted_amount numeric,
  ADD COLUMN IF NOT EXISTS ai_extracted_number text,
  ADD COLUMN IF NOT EXISTS ai_extracted_cnpj   text;