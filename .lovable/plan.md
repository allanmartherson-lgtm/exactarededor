## Objetivo

Permitir que **a mesma empresa apareça em mais de uma regra ativa**, desde que os **médicos cobertos não se sobreponham**. Continuar bloqueando quando o mesmo médico (dentro da mesma empresa) cair em duas regras simultâneas.

## Regra de negócio (definição precisa)

Para cada par (regra A, regra B) ativas com vigências sobrepostas:

- Para cada empresa em comum entre A e B:
  - Sejam `Da` e `Db` os conjuntos de médicos daquela empresa cobertos por cada regra.
  - `Da = []` (vazio) significa **"todos os médicos da empresa"**.
  - **Conflito** se `Da ∩ Db ≠ ∅`, ou se qualquer um for "todos" e o outro não for vazio.
  - **OK** se ambos têm listas específicas e disjuntas.

Regras especificas (`target_type=medico`) continuam sendo cobertas pela verificação `doctor_already_bound` existente.

## Mudanças

### 1. Modelo de dados (`group_company_links`)

Hoje cada link é `{ company_id }`. Passa a ser:

```json
{ "company_id": "uuid", "doctor_ids": ["uuid1", "uuid2"] }
```

- `doctor_ids: []` → "todos os médicos vinculados a essa empresa".
- Backwards-compat: links antigos sem `doctor_ids` são tratados como `[]` (todos).

### 2. UI — `RuleCompanyLinksEditor` (componente que edita os links da regra)

Em cada empresa adicionada à regra:
- Mostrar um seletor de médicos (apenas os médicos vinculados àquela empresa via `doctor_companies`).
- Default = "Todos os médicos desta empresa" (chip).
- Permite trocar para "Médicos específicos" e escolher CRMs.

### 3. Validação SQL — `validate_rule_save`

Substituir a checagem `company_already_bound` (que só compara `company_id`) por uma checagem que:
1. Para cada empresa em comum com regra existente,
2. Compara conjuntos de médicos (resolvendo `[]` = todos os doctor_ids ativos da empresa via `doctor_companies`),
3. Emite `company_doctors_overlap` com lista dos CRMs que colidem (ou marca "todos" quando aplicável).

Manter `doctor_already_bound`, `validity_overlap`, `master_already_exists` como estão.

### 4. UI — `RuleConflictModal`

Renderizar o novo tipo `company_doctors_overlap` mostrando: empresa + médicos que colidem + sugestão (encerrar regra anterior OU remover esses médicos da nova regra).

### 5. Motor de cálculo (`rulesEngine.ts`)

Quando uma regra de grupo é avaliada para um item:
- Se a empresa do item está nos `group_company_links`, conferir se o médico do item está em `doctor_ids` (ou se `doctor_ids=[]`).
- Se não estiver → essa regra não se aplica àquele item (vai pro próximo candidato).

## Migração de dados

- Links existentes (`{company_id}` sem `doctor_ids`) ficam implicitamente como "todos". Nenhuma alteração destrutiva.

## Detalhes técnicos

- `validate_rule_save` (SQL): expandir CTE de peers para fazer `jsonb_array_elements` e cruzar `doctor_ids`. Quando `doctor_ids=[]`, expandir via `doctor_companies`.
- Tipos TS em `rulesEngine.ts` e `validate-rule-save/index.ts` ganham `doctor_ids?: string[]` em cada link.
- `apply_rule_save_with_corrections` (RPC): persistir `doctor_ids` dentro de `group_company_links` (já é jsonb, sem alteração de schema).
- Não há alteração de schema de tabela — tudo vive dentro do jsonb `group_company_links`.

## Fora de escopo

- Não mexe em `target_type=medico` nem `target_type=empresa` (escopo `especifica`).
- Não mexe em `master`.
- Não muda nenhum cálculo de valor — só roteamento de qual regra se aplica.
