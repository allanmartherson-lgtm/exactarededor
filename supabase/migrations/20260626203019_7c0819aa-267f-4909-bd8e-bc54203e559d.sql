
-- Helper: resolve hospital scope from storage object path's first folder
CREATE OR REPLACE FUNCTION public.storage_object_hospital_allows(_bucket text, _name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  _first text;
  _id uuid;
  _hid uuid;
BEGIN
  IF _name IS NULL THEN RETURN false; END IF;
  _first := split_part(_name, '/', 1);
  BEGIN
    _id := _first::uuid;
  EXCEPTION WHEN others THEN
    -- Path without a uuid folder prefix: fall back to global roles only.
    RETURN public.is_global_role(auth.uid());
  END;

  IF _bucket IN ('payment-files', 'approval-pdfs') THEN
    SELECT hospital_id INTO _hid FROM public.payments WHERE id = _id;
  ELSIF _bucket = 'invoices' THEN
    SELECT hospital_id INTO _hid FROM public.invoices WHERE id = _id;
    IF _hid IS NULL THEN
      -- Some invoice files may be filed under payment_id; try payments as fallback.
      SELECT hospital_id INTO _hid FROM public.payments WHERE id = _id;
    END IF;
  ELSIF _bucket = 'reconciliation-files' THEN
    SELECT hospital_id INTO _hid FROM public.reconciliation_runs WHERE id = _id;
  ELSE
    RETURN false;
  END IF;

  -- Unknown parent record: only global roles may proceed.
  IF _hid IS NULL THEN
    RETURN public.is_global_role(auth.uid());
  END IF;

  RETURN public.hospital_scope_allows(_hid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.storage_object_hospital_allows(text, text) TO authenticated, service_role;

-- payment-files / approval-pdfs / invoices: tighten SELECT
DROP POLICY IF EXISTS payment_files_workflow_read ON storage.objects;
CREATE POLICY payment_files_workflow_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = ANY (ARRAY['payment-files'::text, 'approval-pdfs'::text, 'invoices'::text])
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

-- tighten INSERT
DROP POLICY IF EXISTS payment_files_workflow_write ON storage.objects;
CREATE POLICY payment_files_workflow_write ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['payment-files'::text, 'approval-pdfs'::text, 'invoices'::text])
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

-- tighten UPDATE
DROP POLICY IF EXISTS payment_files_workflow_update ON storage.objects;
CREATE POLICY payment_files_workflow_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = ANY (ARRAY['payment-files'::text, 'approval-pdfs'::text, 'invoices'::text])
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
)
WITH CHECK (
  bucket_id = ANY (ARRAY['payment-files'::text, 'approval-pdfs'::text, 'invoices'::text])
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

-- tighten DELETE (admin/diretor)
DROP POLICY IF EXISTS payment_files_admin_delete ON storage.objects;
CREATE POLICY payment_files_admin_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = ANY (ARRAY['payment-files'::text, 'approval-pdfs'::text, 'invoices'::text])
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  AND public.storage_object_hospital_allows(bucket_id, name)
);

-- reconciliation-files: tighten all CRUD
DROP POLICY IF EXISTS recon_files_read ON storage.objects;
CREATE POLICY recon_files_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'reconciliation-files'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

DROP POLICY IF EXISTS recon_files_insert ON storage.objects;
CREATE POLICY recon_files_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'reconciliation-files'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

DROP POLICY IF EXISTS recon_files_update ON storage.objects;
CREATE POLICY recon_files_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'reconciliation-files'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
)
WITH CHECK (
  bucket_id = 'reconciliation-files'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

DROP POLICY IF EXISTS recon_files_delete ON storage.objects;
CREATE POLICY recon_files_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'reconciliation-files'
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  AND public.storage_object_hospital_allows(bucket_id, name)
);
