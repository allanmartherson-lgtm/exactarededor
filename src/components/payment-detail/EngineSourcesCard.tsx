import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, RefreshCw, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type EngineSourceRow = {
  source: string;
  read_at: string | null;
  applicable: boolean;
  applied_count: number;
  total_value: number;
};

const LABELS: Record<string, string> = {
  rules: "Regras de repasse",
  payout_model: "Modelo de remuneração",
  pool_deductions: "Pool e deduções fixas",
  company_adjustments: "Débitos/créditos manuais",
  glosa_debts: "Glosas (médico → PJ)",
  minimum_guarantee: "Garantia mínima",
  retroactive_reconciliation: "Conciliação retroativa",
  special_case_marks: "Casos especiais",
};

const ORDER = [
  "rules",
  "payout_model",
  "pool_deductions",
  "company_adjustments",
  "glosa_debts",
  "minimum_guarantee",
  "retroactive_reconciliation",
  "special_case_marks",
];

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

export function EngineSourcesCard({ paymentId }: { paymentId: string }) {
  const [rows, setRows] = useState<EngineSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("payment_engine_sources" as never)
      .select("source, read_at, applicable, applied_count, total_value")
      .eq("payment_id", paymentId);
    if (!error) setRows((data as unknown as EngineSourceRow[]) ?? []);
    setLoading(false);
  }, [paymentId]);

  useEffect(() => {
    setLoading(true);
    void load();
    // Realtime: qualquer mudança na tabela atualiza
    const ch = supabase
      .channel(`engine-sources-${paymentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_engine_sources", filter: `payment_id=eq.${paymentId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [paymentId, load]);

  const force = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("finalize-payment-engine", {
        body: { payment_id: paymentId, force: true },
      });
      if (error) throw error;
      toast.success("Motor reexecutou todas as fontes");
      await load();
    } catch (e: any) {
      toast.error("Falha ao forçar releitura", { description: e?.message });
    } finally {
      setRefreshing(false);
    }
  };

  const byKey = new Map(rows.map((r) => [r.source, r]));
  const applicable = ORDER.filter((k) => {
    const r = byKey.get(k);
    return r ? r.applicable : true; // mostra todas se ainda não inicializado
  });
  const pending = applicable.filter((k) => {
    const r = byKey.get(k);
    return r && r.applicable && !r.read_at;
  });
  const ready = applicable.length > 0 && pending.length === 0 && rows.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {ready ? (
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-600" />
            )}
            Fontes lidas pelo motor
            {ready ? (
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
                completo
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                {pending.length} pendente{pending.length === 1 ? "" : "s"}
              </Badge>
            )}
          </span>
          <Button size="sm" variant="outline" onClick={force} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
            )}
            Forçar releitura
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          applicable.map((k) => {
            const r = byKey.get(k);
            const done = !!(r && r.read_at);
            return (
              <div key={k} className="flex items-center gap-2 text-sm">
                {done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span className="flex-1 min-w-0">{LABELS[k] ?? k}</span>
                {done ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {fmtTime(r!.read_at!)}
                    {r!.applied_count > 0 ? ` · ${r!.applied_count}` : ""}
                    {Number(r!.total_value) > 0 ? ` · ${brl(Number(r!.total_value))}` : ""}
                  </span>
                ) : (
                  <span className="text-xs text-amber-600">pendente</span>
                )}
              </div>
            );
          })
        )}
        {!loading && !ready && (
          <p className="text-[11px] text-muted-foreground pt-2 border-t border-border mt-2">
            O motor só considera o cálculo final quando todas as fontes aplicáveis estiverem lidas.
            Cadastros novos em /financeiro/creditos-debitos, pools ou regras invalidam automaticamente as fontes afetadas.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
