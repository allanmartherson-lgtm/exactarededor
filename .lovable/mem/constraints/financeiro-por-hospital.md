---
name: Financeiro (glosas/créditos/débitos/ajustes) é sempre por hospital
description: Toda função nova ou ajuste em créditos, débitos, glosas, ajustes de PJ e deduções precisa gravar e filtrar por hospital_id ativo — cada hospital tem autonomia total sobre seus valores
type: constraint
---

**Invariante reforçado pelo usuário (07/2026).**

Créditos, débitos, glosas, ajustes de PJ, deduções aplicadas em lote e eventos de auditoria financeira são **sempre por hospital**. Uma glosa aplicada a uma PJ no Santa Helena não pode aparecer, cruzar, deduzir ou influenciar lote/relatório de outra unidade. Cada hospital tem sua própria autonomia financeira sobre a mesma PJ.

**Tabelas obrigatoriamente hospital-scoped** (hospital_id NOT NULL + RLS + trigger default `current_active_hospital()`):
- `glosa_debts`, `glosa_debt_items`, `glosa_payment_applications`, `glosa_item_match_history`, `glosa_batches`
- `company_financial_adjustments`, `company_adjustment_applications`, `deduction_application_events`
- `pool_deductions`, `pool_deduction_values`, `payment_company_financials`
- Qualquer nova tabela de saldo/movimento financeiro por PJ

**Regras para qualquer feature nova/ajuste em financeiro**:
1. INSERT sempre grava `hospital_id = activeHospitalId` (nunca NULL, nunca inferir do payment).
2. SELECT/UPDATE/DELETE sempre passa pela RLS `current_active_hospital()` — quando o resolver não é óbvio (RPC/edge), incluir `.eq("hospital_id", ...)` explícito como defesa em profundidade.
3. Edge functions que tocam financeiro recebem `hospital_id` no body e validam com `assertHospitalAccess`.
4. Eventos de auditoria (`deduction_application_events`, `audit_log`) carimbam hospital_id da ação.
5. Agrupamentos por PJ na UI **nunca** cruzam hospitais — mesmo que a PJ (companies) seja global, os saldos/débitos são isolados.
6. Relatórios (Excel/PDF) de crédito/débito só listam o hospital ativo; se precisar consolidar cross-unit, exigir role admin/diretor global e marcar explicitamente.

**Por quê**: PJs prestam serviço a várias unidades Rede D'Or com contratos, comissões e apurações independentes. Vazamento entre unidades = risco financeiro direto (dedução aplicada no lote errado) + risco regulatório (LGPD) + contaminação de relatórios de fechamento.
