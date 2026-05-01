-- 1) Função utilitária: extrai apenas dígitos
CREATE OR REPLACE FUNCTION public.only_digits(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT regexp_replace(COALESCE(txt,''), '\D', '', 'g') $$;

-- 2) Deduplicação: para cada CNPJ (apenas dígitos, com 14 caracteres),
--    manter a empresa mais antiga e remapear referências das duplicatas.
WITH norm AS (
  SELECT id, name, created_at, public.only_digits(document) AS doc
  FROM public.companies
  WHERE public.only_digits(document) <> ''
    AND length(public.only_digits(document)) = 14
),
ranked AS (
  SELECT id, doc,
         FIRST_VALUE(id) OVER (PARTITION BY doc ORDER BY created_at ASC, id ASC) AS keeper_id
  FROM norm
),
dups AS (
  SELECT id AS dup_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
)
-- Remapeia payment_items
UPDATE public.payment_items pi
SET company_id = d.keeper_id
FROM dups d
WHERE pi.company_id = d.dup_id;

WITH norm AS (
  SELECT id, created_at, public.only_digits(document) AS doc
  FROM public.companies
  WHERE public.only_digits(document) <> ''
    AND length(public.only_digits(document)) = 14
),
ranked AS (
  SELECT id, doc,
         FIRST_VALUE(id) OVER (PARTITION BY doc ORDER BY created_at ASC, id ASC) AS keeper_id
  FROM norm
),
dups AS (
  SELECT id AS dup_id, keeper_id
  FROM ranked
  WHERE id <> keeper_id
)
-- Remapeia rules.target_company_id
UPDATE public.rules r
SET target_company_id = d.keeper_id
FROM dups d
WHERE r.target_company_id = d.dup_id;

-- Apaga as duplicatas
WITH norm AS (
  SELECT id, created_at, public.only_digits(document) AS doc
  FROM public.companies
  WHERE public.only_digits(document) <> ''
    AND length(public.only_digits(document)) = 14
),
ranked AS (
  SELECT id, doc,
         FIRST_VALUE(id) OVER (PARTITION BY doc ORDER BY created_at ASC, id ASC) AS keeper_id
  FROM norm
)
DELETE FROM public.companies c
USING ranked r
WHERE c.id = r.id AND r.id <> r.keeper_id;

-- 3) Normaliza o documento dos remanescentes para apenas-dígitos formatados (mantém máscara consistente)
UPDATE public.companies
SET document = public.only_digits(document)
WHERE document IS NOT NULL
  AND length(public.only_digits(document)) = 14;

-- 4) Índice único no CNPJ normalizado (ignora NULL e strings vazias)
CREATE UNIQUE INDEX IF NOT EXISTS companies_unique_cnpj_digits
ON public.companies ((public.only_digits(document)))
WHERE document IS NOT NULL AND public.only_digits(document) <> '';
