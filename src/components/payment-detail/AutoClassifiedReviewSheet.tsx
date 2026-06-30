import { useMemo, useState } from "react";
import { ListChecks, Check, RotateCcw, Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { recordObservation } from "@/lib/observations";
import { invokeDispatchAnalysis } from "@/lib/dispatchAnalysis";
import { cn } from "@/lib/utils";

type ReviewableItem = {
  id: string;
  attendance_number?: string | null;
  procedure_code?: string | null;
  procedure_description?: string | null;
  company_name?: string | null;
  /** Tipo do item (Parecer/Visita/etc) — coluna canônica `item_type_id`. */
  item_type_id?: string | null;
  item_type_source?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  items: ReviewableItem[];
  lotePaymentTypeId: string | null;
  canEdit: boolean;
  onChanged?: () => void;
}

const AUTO_SOURCES = new Set(["auto_tuss", "auto_heuristic"]);

/**
 * Painel de revisão dos itens auto-reclassificados (lote misto).
 * Permite ao analista ACEITAR (vira source=manual, mantendo o tipo sugerido)
 * ou REVERTER (volta ao tipo do lote) cada item, com justificativa opcional
 * registrada no histórico via payment_observations (observation_type=justificativa_override).
 *
 * Após qualquer mudança, dispara reanálise filtrada pelas empresas afetadas.
 */
export function AutoClassifiedReviewSheet({
  open,
  onOpenChange,
  paymentId,
  items,
  lotePaymentTypeId,
  canEdit,
  onChanged,
}: Props) {
  const { list: paymentTypes } = usePaymentTypes({ onlyActive: true });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justifById, setJustifById] = useState<Record<string, string>>({});
  const [dispatching, setDispatching] = useState(false);
  const [touched, setTouched] = useState(false);

  const ptLabel = (id?: string | null) =>
    paymentTypes.find((t) => t.id === id)?.label ?? "—";

  const rows = useMemo(() => {
    return items.filter((it) => {
      const src = String(it.item_type_source ?? "");
      if (!AUTO_SOURCES.has(src)) return false;
      const itemTypeId = it.item_type_id ?? null;
      return !!itemTypeId && itemTypeId !== lotePaymentTypeId;
    });
  }, [items, lotePaymentTypeId]);

  const counts = useMemo(() => {
    let tuss = 0, heur = 0;
    for (const r of rows) {
      if (r.item_type_source === "auto_tuss") tuss++;
      else if (r.item_type_source === "auto_heuristic") heur++;
    }
    return { tuss, heur, total: rows.length };
  }, [rows]);

  async function logJustification(itemId: string, message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const actorId = userRes?.user?.id;
      if (!actorId) return;
      await recordObservation({
        payment_id: paymentId,
        author_type: "analista",
        author_id: actorId,
        item_id: itemId,
        message: trimmed,
        observation_type: "justificativa_override",
      });
    } catch (e) {
      console.warn("[AutoClassifiedReviewSheet] log justification falhou", e);
    }
  }

  async function acceptItem(it: ReviewableItem) {
    if (!canEdit || busyId) return;
    setBusyId(it.id);
    try {
      // Escrita dupla (item_type_source canônico + payment_type_source legacy)
      // — o trigger sync_payment_items_type_columns mirroring uma direção só,
      // garantimos a consistência explícita por aqui.
      const { error } = await supabase
        .from("payment_items")
        .update({ item_type_source: "manual", payment_type_source: "manual" } as any)
        .eq("id", it.id);
      if (error) {
        toast({ title: "Falha ao confirmar", description: error.message, variant: "destructive" });
        return;
      }
      await logJustification(it.id, justifById[it.id] ?? "");
      toast({ title: "Reclassificação confirmada", description: ptLabel(it.item_type_id) });
      setTouched(true);
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function revertItem(it: ReviewableItem) {
    if (!canEdit || busyId) return;
    setBusyId(it.id);
    try {
      // IMPORTANTE: limpar BOTH item_type_id e payment_type_id no mesmo UPDATE.
      // O trigger sync_payment_items_type_columns re-preenche payment_type_id
      // a partir de item_type_id se só um for setado como null — bug sutil.
      const { error } = await supabase
        .from("payment_items")
        .update({
          item_type_id: null,
          item_type_source: null,
          payment_type_id: null,
          payment_type_source: null,
        } as any)
        .eq("id", it.id);
      if (error) {
        toast({ title: "Falha ao reverter", description: error.message, variant: "destructive" });
        return;
      }
      const j = justifById[it.id] ?? "";
      await logJustification(
        it.id,
        j ? `Revertido ao padrão do lote. ${j}` : "Revertido ao padrão do lote.",
      );
      toast({ title: "Item revertido ao padrão do lote" });
      setTouched(true);
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function reanalyzeNow() {
    if (!paymentId) return;
    setDispatching(true);
    try {
      const affected = Array.from(new Set(rows.map((r) => r.company_name).filter(Boolean) as string[]));
      await invokeDispatchAnalysis(
        {
          payment_id: paymentId,
          ...(affected.length > 0 ? { only_companies: affected } : {}),
          force_fresh_rules: true,
          skip_ai: true,
        },
        { showToast: false },
      );
      toast({ title: "Reanálise disparada" });
      setTouched(false);
      onChanged?.();
    } finally {
      setDispatching(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && touched) {
      // Garante que o motor recalcule antes do usuário voltar à grade.
      void reanalyzeNow();
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-600" />
            Revisar reclassificações automáticas
          </SheetTitle>
          <SheetDescription className="text-xs">
            Confirme ou reverta cada item que o motor classificou de forma diferente
            do tipo do lote ({ptLabel(lotePaymentTypeId)}).
          </SheetDescription>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              total · {counts.total}
            </Badge>
            {counts.tuss > 0 && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">TUSS · {counts.tuss}</Badge>
            )}
            {counts.heur > 0 && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">heurística · {counts.heur}</Badge>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4 space-y-3">
            {rows.length === 0 && (
              <div className="text-xs text-muted-foreground py-8 text-center">
                Nenhum item pendente de revisão.
              </div>
            )}
            {rows.map((it) => {
              const suggested = ptLabel(it.item_type_id);
              const lote = ptLabel(lotePaymentTypeId);
              const srcLabel = it.item_type_source === "auto_tuss" ? "TUSS" : "heurística";
              const isBusy = busyId === it.id;
              return (
                <div
                  key={it.id}
                  className={cn(
                    "rounded-lg border border-violet-200/60 bg-violet-50/40 p-3 space-y-2",
                    "dark:bg-violet-950/15 dark:border-violet-900/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-medium truncate">
                        Atend. {it.attendance_number ?? "—"} · TUSS {it.procedure_code ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">
                        {it.procedure_description ?? "—"}
                      </div>
                      {it.company_name && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {it.company_name}
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] shrink-0">
                      {srcLabel}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">{lote}</span>
                    <span className="text-muted-foreground">→</span>
                    <Badge className="h-5 px-1.5 text-[10px]">{suggested}</Badge>
                  </div>

                  <Textarea
                    placeholder="Justificativa (opcional)"
                    value={justifById[it.id] ?? ""}
                    onChange={(e) =>
                      setJustifById((prev) => ({ ...prev, [it.id]: e.target.value }))
                    }
                    rows={2}
                    className="text-xs min-h-[44px]"
                    disabled={!canEdit || isBusy}
                  />

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={!canEdit || isBusy}
                      onClick={() => revertItem(it)}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reverter
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={!canEdit || isBusy}
                      onClick={() => acceptItem(it)}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3 mr-1" />
                      )}
                      Confirmar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <Separator />
        <div className="px-6 py-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground">
            {touched
              ? "Alterações pendentes — reanalisar para aplicar nas regras."
              : "Sem alterações pendentes."}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={reanalyzeNow}
            disabled={dispatching || !touched}
          >
            {dispatching ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <ListChecks className="h-3 w-3 mr-1" />
            )}
            Reanalisar agora
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
