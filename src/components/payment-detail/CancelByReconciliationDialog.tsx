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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  ALL_REASONS,
  REASON_LABELS,
  type CancellationReason,
} from "@/lib/cancelledPayments";

/**
 * Cancelamento disparado pelo painel de conciliação.
 * Usa a RPC `cancel_by_reconciliation`, que marca os itens em lote e
 * fecha o ciclo na tabela `reconciliation_items` (action_taken).
 */
export type CancelScope =
  | { type: "items"; item_ids: string[]; label: string }
  | { type: "group"; company_group_id: string; label: string }
  | { type: "attendance"; attendance_number: string; company_name: string; label: string }
  | { type: "company"; company_name: string; label: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  runId: string;
  paymentId: string;
  scope: CancelScope;
  defaultReason?: CancellationReason;
  onCancelled?: (result: { items_affected: number; groups_affected: number }) => void;
}

export default function CancelByReconciliationDialog({
  open, onOpenChange, runId, paymentId, scope, defaultReason, onCancelled,
}: Props) {
  const [reason, setReason] = useState<CancellationReason | "">(defaultReason ?? "duplicidade_externa");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!reason) {
      toast.error("Selecione um motivo");
      return;
    }
    setLoading(true);
    try {
      let scopeJson: Record<string, unknown> = {};
      if (scope.type === "items") scopeJson = { item_ids: scope.item_ids };
      else if (scope.type === "group") scopeJson = { company_group_id: scope.company_group_id };
      else if (scope.type === "attendance") scopeJson = {
        attendance_number: scope.attendance_number,
        company_name: scope.company_name,
      };
      else if (scope.type === "company") scopeJson = { company_name: scope.company_name };

      const { data, error } = await supabase.rpc("cancel_by_reconciliation", {
        p_run_id: runId,
        p_payment_id: paymentId,
        p_scope: scopeJson as never,
        p_reason: reason,
        p_note: note || null,
      });
      if (error) {
        const code = error.message || "";
        // Conciliação é ETAPA DE ANÁLISE. Os erros aqui são SOMENTE de análise —
        // o fluxo de solicitação/conciliação de nota fiscal é separado e não é tratado neste dialog.
        if (code.includes("payment_not_in_analysis_stage"))
          toast.error("Este pagamento já saiu da etapa de análise. Cancelamento via conciliação só é permitido enquanto o lote está em análise.");
        else if (code.includes("cannot_cancel_paid_payment"))
          toast.error("Não é possível cancelar: pagamento já está pago/lançado/arquivado.");
        else if (code.includes("forbidden"))
          toast.error("Você não tem permissão para cancelar.");
        else if (code.includes("invalid_scope"))
          toast.error("Escopo de cancelamento inválido.");
        else
          toast.error(`Falha ao cancelar: ${code}`);
        return;
      }
      const res = (data as { items_affected?: number; groups_affected?: number } | null) ?? {};
      const ia = res.items_affected ?? 0;
      const ga = res.groups_affected ?? 0;
      if (ia === 0) {
        toast.info("Nenhum item ativo encontrado no escopo selecionado.");
      } else {
        toast.success(
          `${ia} ${ia === 1 ? "item cancelado" : "itens cancelados"} via conciliação` +
          (ga > 0 ? ` (${ga} ${ga === 1 ? "grupo encerrado" : "grupos encerrados"})` : ""),
        );
      }
      onOpenChange(false);
      setReason(defaultReason ?? "duplicidade_externa");
      setNote("");
      onCancelled?.({ items_affected: ia, groups_affected: ga });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar via conciliação</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p className="font-medium text-foreground">{scope.label}</p>
              <p className="text-xs">
                Os itens serão marcados como cancelados <strong>com origem na conciliação</strong>.
                Eles entram no relatório "Ajustes por intervenção" na categoria{" "}
                <strong>Cancelamento via conciliação</strong> e o resultado é registrado na
                linha do relatório de conciliação que originou o caso.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Motivo *</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as CancellationReason)}>
              <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
              <SelectContent>
                {ALL_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Observação (opcional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Ex: atendimento removido da base hospitalar na conciliação de DD/MM…"
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
  );
}
