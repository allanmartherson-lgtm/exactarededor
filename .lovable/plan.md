# Mudança de padrão: aplicação "tudo ou nada" com decisão explícita do usuário

## Regra nova
Ao aplicar glosa/débito de uma PJ em um lote:

- **Se líquido do lote cobre 100% do saldo devedor** → aplica normalmente.
- **Se NÃO cobre** → NÃO aplica nada automaticamente. Abre modal de decisão:
  1. **Parcelar neste lote** — aplica o máximo possível agora; residual fica pendente para próximo ciclo (comportamento antigo, mas explícito).
  2. **Adiar para próximo período** — não aplica nada neste lote; débito segue pendente aguardando outro lote com líquido suficiente.
  3. **Escolher outro lote-alvo** — reabre seletor de lote para apontar um com líquido maior.
  4. **Cancelar**.

Sem residual silencioso. Sem "aplicação com pendências" como default.

## Arquivos afetados

### 1. `supabase/functions/apply-company-deductions/index.ts`
- Aceitar novo parâmetro `mode: 'full_only' | 'partial_allowed'` (default `full_only`).
- Aceitar `dry_run: boolean` para pré-checagem sem escrever.
- Quando `mode='full_only'` e líquido < saldoDevedor: retornar `insufficient_liquidity` **sem** aplicar, com detalhes (líquido disponível, saldo devedor, faltante) por PJ.
- Quando `mode='partial_allowed'`: comportamento atual (aplica o que couber, adia resíduo).
- Reimplantar.

### 2. `src/pages/CreditosDebitos.tsx`
- Fluxo "Confirmar em massa" e ação individual:
  - Primeiro chama edge em `dry_run` para descobrir quais PJs têm líquido insuficiente.
  - Se todas cobrem → aplica direto (modo `full_only`).
  - Se alguma NÃO cobre → abre novo modal `InsufficientLiquidityDialog` listando as PJs problemáticas com opções acima.
  - Decisão do usuário vira segunda chamada com `mode` apropriado (e possivelmente lista filtrada de PJs a aplicar / adiar).

### 3. Novo componente `src/components/creditos-debitos/InsufficientLiquidityDialog.tsx`
- Lista PJs com: nome, saldo devedor, líquido do lote-alvo, faltante.
- Ações por linha: Parcelar / Adiar / Trocar lote.
- Ações em massa: Parcelar todas / Adiar todas.

## Fora de escopo (não mexo)
- Motor de cálculo de glosa.
- Regras de idempotência (advisory lock, upsert de débitos).
- Outras telas financeiras.

## Migração / dados
Nenhuma migration. Débitos que já ficaram com residual das rodadas anteriores continuam válidos — a mudança vale só para novas aplicações.
