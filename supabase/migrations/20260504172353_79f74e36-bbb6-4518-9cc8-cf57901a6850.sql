INSERT INTO storage.buckets (id, name, public)
VALUES ('import-uploads', 'import-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "import_uploads_admin_diretor_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'import-uploads'
  AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'diretor'::app_role))
);

CREATE POLICY "import_uploads_admin_diretor_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'import-uploads'
  AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'diretor'::app_role))
);

CREATE POLICY "import_uploads_admin_diretor_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'import-uploads'
  AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'diretor'::app_role))
);