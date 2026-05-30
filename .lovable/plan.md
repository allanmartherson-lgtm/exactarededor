# Cadastro de Convênios

Hoje o convênio é tratado por texto livre (`agreement_text` / `agreement_name`) e o motor faz matching só pela string normalizada vinda da planilha + listas de aliases dentro de cada regra (`agreement_aliases`). Isso vira ruído quando a mesma operadora aparece com nomes diferentes (Bradesco, BRADESCO SAÚDE, BSAÚDE…). A proposta é fazer com convênios o mesmo modelo já consolidado em **Setores**: cadastro central com nome canônico, slug, aliases e ativação.

## Escopo

### 1. Banco — tabela `public.convenios`
Espelho de `sectors`:

```
slug             text PK
name             text not null        -- nome canônico (exibição)
aliases          text[] not null default '{}'
active           bool not null default true
sort_order       int not null default 0
operator_code    text                 -- código da operadora (opcional, p/ relatórios)
notes            text
created_at / updated_at
```

- GRANT padrão (`authenticated` SELECT/INSERT/UPDATE/DELETE, `service_role` ALL).
- RLS: view para todo autenticado; manage só `admin` + `diretor` (mesma policy de `sectors`).
- Trigger `update_updated_at_column`.
- Índices em `name` e GIN em `aliases` para busca.

### 2. Resolver compartilhado — `src/hooks/useConvenioAliases.ts`
Cópia do padrão de `useSectorAliases`:
- `resolve(raw)` → nome canônico
- `resolveSlug(raw)` → slug
- Cache em memória + função `loadConvenioAliases()` para uso fora de hook (parse, save de regra).

### 3. UI de gestão
- Página/aba **Convênios** dentro de *Cadastros* (ou ao lado de Setores), reusando o layout de `SectorsManager`:
  - Lista com nome, aliases (chips), status, código de operadora.
  - Editar/criar/inativar; aliases livres (chips).
  - Busca por nome ou alias.
- Atalho no menu lateral em **Cadastros → Convênios**.

### 4. Combobox/Multi-select de convênios — `src/components/rules/ConvenioMultiSelect.tsx`
Espelho de `SectorMultiSelect`. Usado em **RuleCalculationsEditor** no filtro de Convênio (hoje é um campo de chips de texto livre dentro da regra), substituindo `agreement_aliases` por uma lista de **slugs** de convênio cadastrados.

### 5. Motor de regras (`_shared/rulesEngine.ts`)
- Em vez de comparar string-a-string contra `agreement_aliases`, resolver o convênio do item via tabela:
  - `itemConvenioSlug = resolveConvenioSlug(item.agreement_name)`
  - Match whitelist/blacklist passa a comparar **slugs**.
- Mantém compatibilidade: se a regra ainda tiver `agreement_aliases` em texto livre (regras antigas), faz fallback para a comparação atual.

### 6. Importação (`src/lib/parsePaymentFile.ts`)
Sem mudança de schema do `payment_items` — continua salvando `agreement_text` original (para auditoria). A normalização acontece no motor e na UI usando o resolver.

### 7. Exibição
- `CompanyAnalysis` e `ItemsDataGrid` passam a mostrar o **nome canônico** quando o resolver encontra match; cai no texto bruto quando não encontra (com badge sutil “não cadastrado”).

## Detalhes técnicos

- Slug gerado a partir do nome (kebab/normalizado), igual a Setores.
- Alias matching com a mesma função `norm()` já usada (lowercase, sem acentos, sem separadores).
- Sem migração de dados automática: cadastro inicial fica a cargo do admin (igual fizemos com setores). Posso opcionalmente rodar um `SELECT DISTINCT agreement_text` para sugerir candidatos no primeiro acesso da página — mas só se você quiser.
- Edge functions afetadas que importam `rulesEngine.ts`: `analyze-payment`, `simulate-rule`, `validate-payment`. Todas seguem funcionando porque o resolver é puro (carrega a tabela uma vez por execução).

## Fora do escopo
- Não vou tocar em `companies`, `doctors`, nem em regras de glosa.
- Não vou criar mapeamento convênio × empresa (caso queira no futuro, dá pra plugar depois).

Posso seguir?
