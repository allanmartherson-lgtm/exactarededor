import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";

export type CancelledItemRow = {
  id: string;
  doctor_name?: string | null;
  procedure_code?: string | null;
  procedure_name?: string | null;
  gross_amount?: number | null;
  cancelled_at?: string | null;
  cancellation_source?: string | null;
  cancellation_reason?: string | null;
  cancellation_note?: string | null;
  cancellation_reactivated_at?: string | null;
  is_cancelled?: boolean | null;
};

export type CancelledItemsBannerProps = {
  items: CancelledItemRow[];
  canReactivate: boolean;
  onReactivated: () => void | Promise<void>;
};

/**
 * Banner amarelo na página da empresa quando há itens cancelados
 * individualmente (tipicamente via conciliação) que continuam ativos
 * no banco — `is_cancelled=true` e `cancellation_reactivated_at` nulo.
 *
 * Complementa o `CancelledGroupBanner` (que cobre cancelamento do grupo inteiro).
 * Sem este banner, itens cancelados item-a-item ficam invisíveis na tela
 * da empresa, dificultando auditoria e reversão.
 */
export function CancelledItemsBanner({ items, canReactivate, onReactivated }: CancelledItemsBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Rastreia individualmente itens em reativação para permitir feedback por linha
  // e evitar que um clique acidental dispare duas chamadas simultâneas no mesmo id.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const cancelled = useMemo(
    () =>
      (items ?? []).filter(
        (it) => it.is_cancelled === true && !it.cancellation_reactivated_at,
      ),
    [items],
  );

  if (cancelled.length === 0) return null;

  const total = cancelled.reduce((s, it) => s + Number(it.gross_amount ?? 0), 0);
  const oldest = cancelled
    .map((it) => it.cancelled_at)
    .filter(Boolean)
    .sort()[0];
  const anyBusy = batchBusy || inFlight.size > 0;

  const toggleAll = () => {
    if (selected.size === cancelled.length) setSelected(new Set());
    else setSelected(new Set(cancelled.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const reactivate = async (ids: string[]) => {
    // Filtra ids que já estão em vôo para idempotência contra cliques duplos.
    const targets = ids.filter((id) => !inFlight.has(id));
    if (targets.length === 0) return;

    const isBatch = targets.length > 1;
    if (isBatch) setBatchBusy(true);
    setInFlight((prev) => {
      const next = new Set(prev);
      for (const id of targets) next.add(id);
      return next;
    });

    const toastId = isBatch ? toast.loading(`Reativando ${targets.length} itens...`) : undefined;
    let ok = 0;
    const errors: string[] = [];

    // Sequencial: a RPC toca o mesmo PCG (totais, status); paralelo pode causar
    // condições de corrida no recálculo. Sequencial é simples e suficiente.
    for (const itemId of targets) {
      const { error } = await supabase.rpc("reactivate_cancelled_item", { p_item_id: itemId });
      if (error) errors.push(`${itemId.slice(0, 8)}: ${error.message}`);
      else ok++;
    }

    setInFlight((prev) => {
      const next = new Set(prev);
      for (const id of targets) next.delete(id);
      return next;
    });
    if (isBatch) setBatchBusy(false);

    if (toastId !== undefined) toast.dismiss(toastId);
    if (ok > 0 && errors.length === 0) {
      toast.success(ok === 1 ? "Item reativado" : `${ok} itens reativados`);
    } else if (ok > 0 && errors.length > 0) {
      toast.warning(`${ok} reativados, ${errors.length} falharam`, {
        description: errors[0],
      });
    } else {
      toast.error("Falha ao reativar", { description: errors[0] ?? "Erro desconhecido" });
    }

    // Limpa só os ids que foram efetivamente processados (preserva seleção restante).
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of targets) next.delete(id);
      return next;
    });
    await onReactivated();
  };

  return (
    <div
      className="rounded-md border-2 border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-3"
      data-testid="cancelled-items-banner"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {cancelled.length} {cancelled.length === 1 ? "item cancelado individualmente" : "itens cancelados individualmente"}{" "}
            — total {formatCurrency(total)}
            {oldest ? ` · desde ${new Date(oldest).toLocaleDateString("pt-BR")}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Cancelamentos item-a-item (tipicamente via conciliação) permanecem no banco mas saem do pagamento.
            Use "Ver itens" para auditar ou reverter individualmente.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 self-start md:self-auto"
          data-testid="toggle-cancelled-items"
        >
          {expanded ? <ChevronUp className="h-4 w-4 mr-1.5" /> : <ChevronDown className="h-4 w-4 mr-1.5" />}
          {expanded ? "Ocultar" : "Ver itens"}
        </Button>
      </div>

      {expanded && (
        <div className="rounded border border-amber-500/30 bg-background/60 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={selected.size === cancelled.length && cancelled.length > 0}
                onCheckedChange={toggleAll}
                aria-label="Selecionar todos"
                disabled={!canReactivate || anyBusy}
              />
              <span className="text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selecionado(s)` : "Selecionar"}
              </span>
            </div>
            {canReactivate ? (
              <Button
                size="sm"
                variant="default"
                disabled={anyBusy || selected.size === 0}
                onClick={() => reactivate(Array.from(selected))}
                data-testid="reactivate-selected-items"
              >
                <Undo2 className="h-4 w-4 mr-1.5" />
                {batchBusy ? "Reativando..." : "Reativar selecionados"}
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Reativação restrita a Supervisor / Diretor / Admin.
              </span>
            )}
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background/95">
                <tr className="text-left text-muted-foreground border-b">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Médico</th>
                  <th className="px-3 py-2">Procedimento</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {cancelled.map((it) => {
                  const reasonTxt = it.cancellation_reason ? it.cancellation_reason.replace(/_/g, " ") : "—";
                  const srcTxt = it.cancellation_source === "reconciliacao" ? " (conciliação)" : "";
                  return (
                    <tr key={it.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.has(it.id)}
                          onCheckedChange={() => toggleOne(it.id)}
                          aria-label={`Selecionar ${it.doctor_name ?? it.id}`}
                          disabled={!canReactivate || anyBusy}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{it.doctor_name ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[11px]">{it.procedure_code ?? ""}</span>
                        <span className="text-muted-foreground"> · {it.procedure_name ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(it.gross_amount ?? 0))}</td>
                      <td className="px-3 py-2">
                        <span>{reasonTxt}{srcTxt}</span>
                        {it.cancellation_note ? (
                          <div className="text-muted-foreground italic truncate max-w-[200px]" title={it.cancellation_note}>
                            {it.cancellation_note}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {it.cancelled_at ? new Date(it.cancelled_at).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canReactivate && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => reactivate([it.id])}
                          >
                            <Undo2 className="h-3.5 w-3.5 mr-1" /> Reativar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
