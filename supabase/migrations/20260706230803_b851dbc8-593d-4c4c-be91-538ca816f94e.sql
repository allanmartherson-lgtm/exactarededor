
ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS piso_habilitado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS piso_escopo text CHECK (piso_escopo IN ('por_item','por_atendimento')),
  ADD COLUMN IF NOT EXISTS piso_valor_padrao numeric,
  ADD COLUMN IF NOT EXISTS piso_por_funcao jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.rule_calculations.piso_habilitado IS
  'Quando true, aplica MAX(valor_convenio, piso) ao invés de apenas o percentual do convênio.';
COMMENT ON COLUMN public.rule_calculations.piso_escopo IS
  'por_item = piso vale para cada linha; por_atendimento = piso aplicado 1x por atendimento independente do número de linhas.';
COMMENT ON COLUMN public.rule_calculations.piso_por_funcao IS
  'Array [{funcao:"Cirurgião Principal", valor:1100}, {funcao:"1º Auxiliar", valor:400}]. Se vazio, usa piso_valor_padrao.';

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS piso_aplicado_valor numeric,
  ADD COLUMN IF NOT EXISTS piso_metodo_vencedor text CHECK (piso_metodo_vencedor IN ('convenio','piso'));

COMMENT ON COLUMN public.payment_items.piso_aplicado_valor IS
  'Valor complementado pelo piso (piso - valor_convenio) quando o piso venceu. 0/null quando não houve piso ou convênio venceu.';
COMMENT ON COLUMN public.payment_items.piso_metodo_vencedor IS
  'Auditoria: registra se o expected_amount veio do cálculo por convênio ou do piso.';
