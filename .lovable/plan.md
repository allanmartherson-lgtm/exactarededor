# Plano — Lotes de Remessa com competência por item

## Objetivo
Suportar lotes onde os itens têm competências diferentes da competência declarada do lote (cenário típico de **remessa mensal**: tudo que foi remetido em Janeiro/2026, independente de quando o atendimento ocorreu).

## Decisões já fechadas
- **Modo do lote:** novo `tipo_apuracao = 'remessa'` (além de habitual/retroativo/histórico).
- **Período do lote:** opcional em remessa; vira apenas "janela de remessa" informativa.
- **Competência verdadeira:** derivada **por item**, a partir da **data de atendimento** (= data de execução do procedimento, segundo a regra do negócio).
- **Sem data válida no item:** vai para bucket `sem_competencia` + alerta para o analista. **Não bloqueia** importação (motor pode ter lido coluna errada).
- **Wizard de importação:** mapeamento de "Data de atendimento/execução" passa a ser **obrigatório e destacado** quando o lote é remessa.

## Mudanças

### 1. Schema (`supabase--migration`)
- `payments.tipo_apuracao` aceita novo valor `'remessa'` (atualizar CHECK).
- `payments.periodo_inicio / periodo_fim` permanecem NOT NULL para habitual/histórico, mas viram opcionais quando `tipo_apuracao = 'remessa'` (validação via trigger, não CHECK).
- `payment_items.competencia_item` (date, nullable) — competência derivada da data de atendimento do próprio item.
- `payment_items.competencia_source` (text: `data_atendimento` | `data_execucao` | `manual` | `sem_data`) — auditoria.
- Índice em `(payment_id, competencia_item)` para agregações de pool/DRE.

### 2. Motor de importação (edge function de import + `recompute`)
- Ao processar cada item, ler `data_atendimento` (fallback `data_execucao`) e popular `competencia_item` (primeiro dia do mês da data).
- Sem data → `competencia_item = NULL`, `competencia_source = 'sem_data'`, gera registro em `payment_unmatched_items` ou alerta dedicado para "sem competência".
- Em lotes `habitual/historico`: comportamento atual preservado (`competencia_item = competência do lote` por default).

### 3. Pool / DRE / Rateio
- `pool_calculation_runs` e cálculos de rateio agrupam por `competencia_item` quando o lote é `remessa`. Hoje agrupam pela competência do lote — vira fallback.
- `financial_journal` (DRE) recebe lançamentos por `competencia_item`, distribuindo automaticamente o líquido nas competências corretas.

### 4. UI

**Wizard de criação do lote (`NewBatchWizard` / `NewManualPayment`):**
- Seletor de `tipo_apuracao` ganha card **"Remessa"** com descrição: "Itens com datas variadas remetidos em um mesmo período".
- Quando selecionado: período do lote vira opcional ("Mês de remessa" — só rótulo) e mapeamento "Data de atendimento" recebe selo **Obrigatório** com tooltip explicando que define a competência.

**Detalhe do pagamento:**
- Card de header: quando lote é remessa, mostrar distribuição "Competências detectadas: Jan/2026 (412), Dez/2025 (180), Nov/2025 (56)".
- Aba/seção **"Itens sem competência"** com contador, exibe linha, atendimento, médico e botão "Definir competência manualmente" (registra `competencia_source = 'manual'` + auditoria).

**Zeev / alertas:**
- Diagnóstico do lote inclui sinal "X itens sem competência — revisar mapeamento da coluna data".
- Não bloqueia validação/aprovação por padrão; admin pode optar por "exigir 100% com competência" via `hospital_settings`.

### 5. Memória de projeto
Adicionar memória `features/lote-remessa` documentando: remessa = competência por item, data de atendimento como fonte, bucket sem_competencia não-bloqueante, wizard destaca mapeamento da data.

## Fora de escopo (próximos ciclos)
- Migração retroativa de lotes existentes para o novo modelo (manter como `habitual`).
- Relatório consolidado "remessa × competência real" (vem depois, quando houver dados).

## Detalhes técnicos
- Trigger de validação em `payments`: se `tipo_apuracao IN ('habitual','historico')` → exige `periodo_inicio/fim`; se `remessa` → permite NULL.
- Função `derive_competencia_item(data_atendimento date)` → `date_trunc('month', coalesce(data_atendimento, data_execucao))::date`.
- Tornar `competencia_source` enum-like via CHECK simples (não enum Postgres, pra evoluir sem migration pesada).
- Motor de recompute: ao reprocessar, recalcula `competencia_item` apenas se `competencia_source != 'manual'` (preserva override do analista).
