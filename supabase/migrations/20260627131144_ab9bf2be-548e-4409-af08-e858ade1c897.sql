CREATE POLICY "invoices_storage_company_portal_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoices'
  AND EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.file_path = storage.objects.name
      AND i.sent_at IS NOT NULL
      AND i.status <> 'cancelada'::public.invoice_status
      AND public.is_company_portal_user(auth.uid(), i.company_id)
      AND (
        i.hospital_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.company_portal_user_hospitals cpuh
          JOIN public.company_portal_users cpu ON cpu.id = cpuh.portal_user_id
          WHERE cpu.user_id = auth.uid()
            AND cpu.company_id = i.company_id
            AND cpu.active = true
            AND cpuh.hospital_id = i.hospital_id
        )
      )
  )
);