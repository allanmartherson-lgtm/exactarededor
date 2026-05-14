import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

interface ProcessingJob {
  id: string;
  payment_id: string;
  total_companies: number;
  processed_companies: number;
  status: "em_andamento" | "concluido" | "parcial" | "cancelado";
  failed_companies: Array<{ company_name: string; error: string; at: string }>;
  company_list: string[] | null;
  total_items: number | null;
  started_at: string;
  finished_at: string | null;
}

export function AnalysisProgressBar({ paymentId }: { paymentId: string }) {
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("payment_processing_jobs")
        .select("*")
        .eq("payment_id", paymentId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mounted) setJob(data as any);
    };
    load();

    const channel = supabase
      .channel(`ppj-${paymentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_processing_jobs", filter: `payment_id=eq.${paymentId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const newJob = payload.new as ProcessingJob;
          
          // Se o status mudou para concluído, parcial ou cancelado, dispara o toast
          if (job && job.status === "em_andamento" && (newJob.status === "concluido" || newJob.status === "parcial" || newJob.status === "cancelado")) {
            const successCount = newJob.processed_companies - (newJob.failed_companies?.length ?? 0);
            const failCount = newJob.failed_companies?.length ?? 0;
            
            if (newJob.status === "concluido") {
              toast.success(`Análise concluída: ${successCount} empresa(s) processada(s) com sucesso.`);
            } else if (newJob.status === "parcial") {
              toast.warning(`Análise finalizada com erros: ${successCount} sucesso(s), ${failCount} falha(s).`);
            } else if (newJob.status === "cancelado") {
              toast.info(`Análise interrompida pelo usuário: ${newJob.processed_companies} empresa(s) processada(s).`);
            }
          }
          
          setJob(newJob as any);
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [paymentId, job?.id, job?.status]);

  if (!job) return null;

  const pct = job.total_companies > 0 ? Math.round((job.processed_companies / job.total_companies) * 100) : 0;
  const failed = job.failed_companies?.length ?? 0;

  const retryFailed = async () => {
    if (!failed) return;
    setRetrying(true);
    try {
      const failedNames = job.failed_companies.map((f) => f.company_name);
      const { data, error } = await supabase.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: paymentId, only_companies: failedNames },
      });
      if (error) throw error;
      toast.success(`Reprocessamento iniciado: ${data?.total_companies ?? 0} empresa(s).`);
    } catch (e: any) {
      toast.error(`Falha ao reprocessar: ${e?.message ?? e}`);
    } finally {
      setRetrying(false);
    }
  };
  
  const cancelJob = async () => {
    if (!job || job.status !== "em_andamento") return;
    
    // Confirmação dupla para evitar cliques acidentais
    const confirmed = window.confirm(
      "Tem certeza que deseja cancelar a reanálise em andamento? " +
      "As empresas que já foram processadas manterão os novos valores, " +
      "mas o processamento das demais será interrompido imediatamente."
    );
    
    if (!confirmed) return;
    
    setCancelling(true);
    try {
      const { error } = await supabase
        .from("payment_processing_jobs")
        .update({ 
          status: "cancelado",
          finished_at: new Date().toISOString()
        })
        .eq("id", job.id);
        
      if (error) throw error;
      toast.success("Reanálise cancelada com sucesso.");
    } catch (e: any) {
      toast.error(`Falha ao cancelar: ${e?.message ?? e}`);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {job.status === "em_andamento" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {job.status === "concluido" && <CheckCircle2 className="h-4 w-4 text-success" />}
            {job.status === "parcial" && <AlertTriangle className="h-4 w-4 text-warning" />}
            {job.status === "cancelado" && <XCircle className="h-4 w-4 text-destructive" />}
            <span>
              {job.status === "em_andamento" && `Analisando ${job.processed_companies}/${job.total_companies} empresas…`}
              {job.status === "concluido" && `Análise concluída — ${job.total_companies} empresa(s) processada(s).`}
              {job.status === "parcial" && `Análise parcial — ${failed} empresa(s) com erro.`}
              {job.status === "cancelado" && `Análise interrompida — processadas ${job.processed_companies} de ${job.total_companies}.`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{pct}%</Badge>
            {failed > 0 && (
              <Button size="sm" variant="outline" onClick={retryFailed} disabled={retrying}>
                {retrying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCcw className="h-3 w-3 mr-1" />}
                Reprocessar {failed} com falha
              </Button>
            )}
            {job.status === "em_andamento" && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8" onClick={cancelJob} disabled={cancelling}>
                {cancelling ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />}
                Cancelar reanálise
              </Button>
            )}
          </div>
        </div>
        <Progress value={pct} />
        {failed > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Ver empresas com erro ({failed})</summary>
            <ul className="mt-2 space-y-1">
              {job.failed_companies.slice(0, 10).map((f, i) => (
                <li key={i} className="truncate">
                  <span className="font-medium text-foreground">{f.company_name}:</span> {f.error}
                </li>
              ))}
              {failed > 10 && <li>…e mais {failed - 10}.</li>}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
