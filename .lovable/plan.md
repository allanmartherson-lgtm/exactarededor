# Migração Exacta → Design System CURA (Rede D'Or)

## Realidade do escopo escolhido

Você pediu **"Migração completa para @rededor/cura-react"** + **substituição definitiva**. Preciso ser honesto:

- O Exacta tem **~180 páginas** e centenas de componentes shadcn (Button, Input, Select, Dialog, Table, Tabs, Command, DataTable, Sheet, DropdownMenu, Popover, Calendar, Toast, Form etc.) usados em praticamente toda tela.
- `@rededor/cura-react` **não cobre 1:1** o shadcn. Não existe `CuraDataTable`, `CuraCommand`, `CuraCalendar`, `CuraSheet`, `CuraPopover`, `CuraDropdownMenu` com paridade funcional. Componentes densos (BI, conciliação, auditoria) dependem de shadcn/Radix.
- Migração 100% literal a `CuraButton`/`CuraInput`/`CuraToast` **quebraria os formulários complexos** (react-hook-form + zod + shadcn Form), tabelas com filtros, comandos, calendários, popovers de filtro etc. — é semana(s) de retrabalho manual.

## Proposta: "CURA por fora, shadcn por dentro"

Trato CURA como **tema visual + componentes onde há paridade real**, mantendo shadcn/Radix para componentes densos que CURA não cobre. Resultado visual: 100% Rede D'Or. Resultado técnico: app continua funcionando.

## Plano em 4 fases (cada uma entregável e reversível por commit)

### Fase 1 — Fundação de tokens (base de tudo)
- Instalar `@rededor/cura` e `@rededor/cura-react` (2.x).
- Criar `src/cura.d.ts` com declarations.
- Chamar `CuraInit({ localAssetsPath: '/assets/cura' })` + `defineCustomElements(window)` no `main.tsx`.
- Reescrever `src/index.css`:
  - Substituir `--primary`, `--background`, `--card`, `--border`, `--muted`, `--accent`, `--destructive`, `--success`, `--warning`, `--info` (+ `-foreground`, `-soft`, `-text`) pelos valores CURA (`primary-700 #003DA5`, `accent-500 #FF8200`, neutral-0/100/200/500/600/700, success/warning/error/info conforme paleta enviada).
  - Manter HSL (padrão shadcn) → converter as cores CURA para HSL para não quebrar `hsl(var(--...))` que está em todo lugar.
  - Radius: `--radius: 0.5rem` (8px cards) — atualmente 12px. Botões usam 4px via variant.
- Trocar fonte: instalar `@fontsource/dm-sans` (fallback Gotham indisponível publicamente) + `@fontsource/playfair-display` para hero. Setar em `tailwind.config.ts`.
- **Nada mais é tocado.** Todas as 180 telas passam a exibir a paleta CURA automaticamente.

### Fase 2 — Chrome do app (o que o usuário vê primeiro)
- `AppLayout` header: fundo `primary-700` + `--cura-font-color: #ffffff`.
- Sidebar: neutral-0 + estados hover/active em primary-100/700.
- `Button` (shadcn): variants reescritos para casar com CuraButton (radius 4px, primary sólido, secondary outlined).
- `Badge`, `Card`, `KpiCard`, `SafeCard`: revistos para casar com o preview `/preview-cura`.
- Logo/wordmark Exacta permanece (é a marca do produto), mas assinado "por Rede D'Or".

### Fase 3 — Componentes CURA onde faz sentido
Substituição pontual, só onde CURA agrega e não quebra:
- `CuraToast` no lugar do toaster atual (via key numérica, sem `onToastClosed`).
- `CuraButton` em CTAs primários de páginas simples (login, force-change-password, set-password).
- `cura-icon` para ícones institucionais (logo Rede D'Or).
- **Manter shadcn** em: Form/Input (react-hook-form), Table/DataTable, Dialog, Sheet, Command, Popover, Calendar, Select complexo, Tabs, Accordion — CURA não cobre com paridade.

### Fase 4 — Auditoria e polimento
- Rodar checklist `/skill:cura-review` em todo arquivo tocado.
- Rodar `bun run build` + `bun run test` a cada fase.
- Corrigir contrastes (o tema atual tem `--warning-soft`/`--info-soft` bem calibrados para light+dark — refazer para CURA sem quebrar dark mode).
- Screenshot comparativo antes/depois em 6 telas críticas (Dashboard, Pagamentos, Regras, Conciliação, Auditoria, Notas Fiscais).

## O que NÃO farei nesta migração
- Não vou trocar shadcn Form → CuraInput em todas as 40+ telas de formulário. Isso é retrabalho sem ganho visual proporcional.
- Não vou tocar em telas de BI/relatórios que dependem de Recharts + shadcn Table — só re-tokenizo cores.
- Não vou mexer em edge functions, lógica de negócio, hooks de dados.
- Não vou remover dark mode — CURA é primariamente light; se você usa dark, preciso saber (pergunta abaixo).

## Detalhes técnicos

**Estratégia HSL:** shadcn/Tailwind usa `hsl(var(--primary))` em todo lugar. Converto os hex CURA para HSL:
- `primary-700 #003DA5` → `hsl(214, 100%, 32%)`
- `accent-500 #FF8200` → `hsl(31, 100%, 50%)`
- `neutral-100 #F6F6F6` → `hsl(0, 0%, 96%)`
- `neutral-600 #6E6E6E` → `hsl(0, 0%, 43%)`
- `success-500 #5FD290` → `hsl(140, 55%, 60%)`
- `error-500 #CE2A2A` → `hsl(0, 66%, 49%)`
- etc.

**Coexistência:** os arquivos `PreviewCura.tsx` e `PreviewDesignSystems.tsx` continuam existindo como referência — não removo.

**Migração de tokens é reversível** por revert de commit único (fase 1). As fases 2-4 são commits independentes.

## Pergunta bloqueante antes de começar

Duas coisas que muito impactam a Fase 1 e preciso confirmar:

1. **Dark mode:** o Exacta hoje tem dark mode funcional (via `ThemeContext`). CURA não define uma paleta dark oficial. Opções:
   - (a) Descontinuar dark mode (mais alinhado com CURA, mais simples).
   - (b) Manter dark, eu derivo uma paleta dark a partir dos neutrals CURA.

2. **Fonte:** Gotham (padrão CURA no app médico) é licenciada e não está disponível como npm/@fontsource. Uso **DM Sans** (já na sua brand memory) como fallback oficial? Ou você tem os arquivos `.woff2` da Gotham para eu embutir?

Responda essas duas e eu executo a Fase 1 imediatamente (uma leva de tokens + fontes + init CURA, sem tocar em componente nenhum ainda).