# Acatar esperado = ajustar o valor a pagar

## Premissa corrigida
`gross_amount` = valor que **será pago** (proposta atual). Não é histórico de pagamento. Durante confecção/análise, o analista está justamente montando esse número. Quando ele "acata o esperado", o bruto a pagar tem que virar o esperado — senão o card de composição mente.

## Modelo
Modelo **(B) com trilha + reversão**:
- Acatar item → `gross_amount := expected_amount`
- Guardar valor original em `gross_amount_original` (preenchido só na 1ª sobrescrita)
- Registrar `gross_override_at`, `gross_override_by`, `gross_override_reason='acatado_esperado'`
- Botão "Reverter para valor original" restaura `gross_amount := gross_amount_original` e limpa as flags
- Trava: só permitido enquanto `status ∈ {em_confeccao, revisao_analista, divergente}`. Após aprovado/pago, bloqueado.

## Comportamento por tipo de regra (uniforme)
Funciona igual para qualquer método, porque a operação é sempre "gross := expected":
- **valor_fixo / tabela_diferenciada / percentual_convenio / bonus**: item individual, gross vira expected.
- **pacote**: itens secundários já entram com `expected = 0` e `package_absorbed = true`. Ao acatar o pacote inteiro:
  - item âncora: `gross := expected` (valor do pacote)
  - itens absorvidos: `gross := 0`, `package_absorbed = true`
  - composição: bruto da empresa cai para o valor do pacote naturalmente (já filtramos `package_absorbed` no `compute-company-financials`)
- **sem_regra**: não permite acatar (não há esperado confiável). Mantém comportamento atual.

## Onde toca

### Banco (migration)
Em `payment_items`:
- `gross_amount_original numeric` (nullable)
- `gross_override_at timestamptz`
- `gross_override_by uuid`
- `gross_override_reason text` — enum textual: `acatado_esperado | ajuste_manual | pacote_absorvido`

### Backend
- Novo edge `accept-expected-value` (ou estender `override-duplicate-item` pattern):
  - input: `{ payment_id, item_ids[], reason }`
  - valida status, copia `expected_amount → gross_amount`, preserva original
  - trigger `compute-company-financials` no fim
- Reverter: mesma função com `action: 'revert'`
- `analyze-payment`: NÃO sobrescrever `gross_amount` quando `gross_override_at IS NOT NULL` (respeitar override do analista). Continua atualizando `expected_amount` se a regra mudar — aí o analista decide reacatar.

### Frontend
- `ItemsDataGrid.tsx`:
  - Ação "Acatar esperado" já existe → passa a chamar o novo endpoint (não só mudar status)
  - Badge "ajustado" nos itens com `gross_override_at`, tooltip mostra original
  - Menu de item: "Reverter para valor original" quando há override
  - Banner do pacote: usa o gross efetivo (que agora bate com expected)
- `CompanyAnalysis.tsx`: após acatar, `await load()` + `composition.refresh()` (já está feito)
- `FinancialCompositionStrip`: nenhum mudança — passa a bater sozinho

## Reversibilidade e auditoria
- `audit_log` recebe entrada por override (item_id, valor antes/depois, motivo, usuário)
- Reversão é livre até aprovação. Após aprovado, qualquer mudança de valor exige reabrir o grupo (fluxo existente).

## Não faz parte deste plano
- Mudar semântica de `gross_amount` para pagamentos já aprovados (imutável após aprovação)
- Editar valor livre (só "acatar esperado" e "reverter"; edição manual de valor continua via campo de override existente, agora também grava `gross_amount_original` se ainda não estiver setado)
- Glosas e débitos: continuam exatamente como hoje, na tela própria, somando no card de composição

## Ordem de execução
1. Migration dos 4 campos novos
2. Edge `accept-expected-value` + ajuste no `analyze-payment` para respeitar override
3. UI: ação acatar → endpoint, badge "ajustado", reverter
4. Smoke no caso atual (DF Star, R$ 19.547,95 do pacote) e em 1 caso de tabela_diferenciada

Confirma que sigo com isso?
