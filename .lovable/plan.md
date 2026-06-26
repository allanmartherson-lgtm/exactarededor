## Objetivo
Substituir as duas regras `duplicidade_exata` e `duplicidade_atendimento` por uma única regra **`duplicidade_lancamento`** com matriz de campos comparáveis e modo de médico configurável.

## Modelo unificado da regra

Params:
- **Campos do "mesmo item"** (booleanos): `compare_attendance`, `compare_patient`, `compare_date`, `compare_code`, `compare_role`, `compare_access_route`
- **Médico** (enum `doctor_mode`):
  - `same` — só conta como duplicidade se o médico for o mesmo (equivale ao antigo "Cobrança duplicada" com médico marcado)
  - `any` — ignora médico (equivale ao antigo "Duplicidade por atendimento" com "permitir médicos diferentes")
  - `different` — só dispara quando os médicos forem diferentes (alerta "mesmo procedimento por médicos distintos")
- **Janela** (`window_days`, número): `0` = mesmo dia (default quando `compare_date=on`); `N` = dentro de N dias.

Mantém severidade/ação livres → o admin cadastra quantas instâncias quiser (ex.: uma estrita como bloqueio, uma ampla como alerta) sem precisar trocar de tipo.

## Mudanças

### 1. Backend (SQL)
Migração que converte linhas existentes em `validation_rules`:
- `duplicidade_exata` → `duplicidade_lancamento` com `doctor_mode = compare_doctor ? 'same' : 'any'`, demais flags preservadas, `window_days=0`.
- `duplicidade_atendimento` → `duplicidade_lancamento` com `doctor_mode = allow_different_doctors ? 'any' : 'same'`, `compare_role=false`, `compare_access_route=false`, `window_days=0`.

### 2. Edge function `validate-payment`
- Nova `applyDuplicidadeLancamento(rule, items, …)` que:
  - constrói chave com os campos marcados,
  - quando `doctor_mode='same'` adiciona médico na chave,
  - quando `window_days>0`, agrupa por janela rolante por (chave-sem-data) e considera duplicado se houver outro item dentro de N dias,
  - quando `doctor_mode='different'`, exige ≥2 médicos distintos no mesmo bucket.
- Dispatch passa a aceitar `duplicidade_lancamento`. Os dois kinds antigos continuam aceitos como aliases (chamam a nova função convertendo os params em runtime), garantindo segurança caso alguma migração falhe.

### 3. UI `src/pages/ValidationRules.tsx`
- Remove `duplicidade_exata` e `duplicidade_atendimento` do dropdown e adiciona `duplicidade_lancamento` ("Duplicidade de lançamento").
- Form único: checkboxes da matriz de campos, `Select` para "Médico" (Mesmo / Qualquer / Diferentes obrigatoriamente), `Input` numérico para janela em dias.
- Hint contextual: "Atend+TUSS+médico estrito = bloqueio. Atend+TUSS qualquer médico = alerta."
- Mantém labels de fallback para os kinds antigos (caso uma migração não rode, a lista ainda renderiza).
- Atualiza `defaultParamsFor` e `paramSummary`/description.

### 4. Pequenas referências
- `src/components/payment-detail/ItemsDataGrid.tsx`: adiciona `duplicidade_lancamento: "Duplicidade"` ao mapa de labels (mantém `duplicidade_exata` para histórico).
- `src/pages/__tests__/cancelByReconciliation.e2e.test.ts`: atualiza fixture para `duplicidade_lancamento`.

## Detalhes técnicos

- **Sem CHECK constraint** em `validation_rules.kind` (verificado), então não precisa alterar schema — só `UPDATE`.
- Migração roda em uma transação só; idempotente (re-rodar não faz nada se já estiver no novo kind).
- `validation_findings` antigos já gravados em `payment_items` mantêm `kind: 'duplicidade_exata'` — o ItemsDataGrid renderiza ambos.
- Backward compat no engine garante que qualquer regra ainda no kind antigo continua funcionando até a migração rodar.

## Impacto pro usuário
- Lista de Validações fica com 1 item de duplicidade no lugar de 2.
- Regras já cadastradas são convertidas automaticamente; o admin não precisa recriar nada.
- Quem quiser comportamento "estrito" cadastra com `doctor_mode=same` + todos os campos; quem quiser "amplo" usa `doctor_mode=any`.
