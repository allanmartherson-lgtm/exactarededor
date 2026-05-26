
-- Phase 3: Vincular payment_items ao doctor_id (FK real)

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS doctor_id uuid NULL REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_items_doctor_id ON public.payment_items(doctor_id);

-- Backfill por CRM/UF (formato exato do doctor_document = "16412/DF")
WITH matched AS (
  SELECT pi.id AS item_id, d.id AS doctor_id
  FROM public.payment_items pi
  JOIN public.doctors d
    ON d.crm = split_part(pi.doctor_document, '/', 1)
   AND d.crm_uf = split_part(pi.doctor_document, '/', 2)
  WHERE pi.doctor_id IS NULL
    AND pi.doctor_document IS NOT NULL
    AND pi.doctor_document <> ''
    AND position('/' in pi.doctor_document) > 0
)
UPDATE public.payment_items pi
SET doctor_id = m.doctor_id
FROM matched m
WHERE pi.id = m.item_id;

-- Fallback por LOWER(name) quando ainda não vinculado e há doctor_name
WITH matched AS (
  SELECT pi.id AS item_id, d.id AS doctor_id
  FROM public.payment_items pi
  JOIN public.doctors d
    ON LOWER(TRIM(d.full_name)) = LOWER(TRIM(pi.doctor_name))
  WHERE pi.doctor_id IS NULL
    AND pi.doctor_name IS NOT NULL
    AND pi.doctor_name <> ''
)
UPDATE public.payment_items pi
SET doctor_id = m.doctor_id
FROM matched m
WHERE pi.id = m.item_id;

-- Estender enrich_doctor_documents para também setar doctor_id quando possível
CREATE OR REPLACE FUNCTION public.enrich_doctor_documents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  -- 1) Preenche doctor_document a partir do nome do médico cadastrado
  WITH src AS (
    SELECT pi.id AS item_id, (d.crm || '/' || d.crm_uf) AS doc, d.id AS d_id
    FROM payment_items pi
    JOIN doctors d ON LOWER(TRIM(d.full_name)) = LOWER(TRIM(pi.doctor_name))
    WHERE (pi.doctor_document IS NULL OR pi.doctor_document = '')
      AND pi.doctor_name IS NOT NULL AND pi.doctor_name <> ''
      AND d.crm IS NOT NULL AND d.crm_uf IS NOT NULL
  )
  UPDATE payment_items pi
  SET doctor_document = src.doc,
      doctor_id = COALESCE(pi.doctor_id, src.d_id)
  FROM src
  WHERE pi.id = src.item_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- 2) Vincula doctor_id por CRM/UF onde ainda estiver nulo
  WITH src AS (
    SELECT pi.id AS item_id, d.id AS d_id
    FROM payment_items pi
    JOIN doctors d
      ON d.crm = split_part(pi.doctor_document, '/', 1)
     AND d.crm_uf = split_part(pi.doctor_document, '/', 2)
    WHERE pi.doctor_id IS NULL
      AND pi.doctor_document IS NOT NULL
      AND position('/' in pi.doctor_document) > 0
  )
  UPDATE payment_items pi
  SET doctor_id = src.d_id
  FROM src
  WHERE pi.id = src.item_id;

  RETURN updated_count;
END;
$$;
