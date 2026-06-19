
## Objetivo
Permitir que casos com viés assistencial (oncológico, pediátrico, etc.) recebam remuneração diferenciada, mantendo o motor determinístico: o sistema só aplica a regra especial quando um humano marca + gestão médica aprova.

## Princípios
- Motor nunca infere "é oncológico" sozinho — depende de flag explícita.
- Sem regra cadastrada para o tipo especial = cai na regra padrão (não inventa default).
- Toda marcação é auditada (quem marcou, quando, justificativa, quem aprovou).
- Reaplicação retroativa é sempre decisão manual do analista.

## Modelo de dados

**`special_case_types`** (admin gerencia)
- `code` (oncologico, pediatrico, urgencia_alta…), `label`, `description`, `active`, `hospital_id`, `requires_justification` (default true)

**`special_case_marks`** (uma marca = atendimento OU item específico)
- `payment_id`, `attendance_number`, `item_id` (nullable — null = vale pra todo o atendimento)
- `special_case_type_code`
- `status`: `pending` | `approved` | `rejected` | `revoked`
- `origin`: `medico_portal` | `analista` | `gestao_medica`
- `marked_by`, `marked_at`, `justification`
- `approved_by`, `approved_at`, `approval_note`
- `rejected_by`, `rejected_at`, `rejection_reason`
- Único parcial: um marca ativa por (attendance + item_id + type_code)

**`payment_items`** (campos derivados, mantidos por trigger)
- `special_case_code` (resolvido), `special_case_status`

**`rules`** (novo campo)
- `special_case_filter` text[] nullable
  - `null` → regra padrão (casa qualquer item; itens com flag aprovada ainda preferem regra especial)
  - `['*']` → casa qualquer caso especial aprovado
  - `['oncologico']` → casa só esse código

## Fluxos

**Marcar (3 origens)**
- Médico (portal): marca atendimento → status `pending` → notifica gestão médica
- Analista (PaymentDetail / detalhe do item): marca → status `pending` → notifica gestão médica
- Gestão médica (role `gestao_medica`): marca → já entra `approved`

**Aprovar/Rejeitar**
- Tela `/casos-especiais` com fila de pendentes (gestão médica)
- Magic link no e-mail/whatsapp pra aprovar sem login (mesmo padrão do approve-via-magic-link)
- Aprovação dispara recálculo do(s) item(s) afetado(s)
- Rejeição mantém regra padrão

**Granularidade "ambos"**
- UI default: marca por atendimento (herda em todas as linhas)
- "Marcar apenas estes itens" abre seleção de linhas específicas
- Resolução: item_id específico > attendance > nenhuma

**Reaplicação retroativa (decisão manual)**
- Se aprovação chega com pagamento já `pago`/`fechado`, sistema NÃO recalcula automaticamente
- Mostra banner no PaymentDetail: "X casos especiais aprovados após fechamento — gerar ajuste retroativo?"
- Botão dispara `generate-retroactive-adjustment` (função já existente) — mesma esteira de retroativo.

## Motor (analyze-payment / validate-payment)
Ordem de match de regra para cada item:
1. Se item tem `special_case_status='approved'` com `code=X`:
   - Procura regra ativa com `special_case_filter` contendo `X` ou `*`
   - Se achar → aplica
   - Se NÃO achar → cai na regra padrão (mesmo fluxo de hoje) + alerta "caso especial sem regra cadastrada"
2. Item sem flag aprovada → ignora regras com `special_case_filter` não-nulo → segue padrão.

## UI

**PaymentDetail / item**
- Badge "Caso especial: Oncológico (aprovado)" ou "(pendente)" ao lado do item
- Ação "Marcar caso especial" no menu do item e do atendimento
- Card no topo: "N casos especiais (M pendentes)"

**Portal do médico**
- Botão "Sinalizar caso especial" no atendimento, com tipo + justificativa obrigatória

**`/casos-especiais`** (gestão médica + admin)
- Tabela: pendentes / aprovados / rejeitados, com filtros (hospital, tipo, médico, data)
- Ações em lote: aprovar/rejeitar com nota

**`/admin/tipos-caso-especial`**
- CRUD de `special_case_types`

**`/regras` (ValidationRules)**
- Novo campo opcional "Caso especial" (multi-select dos tipos ativos + opção "Qualquer caso especial")

## Auditoria
- Cada transição → `audit_log` (mark / approve / reject / revoke / retroactive_generated)
- Mudança de status que altera cálculo já existente passa pelo gate de governança de `rule_calculations` (snapshot + confirmação)

## Notificações
- Marcação por médico/analista → `notify-internal-question` adaptado ou novo handler `notify-special-case-pending` para gestão médica
- Aprovação/rejeição → notifica quem marcou (analista e/ou médico)
- Canais: e-mail + WhatsApp + portal (padrão atual)

## Entrega faseada
**Fase 1 (MVP)**: tabelas, motor, marcação por analista, fila de aprovação, campo na regra
**Fase 2**: marcação pelo médico no portal + magic link de aprovação
**Fase 3**: relatório agregado + banner de retroativo no PaymentDetail

Confirma que sigo nessa direção e começo pela Fase 1?
