-- Fase D / Onda 4 — etapa 1a
-- View pública `payment_types_unified`: UNION semântico de item_types + payment_models.
-- Substitui a tabela legada `payment_types` como fonte de listagens em hooks de UI.
-- A tabela `payment_types` permanece para retrocompat (7 FKs ainda apontam pra ela);
-- os ruídos históricos (`valor_fixo`, `bonus_paciente`) ficam de fora da view e
-- somem das telas de seleção.

CREATE OR REPLACE VIEW public.payment_types_unified AS
SELECT
  it.id,
  it.code,
  it.label,
  COALESCE(it.active, true) AS active,
  COALESCE(it.sort_order, 0) AS sort_order,
  'item_type'::text AS origin,
  it.created_at,
  it.updated_at
FROM public.item_types it
UNION ALL
SELECT
  pm.id,
  pm.code,
  pm.label,
  COALESCE(pm.active, true) AS active,
  COALESCE(pm.sort_order, 0) AS sort_order,
  'payment_model'::text AS origin,
  pm.created_at,
  pm.updated_at
FROM public.payment_models pm;

COMMENT ON VIEW public.payment_types_unified IS
  'Fase D: substitui a tabela payment_types como fonte de listagem na UI. '
  'UNION de item_types (Parecer/Visita/Consulta...) + payment_models (Producao/Remessa). '
  'origin discrimina cada linha. Tabela payment_types permanece por FKs legadas.';

GRANT SELECT ON public.payment_types_unified TO authenticated, anon;
GRANT ALL ON public.payment_types_unified TO service_role;