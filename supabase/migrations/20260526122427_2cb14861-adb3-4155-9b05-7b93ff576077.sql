-- Backfill: preencher doctor_document = 'CRM/UF' onde há match por nome contra cadastro
UPDATE payment_items pi
SET doctor_document = d.crm || '/' || d.crm_uf
FROM doctors d
WHERE (pi.doctor_document IS NULL OR TRIM(pi.doctor_document) = '')
  AND LOWER(TRIM(pi.doctor_name)) = LOWER(TRIM(d.full_name))
  AND d.crm IS NOT NULL
  AND d.crm_uf IS NOT NULL;

-- Função para enriquecimento pós-import por lote
CREATE OR REPLACE FUNCTION public.enrich_doctor_documents(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE payment_items pi
  SET doctor_document = d.crm || '/' || d.crm_uf
  FROM doctors d
  WHERE pi.payment_id = p_payment_id
    AND (pi.doctor_document IS NULL OR TRIM(pi.doctor_document) = '')
    AND LOWER(TRIM(pi.doctor_name)) = LOWER(TRIM(d.full_name))
    AND d.crm IS NOT NULL
    AND d.crm_uf IS NOT NULL;
END;
$$;