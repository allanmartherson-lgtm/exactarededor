import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { recordAudit, buildDiff } from "@/lib/audit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Wand2, RotateCcw } from "lucide-react";
import { impactBadgeClass, impactLabel } from "@/lib/saveIntervention";
import { cn } from "@/lib/utils";
import {
  useManualInterventionReasons,
  type ManualInterventionReason,
} from "@/hooks/useManualInterventionReasons";

/**
 * Diálogo unificado para "tratar item manualmente".
 *
 * Substitui os caminhos antigos de **Exceção do cálculo** (reclassificação
 * clínica) e **Acatar divergência** (aceite financeiro). O analista escolhe
 * um motivo categorizado e o motor passa a aceitar `procedure_amount` como
 * `expected_amount` (status `aprovado`, `calculation_type_used =
 * "tratamento_manual"`).
 *
 * Não interfere nas regras cadastradas — o tratamento é por item.
 */
export type ManualInterventionDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemId: string;
  paymentId: string;
  companyName: string | null;
  current: {
    manual_intervention_reason_id?: string | null;
    manual_intervention_notes?: string | null;
  };
  /** Pré-seleciona categoria (ex.: ao abrir a partir do botão verde de aceite). */
  preferCategory?: ManualInterventionReason["category"];
  onApplied?: () => void;
};

