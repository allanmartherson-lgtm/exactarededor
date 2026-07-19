
## Objetivo
Trocar os HTMLs de e-mail espalhados pelas edge functions pelos 13 templates entregues pelo design (a1 → e1), mantendo variáveis, remetentes, anexos e demais efeitos colaterais. Padronizar logo/wordmark Exacta (círculo azul `#003DA5` + check bronze `#C6A27C`) — os HTMLs originais que usam laranja/branco serão trocados pelo nosso padrão.

## Arquivos a criar

- `supabase/functions/_shared/emailTemplates/brand.ts` (novo)  
  Helpers: `escapeHtml`, `escapeAttr`, `formatBRL`, `greetingBrasilia`, SVG inline do logo Exacta (mesma arte do `ExactaIcon` — círculo `#003DA5`, check `#C6A27C`), constante do `hospital_dados_cadastrais` e `hospital_name/contact_*` (parametrizáveis).

- `supabase/functions/_shared/emailTemplates/shell.ts` (novo)  
  `renderShell({ preheader, title, bodyHtml, footerNote? })` que aplica header com logo, área central e rodapé — o layout que todos os 13 templates compartilham.

- `supabase/functions/_shared/emailTemplates/templates.ts` (novo)  
  Uma função de render por template, tipada, devolvendo `{ subject, html, text }`:
  - `a1_sendInvoiceRequest`
  - `a2_nfReceived` (usa em `notify-analyst-event` quando `eventType='nf_received'`)
  - `a3_reset` (opcional; será usado só se tivermos gancho — se não houver, incluo mas não wire)
  - `b1_returned` (returned em `notify-analyst-event`)
  - `b2_iaConcluded` (ia_concluded em `notify-analyst-event`)
  - `b3_forwardValidator` (assignment em `validatorAssignment.ts`)
  - `b4_approvedFeedback` (não wire agora — nenhum caller claro; deixo registrado)
  - `b5_internalQuestionCreated`
  - `b6_internalQuestionResolved` (usado em `notify-internal-question` `resolved` e em `notify-question-reply`)
  - `c1_analystChange` (opcional)
  - `d1_massCampaign` (usado em `dispatch-broadcast`)
  - `d2_campaignApproval` (opcional se aplicável em `notify-campaign-decision`)
  - `e1_productionValidation` (director_approval em `notification-queue-worker/handlers/directorApproval.ts`)
  - `passwordAction` (invite/recovery — usado em `_shared/passwordActionEmail.ts`)

## Arquivos a alterar (só HTMLs de e-mail)

- `supabase/functions/send-invoice-request/index.ts`  
  Remover o bloco HTML inline (linhas ~494–599) e enviar `html`/`subject` vindos de `a1_sendInvoiceRequest(ctx)`. `templates.ts` local passa a devolver apenas texto (compat com `request_message`).

- `supabase/functions/notify-analyst-event/index.ts`  
  Substituir `html`/`bodyText` por `b1_returned`, `b2_iaConcluded`, `a2_nfReceived` conforme `eventType`.

- `supabase/functions/notification-queue-worker/handlers/validatorAssignment.ts`  
  Trocar `buildHtml` inline por `b3_forwardValidator`.

- `supabase/functions/notification-queue-worker/handlers/directorApproval.ts`  
  Trocar `buildEmailHtml` (tema bronze antigo) por `e1_productionValidation`.

- `supabase/functions/notify-internal-question/index.ts`  
  Substituir o `html`/`text` genérico por `b5_internalQuestionCreated` / `b6_internalQuestionResolved`.

- `supabase/functions/notify-question-reply/index.ts`  
  Substituir HTML inline por `b6_internalQuestionResolved` adaptado a resposta do analista ao recebedor da NF.

- `supabase/functions/dispatch-broadcast/index.ts`  
  Trocar `renderHtml` por `d1_massCampaign`.

- `supabase/functions/_shared/passwordActionEmail.ts`  
  Trocar o HTML inline por `passwordAction({ kind })`.

## Fora de escopo neste passo

- `directorReapproval.ts` (não há template correspondente entre os 13 — mantém HTML atual).
- Outros callers de e-mail que já usam `send-email-corporate` com HTML pronto do banco (`notify-campaign-decision` etc.) — só entram se você confirmar.
- Nenhuma mudança de fluxo/destinatários/anexos: só troca do HTML/subject.
- Nenhuma mudança de schema, RLS, ou config.

## Deploy

Todas as edge functions alteradas serão redeployadas em uma leva no fim do turno. Vou listar cada `supabase functions deploy` executado no relatório final.

## Riscos

- Templates b4, c1, a3, d2 ficam no módulo mas sem wiring — se você quiser, aponto e ligamos depois.
- Se algum template referencia variável que hoje não está sendo populada (ex.: `{{prazo_envio}}`), uso fallback `—` para não quebrar envio.

Se aprovar, sigo direto para a implementação nessa ordem: `_shared/emailTemplates/*` → wiring → deploy.
