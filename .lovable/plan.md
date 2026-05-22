# Plano — Inteligência Financeira + Ciclo de NF

## Restrições confirmadas
- **Não alterar**: `Dashboard.tsx`, `Invoices.tsx`, `AgingRecebiveis.tsx`.
- **Sem tabelas novas, sem edge functions novas, sem migrations.**
- Reuso de padrão visual de `Dashboard.tsx` (`bubbleStyle`, `SectionLabel`, `SurfaceCard`, `SurfaceCardHeader`) — vou extrair para um arquivo compartilhado leve para não duplicar 200 linhas em cada página nova.
- Queries via `supabase` client; gráficos via `recharts` já instalado.
- `get_payment_pivot(p_current_month, p_months_back, p_grouping, p_secondary)` confirmado no banco.

## Exceção pontual à restrição "não tocar em Invoices.tsx"
O item 2.2 pede validação de CNPJ na tela `Invoices.tsx`. Isso **exige** editar o arquivo. Vou tratar como exceção mínima e cirúrgica (banner + badge em uma célula), mantendo o restante intacto. **Se preferir manter `Invoices.tsx` 100% intocado, mover essa validação para o `/ciclo-nf` numa quarta seção e remover da Invoices.** Premissa default: edição mínima permitida em Invoices.tsx para o CNPJ.

---

## Arquivos NOVOS

### Compartilhado
- `src/components/shared/SurfacePrimitives.tsx`
  Extrai de Dashboard.tsx: `bubbleStyle`, `BubbleColor`, `SectionLabel`, `SurfaceCard`, `SurfaceCardHeader`. Sem mudar comportamento.
  *Nota:* Dashboard.tsx continua usando suas definições locais (não toco nele). A duplicação fica isolada nas páginas novas.

### Módulo 1 — Inteligência Financeira
- `src/pages/FinancialIntelligence.tsx` — shell com `<Tabs>` (shadcn) de 4 abas.
- `src/components/financial-intelligence/BenchmarkTab.tsx`
  - Query `payment_items` (paginada/limit) agrupando client-side por `specialty + procedure_code + company_name`.
  - Calcula mediana/média/min/max/n via util.
  - Filtros multi-select (especialidade, empresa) + range de competência usando `payments.competence_month` via join.
  - Destaque vermelho quando item recente > 1,5x mediana.
- `src/components/financial-intelligence/LossTrendTab.tsx`
  - `supabase.rpc('get_payment_pivot', { p_current_month, p_months_back: 6, p_grouping: 'specialty'|'company' })`.
  - Recharts `LineChart` agrupado.
  - Badge vermelho se último mês > 1,15 × média(5 anteriores).
- `src/components/financial-intelligence/ProjectionTab.tsx`
  - Lê `payments` últimos 6 meses, filtra status, calcula média móvel 3m por `competence_month`.
  - Card grande com valor projetado + delta % vs mês atual.
- `src/components/financial-intelligence/DoctorConcentrationTab.tsx`
  - `payment_items` agrupado por `payment_id + doctor_name`; cálculo de %; alerta >30%.
  - Tabela com filtro por lote.
- `src/lib/financialStats.ts` — utilitários puros: `median`, `mean`, `movingAverage`, `groupBy`.

### Módulo 2 — Ciclo de NF
- `src/pages/NfCycle.tsx` — shell com 3 seções (cards expansíveis ou tabs).
- `src/components/nf-cycle/InvoiceAgingSection.tsx`
  - Query `invoices` com `status='aguardando'` e `sent_at IS NOT NULL`, join company + payment.
  - Buckets 0-7 / 8-14 / 15-30 / 30+ a partir de `sent_at`.
  - Botão reenviar → `supabase.functions.invoke('send-invoice-request', { body: { invoice_id } })`.
- `src/components/nf-cycle/FiscalDeadlineAlerts.tsx`
  - Mesma base de invoices + `payments.approved_at`; alerta quando `today - approved_at > 25 dias`.
- `src/components/nf-cycle/ResendHistorySection.tsx`
  - Lê `payment_observations` filtrando `observation_type='informativo'` e `message ilike '%reenvi%NF%'` (ou similar — vou conferir mensagens reais ao implementar).
  - Botão de reenviar inline.

---

## Arquivos MODIFICADOS (apenas estes)

1. `src/config/navItems.ts`
   - Adicionar em grupo **Financeiro**:
     - `{ to: '/inteligencia-financeira', label: 'Inteligência Financeira', icon: TrendingUp, roles: ['analista','validador','diretor','admin'] }`
   - Adicionar em grupo **Financeiro** (ou novo "Operacional NF"):
     - `{ to: '/ciclo-nf', label: 'Ciclo de NF', icon: FileWarning, roles: ['analista','admin'] }`
   - Atualizar `EXPECTED_SIDEBAR_ORDER` (auditor exige).

2. `src/App.tsx`
   - 2 `lazy()` imports + 2 `<Route>` dentro do `AppLayout` protegido.
   - `ciclo-nf` envolto em `ProtectedRoute roles={['analista','admin']}`.

3. `src/pages/Invoices.tsx` *(exceção mínima — confirmar)*
   - Banner vermelho + badge verde de CNPJ na linha/detalhe da invoice. ~30 linhas, sem refatorar o resto.

---

## Decisões técnicas
- **Sem cache server-side novo**: queries direto via client; payloads filtrados por competência para não explodir (`limit` + filtro por `payments.competence_month`).
- **Filtros de competência**: `MonthMultiSelect` já existe — reaproveitar.
- **Empresas/especialidades**: combobox/multi-select já existentes (`CompanyCombobox`, `MultiSelectChips`).
- **Roles**: Inteligência Financeira para todos os autenticados de workflow; Ciclo de NF para analista/admin conforme pedido.
- **Acessibilidade**: seguir padrão já validado (focus-visible, aria-labels, tokens semânticos).

## Riscos / pontos a confirmar antes de codar
1. **Posso editar `Invoices.tsx`** para o item 2.2, ou movo a validação de CNPJ para uma quarta seção dentro de `/ciclo-nf`?
2. **Localização no menu**: ok colocar ambas dentro do grupo "Financeiro"? Ou criar um grupo novo "Inteligência" para a primeira?
3. **`get_payment_pivot` retorna `total`** (numérico já agregado por mês). Vou usar como está — sem reagrupar.

Se confirmar (1) e (2), parto para implementação.
