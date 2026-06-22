import { useEffect, useState } from "react";
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
import { Loader2, FilterX, RotateCcw } from "lucide-react";

/**
 * Dialog para marcar / remover "Exceção do cálculo" em um item.
 *
 * Efeito: quando ligada, o motor pula cálculos com `payment_type_id` setado
 * na regra resolvida e cai no próximo cálculo elegível (tipicamente o
 * universal / percentual do convênio). Use quando um item específico não
 * deve seguir a regra tipada (ex.: visita sequencial gerada por parecer
 * que precisa pagar pelo convênio).
 */
export type CalcExceptionDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemId: string;
  paymentId: string;
  companyName: string | null;
  appliedCalcId: string | null;
  current: {
    calc_exception_skip?: boolean | null;
    calc_exception_reason?: string | null;
  };
  /** Rótulo do cálculo tipado (ex: "Regra Parecer") para exibir no diálogo. */
  skippedCalcLabel?: string | null;
  onApplied?: () => void;
};

export function CalcExceptionDialog({
  open,
  onOpenChange,
  itemId,
  paymentId,
  companyName,
  appliedCalcId,
  current,
  skippedCalcLabel,
  onApplied,
}: CalcExceptionDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMarked = !!current.calc_exception_skip;
  const [reason, setReason] = useState(current.calc_exception_reason ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setReason(current.calc_exception_reason ?? "");
  }, [open, current.calc_exception_reason]);

  const apply = async (next: boolean) => {
    if (!user?.id) {
      toast({ title: "Não autenticado", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const before = {
        calc_exception_skip: !!current.calc_exception_skip,
        calc_exception_reason: current.calc_exception_reason ?? null,
      };
      const patch = next
        ? {
            calc_exception_skip: true,
            calc_exception_reason: reason.trim() || null,
            calc_exception_marked_by: user.id,
            calc_exception_skipped_calc_id: appliedCalcId,
          }
        : {
            calc_exception_skip: false,
            calc_exception_reason: null,
            calc_exception_marked_by: null,
            calc_exception_skipped_calc_id: null,
          };

      const { error } = await supabase
        .from("payment_items")
        .update(patch as any)
        .eq("id", itemId);
      if (error) throw error;

      await recordAudit({
        entityType: "payment_item",
        entityId: itemId,
        action: next ? "calc_exception_enable" : "calc_exception_disable",
        actorId: user.id,
        diff: buildDiff(before, {
          calc_exception_skip: !!patch.calc_exception_skip,
          calc_exception_reason: (patch as any).calc_exception_reason ?? null,
        }),
      });

      // Re-dispara análise apenas da PJ do item para refletir o novo cálculo.
      try {
        await supabase.functions.invoke("dispatch-payment-analysis", {
          body: {
            payment_id: paymentId,
            only_companies: companyName ? [companyName] : undefined,
            force_fresh_rules: true,
          },
        });
      } catch (e) {
        console.warn("[CalcException] dispatch reanalysis falhou", e);
      }

      toast({
        title: next ? "Exceção do cálculo aplicada" : "Exceção do cálculo removida",
        description: next
          ? "O motor vai reanalisar o item pulando o cálculo tipado."
          : "O item volta a seguir a regra tipada original.",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isMarked ? "Remover exceção do cálculo" : "Exceção do cálculo"}
          </DialogTitle>
          <DialogDescription>
            {isMarked ? (
              <>
                Este item está marcado como exceção e está pulando o cálculo
                tipado{skippedCalcLabel ? ` "${skippedCalcLabel}"` : ""}. Ao
                remover, o motor volta a aplicar a regra tipada original.
              </>
            ) : (
              <>
                Marca este item para <strong>pular o cálculo tipado</strong>
                {skippedCalcLabel ? ` "${skippedCalcLabel}"` : ""} da regra
                resolvida. O motor cai no próximo cálculo elegível da mesma
                regra (tipicamente o percentual do convênio). Use, por exemplo,
                quando um parecer gerou visitas sequenciais que devem ser pagas
                pelo convênio em vez do valor fixo.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Motivo (opcional)</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: visita sequencial decorrente de parecer — paga pelo convênio."
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
          {isMarked ? (
            <Button onClick={() => apply(false)} disabled={submitting} variant="outline">
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-1" />
              )}
              Remover exceção
            </Button>
          ) : (
            <Button onClick={() => apply(true)} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FilterX className="h-4 w-4 mr-1" />
              )}
              Aplicar exceção
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
