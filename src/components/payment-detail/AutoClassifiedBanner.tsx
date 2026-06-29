import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Phase 2 lote misto: sinal Zeev mostrando quantos itens da empresa atual
 * foram automaticamente reclassificados pelo motor (TUSS ou heurística).
 * O analista pode confirmar item a item via `PaymentTypeOverrideAction`
 * (ação no detalhe do item) — esse banner é só ponto de atenção.
 */
export function AutoClassifiedBanner({
  items,
  lotePaymentTypeId,
}: {
  items: Array<{ payment_type_id?: string | null; payment_type_source?: string | null }>;
  lotePaymentTypeId: string | null;
}) {
  const stats = useMemo(() => {
    let autoTuss = 0;
    let autoHeur = 0;
    let manual = 0;
    for (const it of items) {
      const src = String(it.payment_type_source ?? "");
      const ptid = it.payment_type_id ?? null;
      if (!ptid || ptid === lotePaymentTypeId) continue;
      if (src === "auto_tuss") autoTuss++;
      else if (src === "auto_heuristic") autoHeur++;
      else if (src === "manual") manual++;
    }
    return { autoTuss, autoHeur, manual, total: autoTuss + autoHeur + manual };
  }, [items, lotePaymentTypeId]);

  if (stats.total === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-violet-200/70 bg-violet-50/60 px-3 py-2 text-xs dark:border-violet-900/60 dark:bg-violet-950/20">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
      <span className="font-medium text-violet-900 dark:text-violet-100">
        Lote misto detectado:
      </span>
      <span className="text-muted-foreground">
        {stats.total} item(ns) com tipo diferente do lote
      </span>
      <div className="ml-auto flex items-center gap-1">
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
      </div>
    </div>
  );
}
