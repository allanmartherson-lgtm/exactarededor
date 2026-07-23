import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AutoClassifiedReviewSheet } from "./AutoClassifiedReviewSheet";

type Item = {
  id?: string;
  attendance_number?: string | null;
  procedure_code?: string | null;
  procedure_name?: string | null;
  procedure_description?: string | null;
  description?: string | null;
  company_name?: string | null;
  item_type_id?: string | null;
  item_type_source?: string | null;
  raw_data?: Record<string, unknown> | null;
};

/**
 * Phase 2 lote misto: sinal Zeev mostrando quantos itens da empresa atual
 * foram automaticamente reclassificados pelo motor (TUSS ou heurística).
 * O analista pode abrir o painel "Revisar" para aceitar/reverter item a
 * item com justificativa opcional registrada no histórico.
 */
export function AutoClassifiedBanner({
  items,
  lotePaymentTypeId,
  paymentId,
  canEdit = false,
  onChanged,
}: {
  items: Item[];
  lotePaymentTypeId: string | null;
  paymentId?: string;
  canEdit?: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const stats = useMemo(() => {
    let autoTuss = 0;
    let autoHeur = 0;
    let manual = 0;
    for (const it of items) {
      const src = String(it.item_type_source ?? "");
      const itemTypeId = it.item_type_id ?? null;
      if (!itemTypeId || itemTypeId === lotePaymentTypeId) continue;
      if (src === "auto_tuss") autoTuss++;
      else if (src === "auto_dynamic" || src === "auto_heuristic") autoHeur++;
      else if (src === "manual") manual++;
    }
    return { autoTuss, autoHeur, manual, total: autoTuss + autoHeur + manual };
  }, [items, lotePaymentTypeId]);

  if (stats.total === 0) return null;
  const pendingReview = stats.autoTuss + stats.autoHeur;

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border border-violet-200/70 bg-violet-50/60 px-3 py-1 text-[12px] dark:border-violet-900/60 dark:bg-violet-950/20">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
        <span className="font-medium text-violet-900 dark:text-violet-100">
          Lote misto detectado:
        </span>
        <span className="text-muted-foreground">
          {stats.total} item(ns) com tipo diferente do lote
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {stats.autoTuss > 0 && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              TUSS · {stats.autoTuss}
            </Badge>
          )}
          {stats.autoHeur > 0 && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              heurística · {stats.autoHeur}
            </Badge>
          )}
          {stats.manual > 0 && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
              manual · {stats.manual}
            </Badge>
          )}
          {paymentId && pendingReview > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] ml-1"
              onClick={() => setOpen(true)}
            >
              Revisar ({pendingReview})
            </Button>
          )}
        </div>
      </div>

      {paymentId && (
        <AutoClassifiedReviewSheet
          open={open}
          onOpenChange={setOpen}
          paymentId={paymentId}
          items={items.filter((it) => !!it.id) as Array<Required<Pick<Item, "id">> & Item>}
          lotePaymentTypeId={lotePaymentTypeId}
          canEdit={canEdit}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
