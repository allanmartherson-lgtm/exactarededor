# Piso mínimo de repasse (Regra C — híbrida) + ajuste dos residuais atuais

## Objetivo

Garantir que **sempre sobre um valor mínimo de líquido** para a PJ receber e emitir NF, mesmo quando a glosa "caberia" no líquido do lote. A clínica precisa perceber que houve glosa e continuar no fluxo de faturamento.

**Regra C (híbrida, global por hospital):** o piso a preservar em cada lote é `max(piso_pct × líquido_bruto_lote, piso_valor_min)`.

- Ex.: `piso_pct = 20%`, `piso_valor = R$ 500`
- Lote com líquido R$ 10.000 → piso = max(2.000, 500) = **R$ 2.000** preservados
- Lote com líquido R$ 1.500 → piso = max(300, 500) = **R$ 500** preservados
- Capacidade de desconto = `líquido − piso`

## Escopo — arquivos afetados

### 1. Banco (migration)

- `hospital_settings`: adicionar 2 colunas
  - `min_payout_pct numeric NOT NULL DEFAULT 0` (0–100, percentual do líquido a preservar)
  - `min_payout_brl numeric NOT NULL DEFAULT 0` (valor absoluto mínimo em R$)
- Default 0/0 = sem piso (comportamento atual preservado até o hospital configurar).

### 2. Edge Function — `apply-company-deductions`

Alterar o cálculo de capacidade da PJ no lote:

```
liquido_pj      = pcf.total_liquido_repasse (já lido)
piso_hospital   = max(min_payout_pct × liquido_pj, min_payout_brl)
capacidade      = max(0, liquido_pj − piso_hospital)
```

- Ler `hospital_settings` uma vez no início da execução via cliente admin.
- Aplicar o mesmo `capacidade` tanto no ramo `full_only` quanto `partial_allowed`.
- No `summary.glosas.insufficient[]` incluir `piso_aplicado` para a UI explicar por quê.

### 3. UI — configuração (nova, pequena)

Adicionar seção **"Piso mínimo de repasse"** em `src/pages/HospitalSettings.tsx` (mesma tela onde já vivem os thresholds de reaprovação):
- Input percentual (0–100) → `min_payout_pct`
- Input R$ → `min_payout_brl`
- Texto explicativo curto: "Nunca descontar mais do que o líquido menos este piso. Garante que a PJ sempre receba algum valor para emitir NF."

### 4. UI — `CreditosDebitos.tsx`

- No tooltip/hint das PJs com `insufficient`, quando `piso_aplicado > 0`, mostrar: "líquido R$ X − piso R$ Y = capacidade R$ Z".
- Nenhuma outra mudança de fluxo (parcelar/adiar já cobrem o caso).

## Ajuste dos residuais já lançados neste ciclo

Casos aplicados **antes** desta regra existirem — CHAIN, CORREIA, DF NEURO etc. — continuam corretos contabilmente, mas o usuário quer que voltem a ter piso preservado.

**Proposta:** roteiro cirúrgico, **não em massa automática**:

1. Rodar diagnóstico (SELECT read-only) listando PJs deste hospital ativo com débito ainda ativo E lote-alvo já `aprovado`/`pago`. Devolvo a lista antes de tocar em qualquer coisa.
2. Para cada caso que você marcar, chamar a RPC existente `revert_glosa_debt` (auditada, não é DELETE cru) — reverte a aplicação e devolve o débito ao pendente.
3. Após configurar o piso do hospital, reaplicar via UI normal com o novo `mode='full_only'`. O motor agora respeita o piso e devolve `insufficient` para os que não couberem, permitindo escolher parcelar/adiar.

**Não vou reverter em massa sem sua confirmação caso a caso** — histórico contábil é sensível.

## Ordem de execução

1. Migration (aguarda aprovação).
2. Edge function + UI de config (após schema pronto).
3. Diagnóstico dos residuais atuais (SELECT — não muta nada).
4. Você escolhe quais reverter; eu executo via `revert_glosa_debt`.

## Detalhes técnicos

- A leitura de `hospital_settings` na edge usa o cliente `service_role` (`SUPABASE_SERVICE_ROLE_KEY`) que já é usado pela função — sem impacto em RLS.
- `min_payout_pct` guardado como fração 0–100 (não 0–1) para casar com o padrão dos outros threshold fields da tabela.
- Piso aplicado **antes** de qualquer outro ajuste (parcelamento manual continua podendo passar por cima via `mode='partial_allowed'`, que é a escolha explícita do usuário na UI).
- Fórmula é **por lote** (usa o líquido daquele payment específico), não uma trava mensal da PJ.
