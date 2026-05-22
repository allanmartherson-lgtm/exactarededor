import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Calculator, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, mean } from "@/lib/financialStats";

interface PaymentRow {
  competence_month: string | null;
  total_amount: number;
  status: string;
}

interface ItemRow {
  sector: string | null;
  gross_amount: number | null;
  created_at: string;
}

const EXCLUDED = new Set(["rascunho", "cancelado", "rejeitado"]);

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmtMonth(ym: string): string {
  const [year, month] = ym.split("-");
  if (!year || !month) return ym;
  const idx = parseInt(month, 10) - 1;
  if (idx < 0 || idx > 11) return ym;
  return `${MONTHS_PT[idx]}/${year.slice(2)}`;
}

function categorizeSector(sector: string | null): string {
  if (!sector) return "Outros";
  const s = sector.toLowerCase();
  if (s.includes("cirurg") || s.includes("cirur")) return "Cirurgia";
  if (s.includes("visit") || s.includes("parecer") || s.includes("consul")) return "Visitas e Pareceres";
  if (s.includes("hemo") || s.includes("cineangiocoronariografia") || s.includes("cinecoronario")) return "Hemodinâmica";
  if (s.includes("anest")) return "Anestesia";
  if (s.includes("uti") || s.includes("intensiv")) return "UTI";
  if (s.includes("endoscopi") || s.includes("colonoscopi")) return "Endoscopia";
  return "Outros";
}

export const ProjectionTab = () => {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [items, setItems] = useState<ItemRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const [{ data: pData }, { data: iData }] = await Promise.all([
        supabase
          .from("payments")
          .select("competence_month,total_amount,status")
          .gte("competence_month", cutoff.toISOString().slice(0, 10)),
        supabase
          .from("payment_items")
          .select("sector, gross_amount, created_at")
          .gte("created_at", cutoff.toISOString())
          .not("gross_amount", "is", null)
          .limit(20000),
      ]);
      setRows((pData as PaymentRow[]) ?? []);
      setItems((iData as ItemRow[]) ?? []);
    })();
  }, []);

  const result = useMemo(() => {
    if (!rows) return null;
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.competence_month || EXCLUDED.has(r.status)) continue;
      const key = r.competence_month.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(r.total_amount));
    }
    const months = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    if (months.length === 0) return { projection: 0, currentTotal: 0, delta: 0, months: [] };
    const last3 = months.slice(-3).map(([, v]) => v);
    const projection = mean(last3);
    const currentTotal = months[months.length - 1][1];
    const delta = currentTotal > 0 ? ((projection - currentTotal) / currentTotal) * 100 : 0;
    return { projection, currentTotal, delta, months };
  }, [rows]);

  const breakdown = useMemo(() => {
    if (!items) return null;
    const byCat = new Map<string, number>();
    let total = 0;
    for (const it of items) {
      const v = Number(it.gross_amount) || 0;
      if (v <= 0) continue;
      const cat = categorizeSector(it.sector);
      byCat.set(cat, (byCat.get(cat) ?? 0) + v);
      total += v;
    }
    const projection = result?.projection ?? 0;
    return Array.from(byCat.entries())
      .map(([cat, val]) => ({
        cat,
        val,
        pct: total > 0 ? (val / total) * 100 : 0,
        proj: total > 0 ? (val / total) * projection : 0,
      }))
      .sort((a, b) => b.val - a.val);
  }, [items, result]);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Projeção do próximo mês"
        icon={Calculator}
        iconColor="blue"
        subtitle="Média móvel dos últimos 3 meses"
      />
      <div className="p-6">
        {!result ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Projeção
              </p>
              <p className="text-3xl font-light tabular-nums">{formatBRL(result.projection)}</p>
            </div>
            <div className="rounded-lg border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Mês atual
              </p>
              <p className="text-3xl font-light tabular-nums">{formatBRL(result.currentTotal)}</p>
            </div>
            <div className="rounded-lg border p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Variação
              </p>
              <p className="text-3xl font-light tabular-nums flex items-center gap-2">
                {result.delta > 0 ? (
                  <ArrowUp className="h-6 w-6 text-destructive" />
                ) : result.delta < 0 ? (
                  <ArrowDown className="h-6 w-6 text-success" />
                ) : (
                  <Minus className="h-6 w-6 text-muted-foreground" />
                )}
                {result.delta.toFixed(1)}%
              </p>
            </div>
          </div>
        )}
        {result && result.months.length > 0 && (
          <div className="mt-6 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {result.months.map(([m, v]) => (
              <div key={m} className="rounded border p-3 text-center">
                <p className="text-xs text-muted-foreground">{fmtMonth(m)}</p>
                <p className="text-sm font-medium tabular-nums mt-1">{formatBRL(v)}</p>
              </div>
            ))}
          </div>
        )}

        {breakdown && breakdown.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold mb-3">Projeção por tipo de procedimento</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Total histórico (6m)</TableHead>
                    <TableHead className="text-right">% do total</TableHead>
                    <TableHead className="text-right">Projeção estimada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.map((b) => (
                    <TableRow key={b.cat}>
                      <TableCell className="font-medium">{b.cat}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(b.val)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {b.pct.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(b.proj)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};
