import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { History, Download } from "lucide-react";

interface ExportRow {
  id: string;
  created_at: string;
  user_email: string | null;
  user_name: string | null;
  report_key: string;
  report_label: string;
  format: string;
  filters: Record<string, unknown> | null;
  hospital_id: string | null;
  row_count: number | null;
}

const formatBadge = (f: string) => {
  const color =
    f === "csv"
      ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : f === "pdf"
      ? "bg-red-500/10 text-red-700 dark:text-red-400"
      : f === "print"
      ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
      : "bg-muted text-muted-foreground";
  return <Badge variant="outline" className={color}>{f.toUpperCase()}</Badge>;
};

const ExportAudit = () => {
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("all");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase.from("export_log" as any) as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!mounted) return;
      if (!error) setRows((data ?? []) as ExportRow[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (formatFilter !== "all" && r.format !== formatFilter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        r.report_label.toLowerCase().includes(q) ||
        (r.user_email ?? "").toLowerCase().includes(q) ||
        (r.user_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, formatFilter]);

  const byFormat = useMemo(() => {
    const acc: Record<string, number> = {};
    rows.forEach((r) => {
      acc[r.format] = (acc[r.format] ?? 0) + 1;
    });
    return acc;
  }, [rows]);

  const downloadCsv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const head = ["data", "usuario", "email", "relatorio", "formato", "linhas", "filtros"].join(",");
    const body = filtered
      .map((r) =>
        [
          esc(new Date(r.created_at).toLocaleString("pt-BR")),
          esc(r.user_name ?? ""),
          esc(r.user_email ?? ""),
          esc(r.report_label),
          esc(r.format),
          esc(String(r.row_count ?? "")),
          esc(JSON.stringify(r.filters ?? {})),
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([`${head}\n${body}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria-exportacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Auditoria de exportações"
        description="Quem baixou ou imprimiu cada relatório, quando e com quais filtros."
        icon={History}
        actions={
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        }
      />

      <div className="px-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{rows.length}</div>
          </CardContent>
        </Card>
        {(["csv", "pdf", "print", "view"] as const).map((f) => (
          <Card key={f}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground uppercase">{f}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{byFormat[f] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="px-6 flex flex-wrap gap-2">
        <Input
          placeholder="Buscar por relatório ou usuário..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1">
          {(["all", "csv", "pdf", "print", "view"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={formatFilter === f ? "default" : "outline"}
              onClick={() => setFormatFilter(f)}
            >
              {f === "all" ? "Todos" : f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <div className="px-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Data</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Relatório</TableHead>
                  <TableHead className="w-[80px]">Formato</TableHead>
                  <TableHead className="w-[80px] text-right">Linhas</TableHead>
                  <TableHead>Filtros</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      Nenhum registro.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{r.user_name ?? "—"}</div>
                      <div className="text-muted-foreground">{r.user_email ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{r.report_label}</div>
                      <div className="text-muted-foreground">{r.report_key}</div>
                    </TableCell>
                    <TableCell>{formatBadge(r.format)}</TableCell>
                    <TableCell className="text-xs text-right">{r.row_count ?? "—"}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground max-w-[300px] truncate">
                      {r.filters && Object.keys(r.filters).length > 0 ? JSON.stringify(r.filters) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ExportAudit;
