import { Building2, AlertTriangle } from "lucide-react";
import { useHospital } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  /** Quando true, exibe o estado vermelho de "nenhuma unidade ativa". */
  warnIfMissing?: boolean;
}

/**
 * Badge fixo "Unidade: X" para reforçar em modais críticos (aprovação de grupo,
 * pedido de NF, criação/edição de regra) qual unidade hospitalar receberá a
 * ação. Evita erros de operador ao alternar entre unidades.
 */
export function ActiveHospitalBadge({ className, warnIfMissing = true }: Props) {
  const { hospital } = useHospital();

  if (!hospital) {
    if (!warnIfMissing) return null;
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive",
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Nenhuma unidade ativa
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
      title="Unidade hospitalar ativa — a ação será registrada nesta unidade."
    >
      <Building2 className="h-3.5 w-3.5" />
      <span>Unidade:</span>
      <span className="text-foreground">{hospital.name}</span>
    </div>
  );
}
