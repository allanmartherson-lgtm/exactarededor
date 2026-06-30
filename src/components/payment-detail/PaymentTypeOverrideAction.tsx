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
import { useItemTypes } from "@/hooks/useItemTypes";
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
 * UX nova (jun/2026): Select inline em vez de popover. O dropdown lista
 * APENAS item_types (Parecer/Visita/Cirurgia/Consulta/Bônus/Exames) — os
 * modelos do lote (Produção/Plantão/Remessa/Valor fixo) ficam fora porque
 * não fazem sentido como tipo de procedimento.
 *
 * Por compatibilidade com o motor atual, o write continua usando
 * `payment_type_id` (legacy), resolvendo via code o id equivalente na
 * tabela antiga payment_types.
 */
export function PaymentTypeOverrideAction({
  item,
  allItems,
  lotePaymentTypeId,
  hidden,
  canEdit,
  onChange,
}: Props) {
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true });
  const { list: itemTypes } = useItemTypes({ onlyActive: true });

  // Só mostrar no dropdown os payment_types cujo code é de fato um item_type.
  const itemTypeCodes = useMemo(() => new Set(itemTypes.map((t) => t.code)), [itemTypes]);
  const selectable = useMemo(
    () => paymentTypes.filter((t) => itemTypeCodes.has(t.code)),
    [paymentTypes, itemTypeCodes],
  );

  const effectiveId = item.payment_type_id ?? lotePaymentTypeId ?? null;
  const isOverride = !!item.payment_type_id && item.payment_type_id !== lotePaymentTypeId;
  const current = paymentTypes.find((t) => t.id === effectiveId) ?? null;
  const loteType = paymentTypes.find((t) => t.id === lotePaymentTypeId) ?? null;

  const attendIds = useMemo(() => {
    const att = String(item.attendance_number ?? "").trim();
    if (!att) return [item.id];
    return allItems
      .filter((x) => String(x.attendance_number ?? "").trim() === att)
      .map((x) => x.id);
  }, [item.id, item.attendance_number, allItems]);

  const hasAttendanceSiblings = attendIds.length > 1;
  const [scope, setScope] = useState<"item" | "attendance">("item");

  if (hidden || !canEdit || !onChange || selectable.length === 0) return null;

  const applyChange = (newTypeId: string) => {
    const type = selectable.find((t) => t.id === newTypeId);
    if (!type) return;
    const ids = scope === "attendance" && hasAttendanceSiblings ? attendIds : [item.id];
    onChange(ids, newTypeId, type.label);
  };

  const resetToLote = () => {
    if (!lotePaymentTypeId) return;
    const type = paymentTypes.find((t) => t.id === lotePaymentTypeId);
    if (!type) return;
    const ids = scope === "attendance" && hasAttendanceSiblings ? attendIds : [item.id];
    onChange(ids, lotePaymentTypeId, type.label);
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
