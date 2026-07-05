import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "react-router-dom";
import { KpiCard } from "@/components/ui/KpiCard";
import { AlertTriangle } from "lucide-react";
import { formatCompetenceBR } from "@/lib/dateUtils";

type Run = {
  id: string;
  payment_id: string;
  pool_id: string;
  base_amount: number;
  bolo_liquido: number;
  deductions_applied: any;
  quotas: any;
  snapshot: any;
  created_at: string;
  competence_month: string | null;
  captured_item_ids: string[] | null;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  error_detail: any;
};

type Pool = { id: string; nome: string };
type Payment = { id: string; reference: string | null; competence_month: string | null };

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PoolsReport({ embedded = false }: { embedded?: boolean } = {}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [payments, setPayments] = useState<Record<string, Payment>>({});
  const [poolFilter, setPoolFilter] = useState<string>("__all__");
  const [compFilter, setCompFilter] = useState<string>("__all__");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: rs }, { data: ps }] = await Promise.all([
        supabase
          .from("pool_calculation_runs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("pools").select("id, nome").order("nome"),
      ]);
      setRuns((rs ?? []) as any);
      setPools((ps ?? []) as any);
      const payIds = Array.from(new Set((rs ?? []).map((r: any) => r.payment_id)));
      if (payIds.length) {
        const { data: pays } = await supabase
          .from("payments")
          .select("id, reference, competence_month")
          .in("id", payIds);
        const map: Record<string, Payment> = {};
        for (const p of pays ?? []) map[p.id] = p as Payment;
        setPayments(map);
      }
      setLoading(false);
    })();
  }, []);

  const competencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      const c = payments[r.payment_id]?.competence_month;
      if (c) set.add(c);
    }
    return Array.from(set).sort().reverse();
  }, [runs, payments]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (poolFilter !== "__all__" && r.pool_id !== poolFilter) return false;
      if (compFilter !== "__all__" && payments[r.payment_id]?.competence_month !== compFilter) return false;
      return true;
    });
  }, [runs, poolFilter, compFilter, payments]);

  const totals = useMemo(() => {
    let base = 0, bolo = 0;
    for (const r of filtered) {
      base += Number(r.base_amount ?? 0);
      bolo += Number(r.bolo_liquido ?? 0);
    }
    return { base, bolo, deducoes: base - bolo, count: filtered.length };
  }, [filtered]);

  const poolName = (id: string) => pools.find((p) => p.id === id)?.nome ?? id.slice(0, 8);

  return (
    <div className={embedded ? "space-y-6" : "space-y-6"}>
      {!embedded && (
        <PageHeader
          title="Relatório de Pools"
          description="Histórico de execuções de cálculo de pools por competência."
        />
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="w-64">
          <Select value={poolFilter} onValueChange={setPoolFilter}>
            <SelectTrigger><SelectValue placeholder="Pool" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os pools</SelectItem>
              {pools.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={compFilter} onValueChange={setCompFilter}>
            <SelectTrigger><SelectValue placeholder="Competência" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas competências</SelectItem>
              {competencies.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Execuções" value={totals.count} tone="default" />
        <KpiCard label="Base total" value={brl(totals.base)} tone="default" />
        <KpiCard label="Deduções" value={`−${brl(totals.deducoes)}`} tone="danger" />
        <KpiCard label="Bolo líquido" value={brl(totals.bolo)} tone="success" />
      </div>

      <Card>
        <CardHeader><CardTitle>Execuções</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução encontrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Pool</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Bolo líquido</TableHead>
                  <TableHead>Participantes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const pay = payments[r.payment_id];
                  const quotas = Array.isArray(r.quotas) ? r.quotas : [];
                  return (
                    <TableRow key={r.id} className={r.invalidated_at ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs">
                        {new Date(r.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{poolName(r.pool_id)}</span>
                          {r.invalidated_at && (
                            <Badge variant="destructive" className="gap-1 w-fit">
                              <AlertTriangle className="w-3 h-3" />
                              {r.invalidated_reason ?? "Invalidado"}
                            </Badge>
                          )}
                          {Array.isArray(r.captured_item_ids) && r.captured_item_ids.length > 0 && (
                            <Badge variant="outline" className="w-fit text-xs">
                              {r.captured_item_ids.length} itens capturados
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{r.competence_month ?? pay?.competence_month ?? "—"}</TableCell>
                      <TableCell>
                        <Link className="underline text-primary" to={`/pagamentos/${r.payment_id}`}>
                          {pay?.reference ?? r.payment_id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{brl(Number(r.base_amount))}</TableCell>
                      <TableCell className="text-right font-medium">{brl(Number(r.bolo_liquido))}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {quotas.map((q: any, i: number) => (
                            <Badge key={i} variant={q.paga ? "default" : "secondary"}>
                              {q.percentual}% {q.paga ? "" : "(retido)"} {brl(Number(q.quota))}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
