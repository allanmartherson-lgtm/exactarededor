## Objetivo
Permitir cadastrar adicional de **fim de semana**, **feriado** e **noturno** por **linha de cálculo** (rule_calculations), com janela noturna configurável e regra de combinação "só o maior".

## Modelo de dados

Adicionar em `rule_calculations`:

| Campo | Tipo | Descrição |
|---|---|---|
| `adicional_fds_pct` | numeric | % sobre tabela base se atendimento for sábado/domingo |
| `adicional_feriado_pct` | numeric | % sobre tabela base se for feriado nacional (BR) |
| `adicional_noturno_pct` | numeric | % sobre tabela base se hora cair na janela noturna |
| `noturno_inicio` | time | Ex: 19:00 |
| `noturno_fim` | time | Ex: 07:00 (cruza meia-noite, ok) |

Tudo nullable/zero = sem adicional (comportamento atual preservado).

## Motor (`supabase/functions/_shared/rulesEngine.ts`)

Para cada item, depois de calcular `valor_base` (tabela do convênio para a função):

1. Avaliar 3 candidatos a adicional usando `data_atendimento` + `hora_atendimento`:
   - feriado → `adicional_feriado_pct` (usa `brHolidays.ts`)
   - fim de semana → `adicional_fds_pct`
   - noturno → `adicional_noturno_pct` (janela cruzando meia-noite)
2. Escolher **o maior %** dentre os aplicáveis (regra "só o maior").
3. `valor_adicional = valor_base × pct_escolhido / 100`
4. `expected_amount = valor_calculado_normal + valor_adicional`
5. Registrar no breakdown do item: tipo de adicional aplicado, % e valor (pra auditoria no modal de conciliação).

Funciona em qualquer ramo (fixo, %, tabela diferenciada, pacote) — o adicional sempre incide sobre a **tabela base do convênio para a função**, conforme definido.

## UI (`RuleCalculationsEditor.tsx`)

Bloco recolhível "Adicionais temporais" em cada linha de cálculo:
- 3 inputs de % (FDS / Feriado / Noturno)
- 2 time pickers (início/fim noturno), visíveis só se `adicional_noturno_pct > 0`
- Helper text: "Aplica-se o maior dos adicionais elegíveis"

## Validação
- % entre 0 e 200
- Se noturno_pct > 0 → exigir janela
- `noturno_inicio != noturno_fim`

## Auditoria/Conciliação
No `PaymentConciliationModal` (display), quando item tiver adicional aplicado, mostrar tag:
"Base R$ X + 30% noturno = R$ Y"

Sem impacto na chave de matching (continua `atend+TUSS+médico`).

## Entregáveis (ordem)
1. Migration: 5 colunas em `rule_calculations`
2. Motor: helper `computeTemporalSurcharge(item, calc)` + integração nos ramos
3. Testes: novo `temporal_surcharge_test.ts` em `analyze-payment/`
4. UI editor: bloco de adicionais
5. Display conciliação: tag explicativa
6. Bump `RECONCILIATION_LOGIC_VERSION_DATE`

## Pontos em aberto
- **Hora do atendimento**: confirmar que `payment_items` já tem `hora_atendimento` ou equivalente. Se não, definir fonte (coluna fixa da base, ou inferir da data se houver timestamp). **Me avise se a base do hospital não traz hora** — sem isso o noturno não funciona.
- **Feriados estaduais/municipais**: por ora uso só nacional via `brHolidays.ts`. Se precisar do calendário do DF, adiciono num passo seguinte.