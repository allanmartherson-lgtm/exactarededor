-- 1) Backfill defensivo: copia filtros legados de Regra → Cálculos filhos onde estiver vazio
UPDATE public.rule_calculations rc
SET procedure_codes = r.procedure_codes
FROM public.rules r
WHERE rc.rule_id = r.id
  AND r.procedure_codes IS NOT NULL AND array_length(r.procedure_codes, 1) > 0
  AND (rc.procedure_codes IS NULL OR array_length(rc.procedure_codes, 1) IS NULL);

UPDATE public.rule_calculations rc
SET sectors = r.sectors
FROM public.rules r
WHERE rc.rule_id = r.id
  AND r.sectors IS NOT NULL AND array_length(r.sectors, 1) > 0
  AND (rc.sectors IS NULL OR array_length(rc.sectors, 1) IS NULL);

UPDATE public.rule_calculations rc
SET specialties = r.specialties
FROM public.rules r
WHERE rc.rule_id = r.id
  AND r.specialties IS NOT NULL AND array_length(r.specialties, 1) > 0
  AND (rc.specialties IS NULL OR array_length(rc.specialties, 1) IS NULL);

UPDATE public.rule_calculations rc
SET agreement_aliases = r.agreement_aliases
FROM public.rules r
WHERE rc.rule_id = r.id
  AND r.agreement_aliases IS NOT NULL AND array_length(r.agreement_aliases, 1) > 0
  AND (rc.agreement_aliases IS NULL OR array_length(rc.agreement_aliases, 1) IS NULL);

UPDATE public.rule_calculations rc
SET allowed_access_routes = r.allowed_access_routes
FROM public.rules r
WHERE rc.rule_id = r.id
  AND r.allowed_access_routes IS NOT NULL AND array_length(r.allowed_access_routes, 1) > 0
  AND (rc.allowed_access_routes IS NULL OR array_length(rc.allowed_access_routes, 1) IS NULL);

-- 2) Remove definitivamente as colunas legadas no nível Regra
ALTER TABLE public.rules
  DROP COLUMN IF EXISTS procedure_codes,
  DROP COLUMN IF EXISTS sectors,
  DROP COLUMN IF EXISTS specialties,
  DROP COLUMN IF EXISTS agreement_aliases,
  DROP COLUMN IF EXISTS allowed_access_routes;