## Objetivo

Eliminar a convivência de dois dialetos visuais: adotar o **Padrão BI** (telas novas do mockup) como design oficial do sistema, aplicado em todas as 67+ páginas que hoje usam `PageHeader` e `Breadcrumbs`, mais os cards de KPI das telas Financeiras.

## Diagnóstico das diferenças

| Aspecto | Padrão BI (novo, queremos) | Padrão antigo (Pagamentos, etc.) |
|---|---|---|
| Container | `max-w-[1400px]` centralizado, `py-6` | Largura cheia, header colado no topo |
| Título | 30px, semibold, tracking-tight, sem ícone | 16px, medium, com ícone em quadradinho |
| Fundo do header | Transparente (mesmo bg da página) | `bg-card` com `border-b` |
| Botão "voltar" | Não existe (navegação via breadcrumb) | `ArrowLeft` à esquerda do título |
| Subtítulo | 14px muted, "Visão consolidada · competência …" | 12.5px muted |
| Cards KPI | `rounded-2xl`, padding generoso, label uppercase tracking-wider, valor 28-32px tabular-nums, sem ícone colorido | `rounded-lg`, ícone colorido em círculo, card azul destacado para o principal |
| Espaçamento | `space-y-6` entre blocos | Denso, sem ritmo claro |

## Estratégia

Centralizar o design em **3 primitivos compartilhados** e migrar via evolução desses componentes — assim a maior parte das 67 páginas herda o novo visual sem edição individual.

### 1. Evoluir `src/components/PageHeader.tsx`

Reescrever para o padrão BI mantendo a mesma API pública (`title`, `description`, `actions`, `icon`, `showBack`). Mudanças:

- Remover `border-b` + `bg-card`; renderizar transparente.
- Título: `text-3xl font-semibold tracking-tight`.
- Subtítulo: `text-sm text-muted-foreground mt-1`.
- `showBack` default vira `false` (breadcrumb já cobre a navegação). Páginas que dependiam do botão voltar e não têm breadcrumb continuam funcionando passando `showBack`.
- Remover quadradinho do `icon` (não usado no mockup BI) — manter prop por compat mas no-op visual.
- Container interno passa a usar `max-w-[1400px] mx-auto` para alinhar com o BI.

Como todas as 67 páginas chamam `<PageHeader title=... description=... actions=... />`, a alteração é **transparente** — nada precisa ser editado nelas.

### 2. Criar `src/components/ui/KpiCard.tsx` (novo)

Componente único reutilizável que encapsula o card BI:

```tsx
<KpiCard
  label="VALOR EM RISCO"
  value="R$ 7.619"
  hint="1,7% do total · 1 lote crítico"
  tone="danger" // default | primary | success | danger | warning
  trend={<TrendChip pct={8.2} />}
/>
```

Visual: `rounded-2xl border bg-card p-6`, label `text-xs uppercase tracking-wider text-muted-foreground`, valor `text-3xl font-semibold tabular-nums`, hint `text-sm text-muted-foreground mt-2`. Variante `primary` aplica `bg-primary text-primary-foreground` para o card destaque (tipo "Total em aprovação").

### 3. Migrar `src/pages/Payments.tsx` (telas Financeiro)

Substituir os 4 cards atuais (Total em aberto / Pós-aprovação / Aguardando validação / Aguardando aprovação) pelo novo `KpiCard`. É a única página onde o KPI velho aparece visualmente diferente — as outras telas Financeiras (Recebíveis, Bônus, Conciliação) já usam `SafeCard` simples e herdam só pela mudança do PageHeader.

### 4. Atualizar `BiDiretoria` e `BiPagamentos` para consumir os primitivos

Trocar o `<header>` inline e os divs de KPI dessas telas pelos novos `PageHeader` e `KpiCard`. Garante que BI e Financeiro renderizam exatamente o mesmo código de header/cards — fonte única de verdade.

## Fora de escopo (deliberado)

- Não tocar em cores/tokens do design system — só estrutura visual dos componentes compartilhados.
- Não mexer em tabelas, modais, drawers, formulários — só header + KPI cards.
- Não renomear nem mover páginas.

## Riscos

- Páginas que dependiam do botão "voltar" do `PageHeader` sem breadcrumbs ficarão sem navegação para trás. Mitigação: rodar grep por `showBack={false}` vs uso implícito e listar páginas afetadas antes de mexer; nessas, passar `showBack` explicitamente.
- Páginas com `actions` muito grandes podem quebrar layout no header maior. Mitigação: `flex-wrap` no header novo (mesma técnica do BI).

## Validação

1. Abrir `/bi/diretoria`, `/bi/pagamentos`, `/pagamentos`, `/recebiveis`, `/conciliacao`, `/usuarios` e conferir visual consistente.
2. Build limpo.
3. Verificar que nenhuma página perdeu o botão voltar onde era essencial.
