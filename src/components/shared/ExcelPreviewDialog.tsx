import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Search, Rows3, Columns3, AlertTriangle } from "lucide-react";
import { detectRawColKind, formatRawCell } from "@/lib/rawCellFormat";


/**
 * Visualizador rápido da planilha crua (rawMatrix já parseada pelo XLSX).
 * Uso: analista quer conferir uma célula/valor específico sem precisar abrir
 * o Excel de fato. Renderiza em <table> com virtualização simples via slice
 * (limite de linhas mostradas — janela grande o suficiente para conferência
 * pontual sem travar o DOM em planilhas com 50k linhas).
 */
export interface ExcelPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  matrix: unknown[][] | undefined | null;
  headerRowIndex?: number | null;
}

const MAX_ROWS = 500;

// Formatação de exibição (serial Excel → data, coluna de valor → R$ pt-BR)
// vem do helper único compartilhado com a aba "Base importada".
const detectColKind = detectRawColKind;
const formatCell = formatRawCell;


export function ExcelPreviewDialog({ open, onOpenChange, fileName, matrix, headerRowIndex }: ExcelPreviewDialogProps) {
  const [query, setQuery] = React.useState("");
  React.useEffect(() => { if (!open) setQuery(""); }, [open]);

  const safeMatrix = Array.isArray(matrix) ? matrix : [];
  const hIdx = typeof headerRowIndex === "number" ? headerRowIndex : 0;
  const headers = (safeMatrix[hIdx] as unknown[] | undefined) ?? [];
  const dataRows = safeMatrix.slice(hIdx + 1);

  // Pré-detecta tipo por coluna para reformatar seriais Excel na exibição.
  const colKinds = React.useMemo(() => headers.map((h) => detectColKind(String(h ?? ""))), [headers]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? dataRows.filter((row) => (row ?? []).some((c, ci) => formatCell(c, colKinds[ci] ?? "other").toLowerCase().includes(q)))
    : dataRows;
  const shown = filtered.slice(0, MAX_ROWS);
  const truncated = filtered.length > MAX_ROWS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,calc(100vw-2rem))] max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header com gradient suave da marca CURA — sai do flat cinza e reforça identidade. */}
        <DialogHeader className="p-4 sm:p-5 pb-3 border-b border-primary/15 bg-[image:var(--gradient-soft)] space-y-2">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base text-primary-dark truncate" title={fileName}>{fileName}</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Pré-visualização da planilha original — cabeçalho detectado na linha {hIdx + 1}.
              </DialogDescription>
            </div>
          </div>

          {/* KPIs coloridos: linhas, colunas e resultado da busca — cada um com tom semântico. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-info/30 bg-info-soft/60 px-2 py-1 text-[11px] text-info-text">
              <Rows3 className="h-3.5 w-3.5 text-info" />
              <span className="tabular-nums font-semibold">{dataRows.length.toLocaleString("pt-BR")}</span>
              <span className="text-muted-foreground">linha{dataRows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary-soft/50 px-2 py-1 text-[11px] text-primary-dark">
              <Columns3 className="h-3.5 w-3.5 text-primary" />
              <span className="tabular-nums font-semibold">{headers.length}</span>
              <span className="text-muted-foreground">coluna{headers.length === 1 ? "" : "s"}</span>
            </div>
            {q && (
              <Badge variant="secondary" className="text-[10px]">
                {filtered.length.toLocaleString("pt-BR")} resultado{filtered.length === 1 ? "" : "s"}
              </Badge>
            )}
            {truncated && (
              <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-[10px] text-warning-text">
                <AlertTriangle className="h-3 w-3" />
                exibindo primeiras {MAX_ROWS} — refine a busca para ver mais
              </span>
            )}
          </div>

          <div className="relative pt-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 mt-0.5 pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar em qualquer célula…"
              className="h-8 text-xs pl-7 max-w-sm bg-background/80"
            />
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-muted/20">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-primary [&_th]:!text-white">
                <th className="text-left px-2 py-2 font-medium w-12 !text-white/80">#</th>
                {headers.map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 font-semibold whitespace-nowrap text-[11px] uppercase tracking-wide" title={String(h ?? "")}>
                    {String(h ?? "") || <span className="opacity-80 italic normal-case">col {i + 1}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-background">
              {shown.map((row, ri) => (
                <tr key={ri} className="odd:bg-muted/30 hover:bg-primary/5 transition-colors">
                  <td className="px-2 py-1.5 border-b border-border/40 text-muted-foreground tabular-nums text-[10px]">{ri + hIdx + 2}</td>
                  {headers.map((_, ci) => {
                    const cell = (row ?? [])[ci];
                    const text = formatCell(cell, colKinds[ci] ?? "other");
                    return (
                      <td key={ci} className="px-3 py-1.5 border-b border-border/40 whitespace-nowrap max-w-[280px] truncate" title={text}>
                        {text || <span className="text-muted-foreground/60">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={headers.length + 1} className="px-2 py-10 text-center text-muted-foreground">
                    <Search className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    Nenhuma linha corresponde à busca.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
