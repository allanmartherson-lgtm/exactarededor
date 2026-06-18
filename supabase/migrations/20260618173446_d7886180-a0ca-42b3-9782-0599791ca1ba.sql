-- Fase 2.1: Flags de catch-all e prevenção de fallback externo

-- 1) rule_calculations.is_catch_all
ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS is_catch_all boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rule_calculations.is_catch_all IS
  'Quando true, este cálculo é o "piso" da regra: avaliado por último, ignora whitelist de procedure_codes/procedure_keywords (demais filtros — convênio, setor, função, via — continuam valendo). Máximo 1 por regra.';

-- Constraint: máximo um catch-all por regra
CREATE UNIQUE INDEX IF NOT EXISTS rule_calculations_one_catch_all_per_rule
  ON public.rule_calculations (rule_id)
  WHERE is_catch_all = true;

-- 2) rules.prevent_external_fallback
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS prevent_external_fallback boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rules.prevent_external_fallback IS
  'Quando true, se esta regra vence a seleção mas nenhum dos seus cálculos (incluindo catch-all) bate, o item vai para sem_regra com alerta — NÃO cai para a regra geral master. Padrão recomendado: true para regras específicas (com setor/convênio/empresa/médico/grupo), false para a master.';
