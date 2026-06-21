import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, XCircle, TrendingUp, MinusCircle, AlertTriangle } from "lucide-react";
import {
  REASON_GROUPS,
  REASON_LABELS,
  isEconomiaRealReason,
  type CancellationReason,
} from "@/lib/cancelledPayments";

interface Props {
  level: "group" | "item";
  /** group id or item id */
  targetId: string;
  /** Display name in the dialog (e.g. company name or doctor + procedure) */
  targetLabel: string;
  /** Optional: refetch parent after success */
  onCancelled?: () => void;
  trigger?: React.ReactNode;
  /** Controlled open (omit to use internal trigger state). */
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export default function CancelPaymentDialog({
  level, targetId, targetLabel, onCancelled, trigger,
  open: controlledOpen, onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) controlledOnOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [reason, setReason] = useState<CancellationReason | "">("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!reason) {
      toast.error("Selecione um motivo");
      return;
    }
    setLoading(true);
    try {
      const fn = level === "group" ? "cancel_company_group_payment" : "cancel_item_payment";
      const args = level === "group"
        ? { p_group_id: targetId, p_reason: reason, p_note: note || null }
        : { p_item_id: targetId, p_reason: reason, p_note: note || null };
      const { error } = await supabase.rpc(fn, args as never);
      if (error) {
        const code = error.message || "";
        if (code.includes("cannot_cancel_paid_payment"))
          toast.error("Não é possível cancelar: pagamento já está pago/lançado.");
        else if (code.includes("cannot_cancel_with_active_invoice"))
          toast.error("Há nota fiscal ativa para esta empresa. Estorne a NF antes de cancelar.");
        else if (code.includes("forbidden"))
          toast.error("Você não tem permissão para cancelar este pagamento.");
        else if (code.includes("already_cancelled"))
          toast.info("Esse pagamento já está cancelado.");
        else
          toast.error(`Falha ao cancelar: ${code}`);
        return;
      }
      toast.success(
        level === "group"
          ? "Pagamento da empresa cancelado. Não entrará nos KPIs de intervenção."
          : "Item cancelado.",
      );
      setOpen(false);
      setReason("");
      setNote("");
      onCancelled?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!isControlled && (trigger ? (
        <span onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{trigger}</span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="text-destructive border-destructive/30 hover:bg-destructive/5"
        >
          <XCircle className="h-4 w-4 mr-1" />
          Cancelar pagamento
        </Button>
      ))}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancelar pagamento {level === "group" ? "desta empresa" : "deste item"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{targetLabel}</strong>
              <br />
              <span className="text-xs">
                Escolha o motivo correto: motivos de <strong>economia real</strong> entram no saldo
                do KPI de intervenção; motivos <strong>operacionais</strong> (pago em outro lote,
                duplicidade corrigida pelo motor) ficam no relatório de cancelados mas não somam como
                economia.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Motivo *</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as CancellationReason)}>
                <SelectTrigger><SelectValue placeholder="Selecione o motivo do cancelamento" /></SelectTrigger>
                <SelectContent>
                  {REASON_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel className="text-xs flex items-center gap-1.5 text-muted-foreground">
                        {group.reasons[0] && isEconomiaRealReason(group.reasons[0]) ? (
                          <TrendingUp className="h-3 w-3 text-success" />
                        ) : (
                          <MinusCircle className="h-3 w-3 text-muted-foreground" />
                        )}
                        {group.label}
                      </SelectLabel>
                      {group.reasons.map((r) => (
                        <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {reason && (
                <div
                  className={
                    "mt-2 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs " +
                    (isEconomiaRealReason(reason)
                      ? "border-success/30 bg-success/5 text-success"
                      : "border-muted-foreground/20 bg-muted/40 text-muted-foreground")
                  }
                >
                  {isEconomiaRealReason(reason) ? (
                    <TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {isEconomiaRealReason(reason)
                      ? "Este cancelamento será contabilizado como economia real no relatório de intervenções."
                      : "Cancelamento operacional: NÃO entra no saldo de economia. Ficará marcado como neutro no relatório."}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Observação (opcional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Detalhe o caso para auditoria…"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handle} disabled={loading || !reason} className="bg-destructive hover:bg-destructive/90">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
