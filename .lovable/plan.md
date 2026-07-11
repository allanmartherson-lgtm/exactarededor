# Correção da regra de bônus

## Objetivo
Regra `calculation_type=bonus` deve gerar uma **linha nova** de pagamento por atendimento (`tipo_linha='complemento_bonus'`) em vez de sobrescrever `applied_calc_method` de um item TUSS existente. As linhas TUSS ficam intactas com seu cálculo original (percentual_convenio, tabela, etc.).

## Escopo funcional
- Bônus nunca vira `matched_rule` de um item pré-existente.
- Para cada atendimento elegível, o motor gera **1 linha sintética** `complemento_bonus` no anchor (cirurgião principal), com `expected_amount = bonus_amount + base * bonus_pct/100`, onde `base` depende de `application_unit`:
  - `por_item`: `base` = `procedure_amount` do item âncora.
  - `por_atendimento` / `por_paciente_dia`: `base` = soma de `procedure_amount` dos itens do grupo (mesmo atendimento/paciente/data/empresa) que baterem nos filtros da regra.
- Se a regra tem só `bonus_amount` (caso atual), `base` é irrelevante — apenas soma o valor fixo.
- Regras de bônus continuam respeitando todos os filtros já existentes (dia/semana, elective, feriado, PJ, médicos incluídos/excluídos, setor, especialidade, TUSS quando informado, convênio, tipo pagamento).
- Se nenhum item do atendimento bater na regra, nenhuma linha é criada.
- Se o atendimento não tem cirurgião principal identificado, gera linha em modo `pendente_revisao` com alerta pedindo inclusão manual.

## Mudanças no motor (`supabase/functions/_shared/rulesEngine.ts`)

### 1. Excluir bônus do matching por item
Na fase de matching (função que produz `AnalysisResult` por item), regras com `calculation_type='bonus'` são **puladas** — nunca aparecem como `matched_rule_id` de um item TUSS.

### 2. Nova fase pós-matching: `synthesizeBonusLines(items, rules, ctx)`
- Enumera regras ativas cujo cálculo (algum `rule_calculations`) é `bonus`.
- Para cada regra, seleciona itens candidatos aplicando os mesmos filtros usados no matcher (data/hora/elective/setor/convênio/PJ/médicos/TUSS/tipo pagamento).
- Agrupa por `attendance|patient|date|company` (chave sem médico).
- Escolhe anchor = item cujo `doctor_role` classifica como `cirurgiao`.
- Calcula `base` conforme `application_unit`.
- Retorna lista de linhas sintéticas com forma `{ attendance, patient, date, company_id, doctor_id (anchor), rule_id, calc_id, expected_amount, tipo_linha: 'complemento_bonus', complement_reason: rule.name }`.
- Se não houver anchor: linha em modo pendente (mesma lógica já existente).

### 3. Persistência das linhas sintéticas (`supabase/functions/analyze-payment/index.ts`)
Após rodar o motor, para cada linha sintética:
- Faz `upsert` em `payment_items` com chave estável (`payment_id + attendance + rule_id + tipo_linha`) — reprocessos não duplicam.
- Marca `synthetic_bonus=true` (nova coluna booleana) para permitir cleanup/backfill sem afetar itens reais da planilha.
- Gera `AnalysisResult` correspondente com `calculation_type_used='bonus'`, status normal.
- Ao reprocessar um pagamento, remove todos os itens `synthetic_bonus=true` antes de sintetizar de novo — evita duplicidade se a regra mudou/desligou.

### 4. Remove passe atual de dedup de bônus (linhas 4103-4179)
Fica obsoleto — bônus vira linha própria em vez de sobrescrever item existente.

## Mudanças de schema
Migration única:
- `ALTER TABLE payment_items ADD COLUMN synthetic_bonus boolean NOT NULL DEFAULT false;`
- Index parcial: `CREATE INDEX ON payment_items (payment_id, matched_rule_id) WHERE synthetic_bonus = true;`

## Backfill dos lotes já processados
Edge function nova `backfill-bonus-rule` (invocada manualmente):
1. Lista `payment_items` com `applied_calc_method='bonus'` (itens onde o rótulo foi aplicado indevidamente sobre um TUSS real).
2. Para cada item: reseta `matched_rule_id`, `applied_calc_method`, `expected_amount`, `calculation_explanation` a partir da segunda melhor regra (roda o matcher só naquele item, ignorando bônus).
3. Recalcula `diff_pct`, `status`.
4. Coleta os `payment_id` afetados e para cada um chama a fase 2 do motor (`synthesizeBonusLines`) para inserir as linhas de bônus corretas.
5. Registra no `audit_log` (`action='backfill_bonus'`) com contagem por lote.
6. Ao final: relatório em `/mnt/documents/backfill_bonus_YYYYMMDD.csv` (payment_id, itens_corrigidos, linhas_bonus_criadas).

Botão temporário em `/admin/manutencao` (ou similar já existente) para disparar o backfill manualmente, restrito a `admin`.

## UI (impacto mínimo)
- `PaymentConciliationModal.tsx`: já reconhece `tipo_linha='complemento_bonus'` e trata como linha extra. Verificar que:
  - Não entra no matching contra base hospitalar (não tem TUSS a bater).
  - Aparece explicitamente rotulada "Bônus — <nome da regra>" no relatório.
- `RuleFormStepper.tsx`: adicionar aviso visual no cálculo `bonus` explicando que "esta regra gera uma linha adicional no pagamento — não altera valores de itens TUSS existentes".

## Testes
- `supabase/functions/analyze-payment/bonus_per_attendance_test.ts`: atualizar para verificar linha nova sintética + item TUSS original intacto.
- Novo teste: bônus com `por_item` gera 1 linha por item elegível.
- Novo teste: bônus com filtros que não batem em nenhum item do atendimento → 0 linhas.
- Novo teste: reprocesso não duplica linhas sintéticas.

## Detalhes técnicos
- Chave estável do item sintético: `${payment_id}::bonus::${rule_id}::${attendance}::${patient_hash}::${date}` — para o upsert.
- `synthetic_bonus` NÃO conta em soma bruta da planilha (relatórios de "total base hospitalar"), mas conta em "total repasse".
- Motor grava `applied_calc_method='bonus'` **apenas** em itens `synthetic_bonus=true`.
- Ordem de fases no motor: match por item → suplemento (complemento existente) → **novo: synthesizeBonusLines** → dedup residuais → main procedure selection.

## Não-objetivos
- Não altera a semântica de outras `calculation_type` (valor_fixo, percentual_convenio, tabela_diferenciada, etc.).
- Não muda a UI de conciliação além do rótulo — a mesma tela já suporta `complemento_bonus`.
- Não remove a coluna `bonus_amount`/`bonus_pct` de `rule_calculations`.
