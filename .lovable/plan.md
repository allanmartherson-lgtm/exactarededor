# Bruto apresentado × Reprovado × Líquido a pagar (B + C)

## Diagnóstico confirmado no banco

Grupo MSRAD (lote `f0626c0b…`, grupo `08a70250…`):

| ai_status | itens | gross_amount |
|---|---|---|
| aprovado | 173 | R$ 54.619,89 |
| reprovado | 162 | R$ 39.898,69 |
| **total** | **335** | **R$ 94.518,58** |

Os itens estão corretos. O erro está nos agregados:

- `sync_payment_company_group` grava `bruto_total = SUM(gross_amount)` de **todos** os itens — correto, é o lastro da base.
- `recompute_payment_liquido` grava `liquido_total = COALESCE(pcf.liquido, bruto)` — e `pcf.liquido` parte de `bruto_simple`, que **também soma os reprovados**. Nenhum ponto da cadeia desconta item reprovado.

Resultado: líquido = bruto = R$ 94.518,58. A reprovação de R$ 39.898,69 desaparece.

## Decisão adotada

- `bruto_total` continua sendo tudo que veio na base. Não muda. (preserva DRE, conciliação NF, relatório de intervenções, lotes já aprovados)
- Passa a existir um valor explícito de **reprovado**, persistido.
- `liquido_total` desconta os reprovados antes das demais deduções.
- Card do lote e header da PJ passam a mostrar os três números.

Fórmula nova do líquido:

```text
liquido = bruto − reprovados − debitos + creditos − glosas − pool + conciliacao
```

Item conta como reprovado quando: `ai_status = 'reprovado'` **e** não cancelado **e** não `package_absorbed`.
Itens `alerta`, `acatado` e `aprovado` continuam entrando no líquido como hoje.

## Arquivos que mudam

### 1. Migration (banco) — precisa da sua aprovação separada
- `payment_company_groups`: nova coluna `reprovado_total numeric NOT NULL DEFAULT 0`.
- `payment_company_financials`: nova coluna `reprovados numeric NOT NULL DEFAULT 0`.
- `sync_payment_company_group`: passa a calcular e gravar `reprovado_total` junto com `bruto_total` (bruto continua igual).
- `compute_company_financial_aggregates`: passa a devolver a chave `reprovados` (o `bruto_simple` continua igual).
- `recompute_payment_liquido`: quando não há snapshot de `pcf`, o fallback do líquido vira `bruto − reprovado_total` em vez de `bruto`; agrega `reprovado_total` também no nível do lote.
- `upsert_payment_company_financials` (RPC chamada pela edge function): aceita e grava `p_reprovados`.
- Backfill: recalcula `reprovado_total` de todos os grupos existentes e `reprovados`/`liquido` das linhas de `payment_company_financials` já materializadas.

Efeito prático em linguagem simples: nenhum valor bruto muda em lugar nenhum. O que muda é que lotes com itens reprovados passam a mostrar (e pagar) um líquido menor — que é o valor correto. Lotes sem reprovação ficam idênticos.

### 2. `supabase/functions/compute-company-financials/index.ts` (edge function — exige redeploy)
- Lê `reprovados` do agregado, subtrai no cálculo do `liquido`, persiste na nova coluna e devolve no payload.

### 3. `src/hooks/useFinancialComposition.ts` (arquivo compartilhado)
- Adiciona `reprovados: number` ao estado e ao mapeamento do snapshot.
- Aviso de impacto: este hook é consumido por `CompanyAnalysis.tsx` e pelos cards de composição financeira. A mudança é **aditiva** (campo novo, nada removido), então nenhuma tela existente quebra.

### 4. `src/pages/CompanyAnalysis.tsx`
- KPI de composição passa a exibir a linha "Reprovado" entre Bruto e Líquido, com o valor em vermelho quando > 0.
- Sublabel do líquido passa a citar bruto e reprovado.

### 5. `src/pages/PaymentDetail.tsx`
- Card de cada PJ no lote passa a mostrar `Bruto apresentado / Reprovado / Líquido a pagar` em vez de um número só.

### 6. Recálculo pontual (item C)
- Após a migration, roda o recálculo do grupo MSRAD para que ele passe a exibir R$ 94.518,58 bruto / R$ 39.898,69 reprovado / R$ 54.619,89 líquido, sem esperar reimportação.

## Fora do escopo

- Não altero o motor de regras, `analyze-payment` nem `zeev-executor`.
- Não mexo em nenhum lote além do MSRAD no recálculo pontual (o backfill apenas preenche a coluna nova, não altera bruto).
- Não altero relatórios de intervenção, DRE ou conciliação NF — todos continuam lendo `bruto_total`, que não muda.
