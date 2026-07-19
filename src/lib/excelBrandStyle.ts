/**
 * Estilo institucional Rede D'Or para relatórios em Excel.
 *
 * Uso exclusivo dos geradores:
 *   - src/workers/excel-export.worker.ts (PaymentReportModal)
 *   - src/components/payment-detail/PaymentBatchExportDialog.tsx
 *
 * Não é um utilitário global — se outra tela precisar, avaliar antes o
 * impacto (fonte Calibri + faixa navy é um contrato visual da marca).
 */
import * as XLSX from "xlsx-js-style";

// Paleta institucional (hex sem #, formato xlsx-js-style).
export const BRAND_NAVY = "0B3D91";       // Rede D'Or navy
export const BRAND_NAVY_SOFT = "E6ECF7";  // fundo claro para faixa "EXACTA · REDE D'OR"
export const BRAND_BRONZE = "C6A27C";
export const TEXT_DARK = "0F172A";
export const TEXT_MUTED = "475569";

// Cores de status (mantém compatibilidade com o worker atual).
export const STATUS_FILL = {
  aprovado: "D1FAE5",
  alerta: "FEF3C7",
  reprovado: "FEE2E2",
  acatado: "DBEAFE",
} as const;

// Tipografia padrão da marca no ambiente Office (Calibri é universal).
const FONT_NAME = "Calibri";

export const FONT_BODY_STYLE = { name: FONT_NAME, sz: 10, color: { rgb: TEXT_DARK } } as const;
export const FONT_HEADER_STYLE = {
  name: FONT_NAME,
  sz: 11,
  bold: true,
  color: { rgb: "FFFFFF" },
} as const;

const THIN_BORDER = { style: "thin", color: { rgb: BRAND_NAVY } } as const;

/**
 * Insere 4 linhas de branding no topo da planilha (título institucional,
 * nome do relatório, contexto, respiro). Desloca todo o conteúdo existente
 * para baixo e retorna o índice (0-based) da linha do cabeçalho de colunas
 * após o shift — útil para o chamador aplicar estilos de header row.
 */
export function prependBrandHeader(
  ws: XLSX.WorkSheet,
  opts: { title: string; subtitle?: string; columnsCount: number },
): number {
  const BRAND_ROWS = 4;
  const cols = Math.max(1, opts.columnsCount);
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;

  // Shift de todas as células existentes 4 linhas para baixo.
  if (range) {
    const cellsToMove: Array<{ addr: string; newAddr: string; cell: XLSX.CellObject }> = [];
    for (let R = range.e.r; R >= range.s.r; --R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (!cell) continue;
        cellsToMove.push({
          addr,
          newAddr: XLSX.utils.encode_cell({ r: R + BRAND_ROWS, c: C }),
          cell,
        });
      }
    }
    for (const m of cellsToMove) delete ws[m.addr];
    for (const m of cellsToMove) ws[m.newAddr] = m.cell;

    // Atualiza !ref
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: range.s.c },
      e: { r: range.e.r + BRAND_ROWS, c: Math.max(range.e.c, cols - 1) },
    });

    // Ajusta merges e linhas existentes.
    if (Array.isArray(ws["!merges"])) {
      ws["!merges"] = ws["!merges"].map((m) => ({
        s: { r: m.s.r + BRAND_ROWS, c: m.s.c },
        e: { r: m.e.r + BRAND_ROWS, c: m.e.c },
      }));
    }
    if (Array.isArray(ws["!rows"])) {
      ws["!rows"] = [{}, {}, {}, {}, ...ws["!rows"]];
    }
  } else {
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: BRAND_ROWS - 1, c: cols - 1 },
    });
  }

  // Escreve as 4 linhas institucionais.
  const lastCol = cols - 1;

  // Linha 1: EXACTA · REDE D'OR (14pt, navy sobre fundo claro).
  ws["A1"] = {
    t: "s",
    v: "EXACTA · REDE D'OR",
    s: {
      font: { name: FONT_NAME, sz: 14, bold: true, color: { rgb: BRAND_NAVY } },
      fill: { fgColor: { rgb: BRAND_NAVY_SOFT } },
      alignment: { horizontal: "left", vertical: "center", indent: 1 },
      border: { bottom: THIN_BORDER },
    },
  };

  // Linha 2: título do relatório (12pt, negrito, texto escuro).
  ws["A2"] = {
    t: "s",
    v: opts.title,
    s: {
      font: { name: FONT_NAME, sz: 12, bold: true, color: { rgb: TEXT_DARK } },
      alignment: { horizontal: "left", vertical: "center", indent: 1 },
    },
  };

  // Linha 3: subtítulo (10pt, cinza médio).
  ws["A3"] = {
    t: "s",
    v: opts.subtitle ?? "",
    s: {
      font: { name: FONT_NAME, sz: 10, color: { rgb: TEXT_MUTED } },
      alignment: { horizontal: "left", vertical: "center", indent: 1 },
    },
  };

  // Linha 4: respiro visual (fundo branco).
  ws["A4"] = { t: "s", v: "", s: { font: { name: FONT_NAME, sz: 8 } } };

  // Merges das linhas institucionais em toda a largura da tabela.
  const merges = Array.isArray(ws["!merges"]) ? ws["!merges"] : [];
  merges.unshift(
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
  );
  ws["!merges"] = merges;

  // Alturas das linhas institucionais.
  const rowsMeta = Array.isArray(ws["!rows"]) ? ws["!rows"] : [];
  rowsMeta[0] = { hpt: 26 };
  rowsMeta[1] = { hpt: 20 };
  rowsMeta[2] = { hpt: 16 };
  rowsMeta[3] = { hpt: 6 };
  ws["!rows"] = rowsMeta;

  // Índice (0-based) onde estará o header row de colunas após o shift.
  return BRAND_ROWS;
}

