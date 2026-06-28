---
name: Lote misto — parecer/visita dentro de produção
description: Checkbox no wizard + ação retroativa permite cruzar relatório de parecer só nos itens cujo TUSS é ambíguo
type: feature
---

Lotes de PRODUÇÃO (cirurgia/exame/visita/parecer/procedimento) frequentemente misturam visita+parecer compartilhando códigos TUSS de consulta. Para classificar Parecer×Visita sem afetar procedimentos puros:

1. **Wizard (NewPayment)** mostra `MixedParecerSetupCard` quando o tipo do lote NÃO é parecer/visita:
   - Checkbox "Lote contém parecer/visita misturados?"
   - Se marcado: dropdown do subtipo de parecer destino + uploader do relatório Tasy (mesmo `ParecerReportWizardCard` da confecção parecer).
   - Persiste `payments.has_mixed_parecer` + `payments.mixed_parecer_payment_type_id`.

2. **Retroativo (CompanyAnalysis)** — `MixedParecerRetroAction` renderiza acima das tabs. Toggle + dropdown + uploader + botão "Aplicar e cruzar agora" → atualiza payments, sobe relatório (mode init/append/finalize) e dispara `cross-reference-parecer` com `trigger_reanalysis=true`.

3. **Edge `cross-reference-parecer`** quando `has_mixed_parecer=true`:
   - Monta `ambiguousTussSet` a partir de `payment_types` com `category IN (Parecer,Visita,Consulta)` OU `code` matching — coleta `tuss_default` + `tuss_codes_extra`.
   - No loop de items: pula itens cujo `procedure_code` não está no set (procedimento puro fica intocado).
   - `lotePaymentTypeId` usado no patch passa a ser `mixed_parecer_payment_type_id` (em vez do tipo do lote, que é produção).
   - Item ambíguo que bate no relatório → vira parecer subtipo. Não bate → vira visita. Igual ao fluxo confecção parecer.

4. **Gate de especialidade obrigatória em todo item** vale SÓ em confecção parecer puro (`requiresSpecialtyOnAllRows`). Em lote misto não é obrigatório — base de produção raramente traz especialidade em itens cirúrgicos.

5. **Tab Parecer** em `CompanyAnalysis` aparece quando `isParecerPayment || hasMixedParecer`.

Schema:
- `payments.has_mixed_parecer boolean default false`
- `payments.mixed_parecer_payment_type_id uuid → payment_types(id)`
- `payment_types.tuss_codes_extra text[]` (TUSS adicionais além do `tuss_default`)
