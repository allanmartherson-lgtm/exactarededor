# Padronização dos relatórios Excel

## Diagnóstico

Comparando os dois arquivos enviados:

**F1 — `Relatorio_Lote_junhode2026_20260719-193.xlsx`** (emitido em Detalhe do Pagamento → Empresa, via `PaymentReportModal` → `excel-export.worker.ts`)
- ✅ Dados ricos: 4 abas (Resumo, Por Empresa, Detalhe dos Itens, Alertas Assistenciais), cores por status (verde/âmbar/vermelho/azul).
- ❌ Tipografia fora do padrão: `Playfair Display` no cabeçalho + `DM Sans` no corpo.
- ❌ Sem cabeçalho institucional (planilha começa direto na linha de títulos das colunas, sem faixa azul, sem título do relatório, hospital, competência ou data de emissão).

**F2 — `Lote_HDF_..._20260719.xlsx`** (emitido no Lote, via `PaymentBatchExportDialog`)
- ✅ Cabeçalho de colunas com padrão Rede D'Or: fundo `#0B3D91` (navy institucional), fonte branca em negrito, Calibri.
- ❌ Uma aba única, sem resumo, sem cores de status por item, sem quebra por empresa.
- ❌ Também não tem faixa de título institucional acima da tabela.

## O que muda

Criar um único helper de branding e aplicá-lo nos dois pontos de exportação. Manter todos os dados de F1 (é o "deal" segundo o usuário); só troca a "casca visual".

### Arquivos alterados (3)

1. **`src/lib/excelBrandStyle.ts`** — novo (não compartilhado com outras telas ainda; será usado só pelos dois geradores).
   - Constantes: `BRAND_NAVY = "0B3D91"`, `BRAND_BRONZE = "C6A27C"`, cores de status (`STATUS_FILL.aprovado/alerta/reprovado/acatado`).
   - `FONT_BODY = "Calibri" sz 10` e `FONT_HEADER = "Calibri" sz 11 bold branco`.
   - `prependBrandHeader(ws, { title, subtitle, columnsCount })` — insere 3 linhas mescladas no topo:
     - Linha 1: **EXACTA · REDE D'OR** (14pt, negrito, navy, fundo claro).
     - Linha 2: **{título do relatório}** (12pt, negrito, cinza escuro).
     - Linha 3: subtítulo com **Hospital · Competência · Emitido em {data/hora}** (10pt, cinza médio).
     - Linha 4 em branco (respiro).
   - `applyBrandTypography(ws, { headerRow })` — força Calibri em tudo; na linha `headerRow` aplica faixa navy + texto branco em negrito, borda inferior fina.
   - Preserva `cell.s` existente (mantém as cores por status do F1).

2. **`src/workers/excel-export.worker.ts`** (usado só pelo `PaymentReportModal`)
   - Remover constantes `FONT_BODY/FONT_HEADING` locais (Playfair/DM Sans).
   - Chamar `prependBrandHeader` + `applyBrandTypography` em cada uma das 4 abas (Resumo, Por Empresa, Detalhe dos Itens, Alertas Assistenciais).
   - Manter integralmente a lógica de dados, cores de status e a aba Alertas.
   - Título por aba: "Resumo do Lote", "Consolidado por Empresa", "Detalhe dos Itens", "Alertas Assistenciais".
   - Subtítulo receberá `hospitalName`, `competence` e data de emissão — o `PaymentReportModal` já tem `payment.hospital_name` e `payment.competence_months` no contexto; adicionar esses campos ao `workerData`.

3. **`src/components/payment-detail/PaymentBatchExportDialog.tsx`** (F2)
   - Substituir o bloco `handleExportXlsx` para usar o mesmo helper: `prependBrandHeader({ title: "Itens do Lote", subtitle: "…" })` + `applyBrandTypography(ws, { headerRow: 3 })`.
   - Manter as colunas e larguras atuais (só troca de casca).
   - Passa também `payment.hospital_name` e a competência do lote no subtítulo.

## O que NÃO muda

- Nenhuma alteração em componentes de tela, PDFs, dados persistidos, edge functions, banco.
- Aba CSV do `PaymentBatchExportDialog` fica intacta (padrão é dado bruto).
- Cores por status no F1 são preservadas — o helper só ajusta a fonte se não houver `fill` prévio no header, e nunca sobrescreve o `fill` das células de dado.

## Observação sobre arquivos compartilhados

O worker `excel-export.worker.ts` só é chamado pelo `PaymentReportModal`. O `PaymentBatchExportDialog` só é usado no botão "Exportar dados do lote". O novo helper (`excelBrandStyle.ts`) é criado agora e importado só por esses dois pontos — não altera contratos existentes.

Confirma para eu aplicar?
