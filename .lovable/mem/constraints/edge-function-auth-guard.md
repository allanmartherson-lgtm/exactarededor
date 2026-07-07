---
name: Guard obrigatório em edge functions
description: Toda nova edge function precisa de requireInternalOrRole OU entrar em PUBLIC_ALLOWLIST com motivo; CI enforça
type: constraint
---

Toda edge function em `supabase/functions/*/index.ts` DEVE iniciar com:

```ts
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
// ...
const _auth = await requireInternalOrRole(req);
if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);
```

Exceção só é permitida entrando em `PUBLIC_ALLOWLIST` no `scripts/audit-edge-auth.ts` com justificativa curta. Casos aceitáveis:

- Endpoint público com auth própria (magic link, upload token, webhook com assinatura)
- Worker chamado por `pg_cron`/trigger interno (idempotente, sem input externo, payload vindo do DB)
- Função admin que já valida `has_role(admin)` internamente + grava `audit_log`

O helper aceita: service-role JWT, roles internas (`admin/diretor/validador/analista/gestao_medica`), ou header `x-cron-secret` = env `CRON_SECRET`.

CI: job `edge-auth-guard` roda `deno run --allow-read scripts/audit-edge-auth.ts` e bloqueia merge se alguma função nova não estiver protegida ou documentada.

**Por quê**: sem esse padrão, cada nova função vira um `OPEN_ENDPOINTS` no scanner — historicamente 4-8 findings por semana, cada um consumindo créditos pra corrigir função por função. O guard + CI resolve na raiz.

