## Novo fluxo de criação — apuração retroativa (TASY vs Repasse)

### Ideia
Hoje o modal pede médico/empresa antes de qualquer coisa, o que obriga o analista a "adivinhar" quais PJs fazem sentido. O novo fluxo inverte a ordem: **data → lote(s) → PJs/médicos**. Assim o sistema restringe as opções automaticamente ao universo do(s) lote(s) escolhido(s) e já sabe com qual base cruzar.

### Novo passo a passo do modal

```text
1. Modo de apuração          [Alegação do médico] [TASY vs Repasse ✓]
2. Escopo                    [Individual] [Múltiplas empresas ✓]
3. Período (De / Até)        dd/mm/aaaa   dd/mm/aaaa
   └─ ao completar, dispara busca de lotes elegíveis
4. Lote(s) a analisar        lista de payments no período
   ☑ Lote 2026-04 · Ref 1234 · 12 PJs · R$ 320k
   ☑ Lote 2026-04 · Ref 1235 · 4 PJs  · R$ 88k
   ☐ Lote 2026-03 · Ref 1200 · ...
5. PJs incluídas             (auto-preenchido com PJs dos lotes; editável)
6. Médicos                   (auto-preenchido; opcional restringir)
7. Título *                  Ex.: Falta de pagamentos abril/2026
[Criar e seguir]
```

- O passo 5/6 só aparece depois que ≥1 lote for marcado.
- "Marcar todas / Limpar" continua funcionando; a lista base agora vem dos lotes, não do hospital inteiro.
- Se o analista desmarcar todos os lotes, os passos 5/6 escondem e o botão fica desabilitado.

### Regras
- **Data primeiro:** enquanto `start`/`end` não estiverem preenchidos, os passos 4-6 ficam ocultos ou desabilitados.
- **Lotes elegíveis:** `payments` do hospital ativo cujo `competence_month` (ou intervalo do lote) intersecta `[start, end]`. Ordena por competência desc / referência.
- **PJs candidatas:** união das PJs presentes em `payment_items` dos lotes selecionados (companies distintas). Padrão: todas marcadas.
- **Médicos candidatos:** união dos médicos presentes nos mesmos itens. Padrão: nenhum marcado (opcional).
- **Ids do(s) lote(s)** ficam salvos em `summary.selected_payment_ids: string[]`.
- **Cruzamento fica focado:** `loadPaymentItems` passa a filtrar `payment_items.payment_id IN summary.selected_payment_ids` (quando presente), em vez de filtrar por competência derivada. Se `selected_payment_ids` estiver ausente (apurações antigas), mantém o comportamento atual — retrocompat total.

### Modo "Alegação do médico"
Continua individual (1 médico e/ou 1 PJ). O passo de lotes **não** aparece nesse modo — a alegação segue cruzando com a janela ±90d por médico. Fica claro visualmente que o passo 4 é exclusivo de TASY vs Repasse.

### Detalhes técnicos
- Arquivo: `src/components/retroactive/RetroactiveReconciliationsTab.tsx` (componente `NewRecon`).
- Reordenar JSX: seções "Período", "Lotes", "PJs", "Médicos", "Título".
- Novo estado: `selectedPaymentIds: string[]`, `availableLotes: Array<{id, label, competence, company_ids, doctor_ids}>`, `loadingLotes: boolean`.
- Nova query (dispara em `useEffect([start, end, hospitalId, mode, scope])`, com debounce simples):
  1. `payments` do hospital com `competence_month` no intervalo (ou `period_start/period_end` interseccionando).
  2. `payment_items` desses ids projetando `payment_id, company_id, doctor_id, doctor_name` (paginado via `fetchAllPaginated`, campos mínimos).
  3. Agregação em memória → monta a lista.
- `submit`: `multiCompanyIds`/`multiDoctorIds` continuam sendo o output; passam a ser inicializados a partir dos lotes. Persistir `summary.selected_payment_ids` e `summary.selected_payment_labels`.
- `loadPaymentItems` (linha ~2410): se `r.summary?.selected_payment_ids?.length`, filtrar direto por `payment_id IN (...)` e pular o filtro por competência (já implícito no lote).
- Sem migração de banco — tudo cabe em `summary` JSONB.

### Fora do escopo
- Reprocessar apurações antigas.
- Mudar o motor TASY×Repasse.
- Alterar "Alegação do médico".
