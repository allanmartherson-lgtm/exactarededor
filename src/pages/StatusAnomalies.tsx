import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

type Anomaly = {
  id: string;
  payment_id: string;
  status_from: PaymentStatus | null;
  status_to: PaymentStatus | null;
  kind: string;
  severity: string;
  reason: string;
  context: any;
  triggered_by: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

const SEVERITY_BADGE: Record<string, string> = {
  critica: "bg-destructive text-destructive-foreground",
  alta: "bg-destructive-soft text-destructive border-destructive/30",
  media: "bg-warning-soft text-warning-foreground border-warning/30",
  baixa: "bg-muted text-muted-foreground",
};

const KIND_LABEL: Record<string, string> = {
  invalid_transition: "Transição inválida",
  out_of_sync: "Status fora de sincronia",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

const StatusAnomalies = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("status_anomalies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    const list = (data ?? []) as Anomaly[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.payment_id)));
    if (ids.length) {
      const { data: pays } = await supabase.from("payments").select("id,reference").in("id", ids);
      const m: Record<string, string> = {};
      (pays ?? []).forEach((p: any) => { m[p.id] = p.reference; });
      setRefs(m);
    }
    setLoading(false);
  };

  useEffect(() => {
    document.title = "Anomalias de status | MedPay Approval";
    load();
    // Realtime: novos incidentes aparecem ao vivo + toast.
    const ch = supabase
      .channel("status_anomalies_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "status_anomalies" },
        (payload) => {
          const a = payload.new as Anomaly;
          setRows((prev) => [a, ...prev]);
          toast.error(`Anomalia detectada: ${KIND_LABEL[a.kind] ?? a.kind}`, {
            description: a.reason,
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "open") return rows.filter((r) => !r.resolved_at);
    if (filter === "resolved") return rows.filter((r) => r.resolved_at);
    return rows;
  }, [rows, filter]);

  const openCount = rows.filter((r) => !r.resolved_at).length;
  const [recomputing, setRecomputing] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const recompute = async (a: Anomaly, opts: { autoResolve?: boolean } = {}) => {
    setRecomputing((p) => new Set(p).add(a.id));
    const { error } = await supabase.rpc("recompute_payment_status_from_groups", {
      _payment_id: a.payment_id,
    });
    setRecomputing((p) => { const n = new Set(p); n.delete(a.id); return n; });
    if (error) {
      toast.error("Falha ao recalcular status", { description: error.message });
      return false;
    }
    if (opts.autoResolve && user) {
      await supabase.from("status_anomalies").update({
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        resolution_note: "Status recalculado a partir dos grupos (recompute manual).",
      }).eq("id", a.id);
      setRows((prev) => prev.map((r) =>
        r.id === a.id ? { ...r, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_note: "Status recalculado a partir dos grupos (recompute manual)." } : r,
      ));
    }
    toast.success("Status recalculado com sucesso");
    return true;
  };

  const recomputeAllOpen = async () => {
    const open = rows.filter((r) => !r.resolved_at);
    if (open.length === 0) return;
    setBulkBusy(true);
    let ok = 0; let fail = 0;
    const uniquePayments = Array.from(new Set(open.map((r) => r.payment_id)));
    for (const pid of uniquePayments) {
      const { error } = await supabase.rpc("recompute_payment_status_from_groups", { _payment_id: pid });
      if (error) fail++; else ok++;
    }
    if (user) {
      const ids = open.map((r) => r.id);
      await supabase.from("status_anomalies").update({
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        resolution_note: "Status recalculado em lote a partir dos grupos.",
      }).in("id", ids);
    }
    setBulkBusy(false);
    toast.success(`Recompute concluído: ${ok} ok, ${fail} falhas`);
    load();
  };

  const resolve = async (a: Anomaly) => {
    if (!user) return;
    const note = noteById[a.id]?.trim() ?? "";
    const { error } = await supabase
      .from("status_anomalies")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        resolution_note: note || null,
      })
      .eq("id", a.id);
    if (error) {
      toast.error("Falha ao marcar como resolvido", { description: error.message });
      return;
    }
    toast.success("Anomalia marcada como resolvida");
    setRows((prev) => prev.map((r) =>
      r.id === a.id ? { ...r, resolved_at: new Date().toISOString(), resolved_by: user.id, resolution_note: note || null } : r,
    ));
  };

  return (
    <>
      <PageHeader
        title="Anomalias de status"
        description="Pagamentos cuja transição de status fugiu do fluxo permitido ou ficou dessincronizada com os grupos."
      />
      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1 px-2 py-1">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span className="font-medium">{openCount}</span> em aberto
          </Badge>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Apenas em aberto</SelectItem>
              <SelectItem value="resolved">Resolvidas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}>Recarregar</Button>
        </div>

        {loading ? (
          <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Nenhuma anomalia.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((a) => (
              <Card key={a.id} className={cn("shadow-card", !a.resolved_at && "border-destructive/30")}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start gap-2 justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={cn("font-medium", SEVERITY_BADGE[a.severity] ?? "")}>
                          {a.severity.toUpperCase()}
                        </Badge>
                        <Badge variant="outline">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                        {a.resolved_at && (
                          <Badge variant="outline" className="gap-1 text-success">
                            <CheckCircle2 className="h-3 w-3" /> Resolvida
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{fmt(a.created_at)}</span>
                      </div>
                      <p className="text-sm">{a.reason}</p>
                      <div className="text-xs text-muted-foreground">
                        Lote:{" "}
                        <Link to={`/pagamentos/${a.payment_id}`} className="underline hover:text-foreground inline-flex items-center gap-1">
                          {refs[a.payment_id] ?? a.payment_id.slice(0, 8)}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        {a.status_from && a.status_to && (
                          <>
                            {" · "}
                            <span className="font-mono">
                              {PAYMENT_STATUS_LABELS[a.status_from] ?? a.status_from}
                              {" → "}
                              {PAYMENT_STATUS_LABELS[a.status_to] ?? a.status_to}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {a.context && Object.keys(a.context).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Contexto técnico
                      </summary>
                      <pre className="mt-2 p-2 rounded bg-muted/40 overflow-auto">
                        {JSON.stringify(a.context, null, 2)}
                      </pre>
                    </details>
                  )}

                  {a.resolved_at ? (
                    a.resolution_note && (
                      <p className="text-xs text-muted-foreground border-l-2 pl-2">
                        Nota: {a.resolution_note}
                      </p>
                    )
                  ) : (
                    <div className="flex items-end gap-2">
                      <Textarea
                        placeholder="Nota de resolução (opcional)…"
                        value={noteById[a.id] ?? ""}
                        onChange={(e) => setNoteById((p) => ({ ...p, [a.id]: e.target.value }))}
                        rows={2}
                        className="text-xs"
                      />
                      <Button size="sm" onClick={() => resolve(a)}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar resolvida
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default StatusAnomalies;