export function ManualInterventionDialog({
  open,
  onOpenChange,
  itemId,
  paymentId,
  companyName,
  current,
  preferCategory,
  onApplied,
}: ManualInterventionDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { reasons, byCategory, loading: loadingReasons } =
    useManualInterventionReasons();

  const isMarked = !!current.manual_intervention_reason_id;
  const [reasonId, setReasonId] = useState<string>(
    current.manual_intervention_reason_id ?? "",
  );
  const [notes, setNotes] = useState(current.manual_intervention_notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReasonId(current.manual_intervention_reason_id ?? "");
      setNotes(current.manual_intervention_notes ?? "");
    }
  }, [
    open,
    current.manual_intervention_reason_id,
    current.manual_intervention_notes,
  ]);

  const selectedReason = useMemo(
    () => reasons.find((r) => r.id === reasonId) ?? null,
    [reasons, reasonId],
  );

  const apply = async (next: boolean) => {
    if (!user?.id) {
      toast({ title: "Não autenticado", variant: "destructive" });
      return;
    }
    if (next && !reasonId) {
      toast({
        title: "Selecione um motivo",
        description: "Escolha o motivo do tratamento manual antes de aplicar.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const before = {
        manual_intervention_reason_id:
          current.manual_intervention_reason_id ?? null,
        manual_intervention_notes: current.manual_intervention_notes ?? null,
      };
      const patch = next
        ? {
            manual_intervention_reason_id: reasonId,
            manual_intervention_notes: notes.trim() || null,
            manual_intervention_by: user.id,
            manual_intervention_source: "manual",
            // Snapshot categorizado dos novos campos (compartilhado com
            // acate/exclusão/edição). Alimenta relatórios de economia vs perda.
            intervention_reason_id: reasonId,
            intervention_notes: notes.trim() || null,
            intervention_financial_impact:
              selectedReason?.financial_impact ?? null,
          }
        : {
            manual_intervention_reason_id: null,
            manual_intervention_notes: null,
            manual_intervention_by: null,
            manual_intervention_at: null,
            manual_intervention_source: null,
            ai_status: "pendente",
            expected_amount: null,
            intervention_reason_id: null,
            intervention_notes: null,
            intervention_financial_impact: null,
          };


      // Aplica o resultado determinístico do tratamento manual no próprio
      // update — espelha rulesEngine (item.manual_intervention_reason_id =>
      // aprovado, expected = procedure_amount). Garante consistência mesmo se
      // a reanálise for pulada (gate de job em andamento, empresa não-editável
      // etc.). A reanálise abaixo continua útil para recompor totais.
      if (next) {
        const { data: row, error: readErr } = await supabase
          .from("payment_items")
          .select("procedure_amount,gross_amount,gross_amount_original,gross_override_at,gross_override_reason,ai_status,acatado_status_original")
          .eq("id", itemId)
          .maybeSingle();
        if (readErr) throw readErr;
        // Regra de acatação:
        //  • aceite_financeiro  -> aceita o VALOR PAGO (gross_amount atual, ou
        //    gross_amount_original se já houver override) como esperado.
        //    Cobre casos de reajuste sem precisar refazer a regra.
        //  • reclassificacao_clinica -> aceita procedure_amount (valor do
        //    convênio) como esperado (comportamento clínico original).
        //  • Se já havia override manual anterior, preserva o gross vigente.
        const rawProc = row?.procedure_amount;
        const procAmt =
          rawProc == null || !Number.isFinite(Number(rawProc))
            ? 0
            : Number(rawProc);
        const hasPriorOverride = !!(row as any)?.gross_override_at;
        const currentGross = (row as any)?.gross_amount;
        const originalGross = (row as any)?.gross_amount_original;
        const paidGrossRaw = hasPriorOverride ? originalGross : currentGross;
        const paidGross =
          paidGrossRaw != null && Number.isFinite(Number(paidGrossRaw))
            ? Number(paidGrossRaw)
            : null;

        let acceptedAmt: number;
        if (hasPriorOverride && currentGross != null && Number.isFinite(Number(currentGross))) {
          // Preserva ajuste manual anterior (ex.: zerado em consulta de retorno).
          acceptedAmt = Number(currentGross);
        } else if (selectedReason?.category === "aceite_financeiro" && paidGross != null) {
          // Aceita o valor efetivamente pago como esperado.
          acceptedAmt = paidGross;
        } else {
          // Reclassificação clínica ou fallback: usa valor do convênio.
          acceptedAmt = procAmt;
        }
        (patch as any).expected_amount = acceptedAmt;
        (patch as any).gross_amount = acceptedAmt;
        if (!hasPriorOverride) {
          (patch as any).gross_amount_original = (row as any)?.gross_amount ?? null;
        }
        (patch as any).gross_override_at = new Date().toISOString();
        (patch as any).gross_override_by = user.id;
        (patch as any).gross_override_reason = "tratamento_manual";
        (patch as any).ai_status = "aprovado";

      } else {
        const { data: row, error: readErr } = await supabase
          .from("payment_items")
          .select("gross_amount,gross_amount_original,gross_override_reason")
          .eq("id", itemId)
          .maybeSingle();
        if (readErr) throw readErr;
        const overrideReason = (row as any)?.gross_override_reason;
        if (
          (overrideReason === "tratamento_manual" || overrideReason === "zeev_bulk_manual") &&
          (row as any)?.gross_amount_original != null
        ) {
          (patch as any).gross_amount = (row as any).gross_amount_original;
          (patch as any).gross_amount_original = null;
          (patch as any).gross_override_at = null;
          (patch as any).gross_override_by = null;
          (patch as any).gross_override_reason = null;
        }
      }

      const { error } = await supabase
        .from("payment_items")
        .update(patch as any)
        .eq("id", itemId);
      if (error) throw error;

      await recordAudit({
        entityType: "payment_item",
        entityId: itemId,
        action: "update",
        actorId: user.id,
        diff: {
          __op: {
            before: null,
            after: next
              ? `manual_intervention_apply:${selectedReason?.code ?? reasonId}`
              : "manual_intervention_remove",
          },
          ...buildDiff(before, {
            manual_intervention_reason_id:
              (patch as any).manual_intervention_reason_id ?? null,
            manual_intervention_notes:
              (patch as any).manual_intervention_notes ?? null,
          }),
        },
      });

      try {
        await supabase.functions.invoke("dispatch-payment-analysis", {
          body: {
            payment_id: paymentId,
            only_companies: companyName ? [companyName] : undefined,
            force_fresh_rules: true,
          },
        });
      } catch (e) {
        console.warn("[ManualIntervention] dispatch reanalysis falhou", e);
      }

      toast({
        title: next
          ? "Tratamento manual aplicado"
          : "Tratamento manual removido",
        description: next
          ? "O motor vai aceitar o valor do convênio como esperado para este item."
          : "O item volta a ser avaliado pela regra normal.",
      });
      onOpenChange(false);
      onApplied?.();
    } catch (e: any) {
      toast({
        title: "Falha ao atualizar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Ordena grupos colocando a categoria preferida primeiro
  const groupOrder: ManualInterventionReason["category"][] = preferCategory
    ? preferCategory === "aceite_financeiro"
      ? ["aceite_financeiro", "reclassificacao_clinica", "operacional"]
      : ["reclassificacao_clinica", "aceite_financeiro", "operacional"]
    : ["reclassificacao_clinica", "aceite_financeiro", "operacional"];

  const groupTitle: Record<ManualInterventionReason["category"], string> = {
    reclassificacao_clinica: "Reclassificação clínica",
    aceite_financeiro: "Aceite financeiro",
    operacional: "Operacional",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isMarked ? "Tratamento manual ativo" : "Tratar item manualmente"}
          </DialogTitle>
          <DialogDescription>
            {isMarked ? (
              <>
                Este item está sendo tratado manualmente e o motor está
                aceitando o valor do convênio como esperado. Você pode trocar o
                motivo ou remover o tratamento.
              </>
            ) : (
              <>
                Escolha o motivo do tratamento manual. O motor vai aceitar o{" "}
                <strong>valor do convênio</strong> como o esperado para este
                item, marcando-o como <em>aprovado</em>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select
              value={reasonId}
              onValueChange={setReasonId}
              disabled={submitting || loadingReasons}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingReasons ? "Carregando motivos…" : "Selecione um motivo"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {groupOrder.map((cat) => {
                  const items = byCategory[cat];
                  if (!items.length) return null;
                  return (
                    <SelectGroup key={cat}>
                      <SelectLabel>{groupTitle[cat]}</SelectLabel>
                      {items.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <span className="flex items-center gap-2">
                            <span>{r.label}</span>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                                impactBadgeClass(r.financial_impact),
                              )}
                            >
                              {impactLabel(r.financial_impact)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedReason?.description && (
              <p className="text-xs text-muted-foreground">
                {selectedReason.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Observação (opcional)</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contexto adicional para auditoria…"
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          {isMarked && (
            <Button
              variant="outline"
              onClick={() => apply(false)}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-1" />
              )}
              Remover tratamento
            </Button>
          )}
          <Button onClick={() => apply(true)} disabled={submitting || !reasonId}>
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-1" />
            )}
            {isMarked ? "Atualizar motivo" : "Aplicar tratamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
