import { useMemo, useState } from "react";
import { Sparkles, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/status";
import { groupItemsByPattern, type SuggestedBatch } from "@/lib/batchSuggest";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

interface Props {
  items: PaymentItemRow[];
  onAcceptBatch: (itemIds: string[], note: string) => Promise<void>;
}

export function BatchSuggestPanel({ items, onAcceptBatch }: Props) {
  const batches = useMemo(() => groupItemsByPattern(items), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (batches.length === 0) return null;

  const toggleSelected = (key: string) => {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  };
  const toggleExpanded = (key: string) => {
    const next = new Set(expanded);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpanded(next);
  };

  const selectedItemIds = batches
    .filter((b) => selected.has(b.key))
    .flatMap((b) => b.items.map((i) => i.id));

  const handleAccept = async () => {
    if (selectedItemIds.length === 0) return;
    setLoading(true);
    try {
      await onAcceptBatch(selectedItemIds, note.trim());
      setSelected(new Set());
      setNote("");
    } finally {
      setLoading(false);
    }
  };

  const devBadge = (b: SuggestedBatch) => {
    const pct = (b.avgDeviation * 100).toFixed(0);
    const sign = b.avgDeviation >= 0 ? "+" : "";
    const variant = Math.abs(b.avgDeviation) >= 0.05 ? "warning" : "muted";
    return <Badge variant={variant as "warning" | "muted"}>desvio {sign}{pct}%</Badge>;
  };

  return (
    <Card className="border-info/30 bg-info-soft/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-info" />
          Sugestões de acate em lote
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A IA identificou grupos de itens com padrão similar. Selecione os grupos a acatar e justifique.
        </p>

        <div className="space-y-2">
          {batches.map((b) => {
            const isExp = expanded.has(b.key);
            const isSel = selected.has(b.key);
            return (
              <div key={b.key} className="rounded-md border bg-background">
                <div className="flex items-center gap-2 p-2">
                  <Checkbox
                    checked={isSel}
                    onCheckedChange={() => toggleSelected(b.key)}
                    aria-label={`Selecionar ${b.label}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleExpanded(b.key)}
                    className="flex items-center gap-1 text-xs hover:text-foreground/80"
                  >
                    {isExp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <span className="text-xs flex-1 truncate" title={b.label}>{b.label}</span>
                  {devBadge(b)}
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatCurrency(b.totalAmount)}
                  </span>
                </div>
                {isExp && (
                  <div className="border-t bg-muted/30 px-3 py-2 space-y-1">
                    {b.items.map((it) => (
                      <div key={it.id} className="text-[11px] flex items-center gap-3 text-muted-foreground">
                        <span className="truncate flex-1">{it.doctor_name ?? "—"}</span>
                        <span className="truncate">at. {it.attendance_number ?? "—"}</span>
                        <span className="tabular-nums whitespace-nowrap">
                          {formatCurrency(Number(it.gross_amount ?? 0))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Justificativa do acate em lote (obrigatória)..."
          rows={2}
          className="text-xs"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedItemIds.length} {selectedItemIds.length === 1 ? "item" : "itens"} selecionado(s)
          </span>
          <Button
            size="sm"
            onClick={handleAccept}
            disabled={loading || selectedItemIds.length === 0 || note.trim().length === 0}
          >
            {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Acatar selecionados
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
