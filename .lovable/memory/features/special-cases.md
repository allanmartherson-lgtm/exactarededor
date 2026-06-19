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

## Fase 3 — Retroativo
- Aprovação tardia em pagamento já fechado NÃO recalcula automaticamente. Decisão manual do analista via `generate-retroactive-adjustment`.

## Permissões
- Marcar: admin, diretor, analista, gestao_medica (médico via portal — Fase 2).
- Decidir: admin, diretor, gestao_medica.
- Tipos: admin, diretor, gestao_medica gerenciam.

## Fase 3 (entregue)
- Banner `SpecialCaseRetroactiveBanner` em PaymentDetail: aparece se status ∈ {pago, fechado, concluido, aprovado_diretor, aprovado} e existem marks `approved` com approved_at > payment.updated_at. CTA: "Recalcular com casos especiais" (invoca `analyze-payment` modo recompute) ou "Ver marcações".
- Página `/casos-especiais/relatorio` (`SpecialCasesReport.tsx`): KPIs por status/tipo/origem + tabela filtrável (tipo, status, busca por atendimento/médico), link para o pagamento.
