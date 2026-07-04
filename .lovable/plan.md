# Plano — Faltou pagar sem histórico + export split sempre com 2 abas

## Diagnóstico (com base no XLSX enviado)

Abri o arquivo `tasy-vs-repasse_abas_20260704_1719.xlsx`. Confirmei duas causas independentes:

### Causa 1 — Regra prevista sem cálculo previsto
Todos os 195 itens da aba "Por valor" são `Faltou pagar` e caem no fallback bruto (hint "sem regra prevista, exibindo valor bruto 100% convênio"). Olhando a aba "Parâmetros de cálculo":

```
rule_id preenchido (ex. 808a0330… "Acordo Ortopedia")
rule_calculation_id: NULL
convenio_percentage / fixed_amount / … : 0
```

Ou seja: **a fase 1 acha o `rule_id`** (via histórico de `payment_items` do médico+TUSS) **mas não acha um `applied_calc_id`** — provavelmente porque nesse hospital o médico já teve a REGRA aplicada em outros itens, mas nunca esse TUSS específico com `applied_calc_id` gravado. Sem `calc_id`, `calc_raw` fica vazio e o helper devolve `source: "bruto"`.

### Causa 2 — Export split com 1 aba só
No arquivo veio só "Por valor (195)" e sumiu "Por presença". No código:

```ts
const wsPresenca = isSplit && listPresenca.length > 0 ? buildDataSheet(listPresenca) : null;
```

Como todos os itens são `tipo_analise = "valor"` (default herdado quando `nao_pago` não tem lastro no lote → `pag_applied_calc_method` vazio → cai em `"valor"`), `listPresenca` fica vazia e a aba nem é criada. Isso viola o contrato "pedi as duas abas, quero ver as duas".

Cascata da Causa 1 → Causa 2: mesmo quando temos regra prevista, `tipo_analise` do row nunca reflete a regra prevista (ficamos com o default `"valor"`), então itens de `pacote/valor_fixo` iriam para "Por valor" errado.

## Correções propostas (3 pontos, isolados)

### Fix A — Buscar `rule_calculations` quando só temos `rule_id`
No `enrichNaoPagoInferred`, depois do loop atual que popula `ruleByKey` via histórico:

1. Coletar todos os `rule_id` cujo `calc_id` está vazio.
2. `SELECT id, rule_id, sort_order, label, calculation_type, fixed_amount, convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, procedure_codes, is_catch_all FROM rule_calculations WHERE rule_id IN (…) ORDER BY sort_order ASC`.
3. Para cada `(rule_id, tuss)` em `ruleByKey` sem calc, escolher o primeiro calc na ordem:
   - `procedure_codes` contém o TUSS do item, ou
   - `is_catch_all = true`, ou
   - primeiro calc por `sort_order` (fallback).
4. Preencher `calc_id`, `calc_label`, `calc_raw` na entrada existente.

Isso é heurística — mesma disciplina do resto do bloco de "Faltou pagar": nunca inventa valor, mas quando os dados batem determinístico (regra tem calc único, ou calc explicitamente para aquele TUSS), preenche.

Quando `calculation_type` é `pacote`/`tabela_diferenciada` continua caindo em `source: "bruto"` (fase 2), mas o **tipo_analise** já vai ser conhecido — corrige a Causa 2 mesmo sem valor calculado.

### Fix B — `tipo_analise` do row reflete a regra prevista
Só para `status === "nao_pago"`, ao final da inferência:
```ts
if (r.tipo_analise_previsto && r.tipo_analise !== r.tipo_analise_previsto) {
  r.tipo_analise = r.tipo_analise_previsto;
}
```
Impacto: itens Faltou pagar de regras `valor_fixo`/`pacote` passam a aparecer em "Por presença" — que é onde o analista espera vê-los.

Zero risco para statuses com lastro no lote (tipo_analise deles já vem correto do motor).

### Fix C — Split sempre gera as duas abas
```ts
if (isSplit) {
  book_append_sheet(wb, wsValor ?? buildEmptyPlaceholder("Por valor"), `Por valor (${listValor.length})`);
  book_append_sheet(wb, wsPresenca ?? buildEmptyPlaceholder("Por presença"), `Por presença (${listPresenca.length})`);
}
```
`buildEmptyPlaceholder` retorna uma sheet com header + uma linha "Sem itens desta categoria com os filtros atuais." — assim o analista vê que a categoria está vazia, não que o export bugou.

## O que NÃO muda

- Cálculo de statuses com lastro no lote (`div_valor`, `div_qtd_valor`, `pago_a_mais`, `ausente_tasy`) — intocado.
- `describeTvrAcao` e `computeTvrFinancialTotals` da fase 1 — intocados. Apenas passam a receber `valor_previsto_regra` em mais casos porque Fix A alimenta `calc_raw` para mais linhas.
- Fase 2 (pacote/tabela_diferenciada com valor real) — continua fora. Fix A resolve o `tipo_analise` mesmo sem calcular valor, então a linha vai para a aba certa e mostra `[prev.] bruto` no hint.

## Testes

- **`tvrRulePreview.test.ts`** — cobertura atual segue verde (helper não muda).
- **`describeTvrAcao.test.ts`** — adicionar caso: `nao_pago` com `tipo_analise_previsto = "quantidade"` e `valor_previsto_regra = 300` (valor_fixo) → complementar 300, sem cair no fallback bruto.
- Novo teste ligeiro para o build split ficaria em `RetroactiveReconciliationsTab` mas o export usa xlsx-style — mantemos como validação manual (rodar novo export e confirmar 2 abas).

## Risco

Muito baixo:

- Fix A é aditivo — só preenche quando `calc_raw` estava vazio.
- Fix B só toca `nao_pago` e só quando temos regra prevista com tipo conhecido.
- Fix C é puro UX de export, não altera cálculo.

Se aprovado, implemento os três em uma passada + testes + reexportação para você conferir.
