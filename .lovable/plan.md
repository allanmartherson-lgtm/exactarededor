# Lookup Estrito com Tabelas de Cadastro

## Objetivo
Eliminar inferência livre de médicos, convênios e setores. Toda linha importada precisa casar com um registro do cadastro — diretamente, via alias ou via documento (CRM/CNPJ). Sem match = linha bloqueada até o analista resolver.

Resolve o bug "pacientes como médicos" da Leal e Arratia: como o nome do paciente não existe no cadastro de médicos nem como alias, a linha vai parar na fila de resolução em vez de ser aceita silenciosamente.

## 1. Schema — tabelas de alias

Criar três tabelas espelhadas:

- `doctor_aliases` (id, doctor_id → doctors, alias_text, alias_normalized UNIQUE, created_by, created_at)
- `convenio_aliases` (id, convenio_id → convenios, alias_text, alias_normalized UNIQUE, source: 'manual'|'auto', created_by, created_at)
- `sector_aliases` (id, sector_id → sectors, alias_text, alias_normalized UNIQUE, created_by, created_at)

Para convênios, migrar aliases auto-aprendidos existentes (se houver) para a nova tabela mantendo o pipeline já em produção.

GRANTs + RLS: leitura para `authenticated`, escrita restrita a `analista|admin` via `has_role`.

Função SQL `normalize_alias(text)` (lowercase + sem acento + trim) usada nos UNIQUE indexes e nos lookups.

## 2. Resolvers compartilhados

Novo módulo `supabase/functions/_shared/registryLookup.ts` com três funções puras:

- `resolveDoctor({name, crm, cpf}, registry) → { doctor_id | null, matched_by: 'crm'|'cpf'|'name'|'alias'|null }`
- `resolveConvenio(text, registry) → { convenio_id | null, matched_by }`
- `resolveSector(text, registry) → { sector_id | null, matched_by }`

Ordem de match (em todos):
1. Documento/ID exato (CRM, CPF, código)
2. Nome exato normalizado
3. Alias exato normalizado
4. → null (não inferir, não fuzzy-match)

Os stems atuais (`convenioStems`, `sectorStems`) continuam, mas o resultado é considerado **sugestão** — só aceito automaticamente se gerar match único contra o registry. Caso contrário, vira candidato a ser confirmado.

## 3. Pipeline de importação

Em `NewPayment.tsx`, após `mapJsonToRows`:

1. Carregar registries (doctors + aliases, convenios + aliases, sectors + aliases) — uma query por tipo.
2. Para cada linha, popular `doctor_id`, `convenio_id`, `sector_id` + flags `*_matched_by`.
3. Linhas com algum `*_id === null` entram em `unresolvedRows` agrupadas por (tipo, texto bruto).
4. O wizard ganha uma nova etapa **"Resolução de cadastros"** entre parsing e análise IA. Não é possível avançar enquanto houver pendência.

## 4. UI — Tela de resolução

Para cada texto não reconhecido:
```
"BALDOMERO MARTINEZ" (12 ocorrências, médico)
[ Vincular a cadastro existente ▾ ] [ Criar alias ] [ Cadastrar novo médico ]
```

- Vincular a existente → cria alias automaticamente e aplica em todas as ocorrências do lote.
- Criar alias → atalho quando o registro existe e o usuário já escolheu.
- Cadastrar novo → abre modal mínimo (nome + CRM/CNPJ/código) e cria registro + alias.

Visual: cards por tipo (Médicos / Convênios / Setores) com contador e progresso. Bloqueio de "Continuar" enquanto `unresolved > 0`.

## 5. Gestão dedicada de aliases

Nas páginas de cadastro existentes (Médicos, Convênios, Setores), adicionar aba/seção **Aliases** mostrando lista, com ações criar/editar/remover. Reaproveita os mesmos endpoints da tela de import.

## 6. Edge functions

- `analyze-payment` / `rulesEngine.ts`: passar a confiar em `doctor_id`, `convenio_id`, `sector_id` quando presentes. Texto livre vira apenas fallback informativo, nunca operacional.
- `submit-invoice` e demais saídas externas: continuam expondo só os campos já validados (sem mudanças sensíveis).

## 7. Testes

- Unit: `registryLookup_test.ts` cobrindo ordem de match, normalização, ausência de fuzzy.
- Regressão: caso Leal e Arratia — nome de paciente não pode resolver como médico.
- Migração: aliases legados de convênio continuam funcionando.

## Detalhes técnicos

**Normalização**: `lower(unaccent(trim(regexp_replace(text, '\s+', ' ', 'g'))))`.

**Performance**: registries cacheados em memória durante o parse (lotes grandes podem ter 10k+ linhas, mas só ~poucas centenas de médicos/convênios/setores distintos).

**Auto-aprendizado de convênio**: mantém-se, mas grava em `convenio_aliases` com `source = 'auto'` e exige confirmação do analista na primeira ocorrência (vira `manual` ao confirmar).

**Médicos sem CRM**: aceitos via nome exato + alias, mas a linha herda alerta "médico sem documento" para revisão do validador (não bloqueia).

**Ordem de implementação**: schema → resolvers → pipeline import → UI de resolução → gestão de aliases nos cadastros → ajustes no motor → testes.
