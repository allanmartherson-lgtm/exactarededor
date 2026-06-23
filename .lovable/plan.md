# Tratamento Manual unificado + Relatório de Parecer (modo análise)

Substitui o plano anterior de "Exceção do cálculo por item". Confecção fica fora deste plano — será tratada num bloco separado depois.

## Conceito

Hoje temos dois botões com semânticas confusas e efeito final parecido:
- **Acatar divergência** = aceito risco financeiro, valor pago vira o certo
- **Exceção do cálculo (`calc_exception_skip`)** = a regra tipada não se aplica, recalcula sem ela

Ambos terminam aceitando o `procedure_amount` como valor certo. A diferença real é **o motivo** — clínico/operacional ou financeiro. Vamos unificar num único botão **"Tratar item manualmente"** com motivo estruturado (dropdown), e categorizar para alimentar relatórios distintos.

Paralelamente, lotes do tipo **Parecer** passam a exigir upload do **relatório de pareceres do Tasy** antes de liberar análise. O motor cruza payment × relatório e, se um item TUSS-Parecer não aparece no relatório, é uma **visita sequencial disfarçada** → automaticamente reclassificada.

---

## Fase 1 — Tratamento Manual unificado

### Banco

**Nova tabela `manual_intervention_reasons`** (híbrido: seeds fixos + cadastráveis por hospital):

```
id uuid pk
hospital_id uuid null (null = seed global)
code text unique not null            -- 'visita_sequencial_parecer', 'acatar_risco', ...
label text not null
category text not null check (in ('reclassificacao_clinica','aceite_financeiro'))
description text null
is_seed boolean default false        -- seeds não podem ser deletados
is_active boolean default true
sort_order int default 100
created_at, updated_at, created_by
```

Seeds iniciais:
- `visita_sequencial_parecer` — Visita sequencial (parecer já cobrado) [clínica]
- `tuss_ambiguo` — Procedimento com TUSS ambíguo [clínica]
- `outro_clinico` — Outro motivo clínico (texto livre) [clínica]
- `acatar_risco` — Acatar divergência (aceito o risco) [financeiro]
- `valor_negociado` — Valor negociado fora da regra [financeiro]
- `outro_financeiro` — Outro motivo financeiro (texto livre) [financeiro]
- `acatar_divergencia_legado` — Acatar divergência (legado) [financeiro] — só para migração
- `reclassificacao_legado` — Reclassificação clínica (legado) [clínica] — só para migração

**`payment_items` — novos campos:**
```
manual_intervention_reason_id uuid null references manual_intervention_reasons(id)
manual_intervention_notes text null
manual_intervention_by uuid null
manual_intervention_at timestamptz null
manual_intervention_source text null   -- 'manual' | 'auto_parecer_report'
```

Os 5 campos `calc_exception_*` ficam por enquanto (compat com motor). Migração de dados:
- Itens com `calc_exception_skip = true` → `manual_intervention_reason_id = reclassificacao_legado`
- Itens com `accepted_divergence = true` (ou flag equivalente) → `manual_intervention_reason_id = acatar_divergencia_legado`
- Mantém os campos antigos preenchidos para rollback.

**Trigger:** quando `manual_intervention_reason_id` muda, marca `manual_intervention_by/at` e dispara recompute.

**RLS / GRANTs:** `manual_intervention_reasons` legível por authenticated; CRUD restrito a admin/hospital admin via `has_role`.

### Motor (`rulesEngine.ts`)

Substituir guard de `calc_exception_skip` por:
```
if (item.manual_intervention_reason_id) {
  // Aceita procedure_amount como valor pago; expected_amount = procedure_amount;
  // applied_calc_method = 'tratamento_manual';
  // applied_rule_match_reason = reason.code;
  // diff = 0; status = conciliado_manual
  return { ok: true, manual: true, reasonCode };
}
```

Passar o campo no SELECT dos 3 edge functions: `analyze-payment`, `simulate-rule`, `simulate-rule-batch`.

### UI

**Novo componente `ManualInterventionDialog.tsx`** (substitui `CalcExceptionDialog`):
- Dropdown agrupado por categoria (Reclassificação clínica / Aceite financeiro)
- Carrega motivos via `useManualInterventionReasons(hospitalId)` (seeds + custom)
- Campo opcional de notas (obrigatório se motivo for `outro_*`)
- Botão "Remover tratamento manual" quando já aplicado

**`PaymentConciliationModal.tsx` linha do item:**
- Um único botão "Tratar manualmente" (substitui acatar + exceção)
- Chip persistente quando marcado: cor por categoria (âmbar para clínica, azul para financeira), label do motivo, ícone "Manual"
- Tooltip mostra quem marcou, quando, e o que o motor calcularia automaticamente

**Cadastro `/cadastros/motivos-intervencao-manual`:**
- Lista seeds (somente leitura) + custom do hospital
- CRUD para custom; ativar/desativar; reordenar

### Auditoria

`audit_log` entry: `entity_type='payment_item'`, `action='manual_intervention'`, diff completo do reason + notes.

---

## Fase 2 — Relatório de Parecer + Gate

