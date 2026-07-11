## Objetivo
Melhorar o modal "Confirmar débito" em `/financeiro/creditos-debitos`:
1. Exibir rótulo de lote mais completo/único (hospital, competência, status, id curto, valor líquido previsto).
2. Adicionar ação "Confirmar em massa" para várias glosas de uma mesma PJ, escolhendo o lote-alvo ideal.
3. Ensinar o sistema a respeitar a capacidade do lote: se a parcela for maior que o líquido disponível da PJ naquele lote, ela é **postergada** para o próximo ciclo em vez de aplicada.

## Escopo — Frontend (`src/pages/CreditosDebitos.tsx`)

### 1. Rótulos de lote enriquecidos
- Trocar `label` de `LoteOption` para: `"MM/YYYY · <status> · Líq. R$ X · #<id8>"`.
- Buscar líquido previsto por PJ via `payment_company_financials` (`liquido`) ao carregar lotes.
- Usar o mesmo label na lista principal (`paymentLabels`) para eliminar duplicidade visual ("05/2026 · revisão" x2).

### 2. Confirmação em massa
- Adicionar checkbox por linha na seção "Glosas a confirmar" (agrupadas por PJ).
- Novo botão fixo no topo do agrupamento: **"Parcelar e confirmar em massa"** (habilitado quando 2+ selecionadas da mesma PJ).
- Modal em massa mostra: total consolidado, campo parcelas (1–24) aplicado a todos, select do lote-alvo com labels enriquecidos + coluna **"Cabe no lote?"** (líquido − soma das parcelas do ciclo).
- Ao confirmar: um `update` batch por id com `parcelas_default` + `target_payment_id` + `confirmed_at`.

### 3. Regra de capacidade (postergação automática)
Executada quando o motor de aplicação de glosas roda em um lote (Edge Function `apply-company-deductions` — não muda contrato, só lógica interna):
- Calcular `capacidade = liquido_pj_no_lote − Σ(outras deduções já aplicadas no ciclo)`.
- Se `parcela_prevista > capacidade`: **não aplica**, gera registro em `glosa_payment_applications` com `status='postponed'` e `reason='insufficient_net'`, e mantém a glosa ativa. No próximo lote da PJ, entra automaticamente.
- Se `capacidade > 0` mas menor que parcela: aplica parcialmente (`valor_aplicado=capacidade`) e rola resto (mesmo fluxo do débito residual já existente para médico).
- UI da glosa passa a mostrar badge "Postergada: lote sem saldo" quando houver applications `postponed`.

## Detalhes técnicos

**Novos campos / migração**
- `glosa_payment_applications.status` já existe → adicionar valores permitidos `'postponed'` e `'partial'` (check constraint). Adicionar coluna `reason text` se ainda não existe.
- Trigger opcional para não bloquear glosa ativa quando existir application `postponed`.

**Edge Function afetada**
- `supabase/functions/apply-company-deductions/index.ts`: incluir cálculo de capacidade por PJ (usa `payment_company_financials.liquido` do snapshot do lote) e ordenar deduções por prioridade (débitos manuais → glosas mais antigas → recorrentes) antes de aplicar.

**Hooks/queries**
- Nova query em `loadOpenLotes`: join lateral com `payment_company_financials` para trazer `liquido` por PJ.

**Testes**
- Unit em `apply-company-deductions`: cenários (a) cabe tudo, (b) postergação total, (c) aplicação parcial + rolagem.
- UI: garantir que confirmação em massa só habilita para mesma PJ.

## Fora do escopo
- Não altera schema de `glosa_debts` além do necessário.
- Não mexe no fluxo de encaminhamento da apuração retroativa.
- Não altera rotina de cálculo de `liquido` (só consome o snapshot).

## Entrega em 3 PRs sequenciais
1. Labels enriquecidos + query com líquido (baixo risco).
2. Confirmação em massa (frontend puro).
3. Regra de capacidade + postergação (edge function + migração + badge UI).