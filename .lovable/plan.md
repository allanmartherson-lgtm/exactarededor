
## Objetivo

Hoje a função `current_active_hospital()` lê o hospital ativo de um header HTTP (`x-active-hospital`) que o cliente controla. Um usuário com acesso a 2+ hospitais pode simplesmente omitir o header e a RLS permite acesso a todos. Vamos mover essa informação para uma tabela no banco, onde o cliente não tem como mentir.

---

## Mudanças

### 1. Nova tabela `public.user_active_hospital`

Guarda o hospital ativo de cada usuário interno, gravado pelo servidor.

- `user_id` (PK, FK auth.users)
- `hospital_id` (FK hospitals)
- `updated_at`

Acesso: usuário lê só a própria linha; escrita só via RPC (não direto).

### 2. Nova RPC `set_active_hospital(uuid)` — SECURITY DEFINER

- Valida que o usuário realmente tem acesso ao hospital (via `my_accessible_hospitals`).
- Faz upsert em `user_active_hospital`.
- Atualiza `profiles.last_active_hospital_id`.
- Reaproveita auditoria do `log_hospital_switch`.

### 3. Reescreve `current_active_hospital()`

Nova lógica, **sem fallback para header**:

```text
1. Lê hospital_id de user_active_hospital WHERE user_id = auth.uid()
2. Se NULL e usuário tem apenas 1 hospital acessível → retorna esse 1
3. Caso contrário → NULL (bloqueia acesso cross-hospital)
```

Portal users (empresa/médico) seguem sendo isentos via `hospital_scope_allows`.

### 4. Frontend (`HospitalContext.tsx`)

- Em `load()`: assim que resolver o `active`, chama `set_active_hospital(active.id)` **antes** de qualquer outra query.
- Em `switchHospital()`: substitui `log_hospital_switch` por `set_active_hospital` (já loga + persiste + define ativo num único call).
- Mantém o header `x-active-hospital` por enquanto (não atrapalha, apenas vira inerte).

### 5. Deprecar o header (follow-up futuro)

Após confirmar em telemetria que todos os usuários ativos passaram a chamar `set_active_hospital`, remove o `fetch` custom que injeta o header. Não é parte desta entrega para evitar quebrar sessões ativas.

---

## Compatibilidade durante o deploy

- Sessões antigas (frontend velho) param de funcionar para multi-hospital — passam a ver NULL e queries operacionais bloqueiam. **Mitigação:** a chamada de `set_active_hospital` é disparada no primeiro `load()` do novo frontend, antes de qualquer fetch. Usuário com 1 hospital só continua funcionando via auto-resolve.
- Portal users: zero impacto (já isentos da RLS de hospital).

## Riscos

| Risco | Mitigação |
|---|---|
| Usuário sem hospital ativo definido após deploy → telas em branco | `current_active_hospital()` auto-resolve quando há só 1 hospital acessível; multi precisa abrir o app uma vez (load() chama set_active_hospital) |
| `set_active_hospital` falha → usuário trava | RPC retorna erro claro; frontend mostra toast e mantém fluxo de seleção |
| RLS de `user_active_hospital` em recursão | Tabela sem cross-reference; políticas simples `auth.uid() = user_id` |

## Validação

- Teste manual: usuário com 2 hospitais — verificar que omitir o header via DevTools **não vaza mais dados** do hospital não-ativo.
- CI guard existente (`audit-hospital-scope`) segue válido — `current_active_hospital()` continua sendo a função canônica.
- Smoke test: login + troca de hospital + listagem de pagamentos em cada um.

## Arquivos afetados

- `supabase/migrations/<nova>.sql` — tabela, RPC, reescrita de `current_active_hospital()`.
- `src/contexts/HospitalContext.tsx` — chamadas de `set_active_hospital` no load e switch.

## Fora de escopo

- Remover header `x-active-hospital` do fetch custom (follow-up após período de observação).
- RLS no `realtime.messages` (próxima entrega, depende deste).
- Hardening dos warnings do linter Supabase.
