# Plano — "Faltou pagar" com cálculo de regra (não só valor bruto TASY)

## Problema

Hoje, em `RetroactiveReconciliationsTab.tsx`, itens com `status = "nao_pago"` (Faltou pagar) usam **`valor_total_tasy`** (100% do convênio) como valor a complementar. Isso está errado quando o médico:

- recebe **percentual do convênio** (ex.: 50%) → devíamos complementar 50%, não 100%.
- recebe **valor fixo / pacote / tabela diferenciada** → o valor devido nem depende do convênio, e sim do que a regra pagaria.

Já existe a inferência de `regra_prevista` / `calculo_previsto` para esses itens (via histórico do médico + TUSS), mas o **valor** dessa regra não é calculado — só o rótulo aparece na coluna "Rastreio".

## Objetivo

Para cada linha `nao_pago` com regra prevista identificada, calcular **`valor_previsto_regra`** aplicando o mesmo `rule_calculation` que teria sido usado no lote original, e usar esse valor como base do "A complementar" — igualzinho à lógica de recuperação de glosa (que já respeita `%convênio` vs `pacote/valor_fixo`).

Quando **não houver** regra prevista (médico novo, TUSS inédito), mantemos o comportamento atual (fallback = `valor_total_tasy`) e sinalizamos visualmente `[prev. bruto]` para o analista revisar.

## Escopo — o que muda / o que NÃO muda

| Área | Muda? |
|---|---|
| Lógica de `div_valor`, `div_qtd_valor`, `pago_a_mais`, `ausente_tasy` | **NÃO** |
| `computeTvrFinancialTotals` para statuses não-`nao_pago` | **NÃO** |
| `describeTvrAcao` para statuses não-`nao_pago` | **NÃO** |
| Testes atuais (`describeTvrAcao.test.ts`, `tvrReplaceSummary.test.ts`) | Devem continuar verdes |
| Inferência `pj_provavel` / `regra_prevista` (já existe) | Reaproveitada, sem alterar |
| Novo campo `valor_previsto_regra` em `TvrResult` | **SIM** (opcional, default undefined) |
| Branch `nao_pago` em `describeTvrAcao` e `computeTvrFinancialTotals` | **SIM** (preferir novo valor, cair para `valor_total_tasy`) |

## Passos

### 1. Estender `TvrResult`
Adicionar campos opcionais:
```ts
valor_previsto_regra?: number;   // valor que a regra prevista pagaria
tipo_analise_previsto?: "valor" | "quantidade";  // igual ao tipo_analise do lote
previsto_source?: "regra" | "bruto"; // rastreio: usamos cálculo ou fallback bruto
```

### 2. Calcular o valor previsto na inferência
No mesmo bloco que já busca `regra_prevista` (após carregar `rule_calculations`):

- Ler os campos do `rule_calculation` que já são usados no motor: `calculation_type`, `percentage`, `fixed_amount`, `reference_table_id`, etc.
- Aplicar a mesma fórmula usada no motor original para produzir o valor:
  - `percentual_convenio` / `percentual_sobre_convenio` → `valor_total_tasy × pct`
  - `valor_fixo` → `fixed_amount × qtd_tasy`
  - `tabela_diferenciada` / `pacote` → buscar via `reference_table_id` + `port` do convênio (mesma helper já usada em outros pontos)
  - Se qualquer dado faltar → não preencher `valor_previsto_regra` e marcar `previsto_source = "bruto"`
- Definir `tipo_analise_previsto` a partir do `calculation_type` (regra de mapeamento idêntica à do motor).

Reaproveitar helper existente se houver (ex.: `resolvePaymentAmounts`); caso contrário isolar em `src/lib/tvrRulePreview.ts` **novo e puro** para poder testar.

### 3. Atualizar `describeTvrAcao` — branch `nao_pago`
```ts
if (r.status === "nao_pago") {
  const valor = r.valor_previsto_regra ?? r.valor_total_tasy ?? 0;
  const hint = r.valor_previsto_regra != null
    ? `Regra prevista aplicada: ${r.calculo_previsto ?? r.regra_prevista ?? "—"}`
    : "Sem regra prevista — usando valor bruto TASY (revisar)";
  return { kind: "complementar", valor, label: `↑ Complementar ${brl(valor)}`, hint };
}
```

### 4. Atualizar `computeTvrFinancialTotals` — branch `nao_pago`
Substituir `sum + r.valor_total_tasy` por `sum + (r.valor_previsto_regra ?? r.valor_total_tasy)`.

### 5. Coluna "Regra aplicada" / export
Quando `previsto_source === "bruto"`, prefixar com `[bruto]` para diferenciar de `[prev.]` já existente.

### 6. Testes (obrigatórios, sem afrouxar os atuais)
`describeTvrAcao.test.ts`:
- `nao_pago` com `valor_previsto_regra = 500` → `valor = 500`, hint menciona regra.
- `nao_pago` sem `valor_previsto_regra` → cai para `valor_total_tasy` (regressão do bug original preservada).
- `nao_pago` com regra `%convênio 50%` calculada externamente → resultado bate.

Novo `tvrRulePreview.test.ts`:
- `percentual_convenio` → `valor_total_tasy × pct`
- `valor_fixo` → `fixed_amount × qtd`
- Dados incompletos → retorna undefined (não chuta).

`computeTvrFinancialTotals`:
- Cenário misto com `nao_pago` usando `valor_previsto_regra` correto.
- `nao_pago` sem regra prevista continua somando `valor_total_tasy` (retrocompatível).

### 7. Rollout seguro
- Mudança é **aditiva**: campos novos são opcionais; sem regra prevista, comportamento é idêntico ao atual.
- Um flag local `USE_TVR_RULE_PREVIEW = true` (constante no topo do arquivo) permite desligar rapidamente se algo aparecer em produção.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Recalcular regra diferente do motor original | Só usar helpers já validados; nunca implementar fórmula nova |
| `rule_calculation` incompleto / port ausente | Marcar `previsto_source = "bruto"` e não alterar valor |
| Impactar cards de glosa (que já estão OK) | Branch isolado em `nao_pago`; testes de `pago_a_mais/div_valor` inalterados |
| Analista confundir regra prevista com regra oficial | Rótulo `[prev.]` já existente + hint no `describeTvrAcao` |

## Entregáveis

- `src/components/retroactive/RetroactiveReconciliationsTab.tsx` — novos campos, branch atualizado
- `src/lib/tvrRulePreview.ts` — helper puro (novo)
- `src/lib/__tests__/tvrRulePreview.test.ts` — cobertura de cada `calculation_type`
- `src/components/retroactive/__tests__/describeTvrAcao.test.ts` — casos adicionais para `nao_pago` com/sem regra prevista

Faz sentido seguir? Se quiser, posso começar só pelos casos `percentual_convenio` e `valor_fixo` (que cobrem ~90% dos itens) e deixar `pacote/tabela_diferenciada` como fase 2.
