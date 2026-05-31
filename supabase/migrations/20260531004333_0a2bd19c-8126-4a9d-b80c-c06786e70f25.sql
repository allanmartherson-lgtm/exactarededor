-- Tabela de anexos da nota privada por empresa (escopo: usuário + group_id do pagamento)
CREATE TABLE public.user_company_note_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  group_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ucna_user_group ON public.user_company_note_attachments(user_id, group_id);
CREATE INDEX idx_ucna_payment ON public.user_company_note_attachments(payment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_note_attachments TO authenticated;
GRANT ALL ON public.user_company_note_attachments TO service_role;

ALTER TABLE public.user_company_note_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own attachments select" ON public.user_company_note_attachments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own attachments insert" ON public.user_company_note_attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own attachments update" ON public.user_company_note_attachments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own attachments delete" ON public.user_company_note_attachments
  FOR DELETE USING (auth.uid() = user_id);

-- Bucket privado para os anexos
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-company-notes', 'user-company-notes', false)
ON CONFLICT (id) DO NOTHING;

-- Policies de storage: usuário só acessa arquivos da sua própria pasta (user_id/...)
CREATE POLICY "user notes attachments select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'user-company-notes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "user notes attachments insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-company-notes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "user notes attachments update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'user-company-notes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "user notes attachments delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'user-company-notes' AND auth.uid()::text = (storage.foldername(name))[1]);