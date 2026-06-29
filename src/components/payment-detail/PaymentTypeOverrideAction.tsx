import { useMemo, useState } from "react";
import { Tag, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { cn } from "@/lib/utils";

interface Props {
  item: {
    id: string;
    attendance_number?: string | null;
    payment_type_id?: string | null;
    payment_type_source?: string | null;
  };
  allItems: Array<{ id: string; attendance_number?: string | null }>;
  lotePaymentTypeId: string | null;
  /** Esconde a ação quando o lote é parecer/visita — esses casos usam o CaseSubtypeBadge dedicado. */
  hidden?: boolean;
  canEdit: boolean;
  onChange?: (itemIds: string[], newTypeId: string, newTypeLabel: string) => void;
}

/**
 * Override manual do tipo de pagamento por item (lote misto, ex.: consulta + procedimento).
 * O motor já respeita `payment_items.payment_type_id` via fallback no analyze-payment;
 * aqui só damos a UI pro analista marcar item a item ou pelo atendimento inteiro.
 */
export function PaymentTypeOverrideAction({
  item,
  allItems,
  lotePaymentTypeId,
  hidden,
  canEdit,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const { list } = usePaymentTypes({ onlyActive: true });

  const effectiveId = item.payment_type_id ?? lotePaymentTypeId ?? null;
  const isOverride = !!item.payment_type_id && item.payment_type_id !== lotePaymentTypeId;
  const current = list.find((t) => t.id === effectiveId) ?? null;
  const loteType = list.find((t) => t.id === lotePaymentTypeId) ?? null;

  const attendIds = useMemo(() => {
    const att = String(item.attendance_number ?? "").trim();
    if (!att) return [item.id];
    return allItems
      .filter((x) => String(x.attendance_number ?? "").trim() === att)
      .map((x) => x.id);
  }, [item.id, item.attendance_number, allItems]);

  if (hidden || !canEdit || !onChange || list.length === 0) return null;

  const handlePick = (
    newId: string | null,
    label: string,
    scope: "item" | "attendance",
  ) => {
    const ids = scope === "attendance" ? attendIds : [item.id];
    // newId === null → volta ao padrão do lote (limpa override).
    onChange(ids, newId ?? lotePaymentTypeId ?? "", label);
    setOpen(false);
  };

  return (
    <div className={cn(
      "rounded-md border border-dashed px-3 py-2 flex items-center justify-between gap-2",
      isOverride
        ? "border-violet-300/70 bg-violet-50/50 dark:bg-violet-950/15 dark:border-violet-900/60"
        : "border-muted-foreground/20 bg-muted/30",
    )}>
      <div className="flex items-center gap-2 min-w-0 text-xs">
        <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Tipo deste item:</span>
        <Badge variant={isOverride ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
          {current?.label ?? "—"}
        </Badge>
        {isOverride && (
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            (override do lote
            {loteType?.label ? ` "${loteType.label}"` : ""})
          </span>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-xs whitespace-nowrap">
            Alterar tipo…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground px-1 mb-1">
            Reclassificar como
          </div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {list.map((t) => {
              const isCurrent = t.id === effectiveId;
              return (
                <div key={t.id} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-1 px-1">
                    <span className="text-xs font-medium truncate" title={t.label}>{t.label}</span>
                    {isCurrent && <span className="text-[10px] text-muted-foreground">atual</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isCurrent && attendIds.length === 1}
                      className="flex-1 justify-start h-7 text-[11px]"
                      onClick={() => handlePick(t.id, t.label, "item")}
                    >
                      Só este item
                    </Button>
                    {attendIds.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 justify-start h-7 text-[11px]"
                        onClick={() => handlePick(t.id, t.label, "attendance")}
                      >
                        Atendimento ({attendIds.length})
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {isOverride && (
            <div className="pt-1 border-t mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-7 text-[11px] text-muted-foreground"
                onClick={() => handlePick(null, loteType?.label ?? "padrão do lote", "item")}
              >
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Voltar ao padrão do lote
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
