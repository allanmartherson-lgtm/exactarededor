# Auditoria dos Fluxos de Comunicação

Mapa do estado atual dos 3 canais de comunicação do MedPay e checklist de smoke test.

## Canais existentes

| Canal | Tabela | UI principal | Quem inicia | Quem responde |
|---|---|---|---|---|
| Médico ↔ Equipe interna | `doctor_messages` | `src/pages/Conversas.tsx`, `src/components/portal/ConversasDoctorsTab.tsx` | Médico (portal) ou equipe | Equipe interna |
| Empresa ↔ Analista (lote) | `payment_questions` | `src/components/payment-detail/CompanyQuestionsThread.tsx`, `src/components/portal/CompanyThreadChat.tsx` | Validador / Diretor / Empresa | Analista |
| Empresa ↔ Analista (NF) | `invoice_questions` (+ attachments) | `src/components/InvoiceQuestionsThread.tsx` | Empresa (recebedor) ou analista | Analista |

## O que foi padronizado nesta release

Migration `20260601 — comunicacao` adiciona em todos os 3 canais:
- `status` (`pendente | respondida | encerrada`)
- `assigned_to` (analista responsável)
- `first_response_at`, `read_at`, `answered_at`
- `sla_alerted_at` (controle de notificação única)

Demais entregas:
- Tabela `communication_sla_settings` (padrão: 4h primeira resposta, 24h resolução — horas úteis 08–18 seg-sex).
- View `communication_threads_v` unifica os 3 canais.
- RPCs `comm_thread_assign`, `comm_thread_close`, `comm_thread_mark_read`, `comm_reply_on_behalf` (com auditoria).
- Página `/comunicacao/supervisao` (admin/diretor) com fila, filtros e ações.
- Edge function `comm-sla-watchdog` (rodar via cron a cada 15min).

## Checklist de smoke test

### Canal Médico
- [ ] Médico envia mensagem no portal → aparece em `/conversas` para a equipe
- [ ] Equipe responde → médico vê resposta no portal
- [ ] Thread aparece em `/comunicacao/supervisao` com status `pendente` e SLA
- [ ] Após resposta, `first_response_at` é preenchido e SLA muda para `respondida`

### Canal Empresa · Lote
- [ ] Validador abre questionamento em `PaymentDetail` → empresa vê no portal
- [ ] Empresa responde no portal (`CompanyThreadChat`) → status volta a `pendente`
- [ ] Analista responde → status `respondida`, `first_response_at` registrado
- [ ] Supervisor consegue `Responder em nome de` no painel → mensagem aparece com sufixo "(em nome de <analista>)"

### Canal Empresa · NF
- [ ] Empresa envia pergunta sobre NF → analista vê em `InvoiceQuestionsThread`
- [ ] Analista responde → SLA pausa (status `respondida`)
- [ ] Anexos continuam funcionando

### Supervisão
- [ ] Pendentes / Vencidos SLA / Atenção / Tempo médio refletem dados reais
- [ ] Filtros (canal, status, SLA, busca) funcionam
- [ ] Atribuir a mim seta `assigned_to`
- [ ] Encerrar conversa muda status para `encerrada` e some da fila padrão
- [ ] Responder em nome de gera linha em `audit_log` com `action='comm_reply_on_behalf'`

### Watchdog
- [ ] `comm-sla-watchdog` invocado manualmente popula `notification_queue` com `kind='comm_sla_breached'` para threads vencidas
- [ ] Threads já alertadas não geram nova notificação (`sla_alerted_at` preenchido)

## Próximas evoluções possíveis (fora desta release)

- Considerar feriados brasileiros no cálculo de horas úteis (reusar `_shared/brHolidays.ts`)
- SLA por hospital (já há coluna `hospital_id` em `communication_sla_settings`, mas UI ainda é global)
- Painel de produtividade por analista (tempo médio de resposta, threads abertas, fechadas)
- Escalação automática para supervisor após X vencimentos consecutivos
