-- Onda 1: cruzamento por ID
-- 1) Adicionar target_doctor_id em rules (analogo a target_company_id)
ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS target_doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rules_target_doctor_id ON public.rules(target_doctor_id) WHERE target_doctor_id IS NOT NULL;

-- 2) Backfill target_company_id por nome/alias/CNPJ quando vazio
UPDATE public.rules r
SET target_company_id = c.id
FROM public.companies c
WHERE r.scope = 'especifica'
  AND r.target_type = 'empresa'
  AND r.target_company_id IS NULL
  AND (
    (r.target_identifier IS NOT NULL AND only_digits(r.target_identifier) <> '' AND only_digits(c.document) = only_digits(r.target_identifier))
    OR (r.target_name IS NOT NULL AND lower(c.name) = lower(r.target_name))
    OR (r.target_name IS NOT NULL AND EXISTS (
         SELECT 1 FROM unnest(c.aliases) a WHERE lower(a) = lower(r.target_name)
       ))
  );

-- 3) Backfill target_doctor_id por CRM+UF ou nome
-- 3a) por CRM (target_identifier pode vir "12345" ou "12345/SP")
UPDATE public.rules r
SET target_doctor_id = d.id
FROM public.doctors d
WHERE r.scope = 'especifica'
  AND r.target_type = 'medico'
  AND r.target_doctor_id IS NULL
  AND r.target_identifier IS NOT NULL
  AND only_digits(r.target_identifier) <> ''
  AND only_digits(d.crm) = only_digits(split_part(r.target_identifier, '/', 1));

-- 3b) por nome exato quando CRM nao resolveu
UPDATE public.rules r
SET target_doctor_id = d.id
FROM public.doctors d
WHERE r.scope = 'especifica'
  AND r.target_type = 'medico'
  AND r.target_doctor_id IS NULL
  AND r.target_name IS NOT NULL
  AND lower(d.full_name) = lower(r.target_name);