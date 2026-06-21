## Re-skin token-level "Apple-clean" sobre identidade D'Or

Mudança **apenas** em `src/index.css`. Zero em `tailwind.config.ts` (stack SF Pro já está em `fontFamily.sans/display`; radius e sombras já consomem CSS vars). Zero em componentes, telas, lógica, densidade de tabela, status, chat, bubbles.

---

### (a) Variáveis que mudam — antes → depois

#### Light (`:root`)

| Token | Antes | Depois |
|---|---|---|
| `--primary` | `214 100% 32%` (#003DA5) | `211 100% 45%` (#0071E3) |
| `--ring` | `214 100% 32%` | `211 100% 45%` |
| `--ring-soft` | `214 100% 32% / 0.2` | `211 100% 45% / 0.2` |
| `--secondary-foreground` | `214 100% 32%` | `211 100% 45%` |
| `--primary-soft` | `214 60% 94%` (#EAF0FA) | `211 80% 95%` (#E8F2FE) |
| `--primary-glow` | `200 68% 68%` | `205 90% 70%` |
| `--primary-dark` | `214 100% 17%` (#002855) | **manter** (navy D'Or — âncora do gradient e do `chat-bubble-mine-foreground`) |
| `--sidebar-primary` | `214 100% 32%` | `211 100% 45%` |
| `--sidebar-ring` | `214 100% 32%` | `211 100% 45%` |
| `--sidebar-hover-foreground` | `214 100% 32%` | `211 100% 45%` |
| `--sidebar-accent` | `214 60% 94%` | `211 80% 95%` |
| `--sidebar-accent-foreground` | `214 100% 32%` | `211 100% 45%` |
| `--gradient-brand` | `linear-gradient(135deg, hsl(214 100% 17%), hsl(214 100% 32%))` | `linear-gradient(135deg, hsl(214 100% 17%), hsl(211 100% 45%))` (navy D'Or → azul Apple) |
| `--gradient-soft` | `..hsl(214 40% 98%), hsl(214 40% 95%)` | `..hsl(211 50% 98%), hsl(211 50% 95%)` |
| `--radius` | `0.5rem` | `0.625rem` |
| `--shadow-soft` | `0 1px 2px /.06, 0 1px 3px /.05` | `0 1px 2px /.04, 0 1px 2px /.03` |
| `--shadow-card` | `0 1px 2px /.06, 0 2px 6px -1px /.08, 0 4px 12px -2px /.06` | `0 1px 2px /.04, 0 2px 6px -1px /.05, 0 8px 24px -6px /.05` |
| `--shadow-elevated` | `0 4px 8px -1px /.10, 0 8px 20px -4px /.08` | `0 4px 10px -2px /.08, 0 12px 32px -8px /.06` |
| `--shadow-hover` (em `:root` e em cada `data-contrast="1..5"`) | atual | reduzir ~25% em cada nível (mantém escala do slider) |

Intactos: `--accent` `37 42% 61%` e `--accent-light` (dourado D'Or), `--accent-blue*` (status info), todos os `--success/--warning/--info/--destructive*`, todos os `--chat-*`, todos os `--bubble-*`.

#### Dark (`.dark`)

| Token | Antes | Depois |
|---|---|---|
| `--primary` | `214 80% 55%` | **`211 90% 60%`** (ver risco em **d**) |
| `--ring` | `214 80% 55%` | `211 90% 60%` |
| `--ring-soft` | `214 80% 55% / 0.3` | `211 90% 60% / 0.3` |
| `--primary-soft` | `214 40% 18%` | `211 50% 18%` |
| `--primary-glow` | `200 55% 60%` | `205 70% 62%` |
| `--sidebar-primary` | `214 80% 58%` | `211 90% 62%` |
| `--sidebar-ring` | `214 80% 55%` | `211 90% 60%` |
| `--sidebar-accent` | `214 40% 18%` | `211 50% 18%` |
| `--sidebar-accent-foreground` | `214 80% 80%` | `211 90% 82%` |
| `--gradient-brand` | `..hsl(214 100% 12%), hsl(214 100% 28%)` | `..hsl(214 100% 12%), hsl(211 100% 42%)` |
| Sombras dark | atuais | **manter** (no dark, sombra é estrutural — suavizar achata cards). |

#### Tipografia (`@layer base`)

| Item | Antes | Depois |
|---|---|---|
| `body` font-family | `'DM Sans', -apple-system, …` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', system-ui, sans-serif` |
| `h1..h4` font-family | `'DM Sans', sans-serif` | mesmo stack SF Pro |
| `body` 13.5px/400/1.6/0.01em | atual | **manter** |
| `h1..h4` sizes/weights/tracking | atuais | **manter** |
| `thead th` 11px/600/uppercase | atual | **manter** explicitamente |
| `tbody td` 13px/400 | atual | **manter** explicitamente |
| `button` 500/0.02em | atual | **manter** |
| Linha 1 (`@import` Google Fonts) | `DM+Sans:…&family=Playfair+Display:…` | remover `DM+Sans`; Playfair fica se a decisão (c) for "manter" |

---

### (b) Impacto global esperado

Tudo o que consome `hsl(var(--primary))`, `bg-primary`, `text-primary`, `ring-primary`, `bg-sidebar-accent`, `bg-sidebar-primary` muda de tom em todo o app:

- **CTAs primários, links ativos, foco de input, badges azuis, item ativo da sidebar e seu fundo soft** passam do azul D'Or escuro pro azul Apple mais vivo. Sensação: mais "ar", menos peso institucional.
- **`--gradient-brand`** segue começando no navy D'Or e termina no Apple — leitura "D'Or que abre pra um azul moderno", em vez de monocromia D'Or.
- **`chat-bubble-mine`** (usa `--primary-soft` + `--primary-dark` como fg) **não muda contraste** — `--primary-dark` está protegido.
- **Tipografia**: todo o app vira SF Pro nativa no macOS/iOS e cai pra Segoe UI/system-ui no Windows/Linux. Letras um pouco mais estreitas que DM Sans, contadores mais abertos. Tamanhos não mudam → layouts não quebram.
- **Cantos +2px**. Botões `sm`, badges e inputs absorvem sem reflow. Avatares/switches/checkbox já são `rounded-full`.
- **Sombras**: efeito visível em hover de card, modais e popovers — "vidro Apple". Nos níveis `data-contrast="4|5"` mantemos sombras densas (já têm override), então quem precisa de mais profundidade não perde.
- **Dark mode**: `211 90% 60%` é mais saturado/claro que o atual — leitura mais "elétrica". Ver risco em **(d)**.

Não muda: tokens de status, chat, bubbles, dourado D'Or, densidade de tabela, paddings de componentes, qualquer comportamento.

Telas que mais sentem: Login (piloto), Sidebar, Dashboard, Auth, listas com badges azuis, gráficos que pintam por `--primary`.

---

### (c) Wordmark — recomendação: **manter Playfair Display**

- É a única "voz tipográfica" diferenciada do app — todo o resto vira SF Pro. Trocar pra SF Pro semibold homogeneíza demais e o app perde a única assinatura editorial que separa "marca" de "interface".
- Playfair atual (`font-wordmark`, weight 400, tracking 0.005em) dialoga bem com Apple-clean justamente pelo contraste: SF na UI, serif só na marca — mesmo princípio Apple (San Francisco na UI, New York serif em peças editoriais).
- Casa com o dourado D'Or sem precisar de mais cor.

**Alternativa SF Pro Display semibold**, se quiser homogeneidade total:
```css
.font-wordmark {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  font-weight: 600;
  letter-spacing: -0.01em;
}
```
+ remover Playfair do `@import`. Perde-se a única âncora editorial; ganha "Apple puro".

---

### (d) Risco de contraste — #0071E3

Texto branco sobre primary:

| Combinação | Contraste atual | Contraste novo | WCAG |
|---|---|---|---|
| `#FFFFFF` sobre `--primary` light (#003DA5 → #0071E3) | ≈ 9.5:1 | **≈ 4.65:1** | **AA normal ✅**, AAA normal ❌ (precisa 7.0) |
| `#FFFFFF` sobre `--primary` dark (`214 80% 55%` ≈ #338AE3 → `211 90% 60%` ≈ #3DA0F5) | ≈ 3.5:1 | **≈ 2.9:1** | **AA normal ❌**, AA large ✅ |
| `--primary-dark` sobre `--primary-soft` (chat-bubble-mine) | ≈ 12:1 | ≈ 12:1 | AAA ✅ intacto |
| `text-primary` pequeno (<14px) sobre `--background` off-white | n/a | **≈ 4.2:1** | **AA normal ❌**, AA large ✅ |

Implicações:
1. **Caminho mais visível (CTA primary branco em light) passa AA normal** (4.65:1). Conforme WCAG 2.1 AA. Abaixo de AAA.
2. **Dark mode + texto branco em botão primary** já estava no limite e cai pra 2.9:1 — **falha AA normal**. Mitigação: `--primary` dark = `211 90% 48%` (#1175D9 → 5.3:1 ✅) — perde um pouco do brilho Apple, mas conforma.
3. **Links/labels pequenos com `text-primary` em fundo claro** caem pra 4.2:1 (limite AA pra <14px). Mitigação: `--primary` light = `211 100% 42%` (#0066CC → 5.5:1) — perde um pouco do "Apple vivo".
4. **Foco (ring)** mais visível → ganho de acessibilidade.
5. **Botões `outline`/`ghost`** em superfície branca ficam mais legíveis → ganho.
6. `data-contrast="4|5"` continuam funcionando (não tocam `--primary`).

**Decisões pendentes antes de eu implementar:**
1. `--primary` dark: ficar em `211 90% 60%` (Apple, 2.9:1 — falha AA) ou ir pra `211 90% 48%` (5.3:1, AA ✅, menos vibrante)?
2. Wordmark: manter Playfair (recomendação) ou trocar pra SF Pro Display semibold?
3. `text-primary` pequeno em fundo claro: aceitar 4.2:1 ou escurecer `--primary` light pra `211 100% 42%` (5.5:1)?

---

### Plano de execução (quando virar build)

1. Editar **só `src/index.css`**: aplicar tabelas light e dark, trocar `font-family` de body/h1..h4 (sem mexer em sizes/weights/tracking), remover `DM+Sans` do `@import`, atualizar 3 shadows base + os `--shadow-hover` dos 5 níveis de `data-contrast`.
2. `tailwind.config.ts`: **não tocar**.
3. Verificação visual: `/auth` (piloto), sidebar (hover + ativo), `/pagamentos` (densidade + badges), um modal qualquer, uma página em dark, foco via Tab.
4. Não rodar migration, não tocar em componente, não tocar em `chat-*`, `bubble-*`, status.
