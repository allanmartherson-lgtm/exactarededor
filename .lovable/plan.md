# Auditoria e padronização de sinalização visual

## Escopo confirmado
1. **Badge "Validação" para toda regra disparada** (qualquer `action`: informar, alerta, alerta_forte, bloquear)
2. **Flash sutil 2x + scroll** ao navegar para item duplicado (mesmo lote OU lote diferente)
3. **Auditoria completa de alertas** — unificar tokens, ícones, toasts e mensagens

---

## Parte 1 — Badge Validação (critério ampliado)

**Hoje:** badge aparece quando `findings.length > 0`. Findings hoje só são populados para alguns tipos (duplicidade, sobreposição, etc), não para regras `informar`.

**Mudança:**
- Em `ItemsDataGrid.tsx`, derivar findings também de `matched_rules` quando existirem mas não estiverem em `findings`.
- Garantir que toda regra disparada (independente da `action`) gere um entry visível no popover do badge.
- Manter cor base do badge (teal) mas variar a borda/ícone pelo nível de severidade dominante:
  - só `informar` → teal (atual)
  - tem `alerta` → amber
  - tem `alerta_forte` → orange
  - tem `bloquear` → red

## Parte 2 — Navegação duplicidade com flash 2x

**Hoje (linha 1469-1476 de ItemsDataGrid):** mesmo lote = `scrollIntoView` + boxShadow estático por 2s. Lote diferente = abre nova aba sem sinalização.

**Mudança:**
- Criar utilitário `flashHighlight(el)` em `src/lib/uiSignals.ts`:
  - `animate-row-flash` (keyframe novo no tailwind.config): pulsa background amber 2x em ~1.6s e some.
  - scroll suave centralizado antes do flash.
- Mesmo lote: chama `flashHighlight` direto.
- Lote diferente: navega com query param `?highlight=<itemId>`. `PaymentDetail` lê o param no mount e chama `flashHighlight` na linha correspondente após o grid renderizar.
- Trocar `window.open` por navegação React Router (`navigate`) para preservar contexto.

## Parte 3 — Padronização de alertas

**Inventário atual:**
- `AlertBanner.tsx` — banner de topo
- `RiskBadge.tsx` — score de risco
- Badges inline em `ItemsDataGrid` (Validação, duplicidade calc, conflito)
- `toast()` (sonner) usado em ~20 lugares com mensagens livres
- `AlertDialog`/`Dialog` de erro com estilos variáveis

**Padronização:**
- Criar `src/lib/uiSignals.ts` exportando:
  - `SEVERITY_TOKENS = { info, warn, critical, block }` com `{ bgClass, borderClass, textClass, icon, label }` — fonte única.
  - `notify.info/warn/error/success(title, description?)` wrappers de `toast` com ícone e cor consistentes.
- Refatorar `AlertBanner` e badges para consumir `SEVERITY_TOKENS`.
- Substituir `toast({...})` ad-hoc por `notify.*` nos arquivos de payment-detail e ValidationRules.
- Padronizar ícones: `Info` (informar), `AlertTriangle` (alerta), `AlertOctagon` (alerta_forte), `ShieldX` (bloquear). Usar em badge, banner e toast.

---

## Arquivos afetados

**Novos:**
- `src/lib/uiSignals.ts` — tokens + `notify` + `flashHighlight`

**Editados:**
- `tailwind.config.ts` — keyframe `row-flash`
- `src/components/payment-detail/ItemsDataGrid.tsx` — badge ampliado, cor por severidade, navegação com flash, leitura de `?highlight`
- `src/pages/PaymentDetail.tsx` — leitura do param `highlight` no mount, pass-through pro grid
- `src/components/payment-detail/AlertBanner.tsx` — consumir SEVERITY_TOKENS
- `src/components/payment-detail/RiskBadge.tsx` — alinhar ícones/tokens
- ~6 arquivos com `toast()` → `notify.*` (payment-detail + ValidationRules)

## Detalhes técnicos

```ts
// uiSignals.ts
export const SEVERITY_TOKENS = {
  info:    { bg:"bg-teal-50",   border:"border-teal-200",   text:"text-teal-700",   icon:Info,         label:"Informativo" },
  warn:    { bg:"bg-amber-50",  border:"border-amber-200",  text:"text-amber-700",  icon:AlertTriangle,label:"Alerta" },
  critical:{ bg:"bg-orange-50", border:"border-orange-200", text:"text-orange-700", icon:AlertOctagon, label:"Alerta forte" },
  block:   { bg:"bg-red-50",    border:"border-red-200",    text:"text-red-700",    icon:ShieldX,      label:"Bloqueio" },
};

export function flashHighlight(el: HTMLElement) {
  el.scrollIntoView({ behavior:"smooth", block:"center" });
  el.classList.remove("row-flash"); void el.offsetWidth; // reset
  el.classList.add("row-flash");
  setTimeout(() => el.classList.remove("row-flash"), 1700);
}
```

```js
// tailwind keyframe
"row-flash": {
  "0%,100%":  { backgroundColor: "transparent" },
  "20%,60%":  { backgroundColor: "hsl(38 92% 50% / 0.25)" },
  "40%,80%":  { backgroundColor: "transparent" },
}
```

## Fora de escopo
- Não mexer no motor de validação (analyze-payment)
- Não alterar schema do banco
- Não mudar `severity` (já derivado de `action`)
- Não tocar em telas fora de payment-detail/ValidationRules nesta passada