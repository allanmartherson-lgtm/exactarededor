import { useState } from "react";
import { XCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type CancelledGroupBannerProps = {
  group: {
    id: string;
    cancelled_at?: string | null;
    cancellation_reason?: string | null;
    cancellation_note?: string | null;
    cancellation_source?: string | null;
  } | null;
  canReactivate: boolean;
  onReactivated: () => void | Promise<void>;
};

/**
 * Banner vermelho exibido quando um grupo de pagamento está cancelado.
 *
 * Reativo a `group.cancelled_at` — quando o RPC `reactivate_cancelled_group`
 * limpa o campo, o componente some imediatamente sem precisar de refresh.
 *
 * Extraído de CompanyAnalysis para permitir testes E2E focados (ver
 * CancelledGroupBanner.e2e.test.tsx).
 */
export function CancelledGroupBanner({ group, canReactivate, onReactivated }: CancelledGroupBannerProps) {
  const [busy, setBusy] = useState(false);

  if (!group?.cancelled_at) return null;

  const reasonTxt = group.cancellation_reason ? group.cancellation_reason.replace(/_/g, " ") : "—";
  const sourceTxt = group.cancellation_source === "reconciliacao" ? "via conciliação" : "manual";

  const handleReactivate = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("reactivate_cancelled_group", { p_group_id: group.id });
    setBusy(false);
    if (error) {
      toast.error("Falha ao reativar", { description: error.message });
      return;
    }
    toast.success("Pagamento reativado. Itens voltaram ao status anterior.");
    await onReactivated();
  };

  return (
    <div
      className="rounded-md border-2 border-destructive/40 bg-destructive/10 px-4 py-3 flex flex-col md:flex-row md:items-center gap-3"
      data-testid="cancelled-group-banner"
    >
      <XCircle className="h-5 w-5 text-destructive shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-destructive">
          Pagamento cancelado ({sourceTxt}) em {new Date(group.cancelled_at).toLocaleString("pt-BR")}
        </p>
        <p className="text-xs text-muted-foreground">
          Motivo: <strong>{reasonTxt}</strong>
          {group.cancellation_note ? <> — <span className="italic">{group.cancellation_note}</span></> : null}{" "}
          · Todos os itens foram marcados como cancelados em cascata e não entram em KPI/relatório de aprovação.
        </p>
      </div>
      {canReactivate ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={handleReactivate}
          className="shrink-0 self-start md:self-auto"
          data-testid="reactivate-cancelled-group"
        >
          <Undo2 className="h-4 w-4 mr-1.5" /> Reativar pagamento
        </Button>
      ) : (
        <span className="text-[11px] text-muted-foreground shrink-0">
          Reativação restrita a Supervisor / Diretor / Admin.
        </span>
      )}
    </div>
  );
}
