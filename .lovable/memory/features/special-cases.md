---
name: Casos especiais (oncológico/pediátrico/etc.)
description: Flag manual aprovada pela gestão médica que permite regras de repasse diferenciadas para casos com viés assistencial
type: feature
---

# Casos Especiais

Patologias/contextos que pedem remuneração diferenciada (oncológico, pediátrico complexo, urgência alta complexidade) NÃO são inferidos pelo motor. Dependem sempre de marcação humana + aprovação da gestão médica.

## Modelo
- `special_case_types`: catálogo (code, label, requires_justification, hospital_id, active)
- `special_case_marks`: marcação por (payment + attendance, opcionalmente item_id). Status: pending → approved/rejected/revoked. Origin: medico_portal | analista | gestao_medica.
- `payment_items.special_case_code/special_case_status`: campos derivados sincronizados via trigger `trg_special_case_marks_after_change` → função `apply_special_case_to_items`.
- `rules.special_case_filter` text[]: null = regra padrão; ['*'] = qualquer caso aprovado; ['oncologico'] = só esse.

## Fluxo
- Médico (portal) e analista (PaymentDetail) criam marca em `pending`.
- Gestão médica (role `gestao_medica`) cria já `approved` ou decide pendentes.
- Edge functions: `mark-special-case`, `decide-special-case`.
- UI principal: `/casos-especiais` (fila + criação manual).
- Marca por atendimento herda em todos os itens; marca por item específico tem precedência.

## Motor
- `RULES_SELECT` carrega `special_case_filter`.
- `payment_items` SELECT carrega `special_case_code/special_case_status`.
- TODO Fase 1.5: aplicar filtro no matching — regra com `special_case_filter` não-nulo só casa se item tem `special_case_status='approved'` e código compatível; itens com flag aprovada priorizam essas regras antes da padrão.
- Sem regra cadastrada para o caso especial = cai na regra padrão + alerta (jamais default hardcoded).

## Permissões
- Marcar: admin, diretor, analista, gestao_medica (médico via portal — Fase 2 pendente).
- Decidir/aplicar ajuste retroativo: admin, diretor, gestao_medica.
- Tipos: admin, diretor, gestao_medica gerenciam.

## Fase 3 — Ajuste retroativo formal (pagamento fechado = imutável)
- Banner NÃO chama mais `analyze-payment`. Pagamento fechado nunca é recalculado.
- `SpecialCaseRetroactiveBanner` lista marks `approved` com `approved_at > payment_status_history.changed_at` (cutoff real de fechamento) e SEM `retro_adjustment_id`.
- CTA "Gerar ajuste retroativo" abre `SpecialCaseRetroactiveAdjustDialog` → edge `special-case-adjust`:
  1. `preview:true` → summary por PJ (sugere PJ ativa via doctor_companies).
  2. Gate: dedução (`valor<0`) exige `allow_reduction:true` + checkbox UI; sem flag → 409 `reduction_requires_confirmation`. Equivale ao `_allow_calc_reduction` da governança de regras.
  3. `preview:false` (só decisor) cria `company_financial_adjustments` (`complemento_retroativo`/`deducao_retroativa`), `origem=special_case:<payment_id>`.
  4. Vincula marks via `special_case_marks.retro_adjustment_id` + `retro_applied_at/by` (migration 20260619140745).
  5. `audit_log` registra `special_case_retro_adjust` com summary completo.
- Bloqueios: `payment_not_closed`, `marks_invalid`, `marks_already_applied`.

## Admin de tipos
- Rota `/admin/tipos-caso-especial`. Code imutável.

## Marcação no PaymentDetail
- `MarkSpecialCaseDialog` → `mark-special-case`. Analista=pending; gestao_medica/diretor/admin=approved direto.
- Pending → `internal_notifications` para todos os `gestao_medica`.

## Grid
- Badge inline em `ItemsDataGrid` quando `special_case_status` é approved/pending.

## Testes
- `src/test/specialCases.contract.test.ts` (18 testes): auth, gate de redução, snapshot audit, vínculo mark↔adjustment, imutabilidade do fechado, banner sem `analyze-payment`, schema.

## Pendente — Portal do médico (Fase 2)
- `/portal/medico` não existe. Quando criado: plugar `MarkSpecialCaseDialog` + estender `issue-magic-link` com action `decide_special_case`.
