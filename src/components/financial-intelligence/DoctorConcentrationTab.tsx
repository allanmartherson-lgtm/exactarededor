import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Users } from "lucide-react";
import { formatBRL } from "@/lib/financialStats";
import type { TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

interface ItemRow {
  payment_id: string;
  doctor_name: string;
  gross_amount: number;
  payments?: { reference: string | null; title: string | null; status: string } | null;
}

interface Concentration {
  payment_id: string;
  reference: string;
  doctor_name: string;
  amount: number;
  total: number;
  pct: number;
}

type Level = "alta" | "moderada" | "normal";

const classify = (pct: number): Level => (pct > 30 ? "alta" : pct >= 15 ? "moderada" : "normal");

const badgeFor = (level: Level) => {
  if (level === "alta") return { variant: "destructive" as const, label: "Alta" };
  if (level === "moderada")
    return {
      variant: "outline" as const,
      label: "Moderada",
      className: "border-amber-500 text-amber-700 bg-amber-50",
    };
  return {
    variant: "outline" as const,
    label: "Normal",
    className: "border-muted-foreground/30 text-muted-foreground",
  };
};

export const DoctorConcentrationTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [rows, setRows] = useState<ItemRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      let q = supabase
        .from("payment_items")
        .select("payment_id,doctor_name,gross_amount,payments!inner(reference,title,status,payment_track,competence_month)")
        .gt("gross_amount", 0)
        .gte("payments.competence_month", cutoffDate)
        .not("payments.status", "in", '("rascunho","cancelado","rejeitado")');
      if (track === "habitual" || track === "prioritario") {
        q = q.eq("payments.payment_track", track);
      } else if (track === "nao_classificado") {
        q = q.is("payments.payment_track", null);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error("[DoctorConcentrationTab] load error", error);
        setRows([]);
        return;
      }
      setRows((data as unknown as ItemRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [track]);

  const { concentrations, summary } = useMemo(() => {
    if (!rows) return { concentrations: [] as Concentration[], summary: null as null | { alta: number; avgTopPct: number; lotes: number } };
    const totals = new Map<string, number>();
    const refMap = new Map<string, string>();
    const perDoctor = new Map<string, number>();
    for (const r of rows) {
      const v = Number(r.gross_amount);
      totals.set(r.payment_id, (totals.get(r.payment_id) ?? 0) + v);
      refMap.set(r.payment_id, r.payments?.reference ?? r.payments?.title ?? "Sem referência");
      const k = `${r.payment_id}|||${r.doctor_name}`;
      perDoctor.set(k, (perDoctor.get(k) ?? 0) + v);
    }
    const all: Concentration[] = [];
    const topPerPayment = new Map<string, number>();
    for (const [k, amount] of perDoctor) {
      const [paymentId, doctor] = k.split("|||");
      const total = totals.get(paymentId) ?? 0;
      if (total <= 0) continue;
      const pct = (amount / total) * 100;
      all.push({
        payment_id: paymentId,
        reference: refMap.get(paymentId) ?? "Sem referência",
        doctor_name: doctor,
        amount,
        total,
        pct,
      });
      const prev = topPerPayment.get(paymentId) ?? 0;
      if (pct > prev) topPerPayment.set(paymentId, pct);
    }
    all.sort((a, b) => b.pct - a.pct);
    const topPcts = Array.from(topPerPayment.values());
    const avgTopPct = topPcts.length ? topPcts.reduce((a, b) => a + b, 0) / topPcts.length : 0;
    const alta = all.filter((c) => c.pct > 30).length;
    return {
      concentrations: all,
      summary: { alta, avgTopPct, lotes: totals.size },
    };
  }, [rows]);

  const topList = concentrations.slice(0, 20);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Concentração por médico"
        icon={Users}
        iconColor="red"
        subtitle="Distribuição de concentração por médico nos lotes — últimos 6 meses"
      />
      <div className="p-4 space-y-4">
        {!rows ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Concentração &gt; 30%</div>
                <div className="text-2xl font-semibold mt-1 flex items-center gap-2">
                  {summary?.alta ?? 0}
                  {(summary?.alta ?? 0) > 0 && <Badge variant="destructive">Alta</Badge>}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Concentração média</div>
                <div className="text-2xl font-semibold mt-1 tabular-nums">
                  {(summary?.avgTopPct ?? 0).toFixed(1)}%
                </div>
                <div className="text-[11px] text-muted-foreground">% do top médico por lote</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Lotes analisados</div>
                <div className="text-2xl font-semibold mt-1 tabular-nums">{summary?.lotes ?? 0}</div>
              </div>
            </div>

            {topList.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">
                Nenhum dado de concentração encontrado nos últimos 6 meses.
              </p>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lote</TableHead>
                        <TableHead>Médico</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Total lote</TableHead>
                        <TableHead className="text-right">% do lote</TableHead>
                        <TableHead className="text-right">Nível</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topList.map((c) => {
                        const b = badgeFor(classify(c.pct));
                        return (
                          <TableRow key={`${c.payment_id}-${c.doctor_name}`}>
                            <TableCell>
                              <Link to={`/pagamentos/${c.payment_id}`} className="text-primary hover:underline font-medium">
                                {c.reference}
                              </Link>
                            </TableCell>
                            <TableCell>{c.doctor_name}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatBRL(c.amount)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatBRL(c.total)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{c.pct.toFixed(1)}%</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={b.variant} className={b.className}>
                                {b.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Exibindo top {topList.length} de {concentrations.length} concentrações — ordenadas por % decrescente.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </SurfaceCard>
  );
};
