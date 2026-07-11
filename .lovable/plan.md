# Refatoração — Créditos e Débitos

Hoje a tela renderiza todos os ajustes e glosas em listas planas, sem filtros ou paginação. Com o crescimento dos dados vira uma tela ingerenciável. O plano abaixo mantém a mesma lógica de negócio (motor, RPCs, edge functions) e foca 100% em UX/estrutura de apresentação.

## Objetivos

- Achar qualquer PJ/médico/lote em segundos.
- Trabalhar por recorte (período, status, hospital, PJ, trilha, centro de custo).
- Reduzir o custo cognitivo com agrupamentos, contadores e resumos.
- Escalar para milhares de linhas sem travar o navegador.

## Estrutura nova da tela

```text
┌───────────────────────────────────────────────────────────────┐
│ Cabeçalho: título + KPIs (Total pendente | Em andamento |     │
│            Postergado | Aplicado no mês)                      │
├───────────────────────────────────────────────────────────────┤
│ Barra de filtros persistente (sticky):                        │
│   [Busca ▸ PJ/médico/lote] [Período ▾] [Status ▾]             │
│   [Trilha ▾] [Centro de custo ▾] [PJ ▾] [Limpar]              │
├───────────────────────────────────────────────────────────────┤
│ Abas: Glosas · Ajustes manuais · Histórico aplicado           │
├───────────────────────────────────────────────────────────────┤
│ Conteúdo agrupado por PJ (accordion), com:                    │
│   - resumo por PJ (qtd, valor pendente, líquido próximo lote) │
│   - ações em massa por PJ                                     │
│   - lista virtualizada dos itens                              │
└───────────────────────────────────────────────────────────────┘
```

## Filtros (o núcleo da refatoração)

- **Busca global** (debounced): nome da PJ, nome do médico, referência do lote, número do atendimento.
- **Período**: presets (Este mês, Mês passado, Últimos 90 dias, Ano) + range custom via DateRangePicker. Aplica em `competence_month` das glosas e `created_at` dos ajustes.
- **Status**: Pendente, Proposto, Parcial, Postergado, Aplicado, Revertido.
- **Trilha**: HDF Ambulatório / CC+Hemo / etc. (derivado de `payment_types` + `cost_centers`).
- **Centro de custo**: multi-select vindo de `cost_centers` do hospital ativo.
- **PJ (empresa)**: multi-select com busca.
- **Hospital ativo** continua vindo do contexto global (já isolado).
- Estado dos filtros salvo em **URL query params** (`?period=90d&status=pendente&pj=...`) para permitir compartilhar link e voltar sem perder recorte.

## Agrupamento e visualização

- **Aba Glosas** (foco atual do usuário):
  - Agrupada por PJ (accordion `<Collapsible>` do shadcn), fechada por padrão quando > 5 PJs.
  - Header do grupo: nome da PJ · qtd itens · soma pendente · botão "Confirmar em massa (n)".
  - Dentro do grupo: tabela enxuta com colunas Médico · Competência · Origem (lote) · Valor · Parcela sugerida · Cabe? · Ações.
  - Sub-agrupamento opcional por médico (toggle no header do grupo).
- **Aba Ajustes manuais**: mesma estrutura, agrupado por PJ, com badge de tipo (crédito/débito).
- **Aba Histórico aplicado**: read-only, ordenado por `applied_at desc`, com filtro de período e PJ; serve para auditoria rápida sem poluir as abas ativas.

## Performance

- Virtualização com `@tanstack/react-virtual` nas listas quando o grupo tem > 50 linhas.
- Queries no Supabase paginadas por PJ + filtro server-side (`.in('company_id', ...)`, `.gte('competence_month', ...)`, `.eq('confirmed_at', null)`), em vez de trazer tudo e filtrar em memória.
- Contadores e KPIs por queries `count` separadas (não dependem do fetch completo).
- Debounce de 250 ms na busca; memoização dos agrupamentos derivados.

## Ações em massa (mantidas, reorganizadas)

- Botão global "Confirmar em massa" continua, mas só age **sobre o recorte visível** dos filtros — deixa claro no dialog "aplicando 42 glosas filtradas em 6 PJs".
- Sugestão de lote-alvo por PJ continua (centro de custo → trilha), agora exibida em coluna dedicada com badge quando o lote está finalizado (bloqueado) — reforça a blindagem recente do motor.

## Detalhes técnicos

- Novo hook `useCreditosDebitosFilters()` centraliza estado + sync com URL.
- Extrair para componentes: `FiltersBar`, `PjGroupCard`, `GlosaRow`, `AdjustmentRow`, `MassConfirmDialog`, `KpiHeader`, `HistoryTab`.
- Manter as RPCs/edge functions atuais (`apply-company-deductions`, reversões, ensureLoteLiquido) sem mudança de assinatura.
- `ensureLoteLiquido` passa a ter cache por `(pj, lote)` com invalidação ao aplicar/reverter.
- Ordenação padrão: PJ A→Z; dentro do grupo, competência desc, valor desc.
- Skeleton loaders por seção, sem bloquear a tela inteira.
- Zero mudança em schema ou lógica de negócio.

## Escopo fora deste plano

- Não altera cálculo do motor, não mexe em `glosa_debts`/`company_financial_adjustments`.
- Não muda regras de gate de lote finalizado (já implementadas).
- Exportação CSV pode entrar em iteração seguinte.
