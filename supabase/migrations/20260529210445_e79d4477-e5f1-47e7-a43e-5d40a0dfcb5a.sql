
-- Adiciona suporte a pool/rateio no payload de payment_items
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tem_pool boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.tem_pool IS
  'true quando a empresa opera por rateio (pool). Espelha existência de participação ativa em pools, mas pode ser definido manualmente.';

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS empresa_tem_pool boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS empresa_liquido_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS rateio jsonb;

COMMENT ON COLUMN public.payment_items.empresa_tem_pool IS
  'Snapshot: true se a empresa do médico opera por rateio na competência deste item.';
COMMENT ON COLUMN public.payment_items.empresa_liquido_total IS
  'Snapshot do líquido total da empresa (em reais) naquela competência. Aditivo aos campos existentes (bruto, esperado, glosas, líquido do médico).';
COMMENT ON COLUMN public.payment_items.rateio IS
  'JSON com breakdown do rateio quando empresa_tem_pool=true. Formato: { "itens": [{ id, data (YYYY-MM-DD), descricao, valor, paciente?, convenio?, guia? }], "quota": { percentual, valor, pool_id, pool_nome, base, bolo_liquido } }. Omitido (null) quando não há pool.';

-- Constraint de coerência: quando não tem pool, rateio deve ser nulo
ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_rateio_coerente_chk;
ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_rateio_coerente_chk
  CHECK (empresa_tem_pool = true OR rateio IS NULL);
