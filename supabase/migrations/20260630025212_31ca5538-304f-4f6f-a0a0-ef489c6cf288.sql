-- ============================================================
-- Fase D2 — Drop coluna legada payment_type_id (cutover do motor)
-- ============================================================

-- 0. Drop views de auditoria do backfill (D1) — ficam obsoletas após o cutover.
--    Cobriam payment_items + payments + rules; quando as outras tabelas forem
--    migradas em ondas futuras, novas views poderão ser criadas se necessário.
DROP VIEW IF EXISTS public.v_legacy_payment_type_orphans;
DROP VIEW IF EXISTS public.v_legacy_payment_type_divergence;

-- 1. Drop triggers de sync
DROP TRIGGER IF EXISTS trg_sync_payment_items_type_columns ON public.payment_items;
DROP TRIGGER IF EXISTS rule_calculations_sync_item_type ON public.rule_calculations;

-- 2. Drop funções de sync
DROP FUNCTION IF EXISTS public.sync_payment_items_type_columns();
DROP FUNCTION IF EXISTS public.sync_rule_calculations_item_type();
DROP FUNCTION IF EXISTS public._resolve_item_type_from_payment_type(uuid);
DROP FUNCTION IF EXISTS public._resolve_payment_type_from_item_type(uuid);

-- 3. Drop colunas legadas
ALTER TABLE public.payment_items
  DROP COLUMN IF EXISTS payment_type_id,
  DROP COLUMN IF EXISTS payment_type_source;

ALTER TABLE public.rule_calculations
  DROP COLUMN IF EXISTS payment_type_id;

-- 4. Comentários de rastreabilidade
COMMENT ON COLUMN public.payment_items.item_type_id IS
  'Tipo do item (Parecer/Visita/Cirurgia/etc) — FK para item_types. Coluna canônica desde Fase D2 (jun/2026); substituiu payment_type_id (removida).';
COMMENT ON COLUMN public.payment_items.item_type_source IS
  'Origem do item_type_id: manual | auto_tuss | auto_heuristic | base | company_override | default | inherit. Substituiu payment_type_source na Fase D2.';
COMMENT ON COLUMN public.rule_calculations.item_type_id IS
  'Filtro por tipo do item no cálculo. NULL = vale para qualquer tipo. Coluna canônica desde Fase D2; substituiu payment_type_id (removida).';