/**
 * Aplica Calibri em toda a planilha; se `headerRow` for informado, aplica
 * faixa navy + texto branco em negrito nessa linha. Preserva o `fill`
 * previamente definido nas células de dado (mantém cores por status).
 */
export function applyBrandTypography(
  ws: XLSX.WorkSheet,
  opts?: { headerRow?: number },
): void {
  if (!ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const headerRow = opts?.headerRow;

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;

      const isHeader = headerRow != null && R === headerRow;
      // Linhas institucionais (0..3) já vêm estilizadas pelo prependBrandHeader.
      if (R < 4 && headerRow != null && headerRow >= 4) continue;

      const prev = cell.s || {};
      if (isHeader) {
        cell.s = {
          ...prev,
          font: { ...FONT_HEADER_STYLE },
          fill: { fgColor: { rgb: BRAND_NAVY } },
          alignment: {
            vertical: "center",
            horizontal: "center",
            wrapText: true,
            ...(prev.alignment || {}),
          },
          border: {
            ...(prev.border || {}),
            bottom: { style: "medium", color: { rgb: BRAND_NAVY } },
          },
        };
      } else {
        const prevFont = prev.font || {};
        cell.s = {
          ...prev,
          font: {
            name: FONT_NAME,
            sz: prevFont.sz ?? FONT_BODY_STYLE.sz,
            bold: prevFont.bold,
            color: prevFont.color ?? { rgb: TEXT_DARK },
          },
        };
      }
    }
  }

  // Congela a linha do header (e as 4 linhas institucionais) para facilitar leitura.
  if (headerRow != null) {
    ws["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  }
}

/** Formata data no padrão BR sem depender de locale do runner. */
export function fmtDateBR(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return String(iso);
  }
}

/** Subtítulo padrão: "Hospital · Competência · Emitido em dd/mm/aaaa HH:mm". */
export function buildBrandSubtitle(parts: {
  hospitalName?: string | null;
  competence?: string | null;
  emittedAt?: Date;
}): string {
  const emitted = parts.emittedAt ?? new Date();
  const chunks: string[] = [];
  if (parts.hospitalName) chunks.push(parts.hospitalName);
  if (parts.competence) chunks.push(`Competência: ${parts.competence}`);
  chunks.push(
    `Emitido em ${emitted.toLocaleDateString("pt-BR")} ${emitted.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
  );
  return chunks.join("  ·  ");
}
