import { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Pencil, Copy, FileDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RuleListRowProps {
  name: string;
  severity?: "bloqueio" | "aviso" | "info" | string | null;
  active?: boolean | null;
  expired?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  thresholdAlert?: { value: number | null; type: string | null } | null;
  thresholdBlock?: { value: number | null; type: string | null } | null;
  incomplete?: boolean;
  missingFields?: string[];
  description?: string | null;
  ruleText?: string | null;
  calcBadge?: ReactNode;
  selected?: boolean;
  isLast?: boolean;
  onToggleSelect?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onExportPdf?: () => void;
  onDelete?: () => void;
}

/**
 * Linha reutilizável de regra — segue exatamente o padrão visual da
 * lista de Pagamentos: linhas dentro de um Card único, Badge variant="outline",
 * ações sempre visíveis à direita, separadores sutis entre linhas.
 */
export function RuleListRow({
  name,
  severity,
  active,
  expired,
  validFrom,
  validUntil,
  thresholdAlert,
  thresholdBlock,
  incomplete,
  missingFields = [],
  description,
  ruleText,
  calcBadge,
  selected,
  isLast,
  onToggleSelect,
  onEdit,
  onDuplicate,
  onExportPdf,
  onDelete,
}: RuleListRowProps) {
  const renderThresholds = () => {
    const aVal = thresholdAlert?.value;
    const aType = thresholdAlert?.type;
    const bVal = thresholdBlock?.value;
    const bType = thresholdBlock?.type;
    if (aVal == null && bVal == null) return null;
    const aText = aVal != null ? `${aVal}${aType === "percentual" ? "%" : " R$"}` : "global";
    const bText = bVal != null ? `${bVal}${bType === "percentual" ? "%" : " R$"}` : "global";
    return (
      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
        ⚠ {aText} / 🚫 {bText}
      </Badge>
    );
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-6 py-4 hover:bg-muted/40 transition-colors",
        !isLast && "border-b border-border/40",
        selected && "bg-primary/5",
      )}
    >
      {onToggleSelect && (
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        </div>
      )}
      <div className="flex items-start justify-between gap-4 flex-1 min-w-0">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <p className="font-medium text-sm truncate">{name}</p>
            {active === false && (
              <Badge variant="outline" className="gap-1 font-normal bg-destructive-soft text-destructive border-destructive/30">
                Inativa
              </Badge>
            )}
            {expired && (
              <Badge variant="outline" className="gap-1 font-normal bg-warning-soft text-warning-foreground border-warning/30">
                Expirada
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {severity && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 font-normal capitalize",
                  severity === "bloqueio" && "bg-destructive-soft text-destructive border-destructive/30",
                  severity === "aviso" && "bg-warning-soft text-warning-foreground border-warning/30",
                  severity === "info" && "bg-info-soft text-info border-info/30",
                )}
              >
                {severity}
              </Badge>
            )}
            {calcBadge}
            {(validFrom || validUntil) && (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                Vigência: {validFrom ?? "—"} → {validUntil ?? "—"}
              </Badge>
            )}
            {renderThresholds()}
            {incomplete && (
              <Badge variant="outline" className="gap-1 font-normal bg-warning-soft text-warning-foreground border-warning/30">
                <AlertTriangle className="h-3 w-3" /> Faltam: {missingFields.join(", ")}
              </Badge>
            )}
          </div>
          {description && <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>}
          {ruleText && (
            <p className="text-xs text-muted-foreground line-clamp-3">
              <span className="text-foreground/80">{ruleText}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onEdit && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onEdit} title="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {onDuplicate && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onDuplicate} title="Duplicar">
              <Copy className="h-4 w-4" />
            </Button>
          )}
          {onExportPdf && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={onExportPdf} title="Exportar PDF">
              <FileDown className="h-4 w-4" />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete} title="Excluir">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
