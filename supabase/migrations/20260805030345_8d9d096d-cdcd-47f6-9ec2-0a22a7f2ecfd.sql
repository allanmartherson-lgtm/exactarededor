CREATE TABLE IF NOT EXISTS public.agreement_registration_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreement_registrations(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_mime text,
  file_size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_registration_attachments TO authenticated;
GRANT ALL ON public.agreement_registration_attachments TO service_role;

ALTER TABLE public.agreement_registration_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS agreement_attachments_agreement_idx
  ON public.agreement_registration_attachments (agreement_id);

-- Acesso ao acordo: escopo de hospital + papel interno. Security definer evita
-- depender das policies de agreement_registrations dentro do storage.
CREATE OR REPLACE FUNCTION public.can_access_agreement(_agreement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agreement_registrations a
    WHERE a.id = _agreement_id
      AND public.hospital_scope_allows(a.hospital_id)
  ) AND (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'analista')
    OR public.has_role(auth.uid(),'validador')
    OR public.has_role(auth.uid(),'diretor')
    OR public.has_role(auth.uid(),'gestao_medica')
  );
$$;

CREATE POLICY agreement_attachments_select_scoped
  ON public.agreement_registration_attachments FOR SELECT TO authenticated
  USING (public.can_access_agreement(agreement_id));

CREATE POLICY agreement_attachments_insert_scoped
  ON public.agreement_registration_attachments FOR INSERT TO authenticated
  WITH CHECK (public.can_access_agreement(agreement_id) AND uploaded_by = auth.uid());

CREATE POLICY agreement_attachments_delete_scoped
  ON public.agreement_registration_attachments FOR DELETE TO authenticated
  USING (public.can_access_agreement(agreement_id));

-- Storage: mesmo bucket dos anexos de empresa, sob o prefixo acordos/<agreement_id>/
CREATE POLICY agreement_attachments_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-attachments'
    AND (storage.foldername(name))[1] = 'acordos'
    AND public.can_access_agreement(((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY agreement_attachments_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-attachments'
    AND (storage.foldername(name))[1] = 'acordos'
    AND public.can_access_agreement(((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY agreement_attachments_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'company-attachments'
    AND (storage.foldername(name))[1] = 'acordos'
    AND public.can_access_agreement(((storage.foldername(name))[2])::uuid)
  );