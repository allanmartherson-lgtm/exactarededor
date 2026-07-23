/**
 * Relatório de auditoria do KPI "Ajustes por intervenção".
 *
 * Para cada pagamento, lista TODOS os eventos que contribuíram para o KPI:
 *   - intervenção de diretor/validador (devolução / reprovação)
 *   - correção de valor pelo analista
 *   - cancelamento de empresa
 *   - cancelamento de item
 *
 * Mostra delta e valores brutos por evento e o saldo agregado por pagamento.
 * Alerta sobre possíveis duplicidades (mesmo item_id em mais de uma fonte).
 *
 * Reusa a RPC `get_intervention_savings` — que já exclui cancelamentos
 * reativados (`cancellation_reactivated_at IS NULL`) e evita dupla contagem
 * entre cancelamento de item e de empresa no mesmo período.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { useInterventionLedgerRealtime } from "@/hooks/useInterventionLedgerRealtime";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { AlertTriangle, ClipboardList, TrendingDown, TrendingUp } from "lucide-react";
import {
  classifyDelta,
  emptyResult,
  findDuplicateItemEvents,
  groupItemsForAudit,
  impactTone,
  roleLabel,
  summarizeItems,
  type InterventionSavingsResult,
} from "@/lib/interventionSavings";

type Range = 7 | 30 | 90 | 180;

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const sourceBadge = (role: string) => {
  switch (role) {
    case "diretor": return "bg-info/10 text-info border-info/30";
    case "validador": return "bg-primary/10 text-primary border-primary/30";
    case "analista": return "bg-warning/10 text-warning-text border-warning/30";
    case "cancelamento_empresa": return "bg-destructive/10 text-destructive border-destructive/30";
    case "cancelamento_item": return "bg-destructive/10 text-destructive border-destructive/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

export default function InterventionAudit() {
  const currentHospitalId = useActiveHospitalId();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InterventionSavingsResult>(emptyResult());
  const [search, setSearch] = useState("");

  const loadData = useCallback(async (showSkeleton: boolean) => {
    if (showSkeleton) setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - range * 24 * 3600 * 1000);
      const { data: res, error } = await supabase.rpc("get_intervention_savings", {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
        p_hospital_id: currentHospitalId ?? null,
      });
      if (error) throw error;
      setData((res as unknown as InterventionSavingsResult) ?? emptyResult());
    } catch (e) {
      console.error(e);
      toast.error("Falha ao carregar auditoria de intervenções");
      setData(emptyResult());
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, [range, currentHospitalId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await loadData(true); })();
    return () => { cancelled = true; };
  }, [loadData]);

  // Atualiza sem F5 quando o motor materializa novos eventos.
  useInterventionLedgerRealtime(currentHospitalId ?? null, () => {
    loadData(false);
  });

  const groups = useMemo(() => groupItemsForAudit(data.items), [data.items]);
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      g.payment_id.toLowerCase().includes(q) ||
      (g.company_name ?? "").toLowerCase().includes(q) ||
      g.eventos.some(e =>
        (e.doctor_name ?? "").toLowerCase().includes(q) ||
        (e.procedure_code ?? "").toLowerCase().includes(q) ||
        (e.procedure_name ?? "").toLowerCase().includes(q) ||
        (e.autor ?? "").toLowerCase().includes(q)
      )
    );
  }, [groups, search]);

  const totalSummary = useMemo(() => summarizeItems(data.items), [data.items]);
  const duplicates = useMemo(() => findDuplicateItemEvents(data.items), [data.items]);
  const tone = impactTone(totalSummary.saldo);

  // Quebra por fonte para os KPIs do topo.
  const bySource = useMemo(() => {
    const acc: Record<string, { qtd: number; saldo: number }> = {};
    for (const it of data.items) {
      const k = it.role;
      acc[k] = acc[k] ?? { qtd: 0, saldo: 0 };
      acc[k].qtd += 1;
      acc[k].saldo += it.delta;
    }
    return acc;
  }, [data.items]);

  return (
    <div>
      <PageHeader
        title="Auditoria de intervenções"
        description="Detalhe por pagamento de todos os eventos (ajustes, devoluções, cancelamentos) que alimentaram o KPI"
        icon={ClipboardList}
        showBack
      />
      <div className="p-4 md:p-6 space-y-4">
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Período</label>
              <Select value={String(range)} onValueChange={(v) => setRange(Number(v) as Range)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7d</SelectItem>
                  <SelectItem value="30">Últimos 30d</SelectItem>
                  <SelectItem value="90">Últimos 90d</SelectItem>
                  <SelectItem value="180">Últimos 180d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground">Buscar (pagamento, empresa, médico, procedimento)</label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex: Acme, Darcy, 31309096" />
            </div>
          </CardContent>
        </Card>

        {/* Resumo por fonte */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <KpiCard
            label="Saldo total"
            value={loading ? <Skeleton className="h-8 w-32" /> : formatCurrency(totalSummary.saldo)}
            hint={`${totalSummary.qtd_itens} eventos`}
            tone={tone === "positive" ? "success" : tone === "negative" ? "danger" : "default"}
          />
          {(["diretor","validador","analista","cancelamento_empresa","cancelamento_item"] as const).map((r) => {
            const s = bySource[r] ?? { qtd: 0, saldo: 0 };
            return (
              <KpiCard
                key={r}
                label={roleLabel(r)}
                value={loading ? <Skeleton className="h-8 w-24" /> : formatCurrency(s.saldo)}
                hint={`${s.qtd} eventos`}
                tone={s.saldo > 0 ? "success" : s.saldo < 0 ? "danger" : "default"}
              />
            );
          })}
        </div>

        {duplicates.length > 0 && (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-2 text-warning-text">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <strong>{duplicates.length}</strong> item(ns) contabilizados por mais de uma fonte —
              revisar para garantir que não há dupla contagem no KPI. IDs:{" "}
              <span className="font-mono text-xs">
                {duplicates.slice(0, 5).map(d => d.item_id).join(", ")}
                {duplicates.length > 5 ? " …" : ""}
              </span>
            </div>
          </div>
        )}

        {/* Tabela por pagamento */}
        <Card className="shadow-card">
          <CardHeader><CardTitle>Eventos por pagamento</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? (
              <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : filteredGroups.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Nenhum evento no período.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pagamento / Empresa</TableHead>
                    <TableHead>Fonte</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Médico / Procedimento</TableHead>
                    <TableHead className="text-right">Valor regra</TableHead>
                    <TableHead className="text-right">Valor pago</TableHead>
                    <TableHead className="text-right">Δ</TableHead>
                    <TableHead>Classif.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((g) => (
                    <>
                      <TableRow key={`${g.payment_id}-hdr`} className="bg-muted/40">
                        <TableCell colSpan={7}>
                          <Link to={`/pagamentos/${g.payment_id}`} className="font-mono text-xs text-primary hover:underline">
                            {g.payment_id.slice(0, 8)}…
                          </Link>
                          <span className="ml-2 text-sm">{g.company_name ?? "—"}</span>
                          <span className="ml-3 text-xs text-muted-foreground">{g.qtd_eventos} eventos</span>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          <span className={g.saldo > 0 ? "text-emerald-700" : g.saldo < 0 ? "text-red-700" : ""}>
                            {formatCurrency(g.saldo)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {g.saldo > 0 ? <TrendingUp className="h-4 w-4 text-emerald-700" /> :
                           g.saldo < 0 ? <TrendingDown className="h-4 w-4 text-red-700" /> : null}
                        </TableCell>
                      </TableRow>
                      {g.eventos.map((e) => {
                        const c = classifyDelta(e.delta);
                        return (
                          <TableRow key={`${g.payment_id}-${e.obs_id}-${e.item_id}`}>
                            <TableCell className="pl-8 text-xs text-muted-foreground font-mono">{e.item_id.slice(0, 8)}…</TableCell>
                            <TableCell>
                              <Badge className={sourceBadge(e.role)} variant="outline">{roleLabel(e.role)}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{e.autor}</TableCell>
                            <TableCell className="text-xs">{fmtDate(e.acatado_at || e.obs_at)}</TableCell>
                            <TableCell className="text-xs">
                              <div>{e.doctor_name ?? "—"}</div>
                              <div className="text-muted-foreground">
                                {[e.procedure_code, e.procedure_name].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(e.valor_regra)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(e.valor_pago_final)}</TableCell>
                            <TableCell className={`text-right tabular-nums font-medium ${e.delta > 0 ? "text-emerald-700" : e.delta < 0 ? "text-red-700" : ""}`}>
                              {formatCurrency(e.delta)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={c === "economia" ? "border-emerald-300 text-emerald-700" :
                                           c === "aumento"  ? "border-red-300 text-red-700" :
                                                              "border-muted text-muted-foreground"}
                              >
                                {c}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
