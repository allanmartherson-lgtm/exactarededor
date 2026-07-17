## Objetivo

Eliminar a tela redundante "Correções em análise" e fazer as edições manuais do analista aparecerem categorizadas dentro do relatório único de **Ajustes por Intervenção** — hoje elas ficam misturadas no bucket `ajuste_manual` junto com edições de diretor/validador, sem distinção.

## Diagnóstico

Hoje o ledger (`intervention_ledger.fonte`) categoriza por **tipo de evento** (`ajuste_manual`, `cancelamento`, `glosa`, `glosa_pj`, `aceite_esperado`, `aceite_pago`, `sem_intervencao`), não por **quem** interveio. Consequência:

- Edição de valor feita pelo analista, diretor ou validador → todas caem em `ajuste_manual`.
- A sub-tab "Correções em análise" tenta separar filtrando `role='analista'`, mas o campo `role` retornado pela RPC vem de `fonte`, então nunca casa → sempre vazio.

A categorização certa é **cruzada**: `fonte` (o que aconteceu) × `papel_autor` (quem fez).

## Escopo — arquivos afetados

### Backend (1 migração)
- **`supabase/migrations/<nova>.sql`** — atualizar `public.get_intervention_savings`:
  - Derivar `papel_autor` a partir de `user_roles` do `autor_id` (prioridade: diretor > validador > analista > outros; fallback `sistema` quando `autor_id IS NULL`).
  - Adicionar `papel_autor` em cada linha de `items` e em uma nova agregação `by_papel`.
  - Manter `role` = `fonte` (não quebra consumidores atuais nem os filtros de "Papel" já existentes na UI).
  - Sem mudança no ledger em si — só a RPC de leitura. Zero backfill necessário.

### Frontend (3 arquivos)
- **`src/lib/interventionSavings.ts`** — adicionar campo opcional `papel_autor` em `InterventionItem` + tipo `InterventionByPapel`; helper `filterItems` aceitar filtro `papeisAutor?: string[]`.
- **`src/pages/InterventionReports.tsx`** — adicionar coluna "Papel do autor" no drill-down + `MultiSelectPopover` de "Papel" (analista/validador/diretor/sistema) usando o padrão já existente dos outros filtros. Sem novo componente.
- **`src/pages/AnalystCorrections.tsx`** — **deletar** o arquivo.
- **`src/App.tsx`** (ou onde a rota estiver) — remover rota `/relatorios/correcoes-analista`.
- Remover sub-tab/link "Correções em análise" onde aparecer (buscarei em `InterventionReports.tsx` e `navItems.ts`).

### Fora do escopo
- Nenhuma mudança em `materialize_intervention_ledger`, no export (Excel/PDF já usam `itemsToCsv`/`role`), em `payment_observations`, no fluxo de edição do analista, nem no cálculo de delta.

## Como o usuário passa a usar

No relatório único de Ajustes por Intervenção:
- Filtro **"Tipo de intervenção"** (existente) = ajuste manual / cancelamento / glosa etc.
- Filtro **"Papel do autor"** (novo) = analista / validador / diretor / sistema.
- Para reproduzir a antiga tela: `Tipo = Ajuste manual` + `Papel = Analista`.

## Riscos e mitigação

- **RPC sem breaking change**: `role` continua vindo como `fonte`. `papel_autor` é campo aditivo.
- **Performance**: lookup em `user_roles` é 1 JOIN por linha do ledger. Volume é pequeno (drill-down de ~90 dias por hospital); usarei subquery lateral com `LIMIT 1` e ordenação por precedência.
- **Consumidores da RPC**: `InterventionReports.tsx`, `AnalystProductivity.tsx`, `LoteInterventionReport.tsx` — todos permanecem funcionais sem alteração. Só o arquivo deletado deixa de consumir.

## Aprovação necessária

1. Confirmar que a solução unificada (com dois eixos de filtro) atende — ou se prefere que `ajuste_manual` seja **subdividido em `fonte`** distinta por papel (opção mais invasiva: mexe no ledger e exige backfill; não recomendo).
2. Autorizar a migração da RPC + deleção da tela.
