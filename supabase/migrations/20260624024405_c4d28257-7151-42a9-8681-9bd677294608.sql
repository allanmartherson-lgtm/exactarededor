
-- Limpa aliases contaminados com sufixos de arquivo (setor/período/versão).
-- Quando o alias, após remover esses sufixos, fica vazio OU equivalente ao name
-- da empresa, ele é DELETADO. Caso contrário, é substituído pela versão limpa.
-- Motivo: aliases como "X - Parecer Adulto" geram falso-positivo cruzado
-- contra QUALQUER outro arquivo com o mesmo sufixo (ex.: 92% match indevido).
WITH exploded AS (
  SELECT c.id, c.name, a.alias_raw, a.ord
  FROM public.companies c
  CROSS JOIN LATERAL unnest(coalesce(c.aliases, '{}'::text[])) WITH ORDINALITY AS a(alias_raw, ord)
),
cleaned AS (
  SELECT
    id, name, alias_raw, ord,
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(alias_raw,
              '\s*[-_]\s*(centro\s*cirurgico|cc|hemodin[âa]mica|consultas?|pareceres?|parecer\s+adulto|parecer\s+e\s+visita|ambulatorial|visitas?|cirurgi[ao]s?|ambulat[oó]rio|uti|enfermaria|interna[cç][aã]o)\b.*$',
              '', 'i'),
            '\s*[-_]?\s*\d{1,2}[-_./]\d{2,4}\s*$', '', 'g'),
          '\s*[-_]?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zçé]*[\s_\-./]*\d{2,4}\s*$', '', 'i'),
        '\s+', ' ', 'g')
    ) AS alias_clean
  FROM exploded
),
kept AS (
  SELECT id, name, alias_clean, ord
  FROM cleaned
  WHERE alias_clean <> ''
    AND lower(alias_clean) <> lower(name)
),
rebuilt AS (
  SELECT id, array_agg(DISTINCT alias_clean ORDER BY alias_clean) AS new_aliases
  FROM kept
  GROUP BY id
)
UPDATE public.companies c
SET aliases = coalesce(r.new_aliases, '{}'::text[]),
    updated_at = now()
FROM public.companies c2
LEFT JOIN rebuilt r ON r.id = c2.id
WHERE c.id = c2.id
  AND c.aliases IS DISTINCT FROM coalesce(r.new_aliases, '{}'::text[]);
