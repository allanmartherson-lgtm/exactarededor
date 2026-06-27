## Escopo

Validar e cobrir com testes o comportamento do **modo manual** em 4 superfícies a jusante da análise. Antes de codar, registrei o que já existe vs. o que precisa mudar.

### Mapeamento do estado atual

| Fluxo | Onde mora | Status para modo manual |
|---|---|---|
| Aprovação diretor | RPC `approve_payment` + `processDirectorApproval` (email/WhatsApp) + `CompanyAnalysis` | RPC é mode-agnostic (só muda status). E-mail/WhatsApp só citam total + nº empresas, sem regra/glosa. **OK por construção.** |
| E-mail de pedido de NF | `send-invoice-request/templates.ts` | Template não menciona regra/glosa, monta com `sectors`/`specialties` do payment. Para manual: confirmar que `payment.specialties` agrega o que o analista lançou por item. |
| Portal da empresa | `InvoicePortal.tsx` + `submit-invoice` | Mostra valor, prazo, formulário de NF. Não renderiza itens detalhados — **não exibe "regras"**, só valor da empresa. OK. |
| Portal do médico | **Não existe como página separada.** Médico interage por `doctor_messages` / pendências (mode-agnostic). | Nada a esconder — não há tela com colunas de regra/divergência. |

### Conclusão da auditoria
A maioria dos fluxos a jusante **já é neutra ao modo** porque só consomem status + valor + listas agregadas (setor/especialidade). O risco real é:

1. `payment.specialties` (array no nível payment) pode ficar vazio em manual se o agregador não considerar `payment_items.specialty` lançado manualmente → e-mail de NF sai sem o trecho "Produção de …".
2. Nenhuma cobertura de teste garante que esses contratos não regridam.

### O que vou fazer

1. **Verificar agregação de especialidade em manual** — abrir o trecho que popula `payments.specialties` e garantir que ele lê `payment_items.specialty` independente do modo. Corrigir se necessário (escopo mínimo: 1 trigger ou 1 função de recompute).

2. **Testes de contrato (vitest)** em `src/lib/__tests__/manualDownstream.contract.test.ts`:
   - `buildSubject` e `buildEmailBody` do `send-invoice-request` produzem texto sem "regra/glosa/divergência" para um contexto manual (setores vazios, só especialties).
   - Snapshot do payload do `submit-invoice` info-GET para um pagamento manual mock — confirma ausência de campos de regra.
   - `processDirectorApproval` — teste de pureza dos builders de mensagem (greeting/html/text/whatsapp) para um payment manual.

3. **Teste de contrato do RPC** em `src/pages/__tests__/approveManualPayment.contract.test.ts`: monta um payment mock com `analysis_mode='manual'` + grupos em `aguardando_aprovacao` e verifica que o caminho do componente `PaymentBatchActionsFooter` chama `approve_payment` com o mesmo payload que para modos normais (sem ramificação manual).

4. **Playwright E2E (1 cenário, não 4)** — login na preview, navegar até um lote manual existente (se houver na base) ou abrir `CompanyAnalysis` num lote de teste e capturar 3 screenshots: (a) tela mostra ManualItemsGrid sem abas "Divergências/Detalhe IA"; (b) banner de anexo geral; (c) PDF de validação manual renderiza sem seções de regra.
   *Se não houver lote manual real na base, o E2E é pulado e marcado como "skipped — sem fixture"*; o usuário decide se quero criar um fixture seed.

5. **Memória atualizada** — adicionar à `mem://features/manual-mode-ui.md`: "fluxos a jusante (aprovação, NF, portal empresa) são mode-agnostic; portal do médico não é UI dedicada".

### Fora de escopo
- Criar portal do médico como UI dedicada (não existe e não foi pedido).
- Mexer em `approve_payment` RPC (já é mode-agnostic).
- Reformatar template de e-mail (já não cita regras).

### Entregáveis
- 2 arquivos de teste novos (vitest).
- 1 ajuste em agregação de specialties **somente se** a auditoria revelar gap.
- 1 atualização de memória.
- 1 relatório curto no chat com os resultados (incluindo E2E ou justificativa de skip).