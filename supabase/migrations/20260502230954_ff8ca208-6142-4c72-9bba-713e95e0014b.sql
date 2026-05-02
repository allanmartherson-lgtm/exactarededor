-- Fase 1: Schema do novo motor de regras determinístico

-- 1) Novo enum calculation_type (7 tipos da especificação)
CREATE TYPE public.rule_calculation_type AS ENUM (
  'percentual_sobre_convenio',
  'regra_vias',
  'pacote_fechado',
  'pacote_com_extras',
  'valor_fixo',
  'exclusao',
  'informativo'
);

-- 2) Enum analysis_mode em payments
CREATE TYPE public.payment_analysis_mode AS ENUM (
  'padrao',
  'empresa_prioritaria'
);

-- 3) Coluna analysis_mode em payments (default padrao para retrocompat)
ALTER TABLE public.payments
  ADD COLUMN analysis_mode public.payment_analysis_mode NOT NULL DEFAULT 'padrao';

-- 4) Coluna patient_name em payment_items (texto livre, vem do raw_data quando disponível)
ALTER TABLE public.payment_items
  ADD COLUMN patient_name text;

-- 5) Novos campos de cálculo em rules
--    - calculation_type: novo enum (substitui semanticamente rule_type)
--    - convenio_percentage: para percentual_sobre_convenio (ex.: 100, 88, 70)
--    - fixed_amount: para valor_fixo (substitui bonus_amount/target_amount)
--    - extras_codes: para pacote_com_extras (códigos que somam ao pacote_fechado)
ALTER TABLE public.rules
  ADD COLUMN calculation_type public.rule_calculation_type,
  ADD COLUMN convenio_percentage numeric,
  ADD COLUMN fixed_amount numeric,
  ADD COLUMN extras_codes text[];

-- 6) Migração automática dos rule_type antigos para calculation_type
UPDATE public.rules SET calculation_type = CASE rule_type
  WHEN 'pacote'              THEN 'pacote_fechado'::public.rule_calculation_type
  WHEN 'tabela_diferenciada' THEN 'percentual_sobre_convenio'::public.rule_calculation_type
  WHEN 'bonus'               THEN 'valor_fixo'::public.rule_calculation_type
  WHEN 'complemento'         THEN 'valor_fixo'::public.rule_calculation_type
  WHEN 'informativo'         THEN 'informativo'::public.rule_calculation_type
  ELSE 'informativo'::public.rule_calculation_type
END;

-- Default 100% para regras migradas de tabela_diferenciada (eram cálculo via tabela; agora são pct sobre convênio)
UPDATE public.rules
   SET convenio_percentage = 100
 WHERE calculation_type = 'percentual_sobre_convenio'
   AND convenio_percentage IS NULL;

-- Para regras antigas de bônus/complemento, copia o valor fixo aplicável
UPDATE public.rules SET fixed_amount = bonus_amount   WHERE rule_type = 'bonus'      AND bonus_amount   IS NOT NULL AND fixed_amount IS NULL;
UPDATE public.rules SET fixed_amount = target_amount  WHERE rule_type = 'complemento' AND target_amount  IS NOT NULL AND fixed_amount IS NULL;

-- Torna calculation_type obrigatório e define default
ALTER TABLE public.rules
  ALTER COLUMN calculation_type SET NOT NULL,
  ALTER COLUMN calculation_type SET DEFAULT 'informativo'::public.rule_calculation_type;

-- 7) Índices úteis para o motor
CREATE INDEX IF NOT EXISTS idx_rules_calc_type        ON public.rules (calculation_type) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_rules_target_type_id   ON public.rules (target_type, target_company_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_rules_sector_active    ON public.rules (sector) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_rules_extras_codes_gin ON public.rules USING gin (extras_codes);

-- 8) Comentários para documentar
COMMENT ON COLUMN public.rules.calculation_type IS
  'Novo motor determinístico (Fase 1). Substitui rule_type semanticamente. Tipos: percentual_sobre_convenio | regra_vias | pacote_fechado | pacote_com_extras | valor_fixo | exclusao | informativo';
COMMENT ON COLUMN public.rules.convenio_percentage IS
  'Usado em percentual_sobre_convenio. Ex.: 100 (cirurgia geral), 88 (hemodinâmica), 70.';
COMMENT ON COLUMN public.rules.fixed_amount IS
  'Usado em valor_fixo. Substitui bonus_amount/target_amount no novo modelo.';
COMMENT ON COLUMN public.rules.extras_codes IS
  'Usado em pacote_com_extras. Lista de procedure_codes que somam ao package_amount.';
COMMENT ON COLUMN public.payments.analysis_mode IS
  'padrao = comportamento atual; empresa_prioritaria = analisa o arquivo isoladamente, sem cruzar com outros pagamentos/meses, exibe só itens com erro.';
COMMENT ON COLUMN public.payment_items.patient_name IS
  'Nome do paciente (extraído do raw_data quando disponível). Usado na visão empresa_prioritaria.';