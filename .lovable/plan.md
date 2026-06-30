## Status atual

- ✅ 4 tabelas `_backup_d3e4_*` removidas
- ⏳ 516 avisos restantes, agrupados em 3 categorias

## Fase 1 — RLS Policy Always True (14 avisos) — BAIXO RISCO

Políticas que usam `USING (true)` ou `WITH CHECK (true)` em INSERT/UPDATE/DELETE (SELECT com `true` é intencional e está excluído pelo linter).

**Plano:**
1. Listar as 14 políticas via `pg_policies` (nome da tabela, comando, expressão)
2. Para cada uma, decidir caso a caso:
   - Se a tabela já tem outra policy restritiva → remover a `true`
   - Se é tabela administrativa (audit_log, etc.) → trocar por `has_role(auth.uid(),'admin')`
   - Se for legítima (ex: log de telemetria que qualquer usuário autenticado pode inserir) → manter e ignorar o finding com justificativa em `@security-memory`
3. Migration única por tabela afetada

**Risco:** baixo, mexe só em policies pontuais. Cada mudança é reversível.

## Fase 2 — SECURITY DEFINER executable by Public/Signed-In (498 avisos) — MÉDIO RISCO

Funções `SECURITY DEFINER` em que `PUBLIC` ou `authenticated` ainda têm `EXECUTE`. Algumas são RPCs intencionais (chamadas pelo front via `supabase.rpc(...)`), outras são internas (triggers, helpers) que não deveriam ser expostas.

**Plano:**
1. Listar todas as 498 funções (`proname`, `pronargs`, schema, acl)
2. Cruzar com uso real no código:
   - `rg "supabase.rpc\(" src/ supabase/functions/` → conjunto A (intencionalmente expostas)
   - Triggers (`information_schema.triggers`) → conjunto B (não precisam de EXECUTE público)
   - Restante → conjunto C (helpers chamados só por outras funções)
3. Para B e C: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role`
4. Para A: manter e marcar finding como aceito em `@security-memory` com a lista
5. Migration em blocos de ~50 funções para reduzir blast radius e facilitar rollback

**Risco:** médio. Mitigação:
- Lote pequeno + suíte de testes (796 testes) entre cada lote
- Smoke test manual das principais telas após cada lote
- Se algo quebrar, `GRANT EXECUTE` pontual restaura

## Fase 3 — Extension in Public (4 avisos) — ALTO RISCO, ADIAR

`btree_gist`, `pg_net`, `pg_trgm`, `unaccent` no schema `public`.

**Por que adiar:**
- Usadas sem schema-qualify em dezenas de funções, índices e triggers (`unaccent(...)` no `registryLookup`, `pg_trgm` em índices GIN, `pg_net` em hooks de notificação)
- Mover para schema `extensions` exige `ALTER EXTENSION ... SET SCHEMA extensions` + `ALTER ROLE postgres SET search_path = public, extensions` + reescrever todas as referências
- Qualquer função esquecida quebra silenciosamente em runtime (não em build/test)

**Recomendação:** manter no `public` e marcar os 4 findings como aceitos em `@security-memory` com justificativa. São warnings de configuração, não vulnerabilidade explorável.

## Ordem de execução proposta

1. **Hoje:** Fase 1 (14 policies `true`)
2. **Próxima sessão:** Fase 2 lote 1 (~50 funções, conjunto B/C mais óbvio: triggers)
3. **Sessões seguintes:** Fase 2 lotes 2-10
4. **Final:** Ignorar formalmente Fase 3 + RPCs legítimas da Fase 2 no `@security-memory`

## Critério de pronto

- `supabase--linter` reporta apenas findings explicitamente aceitos
- `bun test` continua 796/796
- Smoke test: login, importar planilha, abrir conciliação, aprovar pagamento
