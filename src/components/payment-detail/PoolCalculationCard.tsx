import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, RefreshCw, Info, AlertTriangle } from "lucide-react";
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
  competence_month: string | null;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  error_detail: any;
};

type PoolInfo = { id: string; nome: string; base_calculo: string };

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const INVALID_REASONS: Record<string, string> = {
  analise_pendente:
    "A análise de regras ainda não calculou os valores esperados. Dispare a análise antes do rateio.",
  valor_variavel_competencia_nao_cadastrado:
    "Falta cadastrar o valor de uma dedução variável para a competência deste lote.",
  item_duplicado_em_outro_pool:
    "Há itens deste lote já capturados por outro pool na mesma competência.",
  competencia_nao_definida_para_valor_variavel:
    "Lote sem competência definida — não é possível resolver deduções variáveis.",
};

const fmtComp = (iso: string | null) => {
  if (!iso) return "";
  const [y, m] = String(iso).slice(0, 10).split("-");
  return `${m}/${y}`;
};

export function PoolCalculationCard({ paymentId, onRecalculated }: { paymentId: string; onRecalculated?: () => void | Promise<void> }) {
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
    const all = (data as Run[]) ?? [];
    // Mostrar só a run vigente por pool_id (mais recente). Histórico fica no DB.
    const seen = new Set<string>();
    const list: Run[] = [];
    for (const r of all) {
      if (seen.has(r.pool_id)) continue;
      seen.add(r.pool_id);
      list.push(r);
    }
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
      const { count: pendingCount, error: pendingErr } = await supabase
        .from("payment_items")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", paymentId)
        .eq("is_pool_item", true)
        .eq("ai_status", "pendente");
      if (pendingErr) throw pendingErr;

      if ((pendingCount ?? 0) > 0) {
        const { data: dispatchData, error: dispatchErr } = await supabase.functions.invoke("dispatch-payment-analysis", {
          body: { payment_id: paymentId, force_fresh_rules: true },
        });
        if (dispatchErr) throw dispatchErr;
        toast({
          title: (dispatchData as any)?.already_running ? "Análise já em andamento" : "Análise enfileirada",
          description: (dispatchData as any)?.message ?? "O pool usa valor esperado; o rateio será aplicado depois que o motor calcular os itens.",
        });
        try { await onRecalculated?.(); } catch {}
        return;
      }

      const { data, error } = await supabase.functions.invoke("recalc-payment-pools", {
        body: { payment_id: paymentId },
      });
      if (error) throw error;
      if (data?.accepted) {
        toast({
          title: "Recálculo enfileirado",
          description: data.message ?? "O pool será recalculado em segundo plano. Atualize em instantes.",
        });
        try { await onRecalculated?.(); } catch {}
        return;
      }
      const n = data?.pools_processed ?? 0;
      const blocked = data?.blocked_count ?? 0;
      toast({
        title: blocked > 0 ? "Pool aguardando análise" : n > 0 ? `Pool recalculado` : "Nenhum pool aplicável",
        description: blocked > 0
          ? "Ainda há itens pendentes de cálculo. Clique novamente após a análise concluir."
          : n > 0
          ? `${n} pool(s) processado(s). Totais das empresas atualizados.`
          : "Nenhuma empresa deste pagamento participa de pool ativo vigente.",
        variant: blocked > 0 ? "destructive" : undefined,
      });
      await load();
      // Notifica todos os consumidores de financials (cards, totais, etc.)
      // para recarregarem os snapshots recém-recalculados — evita janela de
      // inconsistência entre tabela e cards.
      try {
        window.dispatchEvent(
          new CustomEvent("financials:invalidated", {
            detail: { payment_id: paymentId, reason: "pool_recalc" },
          }),
        );
      } catch {}
      try { await onRecalculated?.(); } catch {}
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
            const invalid = !!run.invalidated_at;
            const reasonMsg = run.invalidated_reason
              ? INVALID_REASONS[run.invalidated_reason] ?? run.invalidated_reason
              : null;
            const missingItems = Array.isArray(run.error_detail?.items) ? run.error_detail.items : [];
            return (
              <div
                key={run.id}
                className={`rounded-md border p-3 space-y-2 ${invalid ? "border-destructive/50 bg-destructive/5" : "bg-muted/30"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{pool?.nome ?? "Pool"}</span>
                  <span className="text-xs text-muted-foreground">
                    base: {pool?.base_calculo}
                  </span>
                </div>

                {invalid && (
                  <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs space-y-1.5">
                    <div className="flex items-start gap-1.5 font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>Pool não recalculado — {reasonMsg}</span>
                    </div>
                    {run.invalidated_reason === "valor_variavel_competencia_nao_cadastrado" && missingItems.length > 0 && (
                      <div className="pl-5 space-y-1">
                        <div className="text-muted-foreground">
                          Falta cadastrar para a competência <b>{fmtComp(run.competence_month)}</b>:
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {missingItems.map((it: any, k: number) => (
                            <li key={k}>{it.descricao}</li>
                          ))}
                        </ul>
                        <Button asChild size="sm" variant="outline" className="mt-1 h-7">
                          <Link to={`/pools/${run.pool_id}/valores-mensais`}>
                            Cadastrar valor mensal
                          </Link>
                        </Button>
                      </div>
                    )}
                    {run.invalidated_reason === "item_duplicado_em_outro_pool" && (
                      <div className="pl-5 text-muted-foreground">
                        {(run.error_detail?.conflicts ?? []).length} item(ns) já capturados por outro pool — abra a tela do pool conflitante para liberar.
                      </div>
                    )}
                  </div>
                )}

                {!invalid && (
                  <>
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
                      {quotas.map((q: any, i: number) => {
                        const isRetido = q.participant_type === "hospital_nao_paga";
                        return (
                          <div key={i} className="flex justify-between">
                            <span className="flex items-center gap-1.5">
                              {isRetido && (
                                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                  retido
                                </Badge>
                              )}
                              {isRetido
                                ? `Retenção do hospital (${q.percentual}%)`
                                : `Participante ${q.percentual}%`}
                            </span>
                            <span
                              className={
                                isRetido
                                  ? "text-muted-foreground italic"
                                  : "font-medium"
                              }
                              title={isRetido ? "Receita do hospital — não gera pagamento, fora da DRE de pagamento" : undefined}
                            >
                              {brl(q.quota)}
                              {isRetido && " · receita hosp."}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

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
