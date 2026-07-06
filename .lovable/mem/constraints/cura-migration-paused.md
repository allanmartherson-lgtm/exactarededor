---
name: Migração CURA — concluída
description: Status final da migração para @rededor/cura-react (Fases 1-4)
type: constraint
---
Migração CURA CONCLUÍDA em 2026-07-06.

**Aplicado:**
- Fase 1: tokens CURA em `src/index.css` + `tailwind.config.ts`, fontes DM Sans/Playfair, `CuraInit` + `defineCustomElements` em `src/main.tsx`, types em `src/cura.d.ts`.
- Fase 2: chrome (AppLayout header, sidebar, Button variants) tematizado com tokens CURA.
- Fase 3: `CuraSubmitButton` nos CTAs primários de Auth/ForceChangePassword/SetPassword (usa hidden submit para preservar react-hook-form + zod).

**Descopado (justificado):**
- `<cura-icon>` institucional / selo CURA no header — usuário rejeitou co-branding, header mantém só ExactaLogo.
- `CuraToast` — Sonner já consome 100% dos tokens CURA (`bg-card`, `bg-success`, `bg-warning`, `bg-destructive` em `src/components/ui/sonner.tsx`). Migrar exigiria bridge ou reescrever 100+ chamadas `toast(...)`. Retrabalho sem ganho visual; ficamos com Sonner temado.

**Mantido shadcn/Radix** em Form/Input (react-hook-form), Table/DataTable, Dialog, Sheet, Command, Popover, Calendar, Tabs, Accordion — CURA não cobre com paridade.

**Pacotes locais** em `vendor/rededor/cura` e `vendor/rededor/cura-react` (v2.0.0-alpha.14). Assets em `public/assets/cura/`. Não reintroduzir wrapper local — usar pacote real.

**Regras inegociáveis** ao mexer em componentes CURA:
- `--cura-color-*` sempre dentro de `rgb()`/`rgba()`.
- CuraButton: nunca `type="submit"` — usar `CuraSubmitButton` que delega para hidden submit.
- CuraToast (se um dia usado): `key` numérica incrementada, nunca `onToastClosed`.
- Header com fundo navy exige `--cura-font-color: #ffffff`.
