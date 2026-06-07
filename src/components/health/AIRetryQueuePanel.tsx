import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, XCircle, Clock, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  payment_id: string;
  company_name: string;
  attempts: number;
  max_attempts: number;
  status: "pending" | "processing" | "done" | "failed" | "cancelled";
  last_error: string | null;
  next_attempt_at: string;
  last_job_id: string | null;
  updated_at: string;
};

const STATUS_META: Record<
  Row["status"],
  { label: string; tone: string; icon: typeof Clock }
> = {
  pending: { label: "Aguardando", tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", icon: Clock },
  processing: { label: "Processando", tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", icon: Loader2 },
  done: { label: "Concluído", tone: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300", icon: CheckCircle2 },
  failed: { label: "Falhou", tone: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", icon: AlertTriangle },
  cancelled: { label: "Cancelado", tone: "bg-muted text-muted-foreground", icon: XCircle },
};

export default function AIRetryQueuePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_retry_queue")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);
    setRows(((data as Row[]) ?? []));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("ai_retry_queue_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_retry_queue" }, load)
      .subscribe();
    const t = setInterval(load, 30_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(t);
    };
  }, []);

  const runWorkerNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-retry-worker", {
        body: { batch_size: 5 },
      });
      if (error) throw error;
      const picked = (data as { picked?: number; succeeded?: number; failed?: number })?.picked ?? 0;
      if (picked === 0) toast.info("Nenhum item pendente no momento.");
      else toast.success(`Worker processou ${picked} item(ns).`);
      await load();
    } catch (e) {
      toast.error(`Falha ao acionar worker: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const forceRetry = async (id: string) => {
    const { error } = await supabase
      .from("ai_retry_queue")
      .update({ status: "pending", next_attempt_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Item recolocado na fila.");
      await load();
    }
  };

  const cancelItem = async (id: string) => {
    const { error } = await supabase
      .from("ai_retry_queue")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Item cancelado.");
      await load();
    }
  };

  const summary = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<Row["status"], number>,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Fila de reprocessamento da IA
            <Badge variant="outline">Aguardando: {summary.pending ?? 0}</Badge>
            <Badge variant="outline">Processando: {summary.processing ?? 0}</Badge>
            <Badge variant="outline">Falhou: {summary.failed ?? 0}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={runWorkerNow} disabled={running}>
              {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
              Executar worker agora
            </Button>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-6 text-center">
            Fila vazia. Empresas com falha na IA aparecem aqui automaticamente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2 pr-2">Empresa</th>
                  <th className="text-left py-2 pr-2">Status</th>
                  <th className="text-left py-2 pr-2">Tentativas</th>
                  <th className="text-left py-2 pr-2">Próxima</th>
                  <th className="text-left py-2 pr-2">Motivo</th>
                  <th className="text-right py-2 pl-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  const Icon = meta.icon;
                  return (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-2 max-w-[220px]">
                        <div className="font-medium truncate">{r.company_name}</div>
                        <a
                          href={`/pagamentos/${r.payment_id}`}
                          className="text-[10px] text-muted-foreground hover:underline"
                        >
                          {r.payment_id.slice(0, 8)}
                        </a>
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${meta.tone}`}>
                          <Icon className={`h-3 w-3 ${r.status === "processing" ? "animate-spin" : ""}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-mono">
                        {r.attempts}/{r.max_attempts}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">
                        {r.status === "pending"
                          ? new Date(r.next_attempt_at).toLocaleString("pt-BR")
                          : "—"}
                      </td>
                      <td className="py-2 pr-2 max-w-[320px] text-muted-foreground">
                        <div className="truncate" title={r.last_error ?? ""}>{r.last_error ?? "—"}</div>
                      </td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        {r.status === "failed" || r.status === "cancelled" ? (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => forceRetry(r.id)}>
                            Reenfileirar
                          </Button>
                        ) : r.status === "pending" ? (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive" onClick={() => cancelItem(r.id)}>
                            Cancelar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
