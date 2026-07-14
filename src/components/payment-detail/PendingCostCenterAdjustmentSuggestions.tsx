import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, Loader2, CheckCircle2, Network } from "lucide-react";
import { toast } from "sonner";

/**
 * Card âmbar exibido acima da "Composição financeira da empresa" quando existem
 * ajustes (créditos/débitos) cadastrados com filtro por centro de custos que
 * coincidam com o CC do lote — e ainda não foram aplicados nesta competência
 * neste mesmo CC.
 *
 * Regra:
 *  - Não lança automaticamente. Analista confirma cada linha.
 *  - Suprime sugestão se já houver aplicação (não revertida) para o mesmo
 *    (adjustment_id, competence_month, cost_center_code) em qualquer pagamento.
 *  - Após confirmar: insere em company_adjustment_applications e dispara
 *    apply-company-deductions para materializar/atualizar valores no lote.
 */

const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Candidate = {
  id: string;
  tipo: string;
  descricao: string;
  valor_total: number;
  parcelas_total: number;
  parcelas_pagas: number;
  recorrente: boolean;
  cost_center: { code_p12: string; level4: string | null; level5: string | null } | null;
};

export function PendingCostCenterAdjustmentSuggestions({
  paymentId,
  companyId,
  hospitalId,
  costCenterCode,
  competenceMonth,
  canEdit,
  onApplied,
}: {
  paymentId: string;
  companyId: string;
  hospitalId: string | null | undefined;
  costCenterCode: string | null | undefined;
  competenceMonth: string | null | undefined;
  canEdit: boolean;
  onApplied?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Candidate[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPending([]);
    try {
      if (!hospitalId || !companyId || !costCenterCode || !competenceMonth) return;

      // 1) Resolve cost_center_id a partir do code+hospital.
      const { data: ccRow } = await supabase
        .from("cost_centers")
        .select("id")
        .eq("code_p12", costCenterCode)
        .eq("hospital_id", hospitalId)
        .eq("active", true)
        .maybeSingle();
      const ccId = (ccRow as any)?.id as string | undefined;
      if (!ccId) return;

      // 2) Busca ajustes ativos vinculados a este CC + empresa + hospital,
      //    dentro da janela de vigência.
      const today = new Date().toISOString().slice(0, 10);
      const compEnd = competenceMonth.slice(0, 10); // usa a competência como corte
      const { data: adjs } = await supabase
        .from("company_financial_adjustments")
        .select("id, tipo, descricao, valor_total, parcelas_total, parcelas_pagas, recorrente, data_inicio, data_fim, cost_center:cost_centers(code_p12, level4, level5)")
        .eq("hospital_id", hospitalId)
        .eq("company_id", companyId)
        .eq("cost_center_id", ccId)
        .eq("ativo", true)
        .lte("data_inicio", today);
      const candidates = ((adjs as any[]) ?? []).filter((a) => {
        if (!a.data_fim) return true;
        return String(a.data_fim) >= compEnd;
      });
      if (candidates.length === 0) return;

      // 3) Suprime candidatos que já têm aplicação (não revertida) para a
      //    mesma competência + mesmo CC (em qualquer payment do hospital).
      const ids = candidates.map((c) => c.id);
      const { data: sameCompPayments } = await supabase
        .from("payments")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("competence_month", compEnd)
        .eq("cost_center_code", costCenterCode);
      const paymentIds = ((sameCompPayments as any[]) ?? []).map((p) => p.id);
      const suppressed = new Set<string>();
      if (paymentIds.length > 0) {
        const { data: apps } = await supabase
          .from("company_adjustment_applications")
          .select("adjustment_id")
          .in("adjustment_id", ids)
          .in("payment_id", paymentIds)
          .eq("hospital_id", hospitalId)
          .eq("company_id", companyId)
          .neq("status", "revertido");
        ((apps as any[]) ?? []).forEach((row) => suppressed.add(row.adjustment_id));
      }

      setPending(candidates.filter((c) => !suppressed.has(c.id)) as Candidate[]);
    } finally {
      setLoading(false);
    }
  }, [companyId, hospitalId, costCenterCode, competenceMonth]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async (adj: Candidate) => {
    if (!hospitalId) return;
    setConfirming(adj.id);
    try {
      const parcelaValor = adj.recorrente
        ? Number(adj.valor_total)
        : Number(adj.valor_total) / Math.max(1, Number(adj.parcelas_total || 1));
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("company_adjustment_applications").insert({
        hospital_id: hospitalId,
        payment_id: paymentId,
        company_id: companyId,
        adjustment_id: adj.id,
        valor_aplicado: parcelaValor,
        parcela_numero: (adj.parcelas_pagas ?? 0) + 1,
        applied_by: user?.id ?? null,
        status: "proposto",
        source: "manual",
      });
      if (error) throw error;
      // Recalcula deduções do lote para refletir na composição.
      await supabase.functions.invoke("apply-company-deductions", {
        body: { payment_id: paymentId, company_id: companyId },
      }).catch((e) => console.warn("[PendingCC] apply-company-deductions falhou:", e?.message));
      toast.success(`${adj.tipo === "credito" ? "Crédito" : "Débito"} lançado no lote`, {
        description: `${adj.descricao} · ${brl(parcelaValor)}`,
      });
      await onApplied?.();
      await load();
    } catch (e: any) {
      toast.error("Falha ao lançar", { description: e?.message });
    } finally {
      setConfirming(null);
    }
  };

  if (loading || pending.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 shadow-soft px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold">
          Lançamento sugerido para este centro de custos
        </h3>
        <Badge variant="outline" className="text-[10px]">
          {pending.length} pendente{pending.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Há ajustes cadastrados no centro de custos <span className="font-mono">{costCenterCode}</span>
        {" "}ainda não lançados nesta competência. Analista confirma manualmente.
      </p>

      <div className="space-y-1.5">
        {pending.map((adj) => {
          const parcelaValor = adj.recorrente
            ? Number(adj.valor_total)
            : Number(adj.valor_total) / Math.max(1, Number(adj.parcelas_total || 1));
          const isCred = adj.tipo === "credito";
          return (
            <div key={adj.id} className="rounded-md border bg-card px-3 py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={isCred ? "default" : "secondary"} className="text-[10px]">
                    {isCred ? "Crédito" : adj.tipo === "debito" ? "Débito" : adj.tipo}
                  </Badge>
                  {adj.recorrente && <Badge variant="outline" className="text-[10px]">Fixo mensal</Badge>}
                  <span className="text-xs font-medium truncate">{adj.descricao}</span>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Network className="h-3 w-3" />
                  <span className="font-mono">{adj.cost_center?.code_p12}</span>
                  {adj.cost_center?.level5 && <span>· {adj.cost_center.level5}</span>}
                  <span>· {brl(parcelaValor)}</span>
                </div>
              </div>
              {canEdit && (
                <Button
                  size="sm"
                  variant="default"
                  disabled={confirming === adj.id}
                  onClick={() => confirm(adj)}
                >
                  {confirming === adj.id ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Lançando…</>
                  ) : (
                    <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirmar lançamento</>
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
