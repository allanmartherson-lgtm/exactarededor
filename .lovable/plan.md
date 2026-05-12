## Objetivo

Refatorar o cadastro de regras para que **todo critério restritivo** (códigos, convênios, setores, especialidades, horário, vias de acesso, função do médico, urgência/eletiva) viva **dentro de cada cálculo** — não mais no nível da regra. Assim, uma única regra pode conter múltiplos cálculos com escopos completamente diferentes (ex.: Bônus Final de Semana com 3 cálculos: Cirurgia Geral em 3 códigos, Bariátrica em 1 código, Geral como fallback).

## Conceito atual vs novo

```text
HOJE                                  NOVO
────                                  ────
Regra                                 Regra (apenas identificação + escopo de cliente)
├─ códigos                            └─ Cálculos[]
├─ setores                                ├─ Cálculo 1
├─ especialidades                         │   ├─ critérios (códigos, setor, conv., horário, via, função, urg.)
├─ convênios                              │   ├─ unidade (item / atendimento / paciente-dia)
├─ horário                                │   └─ fórmula (% conv., bônus, pacote, fixo, etc.)
├─ vias                                   ├─ Cálculo 2 ← outro escopo, outra fórmula
└─ Cálculos[] (só fórmula)                └─ Cálculo 3 (fallback geral)
    └─ fórmula
```

## Nível Regra — fica apenas

- Identificação: nome, descrição, texto-base, severidade, vigência
- Escopo de **cliente**: master / específica / grupo (empresa, médico, grupo de empresas)
- Tipos de pagamento aplicáveis + prazo
- Limiares de divergência (alerta/bloqueio)

## Nível Cálculo — passa a conter

Já tem hoje: `time_mode`, `weekdays`, `time_start/end`, `includes_holidays`, `elective_mode`, `allowed_access_routes`, `apply_access_route`, `sectors`, `specialties`, `application_unit`, `force_totalized`, fórmula completa, `extras_codes`.

**A adicionar:**

- `procedure_codes text[]` — códigos TUSS/CBHPM aos quais o cálculo se aplica (vazio = qualquer código)
- `code_match_mode text` — `whitelist` (só esses) | `blacklist` (qualquer menos esses) | `any` (ignora)
- `doctor_roles text[]` — função do médico no item (cirurgião, anestesista, auxiliar…)
- `agreement_match_mode text` + `agreement_aliases text[]` — filtro por convênio (whitelist/blacklist)
- `priority int` — ordem de avaliação dentro da regra (primeiro match aplica; cálculo "geral" fica por último)
- `match_strategy text` — `first_match` (default, para o no primeiro que casar) | `all_match` (avalia todos, soma efeitos)

## Motor (`rulesEngine.ts`)

Ao avaliar um item contra uma regra:

1. Validar escopo da **regra** (cliente, prazo, tipo de pagamento, vigência) — se falhar, descarta a regra inteira
2. Iterar `calculations` ordenados por `priority`
3. Para cada cálculo, avaliar os filtros locais (código, setor, especialidade, convênio, horário, via, função, eletiva)
4. `first_match`: aplica o primeiro que casar e para
5. Se nenhum cálculo casar → item sai com `sem_regra` (sem default, conforme memória)

Remover do motor qualquer leitura de códigos/setores/etc. do nível regra para fins de filtro de aplicação.

## UI — `Rules.tsx` + `RuleCalculationsEditor.tsx`

**Aba Identificação** (Regra):
- Nome, descrição, texto, severidade, vigência

**Aba Aplicação** (Regra):
- Escopo de cliente (master/específica/grupo)
- Prazo + tipos de pagamento
- Limiares

**Aba Cálculos** (lista ordenável de cálculos):
Cada cálculo num accordion expandido com **3 seções internas**:
1. **Quando aplicar** (filtros): códigos + modo, setores, especialidades, convênios + modo, horário/dias, vias, função, eletiva/urgência
2. **Como contar** (unidade): por item / atendimento / paciente-dia, force_totalized
3. **Fórmula**: tipo + parâmetros (% conv., bônus, pacote, fixo, complemento, etc.)

Botões: adicionar cálculo, duplicar, reordenar (drag/setas), remover. Badge "Fallback" automático no último sem filtros.

Remover da Regra os campos: `procedure_codes`, `sectors`, `specialties`, `agreement_*`, `allowed_access_routes`, `payment_term`/`applies_payment_types` ficam (são da regra). 

## Migração de dados

Para regras existentes que têm critérios no nível regra:
- Copiar `procedure_codes`, `sectors`, `specialties`, `agreement_*`, `allowed_access_routes` da regra para **cada** `rule_calculations` filho que ainda não tenha o equivalente
- Manter colunas antigas na tabela `rules` como deprecated por enquanto (não remover) para não quebrar leitura legada; UI deixa de exibir/editar

## Detalhes técnicos

- **Migration**: adicionar colunas em `rule_calculations` (`procedure_codes`, `code_match_mode`, `doctor_roles`, `agreement_match_mode`, `agreement_aliases`, `priority`, `match_strategy`); backfill copiando dos pais
- **Motor**: novo helper `calcMatchesItem(calc, item, ctx)` que centraliza todos os filtros locais; `analyzePaymentItems` usa `first_match` por priority
- **UI**: `RuleCalculationsEditor` ganha sub-seção "Quando aplicar" com inputs já existentes hoje no nível Regra (reaproveitar componentes)
- **Form state em `Rules.tsx`**: remover `codesInput`, `fSectors`, `fSpecialties`, `fAgreementAliases`, `fAllowedAccessRoutes` do nível regra (passam a ser por-cálculo dentro do `CalcItem`)
- **Testes**: criar `rule_per_calc_filters_test.ts` cobrindo: bônus 3 códigos / 1 código / fallback, prioridade, first_match, herança nenhuma quando regra não tem mais filtros

## Fora de escopo

- Não tocar em `payment_items`, status, ou qualquer cálculo financeiro além do roteamento
- Não remover colunas legadas da tabela `rules` neste passo (depreciação só)
- Não mexer em outras telas (Pagamentos, Detalhe, Faturas)

## Risco

Mudança grande na UI de cadastro. Regras antigas continuam funcionando via backfill. Após a refatoração, qualquer ajuste fino é feito por cálculo — sem precisar de correção em banco.
## Status de execução (2026-05-12)

**Concluído:**
- Motor (`rulesEngine.ts`): roteamento por `priority` + `first_match`, sem default hardcoded → `sem_regra`
- `rule_calculations`: colunas de filtros locais + backfill dos pais aplicado
- UI `RuleCalculationsEditor`: seção "Quando aplicar" por cálculo (códigos+modo, setores, especialidades, convênios+modo, vias, função, eletiva)
- UI `Rules.tsx`: badge âmbar "Legado nível-Regra" sinalizando regras com filtros restritivos ainda no nível regra (helper `legacyRuleLevelFilters`)
- Banco: `COMMENT ON COLUMN` marcando como DEPRECATED em `public.rules`: `procedure_codes`, `sectors`, `specialties`, `agreement_aliases`, `allowed_access_routes` (leitura legada preservada)
- Testes: 196/196 passando

**Pendente (opcional, futuro):**
- Remoção física das colunas legadas em `public.rules` após período de observação sem badges acesos
- Migração assistida na UI para mover automaticamente filtros legados de regra → cálculos filhos (botão "promover para cálculo")
