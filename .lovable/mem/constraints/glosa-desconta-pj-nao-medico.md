---
name: Glosa desconta da PJ, não do médico
description: Para fins de pagamento, PJ e médico são inseparáveis. Glosa é dívida da PJ e sai do líquido da PJ no lote — independente de o médico específico ter produção nesse lote.
type: constraint
---

**Invariante reforçado pelo usuário (07/2026).**

A tela de Créditos e Débitos roda **paralela ao lote vigente**, não dentro dele. Quando aplicamos uma glosa a uma PJ num lote, o desconto sai do **líquido da PJ**, não do sub-total daquele médico específico.

**Regra**: NUNCA condicionar aplicação de glosa/débito à existência de `payment_items` do médico da dívida no lote alvo. O médico pode não ter produção nenhuma naquele mês — a PJ ainda tem produção de outros médicos e é dela que se desconta.

**Não fazer**:
- `postponed` com `postpone_reason = "sem_producao"` só porque o doctor_id da dívida não aparece em `payment_items` do lote.
- Filtrar `glosa_debts` por médicos com produção no lote.
- Skip silencioso quando `doctorIdsComProducao.has(debt.doctor_id) === false`.

**Fazer**:
- Carregar todas as dívidas ativas apontadas para o lote (via `target_payment_id` ou `origem=conciliacao_residual`) da PJ + hospital.
- Aplicar contra `capacidadeRestante` da PJ (líquido do snapshot menos deduções já deste ciclo).
- `postponed` só quando faltar capacidade (`insufficient_net` / `partial_capacity`), nunca por ausência do médico.

**Por quê**: se pagamos indevidamente à PJ errada no passado, a dívida é dela. Como o pagamento hospital→médico é sempre via PJ + NF, a PJ é o veículo financeiro; o médico é rastreabilidade. Bloquear por produção do médico esconde débitos legítimos e mantém botão "Aplicar" perpetuamente habilitado.
