
# Modo Confecção — Comportamento próprio

A auditoria identificou que o modo confecção ainda renderiza vários blocos do modo análise (abas, cards, composição financeira zerada, conciliação, relatórios) e usa o mesmo vocabulário ("aprovado/reprovado/divergência"). O plano abaixo corta cada vazamento e dá ao modo confecção identidade própria.

## 1. UI — Tela da empresa (`CompanyAnalysis`)

- **Aba "Divergências"**: ocultar em confecção. Não existe "divergência" — só "com regra" / "sem regra".
- **Aba "Detalhe IA"**: ocultar em confecção (motor não roda IA aqui).
- **Cards de stats (Alertas / Críticos)**: em confecção, trocar por **"Itens com regra"** e **"Itens sem regra"** (cor warning quando > 0). "Valor líquido" passa a ser **"Repasse calculado"** (Σ `expected_amount`) e o subtítulo "Bruto" vira **"Convênio"** (Σ `procedure_amount`).
- **Botão "Conciliação desta empresa"**: ocultar em confecção (não há base hospitalar para confrontar).
- **`FinancialCompositionStrip`**: passar prop `mode`; em confecção, exibir apenas "Valor convênio" → "Repasse calculado" e ocultar a equação Bruto−Débitos−Glosas−Pool=Líquido (ainda não se aplica).
- **`CompanyHistoryPanel`**: esconder linhas de versão IA / `ai_status` em confecção; manter só observações e mudanças de `confeccao_status`.

## 2. UI — Tela do lote (`PaymentDetail`)

- Bloco de cards de IA (`ExecutiveSummaryCard`, `DirectorBriefingCard`, `PreAnalysisScoreCard`, "Alertas assistenciais"): adicionar `&& !isConfeccao` no guard.
- `PhaseSummary` (fases análise→validação→aprovação): ocultar em confecção; mostrar barrinha própria "Em confecção → Confecção concluída → Pronto para análise".
- Header do lote: em confecção, mostrar "Repasse calculado: Σ expected_amount" (não `total_amount`, que está zerado).
- `GroupReconciliationGate`: bypass em confecção.

## 3. Listagem `/pagamentos` e labels de status

- Em `src/lib/status.ts`, adicionar labels de `confeccao_status` ("Em confecção", "Confecção concluída").
- Na coluna de status da listagem, quando `analysis_mode === "confeccao"`, exibir o `confeccao_status` (com cor âmbar) em vez de "Rascunho".

## 4. Dados — Composição financeira

- `useFinancialComposition` + edge `compute-company-financials`: aceitar `mode`. Em confecção, calcular `bruto = Σ procedure_amount` e `liquido = Σ expected_amount` (sem deduções/glosas/pool, que ainda não existem nessa fase).
- Persistir snapshot em `payment_company_financials` marcado com `source = 'confeccao'` para auditoria.

## 5. Relatórios

- `paymentReportPdf` / `groupValidationPdf`: em confecção, gerar versão "Relatório de confecção" (sem colunas de `ai_status` e divergência; com colunas Convênio / Repasse calculado / Regra aplicada / Sem regra). Alternativa mínima: bloquear export em confecção com toast "Disponível após finalizar confecção".

## 6. Edge functions

- `validate-payment`: short-circuit no início se `payment.analysis_mode === 'confeccao'` (não deve rodar; só após finalize_confeccao).
- `notify-validator-assignment` / `notify-director-approval` / `notify-analyst-review`: guard explícito `analysis_mode !== 'confeccao'` no topo (defesa em profundidade, mesmo que os paths atuais já não os disparem).

## 7. Memória do projeto

- Atualizar `.lovable/memory/features/confeccao-vs-analise-status.md` com a regra: "Em confecção, UI não usa vocabulário aprovado/reprovado/divergência, composição financeira é Σ procedure_amount → Σ expected_amount, abas Divergências/Detalhe IA ocultas, conciliação e PDFs analíticos bloqueados".

## Detalhes técnicos

- Flag única: `const isConfeccao = payment.analysis_mode === "confeccao"` já existe em cada tela — reusar.
- Onde a composição depende de edge function (`compute-company-financials`), o branch novo é no SQL: somar `coalesce(procedure_amount,0)` e `coalesce(expected_amount,0)` quando `payments.analysis_mode = 'confeccao'`.
- Sem mudança de schema: `confeccao_status` e `expected_amount` já existem.
- Testes: estender `CompanyAnalysis.confeccao.contract.test.ts` para verificar (a) ausência das abas "divergencias" e "ia" em confecção, (b) stats com labels "Itens com/sem regra", (c) `FinancialCompositionStrip` recebendo `mode="confeccao"`.

## Itens fora do escopo (próxima fase)

- Painel próprio de "Itens sem regra" com call-to-action para vincular regra rapidamente.
- Relatório PDF dedicado de confecção (a fase imediata só bloqueia/sinaliza).
- Refatorar `ItemsDataGrid` para suprimir colunas de divergência em confecção (hoje já são vazias; baixo impacto visual).
