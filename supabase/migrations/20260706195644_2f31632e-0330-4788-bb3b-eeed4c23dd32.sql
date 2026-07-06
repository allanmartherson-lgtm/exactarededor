UPDATE public.hospitals SET code_prefix = 'HSH' WHERE slug = 'santa_helena' AND (code_prefix IS NULL OR code_prefix <> 'HSH');
UPDATE public.hospitals SET code_prefix = 'DFS' WHERE slug = 'df_star' AND (code_prefix IS NULL OR code_prefix <> 'DFS');

ALTER TABLE public.rules DISABLE TRIGGER trg_rules_protect_immutable;

WITH base AS (
  SELECT COALESCE(MAX((regexp_replace(code, '^.*-R0*', ''))::int), 0) AS max_seq
  FROM public.rules
  WHERE hospital_id = (SELECT id FROM public.hospitals WHERE slug='santa_helena')
    AND code ~ '^HSH-R[0-9]+$'
),
ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
  FROM public.rules
  WHERE hospital_id = (SELECT id FROM public.hospitals WHERE slug='santa_helena')
    AND code ~ '^SAN-R\d+$'
)
UPDATE public.rules r
SET code = 'HSH-R' || lpad(((SELECT max_seq FROM base) + ranked.rn)::text, 3, '0')
FROM ranked
WHERE r.id = ranked.id;

ALTER TABLE public.rules ENABLE TRIGGER trg_rules_protect_immutable;