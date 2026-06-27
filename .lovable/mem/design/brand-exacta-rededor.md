---
name: Identidade visual Exacta / Rede D'Or
description: Paleta, fontes e ativos oficiais da marca Exacta após alinhamento com a Rede D'Or
type: design
---
## Marca
- Nome: **Exacta** — produto de pagamento médico da Rede D'Or
- Tagline: "PAGAMENTO MÉDICO · REDE D'OR"

## Cores
- Azul institucional (primary): `#003DA5`
- Azul fundo escuro (login art): `#002855`
- Bronze/acento (check, "x" do wordmark): `#C6A27C`
- Bronze escuro (wordmark "x" em fundo claro): `#8A6830`
- Branco wordmark: `#FFFFFF`

## Tipografia
- Wordmark/títulos hero: **Playfair Display** (400/500), letter-spacing 0.04em
- Corpo: **DM Sans**
- Tagline pequena: Arial/sans, uppercase, letter-spacing ~0.25em, opacity 30%

## Ícone oficial
Círculo `#003DA5` + check bronze `#C6A27C`. Componente: `src/components/brand/ExactaIcon.tsx` (SVG inline). Use SEMPRE este componente — não recriar o checkmark inline em outros lugares.

## Wordmark
"E" branco + "x" bronze + "acta" branco em Playfair Display. No app:
- `AppLayout` (`Logo`): ícone + wordmark "Exacta" (com x bronze) + tagline
- `Auth`, `SetPassword`, `ForceChangePassword`: ExactaIcon 56–64px no header

## Favicon / PWA
- `public/favicon.svg` (vetorial, mesma arte do ExactaIcon)
- `public/apple-touch-icon.png` (512px)
- `theme-color`: `#003DA5`

## Pendências futuras (não bloquear)
- Versão monocromática branca para fundos coloridos
- OG image 1200x630 com lockup completo
- Variante dark com fundo `#01103a`
