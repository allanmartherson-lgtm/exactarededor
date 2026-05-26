import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, RefreshCw, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Run = {
  id: string;
  pool_id: string;
  base_amount: number;
  bolo_liquido: number;
  deductions_applied: any;
  quotas: any;
  snapshot: any;
  created_at: string;
};

type PoolInfo = { id: string; nome: string; base_calculo: string };

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PoolCalculationCard({ paymentId }: { paymentId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [poolMap, setPoolMap] = useState<Record<string, PoolInfo>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pool_calculation_runs")
      .select("*")
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: false });
    const list = (data as Run[]) ?? [];
    setRuns(list);
    if (list.length > 0) {
      const ids = Array.from(new Set(list.map(r => r.pool_id)));
      const { data: pools } = await supabase
        .from("pools").select("id, nome, base_calculo").in("id", ids);
      const map: Record<string, PoolInfo> = {};
      (pools ?? []).forEach((p: any) => { map[p.id] = p; });
      setPoolMap(map);
    }
    setLoading(false);
  }, [paymentId]);

  useEffect(() => { load(); }, [load]);

  const recalc = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("recalc-payment-pools", {
        body: { payment_id: paymentId },
      });
      if (error) throw error;
      const n = data?.pools_processed ?? 0;
      toast({
        title: n > 0 ? `Pool recalculado` : "Nenhum pool aplicável",
        description: n > 0
          ? `${n} pool(s) processado(s). Totais das empresas atualizados.`
          : "Nenhuma empresa deste pagamento participa de pool ativo vigente.",
      });
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao recalcular pool", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Calculator className="h-4 w-4" />
          Cálculo de pool de rateio
          {runs.length > 0 && <Badge variant="secondary">{runs.length}</Badge>}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={recalc} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
          {runs.length === 0 ? "Aplicar pool" : "Recalcular"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Nenhum pool aplicado. Clique em "Aplicar pool" para verificar se as empresas
            deste pagamento participam de pools cadastrados.
          </p>
        ) : (
          runs.map(run => {
            const pool = poolMap[run.pool_id];
            const deds = Array.isArray(run.deductions_applied) ? run.deductions_applied : [];
            const quotas = Array.isArray(run.quotas) ? run.quotas : [];
            return (
              <div key={run.id} className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{pool?.nome ?? "Pool"}</span>
                  <span className="text-xs text-muted-foreground">
                    base: {pool?.base_calculo}
                  </span>
                </div>
                <div className="text-sm space-y-1 font-mono">
                  <div className="flex justify-between">
                    <span>Base ({pool?.base_calculo ?? "—"})</span>
                    <span>{brl(run.base_amount)}</span>
                  </div>
                  {deds.map((d: any, i: number) => (
                    <div key={i} className="flex justify-between text-destructive">
                      <span>(−) {d.descricao}</span>
                      <span>−{brl(d.valor)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>Bolo líquido</span>
                    <span>{brl(run.bolo_liquido)}</span>
                  </div>
                </div>
                <div className="text-xs space-y-1 pt-2 border-t">
                  <div className="text-muted-foreground mb-1">Rateio:</div>
                  {quotas.map((q: any, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span className="flex items-center gap-1.5">
                        {q.participant_type === "hospital_nao_paga" ? (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            retido
                          </Badge>
                        ) : null}
                        Participante {q.percentual}%
                        {q.participant_type === "hospital_nao_paga" && " — hospital"}
                      </span>
                      <span className={q.paga ? "font-medium" : "text-muted-foreground line-through"}>
                        {brl(q.quota)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-muted-foreground pt-1">
                  Executado em {new Date(run.created_at).toLocaleString("pt-BR")}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
