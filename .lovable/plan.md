# Multi-Tenant — Plano de Implementação

Baseado nas decisões: **híbrido** (cadastros compartilhados + operacional isolado), **estadual com override local**, **roles globais + escopo opcional**, **DF Star migrado in-place**.

---

## 1. Modelo de Dados

### 1.1 Novas tabelas

```sql
hospitals (
  id uuid pk,
  slug text unique,        -- 'df_star'
  name text,
  state_uf char(2),        -- 'DF' — chave de compartilhamento
  cnpj text,
  active bool,
  created_at, updated_at
)

user_hospitals (
  user_id uuid,
  hospital_id uuid,
  role app_role,           -- analista/validador (diretor/admin = global, ignoram esta tabela)
  primary key (user_id, hospital_id)
)

-- Override local de cadastro estadual
doctor_hospital_overrides (
  doctor_id uuid,
  hospital_id uuid,
  override_data jsonb,     -- aliases, vínculos PJ, repasse default específicos
  primary key (doctor_id, hospital_id)
)
company_hospital_overrides (...mesma forma...)
```

### 1.2 Cadastros estaduais (compartilhados)

Adicionar `state_uf` em: `doctors`, `companies`, `convenios`, `sectors`, `doctor_aliases`, `convenio_aliases`, `sector_aliases`.
RLS: leitura liberada para qualquer usuário cujo hospital ativo esteja no mesmo `state_uf`; escrita exige role admin/diretor estadual.

### 1.3 Operacional (isolado por hospital_id)

Adicionar `hospital_id NOT NULL` em:
`payments`, `payment_items`, `payment_company_groups`, `payment_observations`, `payment_status_history`, `payment_assignments`, `payment_unmatched_items`, `payment_processing_jobs`, `ai_analysis_versions`, `payment_pivot_cache`, `invoices`, `invoice_questions`, `reconciliation_runs`, `reconciliation_items`, `conciliation_bases`, `glosa_batches`, `glosa_items`, `glosa_debts`, `rules`, `rule_calculations`, `validation_rules`, `reference_tables`, `cost_centers`, `sla_settings`, `system_configurations`, `audit_log`, `notification_queue`, `access_requests`.

Regras podem ser **estaduais** (`hospital_id IS NULL` + `state_uf`) ou **locais** (`hospital_id` definido). Motor resolve com prioridade local → estadual → master.

---

## 2. Permissões & RLS

```sql
-- Helpers SECURITY DEFINER
public.user_hospital_ids(_uid) returns uuid[]
public.user_state_ufs(_uid)    returns text[]
public.is_global_role(_uid)    returns boolean  -- admin/diretor
public.can_access_hospital(_uid, _hid) returns boolean
```

Policy pattern por tabela operacional:
```sql
USING (public.is_global_role(auth.uid()) 
       OR hospital_id = ANY(public.user_hospital_ids(auth.uid())))
```

Pattern cadastros estaduais (leitura):
```sql
USING (public.is_global_role(auth.uid())
       OR state_uf = ANY(public.user_state_ufs(auth.uid())))
```

---

## 3. Migração DF Star (in-place)

Migration em fases, mesmo arquivo:
1. Criar `hospitals` + seed `df_star` (UF=DF).
2. ALTER TABLE adicionando `hospital_id` nullable em todas as tabelas operacionais.
3. UPDATE preenchendo com o id do DF Star.
4. ALTER ... SET NOT NULL.
5. ALTER cadastros adicionando `state_uf` com default 'DF'.
6. Criar `user_hospitals` e seedar todos os usuários atuais como vinculados ao DF Star.
7. Recriar policies (drop + create) seguindo os patterns acima.
8. Índices: `(hospital_id, created_at desc)` em payments/items/invoices; `(state_uf, name)` em doctors/companies.

---

## 4. Resolução de Hospital Ativo (App)

- Novo contexto `HospitalContext` em `src/contexts/HospitalContext.tsx`.
- Hook `useActiveHospital()` retorna `{ hospital, switchHospital, availableHospitals }`.
- Persistir seleção em `localStorage` + validar contra `user_hospitals` no boot.
- Header global ganha **seletor de hospital** (visível apenas se usuário tem >1 ou é global).
- Todas as queries do app filtram por `hospital_id` do contexto (exceto telas globais de admin).

---

## 5. Motor de Regras & Edge Functions

- `analyze-payment`, `dispatch-payment-analysis`, `orchestrate-analysis`: receber `hospital_id` no payload; resolver regras com prioridade hospital → estadual → master.
- `registryLookup.ts`: aceitar `hospital_id`/`state_uf` para escopar lookup; aplicar overrides de `doctor_hospital_overrides` quando houver.
- `import-wizard`: validar que o lote pertence ao hospital ativo; bloquear se médico/empresa não estiver no mesmo `state_uf`.
- Auto-aprendizado de aliases: alias gravado com `state_uf` do hospital ativo (compartilhado no estado).

---

## 6. UI

- Tela `/hospitals` (admin only): CRUD de hospitais.
- Tela `/users/:id/hospitals`: gerenciar vínculos user × hospital × role.
- Componente `HospitalSwitcher` no header.
- Telas de cadastro (Doctors/Convenios/Sectors): mostrar badge "Estadual (DF)" e botão "Override local" quando aplicável.
- Dashboard ganha filtro de hospital para roles globais.

---

## 7. Entregáveis em ordem

1. **Migration 1** — `hospitals`, `user_hospitals`, seed DF Star, vincular usuários existentes.
2. **Migration 2** — `hospital_id` + `state_uf` em todas as tabelas + backfill + NOT NULL.
3. **Migration 3** — Helpers SECURITY DEFINER + drop/recreate de todas as RLS policies afetadas.
4. **Migration 4** — Tabelas de override (`doctor_hospital_overrides`, `company_hospital_overrides`).
5. **App** — `HospitalContext`, `HospitalSwitcher`, filtros nas queries existentes.
6. **Edge functions** — propagar `hospital_id` no pipeline de análise.
7. **Lookup & motor** — escopar por estado e aplicar overrides.
8. **UI admin** — CRUD de hospitais + gestão de vínculos.

---

## 8. Riscos & Mitigações

- **RLS quebrada em produção** → testar cada policy com usuário de hospital diferente antes de promover.
- **Performance**: `user_hospital_ids()` chamada em toda query — marcar como STABLE e cobrir com índice em `user_hospitals(user_id)`.
- **Aliases estaduais conflitantes** entre hospitais do mesmo estado → unique `(state_uf, alias_normalized, canonical_id)`; override local sobrescreve.
- **Edge functions com cache** (pivot, processing_jobs) — invalidar por `hospital_id`.

Confirma o plano para eu começar pela **Migration 1**? Se quiser ajustar (ex.: começar só pela estrutura sem mexer em RLS), me diz antes.