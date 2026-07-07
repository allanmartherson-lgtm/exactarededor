-- Remove os índices UNIQUE globais em alias_normalized que impediam
-- cadastrar o mesmo texto de alias em hospitais diferentes.
-- O escopo por hospital é garantido pelos índices compostos existentes:
--   ux_convenio_aliases_slug_norm_hospital  (convenio_slug, alias_normalized, hospital_id)
--   ux_sector_aliases_slug_norm_hospital    (sector_slug,   alias_normalized, hospital_id)
--
-- Sintoma: no Santa Helena, clicar "Vincular" em "BRADESCO OPERAD - Empresarial"
-- não avançava porque o mesmo texto já era alias do DF Star. O INSERT batia no
-- UNIQUE global, o helper tratava como duplicado (sucesso silencioso) e a
-- lista de pendências não mudava.
DROP INDEX IF EXISTS public.convenio_aliases_norm_uq;
DROP INDEX IF EXISTS public.sector_aliases_norm_uq;

-- Garante que dentro do MESMO hospital um texto de alias não aponte para
-- dois convênios/setores diferentes (evita ambiguidade no resolver).
CREATE UNIQUE INDEX IF NOT EXISTS ux_convenio_aliases_norm_per_hospital
  ON public.convenio_aliases (alias_normalized, COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE UNIQUE INDEX IF NOT EXISTS ux_sector_aliases_norm_per_hospital
  ON public.sector_aliases (alias_normalized, COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid));