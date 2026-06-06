import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "react-router-dom";

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
    <div className={embedded ? "space-y-6" : "space-y-6 p-6"}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">Relatório de Pools</h1>
          <p className="text-muted-foreground text-sm">
            Histórico de execuções de cálculo de pools por competência.
          </p>
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Execuções</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totals.count}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Base total</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{brl(totals.base)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Deduções</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">−{brl(totals.deducoes)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Bolo líquido</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{brl(totals.bolo)}</div></CardContent></Card>
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
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">
                        {new Date(r.created_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>{poolName(r.pool_id)}</TableCell>
                      <TableCell>{pay?.competence_month ?? "—"}</TableCell>
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
