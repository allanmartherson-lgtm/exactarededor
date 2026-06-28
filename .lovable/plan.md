## Cadastro de Especialidades — fim do hardcode

### O que vai mudar

1. **Banco de dados — nova tabela `public.specialties`**
   - Campos: `code` (slug imutável, ex.: `fisioterapia`), `name` (rótulo exibido), `active` (soft delete), `sort_order` (opcional, default ordenação alfabética), `created_at`, `updated_at`.
   - Constraints: `code` único, `name` único (case-insensitive).
   - DELETE bloqueado por trigger (padrão dos outros cadastros — só inativação).
   - RLS: leitura para `authenticated`; escrita só para `admin` / `superadmin` (via `has_role`).
   - **Seed**: as 75 especialidades atuais de `src/lib/specialties.ts` viram linhas com `active=true`, geradas a partir do nome (slug determinístico).

2. **Nova tela `/cadastros/especialidades`** (em "Cadastros")
   - Listagem com busca, filtro ativo/inativo, badge "em uso por N médicos".
   - Ações: criar, editar nome, inativar/reativar. `code` exibido como read-only após criação.
   - Validação Zod: nome 2–80 chars, único.
   - Bloqueio amigável ao tentar inativar especialidade em uso por médicos (com link para a lista).
   - Item no nav de Cadastros + breadcrumb + ícone `Stethoscope`.

3. **Hook único `useSpecialties()`**
   - Lê `specialties` ativas via React Query (cache 5 min).
   - Retorna `{ specialties: string[], loading, byCode, byName }`.
   - Fica em `src/hooks/useSpecialties.ts`.

4. **Migração dos consumidores** (todos passam a usar o hook)
   - `src/pages/ValidationRules.tsx`
   - `src/pages/SystemParameters.tsx`
   - `src/pages/ManualPaymentEntry.tsx`
   - `src/pages/RuleSimulator.tsx`
   - `src/components/doctors/DoctorMissingSpecialtyPanel.tsx`
   - `src/components/payment-wizard/SpecialtyResolutionModal.tsx`
   - `src/lib/specialties.ts` vira um **fallback estático** (mesmo array, marcado como `@deprecated`) usado só enquanto o hook está carregando — evita flash de select vazio. Em uma segunda fase pode ser removido.

5. **Sincronização com `doctors.specialties` (text[])**
   - Não muda o tipo da coluna `doctors.specialties` (continua `text[]`) — só passamos a validar contra a tabela na criação/edição de médico (já feito via componente que agora consome o hook).
   - Médicos existentes com especialidades fora da nova tabela são mantidos; o cadastro mostra um aviso "valor fora do catálogo" e permite normalizar.

### Detalhes técnicos

**Migration** (uma só, segue o padrão de `cadastros-imutáveis`):
```
CREATE TABLE public.specialties (
  id uuid PK default gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL default true,
  sort_order int,
  created_at/updated_at timestamptz,
  CONSTRAINT specialties_name_unique_ci UNIQUE (lower(name))
);
GRANT SELECT/INSERT/UPDATE ON public.specialties TO authenticated;
GRANT ALL TO service_role;
ENABLE RLS;
POLICY select: authenticated;
POLICY write: has_role(auth.uid(),'admin') OR has_role(auth.uid(),'superadmin');
TRIGGER block_delete (raise exception, padrão do projeto);
TRIGGER set_updated_at;

-- Seed a partir do array atual:
INSERT INTO public.specialties (code, name) VALUES (...) ON CONFLICT DO NOTHING;
```

**Hook**:
```ts
useQuery(['specialties','active'], () =>
  supabase.from('specialties').select('code,name').eq('active', true).order('name')
)
```

**Componentes**: trocam `import { COMMON_SPECIALTIES }` por `const { specialties } = useSpecialties()`. Comportamento `allowCustom` dos MultiSelectChips é preservado para não bloquear nada que já esteja em produção.

### Fora do escopo (próximos passos sugeridos)
- Normalização em lote dos `doctors.specialties` legados (script de auditoria).
- Vincular `specialties` a um padrão TUSS/CBO no futuro.
- Multi-tenant: por enquanto a tabela é global (igual ao comportamento atual do array).

### Confirmação
Posso seguir e abrir a migration + tela. A migration cria a tabela, faz o seed das 75 especialidades atuais e abre para sua aprovação antes de rodar.
