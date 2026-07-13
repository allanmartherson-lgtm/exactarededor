# PLANO FINAL — Bloco 1: Motor de Classificação Parecer × Visita
Migração já aplicada. Este plano cobre apenas o código.

## Regra em 1 frase
Por `hospital_id + attendance_number + empresa + especialidade` (com normalização e fallbacks), o primeiro contato ambíguo (histórico global + lote atual) é o único candidato a parecer; todo o resto é visita. O relatório Tasy apenas **valida** o candidato — nunca classifica.

## Fluxo

### 1. Carga dos itens do lote
Buscar itens com colunas atuais + `company_id`, `company_name`, `hospital_id`, `item_type_id`, `item_type_source`, `is_cancelled`, `procedure_code`, `procedure_date`, `created_at`, `attendance_number`, `specialty`.

### 2. Filtro de candidatos
- Lote misto: apenas itens com TUSS ambíguo (conjunto derivado de `item_types` marcados como parecer/visita/consulta).
- `item_type_source` protegido (`manual`, `company_override`, `base_tipo`) → nunca troca `item_type_id`, só atualiza `parecer_evidence` como informação, e conta em `protected_kept`.
- `is_cancelled=true` → ignorado.

### 3. Chave de agrupamento COM FALLBACK
```
empresa_key = company_id ?? norm(company_name) ?? SKIP
spec_key    = norm(specialty)
att_key     = onlyDigits(attendance_number)
hosp_key    = hospital_id   // obrigatório
```
- Falta de qualquer chave → item vai para `skipped_no_key[]` (nunca silencioso).
- Se `skipped_no_key.length / candidatos > 10%` → `console.warn` com amostra de até 20 ids.
- `skipped_no_key` volta na resposta HTTP **e** persiste em `cross_summary`.

### 4. Lookback histórico EM BATCH (ajuste 1)
- Coletar todos os `att_key` únicos dos grupos.
- Agrupar por `hospital_id` (fail-closed: item sem `hospital_id` já caiu em skipped).
- Para cada hospital, quebrar os attendances em chunks de **200** e rodar UMA query por chunk:
  ```
  from payment_items
  select id, payment_id, hospital_id, company_id, company_name,
         specialty, attendance_number, procedure_code, procedure_date,
         created_at, item_type_id
  where hospital_id = <hosp>
    and attendance_number in (<chunk até 200>)   // ajuste 2: valor bruto, sem coluna digits
    and payment_id <> <current>
    and is_cancelled = false
    and (item_type_id in <ambiguos> OR procedure_code in <TUSS_ambiguos>)
  ```
- Em memória, casar por `norm(company_id/company_name)` + `norm(specialty)` + `onlyDigits(attendance_number)` para atrelar cada linha ao grupo correto. Cirurgias/exames/outros TUSS não entram porque já foram filtrados no `where`.
- Dado real: maior lote = 387 atendimentos → 2 queries em vez de 387.

### 5. Decisão por grupo (empate de data explícito)
Ordenar candidatos do lote atual por `procedure_date` asc, tie-break `created_at` asc.
- Histórico com `procedure_date < candidato` → todos do grupo viram `visita` / `parecer_evidence='not_applicable'`.
- Histórico com `procedure_date == candidato` (mesmo dia) → candidato = `parecer`, `parecer_evidence='unverified'`, `parecer_evidence_weak=true`. Nunca `confirmed` automático nesse cenário.
- Sem histórico prévio → candidato = item de menor `procedure_date`; empate interno usa `created_at` + `parecer_evidence_weak=true`.
- Validar candidato contra `payment_parecer_report_rows`:
  - Match → `parecer_evidence='confirmed'` (a menos que o empate de data acima tenha travado em `unverified`).
  - Sem match → `parecer_evidence='unverified'`.
- Demais itens do grupo → `item_type=visita`, `parecer_evidence='not_applicable'`.

### 6. Resumo persistido
Ao final, gravar em `payment_parecer_reports.cross_summary` (jsonb):
```
{ finished_at, items_total, candidates_considered,
  parecer_confirmed, parecer_unverified, visitas,
  skipped_no_key, skipped_no_key_sample_ids,
  protected_kept }
```
Resposta HTTP mantém chaves antigas (`confirmed`, `not_found`, `reclassified=0`) **e** adiciona as novas.

### 7. Encadeamento
Dispara `dispatch-payment-analysis` com `skip_parecer_cross_ref=true` (inalterado).

## Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `supabase/functions/cross-reference-parecer/index.ts` | Reescrita da classificação, fallbacks, lookback em batch, gravação de `cross_summary`. |
| `supabase/functions/cross-reference-parecer/dedup.ts` | Deixar de importar (mantém arquivo, sem deletar). |

## Intocáveis (garantia)
`import-parecer-report`, `analyze-payment`, motor de regras, todo `src/**`, coluna `reclassified_from_parecer` (mantida, escrita cessada).

## Deploy
`cross-reference-parecer` precisa de **redeploy** após alteração. Informarei explicitamente no relatório final.
