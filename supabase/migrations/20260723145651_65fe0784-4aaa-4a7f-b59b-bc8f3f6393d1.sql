-- 1) Novas colunas em manual_intervention_reasons
ALTER TABLE public.manual_intervention_reasons
  ADD COLUMN IF NOT EXISTS financial_impact text NOT NULL DEFAULT 'neutro'
    CHECK (financial_impact IN ('economia', 'perda', 'neutro'));

COMMENT ON COLUMN public.manual_intervention_reasons.financial_impact IS
'Classifica o impacto financeiro para a unidade: economia (hospital paga menos), perda (hospital paga mais), neutro (sem impacto).';

ALTER TABLE public.manual_intervention_reasons
  ADD COLUMN IF NOT EXISTS applies_to text[] NOT NULL DEFAULT '{manual}';

COMMENT ON COLUMN public.manual_intervention_reasons.applies_to IS
'Ações onde este motivo é oferecido: manual (tratamento manual), acatar (acate rápido), excluir (exclusão de item), editar (edição de valor). Um motivo pode aparecer em várias ações.';

-- 2) Ampliar CHECK de category para incluir 'operacional'
ALTER TABLE public.manual_intervention_reasons
  DROP CONSTRAINT IF EXISTS manual_intervention_reasons_category_check;
ALTER TABLE public.manual_intervention_reasons
  ADD CONSTRAINT manual_intervention_reasons_category_check
  CHECK (category IN ('reclassificacao_clinica', 'aceite_financeiro', 'operacional'));

-- 3) Popular financial_impact + applies_to nos registros existentes
UPDATE public.manual_intervention_reasons SET financial_impact = 'perda',    applies_to = '{manual,acatar}' WHERE code = 'acatar_risco';
UPDATE public.manual_intervention_reasons SET financial_impact = 'perda',    applies_to = '{manual,acatar}' WHERE code = 'valor_negociado';
UPDATE public.manual_intervention_reasons SET financial_impact = 'neutro',   applies_to = '{manual}'        WHERE code = 'outro_financeiro';
UPDATE public.manual_intervention_reasons SET financial_impact = 'neutro',   applies_to = '{manual}'        WHERE code = 'acatar_divergencia_legado';
UPDATE public.manual_intervention_reasons SET financial_impact = 'economia', applies_to = '{manual}'        WHERE code = 'visita_sequencial_parecer';
UPDATE public.manual_intervention_reasons SET financial_impact = 'neutro',   applies_to = '{manual}'        WHERE code = 'tuss_ambiguo';
UPDATE public.manual_intervention_reasons SET financial_impact = 'economia', applies_to = '{manual}'        WHERE code = 'visita_pos_alta';
UPDATE public.manual_intervention_reasons SET financial_impact = 'neutro',   applies_to = '{manual}'        WHERE code = 'outro_clinico';
UPDATE public.manual_intervention_reasons SET financial_impact = 'neutro',   applies_to = '{manual}'        WHERE code = 'reclassificacao_legado';

-- 4) Novos motivos para acate, exclusão e operacional
INSERT INTO public.manual_intervention_reasons (code, label, category, description, financial_impact, applies_to, is_seed, sort_order) VALUES
  ('erro_convenio',        'Erro do convênio (enviou valor errado)',           'aceite_financeiro',       'Convênio enviou valor diferente do acordo. Analista corrige acatando o esperado.',                  'economia', '{acatar}',         true, 15),
  ('fora_acordo',          'Fora do acordo (sem cobertura)',                   'aceite_financeiro',       'Procedimento não está coberto pelo acordo vigente. Item não deve ser pago.',                        'economia', '{acatar,excluir}', true, 16),
  ('duplicidade',          'Duplicidade / reimportação',                       'aceite_financeiro',       'Item duplicado na planilha ou reimportado. Não deve ser pago duas vezes.',                          'economia', '{acatar,excluir}', true, 17),
  ('acordo_complementar',  'Acordo complementar (pagamento fora do convênio)', 'aceite_financeiro',       'Pagamento previsto em acordo direto com o médico/empresa, fora do repasse do convênio.',            'perda',    '{acatar}',         true, 25),
  ('correcao_valor',       'Correção de valor (convênio mandou menos)',        'aceite_financeiro',       'Convênio enviou valor inferior ao devido pelo acordo. Hospital complementa a diferença.',           'perda',    '{acatar}',         true, 26),
  ('excecao_diretoria',    'Exceção autorizada pela diretoria',                'aceite_financeiro',       'Pagamento excepcional autorizado por diretor. Fora da regra padrão.',                               'perda',    '{acatar,manual}',  true, 30),
  ('erro_importacao',      'Erro de importação / dado incorreto',              'operacional',             'Item importado com dados incorretos. Será reimportado ou corrigido na fonte.',                      'neutro',   '{excluir}',        true, 10),
  ('item_cancelado',       'Procedimento cancelado',                           'operacional',             'Procedimento não foi realizado ou foi cancelado. Não deve constar no lote.',                        'economia', '{excluir}',        true, 11),
  ('reclassificacao_tipo', 'Reclassificação (parecer/visita)',                 'reclassificacao_clinica', 'Mudança de classificação clínica do item. Sem impacto financeiro direto.',                          'neutro',   '{manual}',         true, 25)
ON CONFLICT (code) WHERE hospital_id IS NULL DO NOTHING;

-- 5) Colunas de intervenção genérica em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS intervention_reason_id uuid REFERENCES public.manual_intervention_reasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intervention_notes text,
  ADD COLUMN IF NOT EXISTS intervention_financial_impact text
    CHECK (intervention_financial_impact IN ('economia', 'perda', 'neutro'));

COMMENT ON COLUMN public.payment_items.intervention_reason_id IS
'Motivo da última intervenção do analista (acate, exclusão, edição). Diferente de manual_intervention_reason_id que é específico do tratamento manual.';
COMMENT ON COLUMN public.payment_items.intervention_financial_impact IS
'Snapshot do financial_impact no momento da intervenção — desnormalizado para performance de relatórios.';