### Detecção

O lote já tem tipo declarado na criação. O gate aciona quando:
```
payment.payment_type.code === 'parecer'  (ou flag equivalente)
```

Sem heurística por TUSS — declaração explícita do analista no momento do lote.

### Banco

```
payment_parecer_reports
  id uuid pk
  payment_id uuid not null references payments(id) on delete cascade
  hospital_id uuid not null
  period_start date not null   -- declarado pelo analista
  period_end date not null
  source_file_name text
  source_file_hash text
  row_count int
  imported_by uuid
  imported_at timestamptz default now()

payment_parecer_report_rows
  id uuid pk
  report_id uuid not null references payment_parecer_reports(id) on delete cascade
  atendimento text not null
  medico_solic_nome text
  medico_resposta_nome text
  medico_resposta_crm text         -- normalizado (sem UF, sem zeros à esquerda)
  espec_destino text
  dt_solic_parecer date
  dt_resposta_parecer date
  situacao text                    -- 'Com Parecer Med' | 'Sem Parecer Med'
  raw jsonb                        -- linha original para debug

index (report_id, atendimento, medico_resposta_crm)
```

GRANTs padrão + RLS por hospital.

**Em `payment_items`:**
```
parecer_evidence text null    -- 'confirmed' | 'not_found' | 'no_report'
parecer_report_row_id uuid null references payment_parecer_report_rows(id)
parecer_checked_at timestamptz null
```

### Edge function `import-parecer-report`

- Recebe `payment_id`, arquivo (.xls/.xlsx) e período declarado
- Parseia com sheetjs, normaliza CRM (regex `parseCrm`)
- Insere `payment_parecer_reports` + rows
- Dispara `cross-reference-parecer` (abaixo)

### Edge function `cross-reference-parecer`

Para cada item TUSS-Parecer do lote:
1. Match exato `(atendimento, crm_normalizado)` no relatório com `situacao='Com Parecer Med'` → `parecer_evidence='confirmed'` + grava `parecer_report_row_id`
2. Fallback por `(atendimento, nome_normalizado, dt_resposta ± 15d)` → `confirmed` mas com flag `evidence_weak=true`
3. Sem match → `parecer_evidence='not_found'` → aplica automaticamente `manual_intervention_reason_id=visita_sequencial_parecer` com `manual_intervention_source='auto_parecer_report'`
4. Sem relatório importado → `parecer_evidence='no_report'`

### Gate de análise

Em `dispatch-payment-analysis` (e UI de "Liberar análise"):
- Se `payment_type='parecer'` e não há `payment_parecer_reports` cobrindo o período → **bloqueia** com mensagem clara: "Importe o relatório de pareceres do Tasy cobrindo X a Y para liberar análise"
- Se relatório existe mas há atendimentos fora do range coberto → permite análise mas marca esses itens como `parecer_evidence='no_report'` + alerta

### UI

**Dentro do `PaymentDetail` — nova seção "Relatório de Parecer":**
- Card que aparece se `payment_type='parecer'`
- Vazio: botão "Importar relatório do Tasy" + campos período inicial/final
- Importado: nome do arquivo, período, qtd linhas, "Re-importar" / "Substituir"
- Histórico de importações (última prevalece)

**Linha do item:**
- Chip discreto: verde "Parecer confirmado (Tasy)" / âmbar "Reclassificado: visita sequencial (auto)" / cinza "Sem relatório"
- Click no chip → drawer com a linha do relatório que serviu de evidência (ou explicação se não encontrado)
- Itens auto-reclassificados mostram chip diferente do manual (icone "Auto" vs "Manual") — analista pode reverter, e ao reverter vira intervenção manual normal

**Banner de divergência:** se item tem `manual_intervention_source='manual'` com motivo `visita_sequencial_parecer` mas o cruzamento posterior confirmou parecer → banner amarelo "Sua marcação manual diverge da evidência clínica do relatório. Revisar?"

---

## Ordem de implementação

1. Migração Fase 1: tabela `manual_intervention_reasons` + seeds + campos em `payment_items` + trigger + GRANTs/RLS + migração de dados legados
2. Motor: novo guard `manual_intervention` (mantém compat com `calc_exception_skip` ainda lendo, sem escrever novo)
3. UI Fase 1: `ManualInterventionDialog`, hook, chip, substituir botão no modal
4. Cadastro `/cadastros/motivos-intervencao-manual`
5. Smoke test: pegar caso real, marcar manual, ver chip + cálculo correto
6. Migração Fase 2: tabelas `payment_parecer_reports*` + campos `parecer_*` em items + GRANTs
7. Edge `import-parecer-report` + parser xls
8. Edge `cross-reference-parecer`
9. Gate em `dispatch-payment-analysis` + UI de "Liberar análise"
10. UI Fase 2: card de importação + chips por item + drawer de evidência

## Fora deste plano (próximo bloco)

- Confecção (modo separado, lógica diferente — fazer só depois disso estabilizar)
- Relatório/dashboard de "Reclassificações clínicas vs Aceites financeiros" para BI
- Re-importação incremental (hoje, substitui)
