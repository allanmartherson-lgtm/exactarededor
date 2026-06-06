import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { BarChart2 } from "lucide-react";
import { median, formatBRL } from "@/lib/financialStats";

interface Row {
  specialty: string;
  procedure_code: string;
  procedure_name: string;
  company_name: string;
  gross_amount: number;
  created_at: string;
}

interface CompanyStat {
  company_name: string;
  median: number;
  min: number;
  max: number;
  n: number;
  isOutlier: boolean;
}

interface ProcedureGroup {
  key: string;
  specialty: string;
  procedure_code: string;
  procedure_name: string;
  groupMedian: number;
  groupMax: number;
  totalN: number;
  companies: CompanyStat[];
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

  const groups = useMemo<ProcedureGroup[]>(() => {
    if (!rows) return [];
    // Agrupa por procedimento (especialidade ||| procedure_code)
    const procMap = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.specialty}|||${r.procedure_code}`;
      (procMap.get(key) ?? procMap.set(key, []).get(key)!).push(r);
    }

    const out: ProcedureGroup[] = [];
    for (const [key, items] of procMap) {
      // Agrupa por empresa dentro do procedimento
      const byCompany = new Map<string, number[]>();
      for (const i of items) {
        const c = i.company_name ?? "—";
        (byCompany.get(c) ?? byCompany.set(c, []).get(c)!).push(Number(i.gross_amount));
      }

      const groupValues = items.map((i) => Number(i.gross_amount));
      const groupMedian = median(groupValues);
      const groupMax = Math.max(...groupValues);

      const companies: CompanyStat[] = [];
      for (const [company_name, values] of byCompany) {
        if (values.length < 3) continue;
        const med = median(values);
        companies.push({
          company_name,
          median: med,
          min: Math.min(...values),
          max: Math.max(...values),
          n: values.length,
          isOutlier: groupMedian > 0 && med > groupMedian * 1.5,
        });
      }

      if (companies.length < 2) continue;

      companies.sort((a, b) => b.median - a.median);
      const first = items[0];
      out.push({
        key,
        specialty: first.specialty,
        procedure_code: first.procedure_code,
        procedure_name: first.procedure_name ?? "—",
        groupMedian,
        groupMax,
        totalN: companies.reduce((acc, c) => acc + c.n, 0),
        companies,
      });
    }

    return out.sort((a, b) => b.companies.length - a.companies.length || b.totalN - a.totalN);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      if (
        g.specialty.toLowerCase().includes(q) ||
        g.procedure_code.toLowerCase().includes(q) ||
        g.procedure_name.toLowerCase().includes(q)
      )
        return true;
      return g.companies.some((c) => c.company_name.toLowerCase().includes(q));
    });
  }, [groups, filter]);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Benchmark de honorários"
        icon={BarChart2}
        iconColor="purple"
        subtitle="Comparação entre empresas para o mesmo procedimento (min ▸ mediana ▸ max)"
        rightAction={
          <Input
            placeholder="Filtrar especialidade, código, procedimento ou empresa…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-72"
          />
        }
      />
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-8 rounded bg-muted-foreground/30" />
            faixa min–max da empresa
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-foreground" />
            mediana da empresa
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-destructive" />
            mediana acima de 1,5× a mediana do grupo
          </span>
        </div>

        {!rows ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Sem amostras suficientes.</p>
        ) : (
          <div className="space-y-4">
            {filtered.slice(0, 100).map((g) => (
              <div key={g.key} className="rounded-md border bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b p-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {g.specialty}
                    </div>
                    <div className="text-sm font-medium">
                      <span className="tabular-nums text-muted-foreground mr-2">{g.procedure_code}</span>
                      {g.procedure_name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Mediana do grupo</div>
                    <div className="text-base font-semibold tabular-nums">{formatBRL(g.groupMedian)}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.companies.length} empresas · n {g.totalN}
                    </div>
                  </div>
                </div>

                <div className="divide-y">
                  {g.companies.map((c) => {
                    const scale = g.groupMax || 1;
                    const left = (c.min / scale) * 100;
                    const right = (c.max / scale) * 100;
                    const medPct = (c.median / scale) * 100;
                    return (
                      <div key={c.company_name} className="grid grid-cols-[1fr_auto] items-center gap-4 p-3">
                        <div className="min-w-0">
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                            <span className="truncate font-medium">
                              {c.company_name}
                              <span className="ml-1.5 text-muted-foreground">n={c.n}</span>
                            </span>
                            {c.isOutlier && (
                              <Badge variant="destructive" className="text-[10px]">
                                acima 1,5× mediana do grupo
                              </Badge>
                            )}
                          </div>
                          <div className="relative h-2.5 rounded bg-muted">
                            {/* faixa min-max */}
                            <div
                              className="absolute top-0 h-2.5 rounded bg-muted-foreground/30"
                              style={{ left: `${left}%`, width: `${Math.max(0.5, right - left)}%` }}
                            />
                            {/* mediana do grupo (linha guia) */}
                            <div
                              className="absolute -top-1 h-4 w-px bg-foreground/40"
                              style={{ left: `${(g.groupMedian / scale) * 100}%` }}
                              title={`Mediana do grupo: ${formatBRL(g.groupMedian)}`}
                            />
                            {/* mediana da empresa (ponto) */}
                            <div
                              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${
                                c.isOutlier ? "bg-destructive" : "bg-foreground"
                              }`}
                              style={{ left: `${medPct}%` }}
                              title={`Mediana ${c.company_name}: ${formatBRL(c.median)}`}
                            />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                            <span>{formatBRL(c.min)}</span>
                            <span>{formatBRL(c.max)}</span>
                          </div>
                        </div>
                        <div
                          className={`min-w-[110px] text-right text-sm font-semibold tabular-nums ${
                            c.isOutlier ? "text-destructive" : "text-foreground"
                          }`}
                        >
                          {formatBRL(c.median)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};
