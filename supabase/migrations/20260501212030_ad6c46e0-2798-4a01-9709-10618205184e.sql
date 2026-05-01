-- 1) Coluna de vínculo direto à empresa cadastrada
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS target_company_id uuid
    REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rules_target_company_id_idx
  ON public.rules (target_company_id);

-- 2) Backfill: liga a regra à empresa quando CNPJ (apenas dígitos) bate exatamente.
--    Aplica somente quando o vínculo ainda não existe e o alvo é empresa.
WITH matches AS (
  SELECT
    r.id   AS rule_id,
    c.id   AS company_id,
    ROW_NUMBER() OVER (
      PARTITION BY r.id
      ORDER BY c.created_at ASC
    ) AS rn
  FROM public.rules r
  JOIN public.companies c
    ON regexp_replace(COALESCE(c.document, ''), '\D', '', 'g')
     = regexp_replace(COALESCE(r.target_identifier, ''), '\D', '', 'g')
   AND length(regexp_replace(COALESCE(c.document, ''), '\D', '', 'g')) = 14
  WHERE r.target_type = 'empresa'
    AND r.target_company_id IS NULL
    AND r.target_identifier IS NOT NULL
)
UPDATE public.rules r
   SET target_company_id = m.company_id
  FROM matches m
 WHERE r.id = m.rule_id
   AND m.rn = 1;

-- 3) Normaliza target_name das regras vinculadas para refletir o nome canônico da empresa,
--    apenas quando o nome atual está vazio.
UPDATE public.rules r
   SET target_name = c.name
  FROM public.companies c
 WHERE r.target_company_id = c.id
   AND (r.target_name IS NULL OR length(btrim(r.target_name)) = 0);
