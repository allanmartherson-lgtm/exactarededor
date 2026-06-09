---
name: Trilha de Pagamento (Prioritário/Habitual)
description: Campo comercial em payments.payment_track que apenas segmenta fluxo de prazo — nunca afeta cálculo, regra ou status; usado para comparar trilha-com-trilha em relatórios
type: feature
---

Coluna `payments.payment_track` (enum `payment_track`: `prioritario` | `habitual`, nullable = "não classificado").

**Significado:** apenas fluxo comercial — prioritárias pagam antes do prazo padrão, habituais seguem prazo normal. Não entra em nenhuma fórmula, regra ou validação.

**Onde aparece:**
- NewPayment: campo opcional na criação do lote.
- PaymentDetail (header): select inline para mudar a trilha do lote a qualquer momento.
- Payments list: badge no card + filtro "Trilha" no popover de avançados.
- PaymentPivotSection: filtro "Trilha" (default = `auto` = igual à trilha do lote atual). Usa o param `p_track` da RPC `get_payment_pivot` para comparar habitual×habitual ou prioritário×prioritário. Isso evita inflar a média histórica quando coexistem dois lotes no mesmo CC/mês.
- DRE (`/dre`) e Inteligência Financeira: filtro "Trilha de pagamento" no card de filtros. Propaga `p_track` para `get_dre_consolidated`, `get_open_position`, `get_dre_drilldown`, `get_spend_trend`, `get_money_funnel`. Em `ProjectionTab`, `DoctorConcentrationTab` e `ValidationRiskSection` o filtro é aplicado via `payments!inner(payment_track)` na query do PostgREST.
- CompanyAnalysis: badge "Trilha: Habitual/Prioritário/Sem trilha" no header — o filtro não se aplica porque a tela representa um único grupo de empresa dentro de um único lote (a trilha é uma propriedade do lote).

**Como aplicar:** ao adicionar gráfico/relatório histórico comparativo entre lotes, sempre considerar incluir o filtro de trilha. Reutilize `<PaymentTrackFilter>` em `src/components/shared/PaymentTrackFilter.tsx` e use `toRpcTrack()` para converter `"all"`→`null` ao passar para a RPC. Valores aceitos pelas RPCs: `null` (todos), `"prioritario"`, `"habitual"`, `"nao_classificado"` (lotes com `payment_track IS NULL`).
