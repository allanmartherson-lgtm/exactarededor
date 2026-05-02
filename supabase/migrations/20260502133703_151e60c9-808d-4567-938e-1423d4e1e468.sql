-- Tabela de anexos das mensagens da conversa de NF
CREATE TABLE public.invoice_question_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.invoice_questions(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  author_type text NOT NULL CHECK (author_type IN ('recebedor','analista')),
  author_id uuid,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_iqa_question ON public.invoice_question_attachments(question_id);
CREATE INDEX idx_iqa_invoice ON public.invoice_question_attachments(invoice_id);

ALTER TABLE public.invoice_question_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY iqa_view_authenticated
  ON public.invoice_question_attachments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY iqa_insert_internal
  ON public.invoice_question_attachments FOR INSERT
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

-- Bucket privado para os anexos
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-question-attachments', 'invoice-question-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY iqa_storage_select_internal
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoice-question-attachments'
    AND (
      public.has_role(auth.uid(), 'analista'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
      OR public.has_role(auth.uid(), 'validador'::app_role)
    )
  );

CREATE POLICY iqa_storage_insert_internal
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'invoice-question-attachments'
    AND (
      public.has_role(auth.uid(), 'analista'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
    )
  );

CREATE POLICY iqa_storage_delete_internal
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoice-question-attachments'
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
    )
  );