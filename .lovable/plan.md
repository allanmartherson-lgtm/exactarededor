## Objetivo
Eliminar o fallback silencioso da regra geral quando uma regra específica vence a seleção mas nenhum cálculo bate, e dar ao analista uma "última barreira" explícita dentro da própria regra.

---

## Fase 1 — Destrava imediato (cadastro, sem deploy)

Marcar o cálculo **"CBHPM 2018 × 2 + 20%"** da regra **Cirurgia Torácica (DF Star)** como cálculo-piso:
- Remover a whitelist de `procedure_codes` desse cálculo (ou deixá-la ignorada via flag `is_catch_all` quando a Fase 2 estiver disponível).
- Garantir que ele tenha a **maior `priority`** (avaliado por último) entre os 22 cálculos da regra.
- Reprocessar o pagamento da pleuroscopia (30804183) e confirmar que sai com `valor_regra = CBHPM × 2 × 1.20`.

Entregável: pleuroscopia conciliada sem mudança de código.

---

## Fase 2 — Flags no motor

### 2.1 Schema (migration)

**`rule_calculations`**
- `is_catch_all boolean not null default false`
- Quando `true`: ignora `procedure_codes` e `procedure_keywords`; é sempre avaliado por último dentro da regra (após ordenação por `priority`).
- Constraint: no máximo **um** `is_catch_all = true` por `rule_id` (índice único parcial).

**`rules`**
- `prevent_external_fallback boolean not null default false`
- Quando `true`: se a regra vence a seleção mas nenhum cálculo (incluindo catch-all) satisfaz, o item vai para `sem_regra` com alerta — **não** cai para a regra geral mestre.

### 2.2 Motor (`supabase/functions/_shared/rulesEngine.ts`)

- Ordenação dos cálculos: `priority ASC, is_catch_all ASC` (catch-all sempre último).
- Avaliação do catch-all: pula filtros de `procedure_codes`/`procedure_keywords`; demais filtros (convênio, setor, função, via de acesso, etc.) continuam valendo.
- Após o loop de cálculos, se nada matchou:
  - Se `rule.prevent_external_fallback === true` → emite `applied_calc_method = 'sem_regra'`, `skip_reason = 'specific_rule_no_calc_matched'`, e **não** chama o fallback para a master rule.
  - Caso contrário → comportamento atual (cai na geral).
- Telemetria: log de `catch_all_used: true|false` e `fallback_blocked: true|false` em `analysis_telemetry`.

### 2.3 UI

**Editor de regra (`src/pages/ValidationRules.tsx` ou componente equivalente)**
- Checkbox na regra: **"Não permitir fallback para a regra geral"** (default `true` para regras com setor/convênio/empresa específicos; `false` para a master).
- Checkbox no cálculo: **"Cálculo padrão da regra (catch-all)"** — desabilita os campos de whitelist de códigos e mostra aviso "Este cálculo será avaliado por último e cobre todos os códigos que não bateram nos anteriores".
- Validação ao salvar: bloqueia se houver 2+ catch-all na mesma regra.

**Detalhe do item (PaymentDetail)**
- Quando `applied_calc_method = 'sem_regra'` com `skip_reason = 'specific_rule_no_calc_matched'`: badge laranja "Regra específica venceu mas nenhum cálculo bateu — revisar cadastro da regra X".

### 2.4 Backfill

Migration de dados (via insert tool, após approval do schema):
- `UPDATE rules SET prevent_external_fallback = true` para todas as regras **não-master** (que têm `sectors`, `convenios` ou `companies` específicos).
- Manter a master rule com `prevent_external_fallback = false`.

### 2.5 Testes

Adicionar a `supabase/functions/_shared/rulesEngine.test.ts`:
- Regra específica com catch-all → item com código fora da whitelist usa o catch-all.
- Regra específica com `prevent_external_fallback=true` e nenhum cálculo bate → `sem_regra`, **não** master.
- Regra específica sem flag → mantém comportamento legado (cai na master).
- Constraint: tentativa de marcar 2 catch-all na mesma regra falha.

---

## Ordem de execução

1. Fase 1 manual (você, no cadastro) — desbloqueia produção hoje.
2. Migration Fase 2.1 (schema dos dois flags + constraint).
3. Motor 2.2 + testes 2.5.
4. UI 2.3.
5. Backfill 2.4.
6. Comunicação no `system_releases`.

## Riscos

- **Backfill agressivo**: marcar todas as regras não-master como `prevent_external_fallback=true` pode gerar pico de `sem_regra` se houver cadastros incompletos hoje mascarados pela master. Mitigação: rodar `simulate-rule-batch` antes do backfill em produção e listar itens que mudariam de status.
- **Catch-all mal configurado**: se o analista marcar o cálculo errado como catch-all, todos os códigos caem nele. Mitigação: badge + aviso na UI, e log de telemetria mostra quantos itens usaram o catch-all por análise.
