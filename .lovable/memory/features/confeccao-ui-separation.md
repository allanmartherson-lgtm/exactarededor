---
name: Modo Confecção — UI/UX separada do modo Análise
description: Em confecção, vocabulário e blocos do modo análise (aprovado/reprovado, divergência, ai_status, conciliação, PDF analítico, validate-payment) ficam ocultos. Composição financeira usa Σ procedure_amount → Σ expected_amount.
type: feature
---

Princípio: modo confecção CRIA o repasse do zero. Modo análise compara repasse já existente. Nunca misturar vocabulário/UI dos dois.

UI obrigatoriamente OCULTA em confecção:
- Aba "Divergências" e aba "Detalhe IA" (CompanyAnalysis)
- Botão "Conciliação desta empresa" (não há base hospitalar para confrontar)
- Bloco de cards IA (ExecutiveSummaryCard, DirectorBriefingCard, PreAnalysisScoreCard, "Alertas assistenciais")
- PhaseSummary (fases análise→validação→aprovação)
- GroupReconciliationGate
- TussPrincipalAuditPanel
- Cards mobile colapsáveis "Análise IA"

Stats da empresa em confecção:
- "Itens" (mesmo de análise)
- "Repasse calculado" = Σ expected_amount (tom warning/âmbar)
- "Com regra" = itens com applied_rule_id
- "Sem regra" = itens sem applied_rule_id (tom warning se >0)

Composição financeira em confecção (useFinancialComposition + FinancialCompositionStrip):
- bruto = Σ procedure_amount (valor convênio bruto)
- liquido = Σ expected_amount (repasse calculado pelo motor)
- Sem débitos/glosas/pool/conciliação (só entram após finalize_confeccao)
- Hook calcula client-side, sem chamar compute-company-financials
- Strip renderiza versão simplificada com 2 cells: "Valor convênio → Repasse calculado"

Edge functions:
- validate-payment: short-circuit `ok: true, skipped: true, reason: confeccao_mode` se analysis_mode='confeccao'
- compute-company-financials: NÃO chamar em confecção (gross_amount está null)

Status visual em listagens:
- src/lib/status.ts expõe CONFECCAO_STATUS_LABELS + displayPaymentStatus(payment).
- StatusBadge aceita props analysisMode/confeccaoStatus — quando mode=confeccao usa confeccao_status, não payment.status ("rascunho").
- Aplicado em src/pages/Payments.tsx em ambas as listagens (mobile cards e tabela desktop).
