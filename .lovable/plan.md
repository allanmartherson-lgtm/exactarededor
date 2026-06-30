# Plano de endurecimento de segurança — concluído 2026-06-30

## Resultado
- **502 → 148** avisos do linter Supabase em 2 migrations.
- Os 148 restantes são todos cobertos por decisão registrada em `@security-memory`:
  - **~144 lint 0029** — RPCs SECURITY DEFINER intencionalmente expostas a `authenticated` (allowlist de 72 funções, cada overload conta separado). Cada uma valida `has_role` + escopo de hospital internamente.
  - **4 lint 0014** — `btree_gist`, `pg_net`, `pg_trgm`, `unaccent` mantidas em `public` (custo de migração para schema `extensions` muito alto vs. benefício; não são API).

## Migrations aplicadas
1. **`revoke_anon_secdef_all`** — `REVOKE EXECUTE ... FROM anon, PUBLIC` em todas as 254 funções SECURITY DEFINER do schema `public`. App exige login; ninguém precisava de acesso anônimo.
2. **`revoke_authenticated_secdef_helpers`** — `REVOKE EXECUTE ... FROM authenticated` nos 108 helpers internos + 63 triggers. Mantém as 72 RPCs do allowlist acessíveis.

## Próximos passos opcionais
- Findings do scanner `supabase_lov` sobre tabelas com policy `USING(true)` para portais (`conciliation_bases`, `glosa_*`, `reconciliation_*`) — exigem reescrita de RLS para distinguir interno vs. portal. Tratar em sessão dedicada.
