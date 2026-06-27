---
name: Modo manual — UI dedicada
description: Lançamento manual tem layout, colunas e relatório próprios — sem regra/divergência/alerta; observação por linha em manual_note, anexo geral em payments.manual_general_attachment_*
type: feature
---

Pagamentos em `analysis_mode='manual'` (nefrologia, plantão fechado, coordenação) são lançados linha a linha pelo analista com valor já fechado de planilha externa. NÃO existe regra aplicada, TUSS, paciente, divergência ou alerta assistencial — então a UI é deliberadamente diferente de análise/confecção.

## Telas e regras

- **`ManualPaymentEntry.tsx`** (mesa de lançamento): colunas Empresa · Médico · Tipo · Especialidade · Atend. · Paciente · Valor · **Observação** · Fonte/Composição · Status. Anexo geral do lote no topo (opcional) + anexo por linha (opcional).
- **`CompanyAnalysis.tsx`** quando `isManual`: esconde cards Alertas/Críticos (mostra Valor total + Com anexo), esconde abas Divergências/Detalhe IA/Parecer, troca `<ItemsDataGrid />` por `<ManualItemsGrid />`. Banner do anexo geral acima do grid.
- **`ManualItemsGrid.tsx`** (componente dedicado): colunas Médico · Empresa · Especialidade · Valor · Observação · Anexo. Sem filtros de regra. Total no rodapé. Anexo abre via `createSignedUrl` do bucket `payment-manual-sources`.
- **`groupValidationPdf.ts`** quando manual: branch para `renderManualPdf` — sem "sem regra", sem divergências, sem alertas. Tabela: Médico · Especialidade · Observação · Valor · Anexo + total + situação "VALORES LANÇADOS PELO ANALISTA".

## Campos no banco

- `payment_items.manual_note` (text, nullable): observação livre por linha, descrição do tipo de pagamento, contexto.
- `payment_items.manual_source_attachment_path`: anexo por linha no bucket `payment-manual-sources`.
- `payments.manual_general_attachment_path` / `_name`: anexo único que cobre o lote inteiro (opcional, complementar aos anexos por linha).
- `payment_items.is_manual_entry = true` é a flag autoritativa do modo.

## Especialidade

Analista informa por linha (`payment_items.specialty`, texto livre com sugestões de `COMMON_SPECIALTIES`). Não vem do cadastro do médico nem do tipo do lote.

## Fluxos a jusante (aprovação, NF, portais) — mode-agnostic

Aprovação do diretor (`approve_payment` RPC + `processDirectorApproval` email/WhatsApp), pedido de NF (`send-invoice-request`) e portal da empresa (`InvoicePortal`/`submit-invoice`) **não ramificam por modo**. Só consomem status + valor + listas agregadas (sectors/specialties) do payment. Portal do médico não existe como UI dedicada — médico interage por `doctor_messages`/pendências, também mode-agnostic.

Cuidado conhecido: `payments.specialties` precisa ser populado no save manual senão o e-mail de pedido de NF cai no fallback "Produção médica". `recomputeTotal` em `ManualPaymentEntry.tsx` agrega `distinct(payment_items.specialty WHERE is_manual_entry)` e grava no payment.

Cobertura: `src/lib/__tests__/manualDownstream.contract.test.ts` blinda o template (sem termos de regra/glosa), a agregação de specialties e o contrato do RPC approve_payment.
