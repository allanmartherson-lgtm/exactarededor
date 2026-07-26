/**
 * RawDataTable — exibe o `raw_data` (JSONB) dos payment_items da empresa
 * exatamente como foi importado da planilha, sem tratamento/normalização.
 *
 * Objetivo: dar ao analista uma janela de conferência rápida contra a base
 * original — qual valor a analista de repasse informou, qual setor veio
 * escrito, etc. — sem precisar reabrir o Excel.
 *
 * Não formata células (nem datas, nem números). raw_data é espelho fiel.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Search, FileSpreadsheet } from "lucide-react";

type ItemWithRaw = { id?: string | null; raw_data?: unknown; created_at?: string | null };

export function RawDataTable({ items }: { items: ItemWithRaw[] }) {
  const [query, setQuery] = React.useState("");

  // Coleta todos os headers presentes (união de chaves) preservando a ordem
  // do primeiro item — cabeçalhos que aparecem apenas em linhas posteriores
  // vão para o fim.
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
    return { headers: ordered, rows: dataRows };
  }, [items]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => headers.some((h) => String(r[h] ?? "").toLowerCase().includes(q)))
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
            {rows.length.toLocaleString("pt-BR")} linha{rows.length === 1 ? "" : "s"} · {headers.length} coluna{headers.length === 1 ? "" : "s"} · dados brutos, sem tratamento
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
                  const text = v == null ? "" : String(v);
                  return (
                    <td
                      key={h}
                      className="px-3 py-1.5 border-b border-border/40 whitespace-nowrap max-w-[320px] truncate"
                      title={text}
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
