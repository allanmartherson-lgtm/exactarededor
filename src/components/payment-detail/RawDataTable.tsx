/**
 * RawDataTable — exibe o `raw_data` (JSONB) dos payment_items da empresa
 * como veio da planilha original.
 *
 * O DADO é bruto (nada é reescrito no banco); a EXIBIÇÃO é formatada:
 * serial Excel vira dd/mm/aaaa [hh:mm] e coluna de valor vira R$ pt-BR.
 * A formatação vive em `@/lib/rawCellFormat` e é a mesma usada no modal
 * "Ver planilha" da importação.
 *
 * Ordem das colunas: o JSONB do Postgres NÃO preserva a ordem das chaves,
 * então a ordem original da planilha é lida de
 * `payment_source_files.original_headers` (gravada na importação). Lotes
 * antigos sem esse campo caem no fallback: ordem de aparição das chaves.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Search, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { detectRawColKind, formatRawCell, orderHeaders, type RawColKind } from "@/lib/rawCellFormat";

type ItemWithRaw = { id?: string | null; raw_data?: unknown; created_at?: string | null };

export function RawDataTable({ items, paymentId }: { items: ItemWithRaw[]; paymentId?: string | null }) {
  const [query, setQuery] = React.useState("");
  const [originalOrder, setOriginalOrder] = React.useState<string[] | null>(null);

  // Busca a ordem original dos cabeçalhos gravada na importação.
  // Falha/ausência é tolerada: sem isso apenas caímos no fallback de ordem.
  React.useEffect(() => {
    let cancelled = false;
    if (!paymentId) {
      setOriginalOrder(null);
      return;
    }
    (async () => {
      const { data, error } = await (supabase as any)
        .from("payment_source_files")
        .select("original_headers, created_at")
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.warn("[RawDataTable] não foi possível ler original_headers:", error.message);
        setOriginalOrder(null);
        return;
      }
      const merged: string[] = [];
      const seen = new Set<string>();
      for (const row of (data ?? []) as { original_headers?: unknown }[]) {
        const arr = Array.isArray(row?.original_headers) ? row.original_headers : [];
        for (const h of arr) {
          const s = String(h ?? "").trim();
          if (s && !seen.has(s)) {
            seen.add(s);
            merged.push(s);
          }
        }
      }
      setOriginalOrder(merged.length > 0 ? merged : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  // União das chaves presentes, preservando a ordem de aparição (fallback).
  const { headers, rows } = React.useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const dataRows: Record<string, unknown>[] = [];
    for (const it of items) {
      const raw = it?.raw_data;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) {
          seen.add(k);
          ordered.push(k);
        }
      }
      dataRows.push(row);
    }
    return { headers: orderHeaders(ordered, originalOrder), rows: dataRows };
  }, [items, originalOrder]);

  const colKinds = React.useMemo(() => {
    const map: Record<string, RawColKind> = {};
    for (const h of headers) map[h] = detectRawColKind(h);
    return map;
  }, [headers]);

  const q = query.trim().toLowerCase();
  // Busca casa tanto com o texto formatado (R$ 1.234,56 / 03/07/2026)
  // quanto com o bruto (1234.56 / 46230.58125).
  const filtered = q
    ? rows.filter((r) =>
        headers.some((h) => {
          const v = r[h];
          const rawText = v == null ? "" : String(v).toLowerCase();
          if (rawText.includes(q)) return true;
          return formatRawCell(v, colKinds[h] ?? "other").toLowerCase().includes(q);
        }),
      )
    : rows;

  if (headers.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-40" />
        Nenhum dado bruto disponível para esta empresa.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
        <FileSpreadsheet className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Base importada — planilha original</div>
          <div className="text-[11px] text-muted-foreground">
            {rows.length.toLocaleString("pt-BR")} linha{rows.length === 1 ? "" : "s"} · {headers.length} coluna{headers.length === 1 ? "" : "s"} · visualização formatada da planilha original
            {originalOrder ? " · colunas na ordem do arquivo" : ""}
          </div>
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar em qualquer célula…"
            className="h-8 text-xs pl-7 w-[260px]"
          />
        </div>
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="text-left px-2 py-2 font-semibold text-muted-foreground w-12 border-b border-border">#</th>
              {headers.map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2 font-semibold whitespace-nowrap text-[11px] uppercase tracking-wide border-b border-border"
                  title={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr key={ri} className="odd:bg-muted/20 hover:bg-primary/5 transition-colors">
                <td className="px-2 py-1.5 border-b border-border/40 text-muted-foreground tabular-nums text-[10px]">
                  {ri + 1}
                </td>
                {headers.map((h) => {
                  const v = row[h];
                  const kind = colKinds[h] ?? "other";
                  const text = formatRawCell(v, kind);
                  const rawText = v == null ? "" : String(v);
                  return (
                    <td
                      key={h}
                      className={`px-3 py-1.5 border-b border-border/40 whitespace-nowrap max-w-[320px] truncate ${
                        kind === "currency" ? "text-right tabular-nums" : ""
                      }`}
                      // Tooltip mostra o valor bruto quando houve formatação —
                      // o analista precisa poder conferir o dado original.
                      title={text !== rawText && rawText ? `${text}  (bruto: ${rawText})` : text}
                    >
                      {text || <span className="text-muted-foreground/50">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={headers.length + 1} className="px-3 py-10 text-center text-muted-foreground text-sm">
                  Nenhuma linha corresponde à busca.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
