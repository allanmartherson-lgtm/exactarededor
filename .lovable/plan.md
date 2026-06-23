## Objetivo
Permitir que, dentro de um lote de **Parecer**, alguns casos sejam tratados como **Visita** (regra/valor diferente), com marcação em **item, atendimento ou empresa** e classificação automática quando possível.

## Modelo de dados

Novo campo em `payment_items`:
- `case_subtype text` — valores: `parecer` (default) | `visita`
- `case_subtype_source text` — `base` | `report_cross` | `manual` | `company_override` | `attendance_override`
- índice em `(payment_id, case_subtype)`

Novo campo em `payment_company_groups`:
- `default_case_subtype text` — quando o analista define a empresa inteira como Visita dentro do lote, todos os itens herdam (a menos que override por atendimento/item)

Hierarquia de precedência (maior → menor):
1. Override manual no item
2. Override por atendimento (todas as linhas do mesmo nr. atendimento)
3. Default da empresa dentro do lote
4. Classificação automática (base / cruzamento relatório)
5. Default do lote = `parecer`

## Classificação automática

Função `classifyCaseSubtype(item, paymentContext)`:
- Se a base traz coluna `tipo`/`subtipo` com "visita" → `visita` (source=base)
- Senão, cruza com `payment_parecer_report_rows` do lote: se atendimento+médico+TUSS **não** aparece no relatório → `visita` (source=report_cross)
- Caso contrário → `parecer`

Roda no momento de importação e re-roda quando o analista anexa/atualiza o relatório de parecer.

## Motor de regras

A `rules` já distingue por `payment_type`. Adicionar dimensão `case_subtype` no matcher:
- Regra cadastrada com `case_subtype = 'visita'` só casa com itens marcados como visita
- Regra sem `case_subtype` (NULL) casa com qualquer subtipo (compatibilidade com regras atuais de parecer)
- O analista cadastra a regra de Visita normalmente em /regras, escolhendo subtipo

Coluna nova em `rules`:
- `case_subtype text NULL` (NULL = ambos)

## UI

**Grid de itens (ItemsDataGrid):**
- Nova coluna opcional "Subtipo" (Parecer/Visita) — toggleável como as demais
- Badge colorido no item (Visita = azul, Parecer = roxo)
- Ação em linha: "Marcar como Visita" / "Marcar como Parecer"
- Seleção múltipla: aplicar a N itens ou ao atendimento inteiro

**Card de empresa no lote:**
- Botão "Definir subtipo padrão da empresa" → Parecer / Visita / Misto (default)
- Mostra contagem: `12 parecer · 3 visita`

**Header do lote:**
- Resumo: `Parecer: 45 · Visita: 8 · Total: 53`
- Filtro rápido por subtipo

## Auditoria

Toda mudança de `case_subtype` grava em `audit_log` com: item_id, valor anterior, novo, source, usuário. Recompute do motor é disparado automaticamente após mudança (mesmo fluxo do recálculo de regra).

## Entregáveis (ordem)

1. Migration: campos em `payment_items`, `payment_company_groups`, `rules` + grants
2. Função `classifyCaseSubtype` + hook na importação e no anexar-relatório
3. Matcher do motor lê `case_subtype` da regra
4. UI no grid (coluna + ação por item/seleção/atendimento)
5. UI no card de empresa (default por empresa)
6. UI no header do lote (resumo + filtro)
7. Auditoria + trigger de recompute

## Fora de escopo

- Não muda regras de **Plantão/Cirurgia/Procedimento** — `case_subtype` só faz sentido para `payment_type = parecer`
- Não cria payment_type novo "Visita" — fica como subtipo de Parecer (lote permanece um só)
