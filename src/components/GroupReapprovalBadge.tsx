import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useGroupReapproval } from "@/hooks/useGroupReapproval";

const brl = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const triggerLabel = (
  src: string | null | undefined,
): string => {
  switch (src) {
    case "company_change_source":
      return "Troca de empresa (origem)";
    case "company_change_destination":
      return "Troca de empresa (destino)";
    case "invoice_pendency":
      return "Pendência sinalizada pela empresa";
    default:
      return "Ajuste do analista";
  }
};

interface Props {
  companyGroupId: string;
  compact?: boolean;
  className?: string;
}

/**
 * Badge + painel de diff para grupos com re-aprovação pendente.
 * Exibe "antes vs depois" (bruto/líquido) e o gatilho que disparou a pendência.
 * Quando compact=true, mostra apenas o badge âmbar.
 */
export function GroupReapprovalBadge({ companyGroupId, compact, className }: Props) {
  const { state } = useGroupReapproval(companyGroupId);
  if (!state?.reapproval_pending) return null;

  if (compact) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 gap-1",
          className,
        )}
      >
        <AlertTriangle className="h-3 w-3" />
        Re-aprovação pendente
      </Badge>
    );
  }

  const delta = Number(state.bruto_total ?? 0) - Number(state.last_approved_bruto ?? 0);
  const deltaSign = delta >= 0 ? "+" : "";

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/60 bg-amber-500/5 p-4 space-y-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Re-aprovação pendente
            </div>
            <div className="text-xs text-muted-foreground">
              {triggerLabel(state.reapproval_trigger_source)}
              {state.reapproval_reason ? ` — ${state.reapproval_reason}` : ""}
            </div>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
          v{state.approval_version} → v{state.approval_version + 1}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div />
        <div className="text-muted-foreground uppercase tracking-wide">Antes</div>
        <div className="text-muted-foreground uppercase tracking-wide">Depois</div>

        <div className="text-muted-foreground">Bruto</div>
        <div className="font-mono">{brl(state.last_approved_bruto)}</div>
        <div className="font-mono font-semibold">{brl(state.bruto_total)}</div>

        <div className="text-muted-foreground">Líquido</div>
        <div className="font-mono">{brl(state.last_approved_liquido)}</div>
        <div className="font-mono font-semibold">{brl(state.liquido_total)}</div>

        <div className="text-muted-foreground border-t border-amber-500/20 pt-2">
          Δ Bruto
        </div>
        <div
          className={cn(
            "col-span-2 font-mono font-semibold border-t border-amber-500/20 pt-2",
            delta >= 0 ? "text-amber-700" : "text-emerald-700",
          )}
        >
          {deltaSign}
          {brl(delta)}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Avanço para NF, lançamento e pagamento bloqueado até nova aprovação.
        Apenas este grupo precisa retornar ao diretor — os demais seguem inalterados.
      </p>
    </div>
  );
}
