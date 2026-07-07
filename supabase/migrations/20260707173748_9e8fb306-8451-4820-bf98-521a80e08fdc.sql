-- ============================================================================
-- LOTE 3 — Isolamento por hospital: storage de invoice-question-attachments
-- ============================================================================

-- 1. Estende a função para o novo bucket. Path pattern: {invoice_id}/{question_id}/{uuid}.ext
CREATE OR REPLACE FUNCTION public.storage_object_hospital_allows(_bucket text, _name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'storage'
AS $function$
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
    RETURN public.is_global_role(auth.uid());
  END;

  IF _bucket IN ('payment-files', 'approval-pdfs') THEN
    SELECT hospital_id INTO _hid FROM public.payments WHERE id = _id;
  ELSIF _bucket = 'invoices' THEN
    SELECT hospital_id INTO _hid FROM public.invoices WHERE id = _id;
    IF _hid IS NULL THEN
      SELECT hospital_id INTO _hid FROM public.payments WHERE id = _id;
    END IF;
  ELSIF _bucket = 'reconciliation-files' THEN
    SELECT hospital_id INTO _hid FROM public.reconciliation_runs WHERE id = _id;
  ELSIF _bucket = 'invoice-question-attachments' THEN
    SELECT hospital_id INTO _hid FROM public.invoices WHERE id = _id;
  ELSE
    RETURN false;
  END IF;

  IF _hid IS NULL THEN
    RETURN public.is_global_role(auth.uid());
  END IF;

  RETURN public.hospital_scope_allows(_hid);
END;
$function$;

-- 2. Recria policies do bucket invoice-question-attachments com escopo de hospital
DROP POLICY IF EXISTS iqa_storage_select_internal ON storage.objects;
DROP POLICY IF EXISTS iqa_storage_insert_internal ON storage.objects;
DROP POLICY IF EXISTS iqa_storage_delete_internal ON storage.objects;

CREATE POLICY iqa_storage_select_internal
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoice-question-attachments'
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

CREATE POLICY iqa_storage_insert_internal
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'invoice-question-attachments'
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

CREATE POLICY iqa_storage_delete_internal
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'invoice-question-attachments'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);