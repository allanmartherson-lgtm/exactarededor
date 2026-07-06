---
name: Migração CURA — Fase 3 em andamento
description: Status da migração para @rededor/cura-react; pacotes instalados via vendor/
type: constraint
---
Fases 1 e 2 concluídas (tokens CURA em index.css/tailwind, Button/AppLayout ajustados).

Fase 3 DESBLOQUEADA (2026-07-06): pacotes `@rededor/cura` e `@rededor/cura-react` (v2.0.0-alpha.14) instalados via `file:./vendor/rededor/*` a partir de zip enviado pelo usuário. Assets copiados para `public/assets/cura/`. `CuraInit` + `defineCustomElements` chamados em `src/main.tsx`. Types em `src/cura.d.ts`.

Substituições pontuais previstas (só onde CURA agrega e não quebra shadcn/react-hook-form):
- `CuraToast` no lugar do toaster atual (usar `key` numérica, nunca `onToastClosed`)
- `CuraButton` em CTAs primários de páginas simples (Auth, ForceChangePassword, SetPassword)
- `<cura-icon>` para ícones institucionais

MANTER shadcn em: Form/Input (react-hook-form + zod), Table/DataTable, Dialog, Sheet, Command, Popover, Calendar, Tabs, Accordion — CURA não cobre com paridade.

Não reintroduzir wrapper local — pacote real está disponível em vendor/.
