# Cadastro de Acordos — Tipo de Pagamento e Cálculo condicional

Redesenho das etapas 2/3 do wizard para o conceito de "Tipo de Pagamento", com a etapa de cálculo reaproveitando **o mesmo componente** já usado na tela de Regras (`RuleCalculationsEditor`), não uma versão simplificada.

## 1. Banco (migration — precisa da sua aprovação)

Efeito prático, em linguagem simples:

- Cadastra o modelo de pagamento **"Hora trabalhada"** (mesmo padrão de Produção/Remessa/Plantão/Valor fixo, entre Plantão e Valor fixo na ordenação).
- No Cadastro de Acordos passam a existir:
  - **Tipo de pagamento** (vários por acordo);
  - **Mínimo garantido**: ligado/desligado, valor, escopo, periodicidade e base — exatamente os mesmos domínios usados hoje nas Regras;
  - **Rascunho de cálculo**: guarda o método de cálculo e todos os campos que o Setor de Contratos preencheu, no mesmo formato da tela de Regras, para o Analista carregar sem redigitar.
- Os campos antigos "base da tabela" e "percentual" deixam de ser usados pelo formulário. **Não serão apagados** na migration (acordos antigos, PDFs e exportações ainda os leem); ficam apenas como legado, e a tela para de escrever neles. Se preferir remover de fato as colunas, me avise.

Nenhuma regra de acesso muda — os novos campos herdam o RLS por hospital já existente da tabela.

## 2. Etapa "Identificação"

- Novo campo **"Tipo de pagamento"** em chips de múltipla seleção, alimentado por `payment_models` ativos (Produção, Remessa, Plantão, Hora trabalhada, Valor fixo).
- Quando **Produção** ou **Remessa** estiver marcado, aparece o toggle **"Com mínimo garantido"** (padrão Não/Sim já corrigido) e, quando ligado, os campos valor / escopo / periodicidade / base.
- Validação da etapa: exige ao menos um tipo de pagamento; com mínimo garantido ligado, exige valor válido.

## 3. Etapa 3 renomeada para "Cálculo de Pagamento" — conteúdo condicional

| Seleção | O que aparece |
| --- | --- |
| Só "Valor fixo" | Bloco **Valor fixo**: valor do repasse, nº de repasses ou periodicidade. Somem convênios/exceções de convênio, glosa e via de acesso |
| Produção / Remessa / Plantão / Hora trabalhada | Bloco **Cálculo de Pagamento** com o `RuleCalculationsEditor` completo (mesmas 8 opções de método, mesma ordem, mesmos campos condicionais) |
| Ambos os grupos | As duas seções, uma abaixo da outra |

O resultado do editor é serializado com o `calcToDbPayload` já existente e gravado no rascunho de cálculo.

## 4. Semântica dos rótulos (só labels; colunas do banco intactas)

- "Há glosa?" → **"Aplicar desconto de glosa?"**
- "Inclusão de auxiliar" → **"Acordo aplica-se aos auxiliares da cirurgia?"**
- "Inclusão de via de acesso" → **"Os cálculos devem seguir a via de acesso?"**
- Título da etapa "Tabela de pagamento" → **"Cálculo de Pagamento"**

## 5. Fila do Analista → "Cadastrar Regra"

Em `src/pages/Rules.tsx`, o pré-preenchimento passa a:

- carregar o rascunho de cálculo do acordo direto na lista de cálculos (via `calcFromDb`), em vez de montar um único cálculo a partir do percentual;
- trazer o mínimo garantido do acordo para os campos correspondentes da regra;
- manter o fallback atual (percentual legado) para acordos antigos sem rascunho.

## Detalhes técnicos

**Migration**
```sql
insert into payment_models (code,label,description,sort_order,active,calc_strategy,allow_mixed_item_types)
values ('hora_trabalhada','Hora trabalhada','Pagamento por hora efetivamente trabalhada',25,true,'rules',true);

alter table public.agreement_registrations
  add column payment_model_ids uuid[] not null default '{}',
  add column minimo_garantido_ativo boolean not null default false,
  add column minimo_garantido_valor numeric,
  add column minimo_garantido_escopo text,
  add column minimo_garantido_periodicidade text,
  add column minimo_garantido_base text,
  add column calculation_draft jsonb not null default '{}'::jsonb;
```
(`payment_model_ids` como array não aceita FK no Postgres; a integridade é garantida pelo seletor, que só oferece ids de `payment_models`.)

**Arquivos alterados**
- `src/components/relacionamento/AgreementWizardDialog.tsx` — chips de tipo de pagamento, mínimo garantido, etapa condicional, reuso do `RuleCalculationsEditor`, novos labels, payload.
- `src/pages/Rules.tsx` — pré-preenchimento a partir de `calculation_draft` + mínimo garantido.
- `src/lib/agreementRegistrations.ts` — tipagem dos novos campos.
- `src/components/rules/RuleCalculationsEditor.tsx` — **sem alteração de lógica**; se for necessário exportar algo hoje não exportado para reuso, aviso no relatório final.

**Arquivos tocados indiretamente (leitura)** — `AgreementDetailDialog.tsx`, `src/lib/agreementPdf.ts`, `src/lib/agreementExport.ts`: continuam funcionando com os campos legados; passo a incluir o tipo de pagamento e o mínimo garantido nas exportações apenas se você quiser (fora do escopo deste plano).
