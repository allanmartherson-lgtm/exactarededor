# Revisão e Consolidação dos Fluxos de Comunicação

## Diagnóstico (estado atual)

Três canais já existem, mas operam isolados e sem governança:

| Canal | Tabela | UI atual | Lacunas |
|---|---|---|---|
| Médico ↔ Equipe interna | `doctor_messages` | `ConversasDoctorsTab`, `Conversas.tsx` | Sem SLA, sem fila de supervisor, sem "responder em nome de" |
| Empresa ↔ Analista (lote) | `payment_questions` | `CompanyQuestionsThread`, `CompanyThreadChat` | Sem `read_at`/`answered_at`, sem status pendente/respondido |
| Empresa ↔ Analista (NF) | `invoice_questions` (+ attachments) | `InvoiceQuestionsThread` | Tem `read_at`/`answered_at` mas não usados em UI/fila |

Notificações existem (`notify-internal-question`, `notify-question-reply`) mas não há painel agregado nem métrica de tempo.

## Entregas

### 1. Auditoria dos fluxos existentes (passo de teste, sem código)
- Rodar smoke test em cada canal (médico envia → analista vê → responde; empresa envia no portal de lote; empresa envia no portal de NF).
- Registrar achados em `docs/comm-flows-audit.md` (criado pelo agente) com status OK/quebrado/faltando por canal.

### 2. Padronização do modelo de "conversa"
Migration única que:
- Adiciona em `payment_questions`: `read_at timestamptz`, `answered_at timestamptz`, `first_response_at timestamptz`, `assigned_to uuid` (analista responsável), `status text` (`pendente|respondida|encerrada`), `parent_id uuid` (para vincular réplicas a um questionamento raiz).
- Adiciona o mesmo conjunto em `doctor_messages` (já tem `read_at`, `responded_at`; faltam `first_response_at`, `assigned_to`, `status`, `thread_id`).
- Cria view `communication_threads_v` unificando os 3 canais com colunas comuns: `channel`, `thread_id`, `subject_ref`, `hospital_id`, `assigned_to`, `last_message_at`, `last_author_type`, `status`, `waiting_since`, `sla_due_at`, `sla_level`.
- Cria tabela `communication_sla_settings` (channel, severidade, horas úteis para primeira resposta, horas úteis para encerramento, ativo). Default: primeira resposta 4h úteis, encerramento 24h úteis.
- Trigger que recalcula `status`/`first_response_at`/`answered_at` quando o autor inverte (médico/empresa → interno e vice-versa).

### 3. Reaproveitar cálculo de SLA
- Reusar `evaluateSla` de `src/lib/sla.ts` adaptando para "horas úteis" (nova função `addBusinessHours` + `evaluateCommSla`) — não tocar SLA de pagamento.
- Severidade visual: ok / preventivo (≥80%) / vencido — mesmas cores já usadas no app.

### 4. Visão do supervisor — nova rota `/comunicacao/supervisao`
- Cabeçalho: 4 StatTiles (Pendentes totais, Vencidos SLA, Preventivo, Tempo médio 1ª resposta).
- Tabela única consumindo `communication_threads_v` com filtros: canal, hospital, analista responsável, status, faixa de SLA.
- Coluna "Aguardando há" com badge colorido por SLA.
- Ações por linha:
  - **Abrir** (deep-link para o detalhe — `PaymentDetail`/`InvoicePortal`/`Conversas`).
  - **Atribuir a mim** (seta `assigned_to`).
  - **Responder em nome de** — abre dialog `SupervisorReplyDialog` que insere mensagem com `author_type` interno + `author_name = "<supervisor> (em nome de <analista>)"` + `audit_log` registrando `acted_on_behalf_of`.
  - **Encerrar conversa** (status `encerrada`).
- Permissão: `admin` e nova role lógica `supervisor` (mapeada inicialmente para `admin` e `diretor`; flag em `user_roles` se necessário no futuro).

### 5. Ajustes na UI dos canais existentes
- `CompanyQuestionsThread`, `InvoiceQuestionsThread`, `ConversasDoctorsTab`: badge de status (pendente/respondida) + tempo de espera no topo da thread.
- Ao analista abrir a thread → marca `read_at` se ainda não marcado.
- Botão "Encerrar conversa" só para interno quando última mensagem é interna.

### 6. Notificações
- Estender `notify-internal-question` / `notify-question-reply` para também notificar `assigned_to` e, em SLA vencido, o supervisor (lista por hospital — `user_roles in (admin, diretor)`).
- Novo worker leve `comm-sla-watchdog` (cron 15min) que varre `communication_threads_v` e enfileira alerta quando entrar em "vencido" pela primeira vez (registra `sla_alerted_at` para não repetir).

### 7. Documentação
- `docs/comm-flows-audit.md` com mapa do estado inicial e checklist de smoke test.
- `docs/communication-supervision.md` explicando fila, SLA padrão e ação "responder em nome de".

## Detalhes técnicos

- **SLA em horas úteis**: jornada 08–18 seg-sex, ignora feriados (reusar `_shared/brHolidays.ts`).
- **View `communication_threads_v`**: `SECURITY INVOKER`, filtrada por `hospital_scope_allows(hospital_id)` automaticamente via RLS subjacente.
- **"Responder em nome de"**: nunca falsificar `author_id`; sempre o supervisor, mas `author_name` carrega o contexto e linha em `audit_log` com `action='comm_reply_on_behalf'`, `target_id=thread_id`, `metadata={ original_assignee }`.
- **Edge functions novas**: `comm-sla-watchdog` (cron) e `comm-thread-action` (atribuir/encerrar/responder-em-nome, com validação Zod e checagem de role).
- **Telemetria**: registrar em `audit_log` toda transição de status da thread.

## Fora de escopo

- WhatsApp/email externos novos (já cobertos pelo módulo de notificações multi-canal feito anteriormente).
- Reescrita visual dos chats — apenas adendos (badges/ações).
- Tradução do SLA de pagamento para horas úteis.

## Próximos passos após aprovação

1. Rodar a auditoria (eu testo via tooling e gero `docs/comm-flows-audit.md`).
2. Migration de campos + view + tabela SLA.
3. UI: rota `/comunicacao/supervisao` + badges nos threads existentes.
4. Edge functions `comm-thread-action` e `comm-sla-watchdog` + cron.
5. Smoke test final e atualização da doc.
