## Objetivo

Adicionar, dentro do relatório **Ajustes de intervenção** (`/relatorios/intervencoes?view=ajustes`), uma seção "Prévia — lotes em andamento" que mostra o impacto potencial dos itens **acatados** em lotes que ainda não foram aprovados. Assim o usuário vê antes o que vai entrar no KPI quando cada lote for aprovado pelo diretor.

## Onde exatamente

Página: `src/pages/InterventionReports.tsx`, aba/`view=ajustes`.

Layout:

```text
[ Cabeçalho da aba Ajustes ]
[ NOVO: Card "Prévia — se aprovados agora" ]
   ├─ Totais: economia potencial / adicional potencial / saldo / N itens
   └─ Tabela por lote (expansível):
        lote · competência · status atual · itens acatados · Δ economia · Δ adicional · saldo
        → link para /pagamentos/:id
[ Tabela atual de ajustes consolidados (não muda) ]
```

Fica visualmente separado (borda tracejada / fundo levemente diferente) para deixar claro que é **potencial, não realizado**.

## Fonte de dados

Nova RPC `get_intervention_preview(p_hospital_id, p_start?, p_end?)` que replica a lógica do trigger `tg_intervention_ledger_on_status`, mas lê **payment_items acatados de lotes ainda não aprovados**:

- `payments.status IN ('em_analise_ia','em_validacao','aguardando_aprovacao','devolvido_analista')`
- `payment_items.acatado = true` (ou equivalente atual usado pelo trigger)
- Exclui `import_mode = 'historico'` (mesma regra do KPI real)
- Exclui itens já com entrada em `intervention_ledger` sem `reverted_at`
- `delta = valor_regra − valor_pago_final` por item; agrega por payment_id

Retorna:
- `summary`: `{ economia, perda, saldo, qtd_itens, qtd_lotes }`
- `by_payment`: `[{ payment_id, descricao, competence_month, status, qtd_itens, economia, perda, saldo }]`

## Frontend

1. Novo componente `src/components/intervention/InterventionPreviewSection.tsx`
   - Consome a RPC via `supabase.rpc('get_intervention_preview', ...)`
   - Respeita `hospitalId` do `HospitalContext`
   - Usa o mesmo padrão visual dos cards de `InterventionSavingsCard` (tokens, `formatCurrency`, `impactTone`) mas com rótulo "Potencial — sujeito a aprovação"
   - Estados: loading (Skeleton), vazio ("Nenhum lote em andamento com itens acatados"), erro
   - Linhas clicáveis abrem `/pagamentos/:payment_id`

2. Renderizar o componente em `InterventionReports.tsx` no topo da view `ajustes`, acima da tabela existente.

## Regras de negócio

- **Nunca** grava em `intervention_ledger` — é só leitura/simulação.
- Se o lote reverter para status não-aprovado após aprovação, o ledger real já limpa; a prévia é independente.
- Rótulo explícito: "Valores potenciais. Só entram no KPI oficial quando o diretor aprovar o lote."
- Mantém a exclusão de `import_mode='historico'` (memória `intervention-kpi-excludes-historico`).

## Detalhes técnicos

- Migration: criar `get_intervention_preview` como `SECURITY DEFINER`, com filtro por `hospital_id` e permissão `GRANT EXECUTE ... TO authenticated`.
- Gate de acesso no card: mesmo do KPI real — `diretor | admin | validador`.
- Sem alteração no card existente `InterventionSavingsCard` nem no fluxo de aprovação de lote.

## Fora do escopo

- Não altera trigger do ledger.
- Não adiciona prévia dentro da tela do lote.
- Não muda o card global do KPI.
