import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { recordAudit, buildDiff } from "@/lib/audit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { ZeevIcon } from "./ZeevIcon";
import {
  useManualInterventionReasons,
  type ManualInterventionReason,
} from "@/hooks/useManualInterventionReasons";

export type ZeevBulkItem = {
  id: string;
  doctor_name?: string | null;
  procedure_code?: string | null;
  procedure_description?: string | null;
  procedure_amount?: number | null;
  attendance_number?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  companyName: string | null;
  title?: string;
  subtitle?: string;
  items: ZeevBulkItem[];
  onApplied?: () => void;
}

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function ZeevBulkManualDialog({
  open,
  onOpenChange,
  paymentId,
  companyName,
  title,
  subtitle,
  items,
  onApplied,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { reasons, byCategory, loading: loadingReasons } =
    useManualInterventionReasons();

  const [reasonId, setReasonId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    reason_code: string;
    confidence: number;
    reasoning: string;
    suggested_note?: string;
  } | null>(null);


  useEffect(() => {
    if (open) {
      setSelected(new Set(items.map((i) => i.id)));
      setReasonId("");
      setNotes("");
      setProgress(null);
    }
    // Reset somente ao abrir; mudanças de referência em `items` não devem limpar o motivo escolhido
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedReason = useMemo(
    () => reasons.find((r) => r.id === reasonId) ?? null,
    [reasons, reasonId],
  );

  const allChecked = selected.size === items.length && items.length > 0;
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)));
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const apply = async () => {
    if (!user?.id) {
      toast({ title: "Não autenticado", variant: "destructive" });
      return;
    }
    if (!reasonId) {
      toast({ title: "Selecione um motivo", variant: "destructive" });
      return;
    }
    const targetItems = items.filter((i) => selected.has(i.id));
    if (targetItems.length === 0) {
      toast({ title: "Nenhum item selecionado", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    setProgress({ done: 0, total: targetItems.length });
    try {
      let done = 0;
      for (const it of targetItems) {
        // Lê procedure_amount atual (igual ManualInterventionDialog)
        const procAmt =
          it.procedure_amount == null ? null : Number(it.procedure_amount);

        const patch: Record<string, unknown> = {
          manual_intervention_reason_id: reasonId,
          manual_intervention_notes: notes.trim() || null,
          manual_intervention_by: user.id,
          manual_intervention_source: "zeev_bulk",
          ai_status: "aprovado",
        };
        if (procAmt != null && Number.isFinite(procAmt)) {
          patch.expected_amount = procAmt;
        }

        const { error } = await supabase
          .from("payment_items")
          .update(patch as never)
          .eq("id", it.id);
        if (error) throw error;

        await recordAudit({
          entityType: "payment_item",
          entityId: it.id,
          action: "update",
          actorId: user.id,
          diff: {
            __op: {
              before: null,
              after: `zeev_bulk_apply:${selectedReason?.code ?? reasonId}`,
            },
            ...buildDiff(
              { manual_intervention_reason_id: null },
              { manual_intervention_reason_id: reasonId },
            ),
          },
        });

        done += 1;
        setProgress({ done, total: targetItems.length });
      }

      // Re-dispara análise da empresa uma única vez
      try {
        await supabase.functions.invoke("dispatch-payment-analysis", {
          body: {
            payment_id: paymentId,
            only_companies: companyName ? [companyName] : undefined,
            force_fresh_rules: true,
          },
        });
      } catch (e) {
        console.warn("[ZeevBulk] dispatch reanalysis falhou", e);
      }

      toast({
        title: `Zeev aplicou em ${targetItems.length} ${targetItems.length === 1 ? "item" : "itens"}`,
        description: "Os itens foram marcados como aprovados via tratativa manual.",
      });
      onOpenChange(false);
      onApplied?.();
    } catch (e: any) {
      toast({
        title: "Falha ao aplicar em lote",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const groupOrder: ManualInterventionReason["category"][] = [
    "reclassificacao_clinica",
    "aceite_financeiro",
  ];
  const groupTitle: Record<ManualInterventionReason["category"], string> = {
    reclassificacao_clinica: "Reclassificação clínica",
    aceite_financeiro: "Aceite financeiro",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZeevIcon variant="circle" size={20} />
            {title ?? "Aplicar tratativa manual em lote"}
          </DialogTitle>
          <DialogDescription>
            {subtitle ??
              "Zeev sugere aplicar a mesma justificativa em todos esses itens. Revise a lista, escolha o motivo e confirme."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Lista de itens */}
          <div className="rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-background/60">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={toggleAll}
                  disabled={submitting}
                  aria-label="Selecionar todos"
                />
                <span className="text-xs font-medium">
                  {selected.size} de {items.length} selecionados
                </span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                tratativa em lote
              </Badge>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y">
              {items.map((it) => (
                <label
                  key={it.id}
                  className="flex items-start gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer text-xs"
                >
                  <Checkbox
                    checked={selected.has(it.id)}
                    onCheckedChange={() => toggle(it.id)}
                    disabled={submitting}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {it.doctor_name ?? "—"}
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                      <span>TUSS {it.procedure_code ?? "—"}</span>
                      {it.attendance_number && (
                        <span>· Atend. {it.attendance_number}</span>
                      )}
                      {it.procedure_description && (
                        <span className="truncate">· {it.procedure_description}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs tabular-nums font-medium shrink-0">
                    {fmtBRL(it.procedure_amount ?? null)}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Motivo (aplicado a todos)</Label>
            <Select
              value={reasonId}
              onValueChange={setReasonId}
              disabled={submitting || loadingReasons}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingReasons ? "Carregando motivos…" : "Selecione um motivo"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {groupOrder.map((cat) => {
                  const list = byCategory[cat];
                  if (!list.length) return null;
                  return (
                    <SelectGroup key={cat}>
                      <SelectLabel>{groupTitle[cat]}</SelectLabel>
                      {list.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedReason?.description && (
              <p className="text-xs text-muted-foreground">
                {selectedReason.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Justificativa (aplicada a todos)</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: paciente com indicação clínica específica conforme acordo com o convênio…"
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              Essa justificativa fica registrada na auditoria de cada um dos itens.
            </p>
          </div>

          {progress && submitting && (
            <div className="text-xs text-muted-foreground">
              Aplicando… {progress.done}/{progress.total}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={apply}
            disabled={submitting || !reasonId || selected.size === 0}
            className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ZeevIcon variant="mark" className="h-4 w-4 mr-1" />
            )}
            Aplicar em {selected.size} {selected.size === 1 ? "item" : "itens"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
