---
name: Modais respeitam viewport na raiz
description: DialogContent e AlertDialogContent têm max-h/max-w + overflow-y-auto no primitive; nunca patchar por modal.
type: design
---
`src/components/ui/dialog.tsx` e `src/components/ui/alert-dialog.tsx` já aplicam `max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain` no Content. Novos modais NÃO devem duplicar essas classes nem envolver o conteúdo em wrappers com max-height próprio. Se um bloco interno precisa de scroll independente (ex.: lista longa dentro de um modal com botões fixos), use flex-col + `min-h-0` no filho, não max-h fixo em px.
