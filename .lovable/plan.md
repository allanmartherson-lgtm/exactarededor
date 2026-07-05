## Objetivo

Tirar o "Teste de Regras" de dentro do lote e transformá-lo em uma ferramenta de regras (aba dedicada no hub `/regras`), corrigindo o truncamento em 1.000 itens e o falso positivo de mudanças detectadas.

## Diagnóstico

**1. Truncamento 1.986 → 1.000**
O `analyze-payment` faz `.limit(20000)` mas o motor recebe os itens que o PostgREST devolve. Na simulação atual, os itens chegam via chamadas anteriores (base cache) ou via range implícito de 1.000 do PostgREST quando o header `count`/range não é setado. Investigar `itemsQuery` sem `.range()` explícito é o suspeito principal — vamos paginar em blocos de 1.000 na coleta de itens do dry-run.

**2. Falso "acatado → alerta" nos pacotes (R$ 0 → R$ 2.200)**
O modal compara `res.original_status` (lido de `items[].ai_status` que o `PaymentDetail` passa) com `res.status` (retorno do motor). Mas `items` no `PaymentDetail` pode estar **stale/parcial** — só do escopo carregado na tela. Solução: buscar o snapshot atual de `ai_status` e `expected_amount` direto do banco no início da simulação (ou parar de comparar e apenas exibir o resultado do dry-run, que é o que interessa para "e se eu rodasse agora").

## Nova localização

Nova aba **"Teste de motor"** em `/regras?tab=teste-motor` (junto de Simulador e Simulador em lote). Diferente do Simulador em lote (planilha externa), este roda o motor determinístico em cima de um **lote existente** já parseado, com seletor de lote.

## Passos

1. **Criar `src/pages/RuleEngineTest.tsx`** (versão promovida do modal):
   - Combobox de lote (hospital ativo, últimos 90 dias, ordenados por `created_at`)
   - Botão "Rodar simulação" chamando `analyze-payment` com `is_dry_run: true`
   - Tabela com: código/procedimento, via/médico, status atual (snapshot DB) → status simulado, esperado atual → esperado simulado, regra que casou
   - Filtros: "só mudanças", por status simulado, por regra
   - Exportar CSV

2. **Registrar no `RegrasHub`** como nova aba `teste-motor` e no `App.tsx` como rota `/regras?tab=teste-motor`.

3. **Corrigir truncamento**: em `analyze-payment/index.ts` (linha 547), substituir `.limit(20000)` por paginação explícita `.range(0, 999)`, `.range(1000, 1999)`… até esgotar. Aplicar o mesmo padrão no fetch de siblings (linha 558).

4. **Corrigir falso positivo**: no `RuleEngineTest`, ao rodar dry-run, buscar antes um `SELECT id, ai_status, ai_findings->>'expected_amount' FROM payment_items WHERE payment_id = ?` paginado, e usar esse snapshot como "antes" (nunca props stale).

5. **Remover** `RuleTestModal` de `PaymentDetail.tsx`:
   - remover import e o `<RuleTestModal .../>` (linhas 37 e 5111)
   - remover botão que abre o modal (localizar por `RuleTestModal`/`showRuleTest`)
   - deletar `src/components/payment-detail/RuleTestModal.tsx`
   - deixar um link discreto em PaymentDetail: "Testar regras neste lote →" apontando para `/regras?tab=teste-motor&payment_id=<id>` (a página lê o `payment_id` da URL e pré-seleciona)

6. **Guardrail**: teste unitário garantindo que a chamada de dry-run pagina até esgotar (mock do `analyze-payment` retornando 2 páginas).

## Fora do escopo

- Aplicar o resultado da simulação (rodar de verdade) — continua sendo feito pelo botão "Reanalisar" do lote.
- Simulação cross-lote (isso já é o `RuleSimulatorBatch`).

## Preciso confirmar antes de implementar

Você marcou **"Outra coisa"** além do truncamento e do falso positivo — o que era? (Ex.: modal fecha antes de terminar, botão "Rodar novamente" não atualiza, filtro faltando, coluna faltando…). Sem isso eu implemento só os dois problemas conhecidos + a movimentação para tela própria.
