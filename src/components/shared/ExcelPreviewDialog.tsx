import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

// Detecta se um cabeçalho de coluna sugere data, hora ou datetime.
// Usa para reformatar serial Excel (ex: 46164, 0.468…) na exibição.
type ColKind = "date" | "time" | "datetime" | "other";
const detectColKind = (header: string): ColKind => {
  const h = String(header ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!h) return "other";
  const isDate = /(^|[\s_])(dt|data|dat)([\s_]|$)|nascimento|liberac|emissa|vencim|competenc|admiss|alta|evoluc|realiz|proced|atend/.test(h);
  const isTime = /^hora$|(^|[\s_])hora([\s_]|$)|hr$|hh:mm/.test(h);
  if (isTime && isDate) return "datetime";
  if (isDate) return "date";
  if (isTime) return "time";
  return "other";
};

// Serial Excel para Date (base 1899-12-30). Só para exibição no preview.
const excelSerialToDate = (n: number): Date | null => {
  if (!Number.isFinite(n) || n <= 0 || n > 200000) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + n * 86400 * 1000);
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const formatCell = (raw: unknown, kind: ColKind): string => {
  if (raw == null || raw === "") return "";
  if (raw instanceof Date) {
    if (isNaN(+raw)) return String(raw);
    if (kind === "time") return `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}`;
    const d = `${pad2(raw.getUTCDate())}/${pad2(raw.getUTCMonth() + 1)}/${raw.getUTCFullYear()}`;
    if (kind === "datetime") return `${d} ${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}`;
    return d;
  }
  if (kind !== "other" && typeof raw === "number") {
    if (kind === "time") {
      // fração de dia
      const total = Math.round(raw * 24 * 60);
      const hh = Math.floor(total / 60) % 24;
      const mm = total % 60;
      return `${pad2(hh)}:${pad2(mm)}`;
    }
    const dt = excelSerialToDate(raw);
    if (dt) {
      const d = `${pad2(dt.getUTCDate())}/${pad2(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
      if (kind === "datetime") {
        const frac = raw - Math.floor(raw);
        const total = Math.round(frac * 24 * 60);
        const hh = Math.floor(total / 60) % 24;
        const mm = total % 60;
        return `${d} ${pad2(hh)}:${pad2(mm)}`;
      }
      return d;
    }
  }
  return String(raw);
};

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
      <DialogContent className="max-w-[min(1200px,calc(100vw-2rem))] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="text-base truncate" title={fileName}>{fileName}</DialogTitle>
          <DialogDescription className="text-xs">
            Pré-visualização da planilha original — {dataRows.length} linha{dataRows.length === 1 ? "" : "s"} · {headers.length} coluna{headers.length === 1 ? "" : "s"} (cabeçalho detectado na linha {hIdx + 1}).
          </DialogDescription>
          <div className="flex items-center gap-2 pt-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar em qualquer célula…"
              className="h-8 text-xs max-w-sm"
            />
            {q && (
              <Badge variant="secondary" className="text-[10px]">
                {filtered.length} linha{filtered.length === 1 ? "" : "s"}
              </Badge>
            )}
            {truncated && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200 bg-amber-50">
                exibindo primeiras {MAX_ROWS} — refine a busca para ver mais
              </Badge>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
              <tr>
                <th className="text-left px-2 py-1.5 border-b border-border text-muted-foreground font-medium w-12">#</th>
                {headers.map((h, i) => (
                  <th key={i} className="text-left px-2 py-1.5 border-b border-border font-semibold whitespace-nowrap" title={String(h ?? "")}>
                    {String(h ?? "") || <span className="text-muted-foreground italic">col {i + 1}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, ri) => (
                <tr key={ri} className="hover:bg-muted/40">
                  <td className="px-2 py-1 border-b border-border/50 text-muted-foreground tabular-nums">{ri + hIdx + 2}</td>
                  {headers.map((_, ci) => {
                    const cell = (row ?? [])[ci];
                    const text = cell == null || cell === "" ? "" : String(cell);
                    return (
                      <td key={ci} className="px-2 py-1 border-b border-border/50 whitespace-nowrap max-w-[280px] truncate" title={text}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={headers.length + 1} className="px-2 py-6 text-center text-muted-foreground">
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
