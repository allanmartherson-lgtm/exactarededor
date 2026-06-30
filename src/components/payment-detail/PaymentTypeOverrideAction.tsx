import { useMemo, useState } from "react";
import { Tag, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  hidden?: boolean;
  canEdit: boolean;
  onChange?: (itemIds: string[], newTypeId: string, newTypeLabel: string) => void;
}

/**
 * Override manual do tipo de pagamento por item.
 *
 * UX nova (jun/2026): Select inline em vez de popover. Analista escolhe o tipo
 * direto no dropdown e decide o escopo (só este item × atendimento inteiro) num
 * toggle compacto antes de aplicar. Mudança dispara reanálise (motor respeita
 * `payment_items.payment_type_id` em analyze-payment).
 */
export function PaymentTypeOverrideAction({
  item,
  allItems,
  lotePaymentTypeId,
  hidden,
  canEdit,
  onChange,
}: Props) {
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

  const hasAttendanceSiblings = attendIds.length > 1;
  const [scope, setScope] = useState<"item" | "attendance">("item");

  if (hidden || !canEdit || !onChange || list.length === 0) return null;

  const applyChange = (newTypeId: string) => {
    const type = list.find((t) => t.id === newTypeId);
    if (!type) return;
    const ids = scope === "attendance" && hasAttendanceSiblings ? attendIds : [item.id];
    onChange(ids, newTypeId, type.label);
  };

  const resetToLote = () => {
    if (!lotePaymentTypeId) return;
    applyChange(lotePaymentTypeId);
  };

  return (
    <div
      className={cn(
        "rounded-md border border-dashed px-3 py-2 flex flex-col gap-2 min-w-0 max-w-full",
        isOverride
          ? "border-violet-300/70 bg-violet-50/50 dark:bg-violet-950/15 dark:border-violet-900/60"
          : "border-muted-foreground/20 bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2 min-w-0 text-xs">
        <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground shrink-0">Tipo deste item:</span>
        {isOverride && (
          <Badge variant="default" className="h-5 px-1.5 text-[10px] shrink-0">
            override
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <Select value={effectiveId ?? undefined} onValueChange={applyChange}>
          <SelectTrigger className="h-8 text-xs flex-1 min-w-[180px]">
            <SelectValue placeholder="Selecionar tipo…">
              {current?.label ?? "—"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {list.map((t) => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span>{t.label}</span>
                  {t.id === lotePaymentTypeId && (
                    <span className="text-[10px] text-muted-foreground">(padrão do lote)</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasAttendanceSiblings && (
          <div className="inline-flex rounded-md border bg-background overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setScope("item")}
              className={cn(
                "px-2 h-8 text-[11px] transition-colors",
                scope === "item"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              title="Aplicar somente a este item"
            >
              Só este
            </button>
            <button
              type="button"
              onClick={() => setScope("attendance")}
              className={cn(
                "px-2 h-8 text-[11px] border-l transition-colors",
                scope === "attendance"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              title={`Aplicar a todos os ${attendIds.length} itens deste atendimento`}
            >
              Atend. ({attendIds.length})
            </button>
          </div>
        )}

        {isOverride && lotePaymentTypeId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[11px] text-muted-foreground shrink-0"
            onClick={resetToLote}
            title={`Voltar ao padrão do lote (${loteType?.label ?? "—"})`}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Padrão do lote
          </Button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-snug">
        {isOverride ? (
          <>
            Override ativo. Padrão do lote: <strong>{loteType?.label ?? "—"}</strong>.
            {" "}A mudança dispara reanálise e o motor passa a filtrar cálculos pelo
            tipo escolhido.
          </>
        ) : (
          <>
            Trocar o tipo aqui re-roda as regras só para este item (ou para o
            atendimento, se escolhido). O lote inteiro continua como{" "}
            <strong>{loteType?.label ?? "—"}</strong>.
          </>
        )}
      </p>
    </div>
  );
}
