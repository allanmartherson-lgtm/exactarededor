## Objetivo
Habilitar notificações multi-canal (e-mail corporativo + WhatsApp Business) em cada transição do fluxo de aprovação, com aprovação por magic link assinado direto do e-mail (sem login). Pronto antes do go-live do formulário de acordos.

## Decisões já tomadas
- **E-mail**: caixa corporativa via conector (Microsoft Outlook ou Gmail) — envio + inbox monitoring opcional.
- **WhatsApp**: Twilio WhatsApp Business API com templates aprovados pela Meta.
- **Aprovação**: magic link com token JWT de uso único e expiração curta.
- **Eventos no go-live**: atribuição (validador/diretor), perguntas/respostas internas, devoluções, ciclo de NF (recebida/questionada/divergente).

---

## Arquitetura

```text
  Evento de fluxo (trigger DB / edge fn)
            │
            ▼
   ┌──────────────────────┐
   │ notification_queue   │  (já existe — debounce + retry)
   └──────────┬───────────┘
              │
   notification-queue-worker (existente, estendido)
              │
        ┌─────┴─────────────────┐
        ▼                       ▼
  channel: email          channel: whatsapp
  send-email-corporate    send-whatsapp-twilio
  (conector M365/Gmail)   (Twilio gateway)
        │                       │
        └──────┬────────────────┘
               ▼
        notification_deliveries
        (audit por tentativa)
               │
   Magic link (e-mail) ──► approve-via-magic-link
                            (valida JWT, registra aprovação)
```

---

## Mudanças de Banco

### Novas tabelas
- **`notification_channels`** — preferência por usuário×evento (email / whatsapp / ambos / off).
- **`notification_deliveries`** — log por tentativa: canal, destino, status (enviado/falhou/lido), provider_message_id, erro.
- **`magic_link_tokens`** — token JWT hash, tipo de ação (aprovar/rejeitar/devolver), payload (payment_id, company_group_id), expira_at, used_at, used_by_ip.
- **`whatsapp_templates`** — cadastro dos templates aprovados na Meta (sid, nome, variáveis esperadas, evento mapeado).

### Extensões
- `profiles`: `phone_e164` (validado), `whatsapp_opt_in boolean`.
- `notification_queue`: adicionar `channel` (enum), `template_key`, `target_address`.

### RLS
- `notification_deliveries`: admin vê tudo; usuário vê só os próprios.
- `magic_link_tokens`: nenhum acesso via API pública (só via edge function service role).
- `notification_channels`: usuário gerencia os próprios.

---

## Backend (Edge Functions)

| Function | Responsabilidade |
|---|---|
| `send-email-corporate` (novo) | Envia via conector M365/Gmail. Inclui CTA com magic link quando aplicável. |
| `send-whatsapp-twilio` (novo) | Envia via Twilio gateway usando template aprovado. Form-encoded. |
| `notification-queue-worker` (estender) | Despacha por canal de acordo com preferência do usuário. |
| `approve-via-magic-link` (novo, **público, verify_jwt=false**) | Valida token, executa transição de status, marca `used_at`, redireciona para tela de confirmação. |
| `whatsapp-inbound-webhook` (novo, público) | Recebe respostas do WhatsApp (futuro). Por ora só loga em `notification_deliveries`. |
| `email-inbound-poller` (opcional, cron) | Lê inbox via conector para detectar respostas — feature de fase 2, deixar stub. |

### Segurança magic link
- JWT assinado com `MAGIC_LINK_SECRET` (novo runtime secret).
- Single-use (marca `used_at`), TTL 72h.
- IP + user-agent registrados na confirmação.
- Validação cruza `payment_status_history` para evitar aprovação de lote já em outra etapa.

---

## Frontend

- **`/aprovar/:token`** — landing page pública: valida token via edge fn, mostra resumo do lote, botões Aprovar/Rejeitar/Devolver. Confirmação visual + auditoria.
- **`/configuracoes/notificacoes`** — usuário escolhe canal por tipo de evento, cadastra telefone, faz opt-in WhatsApp.
- **`/admin/integracoes`** — admin gerencia: status dos conectores (M365/Gmail/Twilio), templates WhatsApp ativos, histórico de entregas, reenvio manual.
- **Componente `NotificationDeliveryLog`** — timeline na tela do pagamento mostrando o que foi enviado/lido por canal.

---

## Templates iniciais (WhatsApp + e-mail HTML)

| Evento | E-mail | WhatsApp template |
|---|---|---|
| Atribuição validador | sim (com link login) | `lote_atribuido_v1` |
| Atribuição diretor | sim (com **magic link aprovar/rejeitar**) | `aprovacao_pendente_v1` |
| Pergunta interna | sim | `nova_pergunta_v1` |
| Resposta de pergunta | sim | `resposta_pergunta_v1` |
| Devolução | sim | `lote_devolvido_v1` |
| NF recebida | sim | `nf_recebida_v1` |
| NF questionada/divergente | sim | `nf_alerta_v1` |

---

## Conectores e secrets necessários

1. **Microsoft Outlook** ou **Gmail** — conectar caixa corporativa via `standard_connectors--connect`.
2. **Twilio** — conectar com API Key que tenha permissão de envio WhatsApp.
3. **Novo runtime secret**: `MAGIC_LINK_SECRET` (HS256 para JWT).
4. **Variáveis de config** (system_configurations): número WhatsApp From, e-mail From, domínio base do magic link.

---

## Plano de entrega (sequência)

1. **Conexões** — linkar conector de e-mail (Outlook/Gmail) e Twilio; cadastrar `MAGIC_LINK_SECRET`.
2. **Schema** — migration com as 4 novas tabelas, extensões em `profiles` e `notification_queue`, RLS + grants.
3. **Edge functions de envio** — `send-email-corporate` e `send-whatsapp-twilio` isolados e testáveis via `curl_edge_functions`.
4. **Magic link** — edge fn `approve-via-magic-link` + página `/aprovar/:token` + integração com `is_valid_status_transition`.
5. **Worker** — estender `notification-queue-worker` para roteamento por canal + log em `notification_deliveries`.
6. **Templates** — cadastrar 7 templates no Twilio Console (lado humano) e em `whatsapp_templates`; HTML branded para e-mail.
7. **UI** — preferências do usuário, painel admin de integrações, timeline de entregas no PaymentDetail.
8. **Smoke test end-to-end** — disparar cada um dos 7 eventos em DF Star com usuário de teste.

---

## Pendências do usuário (fora do escopo de código)

- Aprovar 7 templates WhatsApp na Meta via Twilio Console (~2–5 dias úteis de aprovação Meta).
- Decidir qual caixa corporativa será conectada (Outlook ou Gmail) e fornecer no fluxo de OAuth.
- Definir e-mail/telefone de remetente oficial.
- Validar com jurídico/LGPD o uso de magic link para aprovação financeira.

---

## Riscos
- **Aprovação Meta dos templates** é gargalo externo — começar essa esteira em paralelo ao desenvolvimento.
- **Caixa corporativa OAuth**: token expira; gateway refresh resolve mas requer reconexão se TI revogar.
- **LGPD/auditoria**: aprovação por link precisa registro robusto (IP, UA, timestamp) — já contemplado.
- **Reply parsing por e-mail** foi descartado em favor do magic link — mais confiável e auditável.