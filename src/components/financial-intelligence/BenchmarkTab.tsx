import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { BarChart2 } from "lucide-react";
import { mean, median, formatBRL } from "@/lib/financialStats";

interface Row {
  specialty: string;
  procedure_code: string;
  procedure_name: string;
  company_name: string;
  gross_amount: number;
  created_at: string;
}

interface Bucket {
  key: string;
  specialty: string;
  procedure_code: string;
  procedure_name: string;
  company_name: string;
  values: number[];
  median: number;
  mean: number;
  min: number;
  max: number;
  n: number;
  hasOutlier: boolean;
}

export const BenchmarkTab = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("payment_items")
        .select("specialty,procedure_code,procedure_name,company_name,gross_amount,created_at")
        .not("specialty", "is", null)
        .not("procedure_code", "is", null)
        .gt("gross_amount", 0)
        .order("created_at", { ascending: false })
        .limit(5000);
      setRows((data as Row[]) ?? []);
    })();
  }, []);

  const buckets = useMemo<Bucket[]>(() => {
    if (!rows) return [];
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.specialty}|||${r.procedure_code}|||${r.company_name ?? ""}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    const out: Bucket[] = [];
    for (const [key, items] of map) {
      if (items.length < 3) continue;
      const values = items.map((i) => Number(i.gross_amount));
      const med = median(values);
      const latest = items[0];
      const sortedDesc = [...items].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      const recent = sortedDesc[0];
      out.push({
        key,
        specialty: latest.specialty,
        procedure_code: latest.procedure_code,
        procedure_name: latest.procedure_name ?? "—",
        company_name: latest.company_name ?? "—",
        values,
        median: med,
        mean: mean(values),
        min: Math.min(...values),
        max: Math.max(...values),
        n: values.length,
        hasOutlier: med > 0 && Number(recent.gross_amount) > med * 1.5,
      });
    }
    return out.sort((a, b) => b.n - a.n);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return buckets;
    return buckets.filter(
      (b) =>
        b.specialty.toLowerCase().includes(q) ||
        b.procedure_code.toLowerCase().includes(q) ||
        b.procedure_name.toLowerCase().includes(q) ||
        b.company_name.toLowerCase().includes(q),
    );
  }, [buckets, filter]);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Benchmark de honorários"
        icon={BarChart2}
        iconColor="purple"
        subtitle="Mediana, média e dispersão por especialidade × procedimento × empresa"
        rightAction={
          <Input
            placeholder="Filtrar especialidade, código, empresa…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-64"
          />
        }
      />
      <div className="p-4">
        {!rows ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Sem amostras suficientes.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Especialidade</TableHead>
                  <TableHead>Procedimento</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-right">Mediana</TableHead>
                  <TableHead className="text-right">Média</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead>Sinal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((b) => (
                  <TableRow key={b.key}>
                    <TableCell className="font-medium">{b.specialty}</TableCell>
                    <TableCell>
                      <div className="text-sm">{b.procedure_code}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[260px]">
                        {b.procedure_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{b.company_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(b.median)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(b.mean)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatBRL(b.min)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatBRL(b.max)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.n}</TableCell>
                    <TableCell>
                      {b.hasOutlier ? (
                        <Badge variant="destructive">acima 1,5× mediana</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">ok</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};
