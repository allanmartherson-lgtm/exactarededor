# RLS Tests — Isolamento por hospital

Teste automatizado end-to-end que garante que um usuário associado ao **hospital A** nunca enxerga registros do **hospital B** — e vice-versa.

## Como funciona

Composto por duas camadas:

1. **Funções SQL** (via migration): `public.rls_test_setup(pwd)`, `public.rls_test_cleanup(...)`, `public.rls_test_hospital_tables()`. Fazem seed/cleanup de fixtures com privilégios elevados (só executáveis por `service_role`).

2. **Edge Function `rls-hospital-test`**: orquestra o teste — chama `setup`, faz `signInWithPassword` real como cada usuário fake, e usa o cliente autenticado (respeitando RLS de verdade) para varrer **toda tabela `public.*` com coluna `hospital_id`** procurando vazamentos. Sempre chama `cleanup` no final.

3. **Deno test** (`index.test.ts`): invoca a edge function e falha se houver qualquer leak.

## Rodar

Após o deploy da edge function:

```bash
# via Deno test runner (recomendado — usado pelo CI)
supabase test edge-functions rls-hospital-test

# ou direto via HTTP
curl -X POST "$SUPABASE_URL/functions/v1/rls-hospital-test" \
     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -H "apikey: $SUPABASE_ANON_KEY"
```

Resposta em caso de sucesso:

```json
{ "ok": true, "checked": 89, "leaks": 0, "failures": [] }
```

Resposta em caso de falha:

```json
{
  "ok": false,
  "checked": 89,
  "leaks": 2,
  "failures": [
    "LEAK payment_items: user A viu 3 linhas do hospital B",
    "LEAK glosa_batches (B<-A): user B viu 1 linha do hospital A"
  ]
}
```

## Escopo

- ✅ Isolamento por hospital em todas as tabelas com coluna `hospital_id` (varredura genérica).
- ✅ Leitura dirigida por id e escrita cross-hospital em `payment_items`, `invoices`, `payment_observations`, `payment_company_groups`, `payments`, `payment_company_financials`.
- ✅ `invoices.upload_token` não selecionável por usuário autenticado.
- ✅ Triggers `guard_group_workflow_transition` e `guard_payment_author_spoof` (spoof de status/aprovador).
- ✅ RPC `apply_calc_duplicity_resolution` recusa item de outro hospital.
- ✅ Edge functions `special-case-adjust` (payment de outro hospital) e `zeev-executor` (`link_doctor_company` por analista).
- ✅ Simétrico (A→B e B→A) e cleanup garantido mesmo em erro.
- ❌ Isolamento entre roles (analista vs empresa/portal) — não coberto aqui.
- ❌ `zeev-executor register_company` (escopo estadual) — não coberto.
- ❌ Tabelas de cadastros híbridos (`companies`, `doctors`, `convenios`, `sectors`) — usam `company_hospital_overrides` etc., não `hospital_id` direto.

> A função exige credencial privilegiada (`service_role` ou `x-cron-secret`); anon key retorna 401.

