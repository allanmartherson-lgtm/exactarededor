## Objetivo
Garantir que atualizações de dados (reseed de cadastros, troca de hospital, exclusão de auth user, mudança de vínculo) nunca derrubem os portais de médico e empresa. Três camadas: **integridade no banco**, **UI tolerante**, e **diagnóstico/auto-reparo**.

---

## Camada 1 — Integridade no banco (preservar vínculos sempre)

Migration única com:

1. **FKs com `ON DELETE` adequado** nas tabelas de vínculo:
   - `doctor_portal_users.user_id` → `auth.users(id) ON DELETE SET NULL` (mantém histórico, marca como órfão).
   - `doctor_portal_users.doctor_id` → `doctors(id) ON DELETE RESTRICT` (impede apagar médico com portal ativo).
   - `company_portal_users.user_id` → `auth.users(id) ON DELETE SET NULL`.
   - `company_portal_users.company_id` → `companies(id) ON DELETE RESTRICT`.
   - Mesmo padrão em `doctor_portal_user_hospitals` e `company_portal_user_hospitals` (`ON DELETE CASCADE` para o pai do vínculo, `RESTRICT` para `hospital_id`).

2. **Coluna `link_health`** (enum: `ok | orphan_user | orphan_target | inactive`) em `doctor_portal_users` e `company_portal_users`, recomputada por trigger sempre que `user_id`, `doctor_id`/`company_id` ou `active` mudam.

3. **Trigger pós-reseed**: na inserção em `auth.users`, se o e-mail já existe em `doctor_portal_users.email` ou `company_portal_users.email` com `user_id IS NULL`, **religa automaticamente** (UPDATE setando `user_id` e `link_health='ok'`). Isso atende "Preservar sempre" mesmo se um reseed acidentalmente recriar o auth user.

4. **Função `repair_portal_links()`** (SECURITY DEFINER, callable só por admin via RPC): varre vínculos órfãos e religa pelo e-mail. Retorna contagem de reparados/não reparados.

5. **View `portal_links_health`**: agrega contagem por status, hospital, tipo de portal — fonte do painel de diagnóstico.

---

## Camada 2 — UI tolerante a falhas

Auditar e blindar hooks/páginas dos portais:

- `src/hooks/usePaymentDetailData.ts` — já corrigido `.single()`→`.maybeSingle()`. Aplicar o mesmo padrão em:
  - `src/pages/InvoicePortal.tsx` (entrada do portal empresa)
  - Hooks de Home do portal médico (queries de `payments`, `doctor_portal_users`, `doctor_companies`)
  - Hooks de Home do portal empresa (`company_portal_users`, `companies`, `payment_company_groups`)

- **Estados claros** quando vínculo/lote não existe no hospital ativo:
  - "Vínculo do portal foi desativado — fale com seu gestor"
  - "Este lote não está disponível no hospital selecionado"
  - "Médico não vinculado a uma PJ — não é possível receber repasse"
  - Em vez de telas brancas, erros JSON, ou redirect para `/auth` sem motivo.

- **Boundary específico** `<PortalErrorBoundary>` em `src/components/portal/` que captura erros de query e oferece "Tentar novamente" + "Trocar de hospital".

- Logging via `telemetry` com tipo `portal_link_failed` para o painel de saúde detectar problemas em produção.

---

## Camada 3 — Painel "Saúde dos Portais"

Nova página `src/pages/PortalHealth.tsx` (acesso admin), com:

- **Cards de resumo**: total de vínculos, órfãos por tipo, médicos sem PJ, empresas sem usuário ativo.
- **Tabela de problemas** filtrável por hospital/tipo, com colunas: e-mail, alvo (médico/empresa), motivo (`orphan_user`/`orphan_target`/`inactive`), última atividade.
- **Ações em massa**: "Auto-reparar selecionados" (chama `repair_portal_links()`), "Desativar selecionados", "Recriar usuário auth" (chama edge function `admin-create-portal-user`).
- **Alerta no header** (`AppLayout`) quando há órfãos pendentes — badge vermelho com contagem, link direto pro painel.

Rota adicionada em `src/App.tsx` protegida por `roles={['admin']}`, item de menu em `src/config/navItems.ts` na seção Administração.

---

## Detalhes técnicos

**Arquivos a criar:**
- `supabase/migrations/<ts>_portal_links_integrity.sql` (camada 1 inteira)
- `src/pages/PortalHealth.tsx`
- `src/components/portal/PortalErrorBoundary.tsx`
- `src/hooks/usePortalLinksHealth.ts`

**Arquivos a editar:**
- `src/pages/InvoicePortal.tsx`, hooks do portal médico (a identificar via grep `.single()` em `src/hooks/use*Portal*`/`src/pages/*Portal*`)
- `src/App.tsx` (nova rota), `src/config/navItems.ts` (item de menu), `src/components/AppLayout.tsx` (badge de alerta)

**Pontos de atenção:**
- A trigger pós-reseed lê `auth.users` — precisa ser `SECURITY DEFINER` com `search_path = public, auth`.
- `link_health` é derivado: a coluna existe pra permitir índice/filtragem rápida no painel, mas a fonte da verdade é a trigger. Não permitir UPDATE manual.
- `repair_portal_links()` precisa ser idempotente — pode rodar várias vezes sem efeito colateral.
- Telemetria `portal_link_failed`: não bloquear render se a inserção falhar.

---

## Fora de escopo desta rodada
- Reseed propriamente dito (a garantia é que, se rodar, os vínculos sobrevivem ou se auto-reparam).
- Mudança no fluxo de criação de portal user (já funciona via `admin-create-portal-user`).
- Auditoria histórica retroativa (o painel mostra estado atual; histórico fica pra outra fase se necessário).

---

## Ordem de execução
1. Migration (camada 1) — precisa aprovação sua.
2. Após aplicada, blindar UI (camada 2).
3. Criar painel + alerta (camada 3).
4. Rodar `repair_portal_links()` uma vez pra limpar órfãos existentes (Gilberto + qualquer outro).