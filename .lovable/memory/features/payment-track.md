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

**Como aplicar:** ao adicionar gráfico/relatório histórico comparativo entre lotes, sempre considerar incluir o filtro de trilha quando o usuário olha um lote específico — comparar trilhas diferentes infla/desinfla números.

Pendente: filtros de trilha em ExecutiveDashboard, DRE, FinancialIntelligence, CompanyAnalysis.
