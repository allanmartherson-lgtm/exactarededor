import { AlertTriangle, Check } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/status";
import { REASON_LABELS, type SuspiciousRow } from "@/lib/detectSuspiciousRows";

export type SuspiciousDecision = "keep" | "discard" | "informative_total";

interface Props {
  fileName: string;
  rows: SuspiciousRow[];
  decisions: Record<number, SuspiciousDecision>;
  onDecide: (rowNumber: number, decision: SuspiciousDecision) => void;
}

const DECISION_LABEL: Record<SuspiciousDecision, string> = {
  keep: "Manter como item",
  discard: "Descartar",
  informative_total: "Total informativo",
};

export function SuspiciousRowsReview({ fileName, rows, decisions, onDecide }: Props) {
  if (rows.length === 0) return null;
  const pending = rows.filter((r) => !decisions[r.rowNumber]);

  return (
    <Alert variant={pending.length > 0 ? "destructive" : "default"} className="mt-2">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">
        {pending.length > 0
          ? `${pending.length} linha${pending.length === 1 ? "" : "s"} suspeita${pending.length === 1 ? "" : "s"} em ${fileName}`
          : `${rows.length} linha${rows.length === 1 ? "" : "s"} suspeita${rows.length === 1 ? "" : "s"} revisada${rows.length === 1 ? "" : "s"}`}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-xs">
          Estas linhas parecem totalizadores/rodapé. Decida o que fazer com cada uma antes de enviar.
          {pending.length > 0 && " O envio fica bloqueado até a decisão."}
        </p>
        <div className="space-y-2">
          {rows.map((r) => {
            const current = decisions[r.rowNumber];
            return (
              <div key={r.rowNumber} className="rounded-md border bg-background/60 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Badge variant="outline" className="h-5 text-[10px]">Linha {r.rowNumber}</Badge>
                  {r.suspectedValue != null && (
                    <Badge variant="outline" className="h-5 text-[10px] font-mono">
                      {formatCurrency(r.suspectedValue)}
                    </Badge>
                  )}
                  {r.reasons.map((reason) => (
                    <Badge key={reason} variant="secondary" className="h-5 text-[10px]">
                      {REASON_LABELS[reason]}
                    </Badge>
                  ))}
                  {current && (
                    <Badge className="h-5 text-[10px] bg-emerald-600 hover:bg-emerald-600">
                      <Check className="h-3 w-3 mr-0.5" />
                      {DECISION_LABEL[current]}
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-2 mb-2">
                  {r.cells.map((c) => `${c.header}: ${c.value}`).join("  ·  ")}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["discard", "informative_total", "keep"] as SuspiciousDecision[]).map((d) => (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      variant={current === d ? "default" : "outline"}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => onDecide(r.rowNumber, d)}
                    >
                      {DECISION_LABEL[d]}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </AlertDescription>
    </Alert>
  );
}
