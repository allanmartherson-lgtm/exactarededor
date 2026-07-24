/**
 * InterventionReasonSelect — painel compacto que o analista usa para escolher
 * um motivo categorizado ANTES de executar uma intervenção (acate, exclusão,
 * edição). Usado dentro de um Popover no split-button e inline no dialog de
 * edição — nunca como Dialog modal, para permitir processar itens em sequência.
 */
import React, { useMemo, useState } from "react";
import {
  useManualInterventionReasons,
  type InterventionAction,
  type ManualInterventionReason,
  type FinancialImpact,
} from "@/hooks/useManualInterventionReasons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { impactBadgeClass, impactLabel } from "@/lib/saveIntervention";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Info } from "lucide-react";

type Props = {
  action: InterventionAction;
  /** Rótulo da ação (ex.: "Acatar", "Excluir"). */
  actionLabel?: string;
  /** Se informado, pré-seleciona esse motivo. */
  defaultReasonId?: string | null;
  defaultNotes?: string | null;
  /**
   * Restringe os motivos exibidos aos impactos financeiros informados.
   * Ex.: quando o delta indica economia, passar `["economia","neutro"]`
   * para esconder motivos de "Perda" que não fazem sentido no contexto.
   */
  impactFilter?: FinancialImpact[];
  onConfirm?: (payload: {
    reason: ManualInterventionReason;
    notes: string;
  }) => void | Promise<void>;
  onCancel?: () => void;
  /** Executa o confirm em modo submitting (bloqueia o botão). */
  submitting?: boolean;
  /** Compacto = usado dentro de popover (menos padding). */
  compact?: boolean;
  /** Modo inline (dialog de edição) — esconde botões e emite via onChange. */
  hideActions?: boolean;
  onChange?: (state: {
    reasonId: string;
    reason: ManualInterventionReason | null;
    notes: string;
  }) => void;
};


const CATEGORY_TITLE: Record<ManualInterventionReason["category"], string> = {
  aceite_financeiro: "Aceite financeiro",
  reclassificacao_clinica: "Reclassificação clínica",
  operacional: "Operacional",
};

export function InterventionReasonSelect({
  action,
  actionLabel,
  defaultReasonId,
  defaultNotes,
  impactFilter,
  onConfirm,
  onCancel,
  submitting = false,
  compact = false,
  hideActions = false,
  onChange,
}: Props) {
  const { reasons: allReasons, loading } = useManualInterventionReasons({
    appliesTo: action,
  });
  const reasons = useMemo(() => {
    if (!impactFilter || impactFilter.length === 0) return allReasons;
    const allow = new Set(impactFilter);
    return allReasons.filter((r) => allow.has(r.financial_impact));
  }, [allReasons, impactFilter]);
  const byCategory = useMemo(
    () => ({
      reclassificacao_clinica: reasons.filter((r) => r.category === "reclassificacao_clinica"),
      aceite_financeiro: reasons.filter((r) => r.category === "aceite_financeiro"),
      operacional: reasons.filter((r) => r.category === "operacional"),
    }),
    [reasons],
  );
  const [reasonId, setReasonId] = useState<string>(defaultReasonId ?? "");
  const [notes, setNotes] = useState<string>(defaultNotes ?? "");

  const selected = useMemo(
    () => reasons.find((r) => r.id === reasonId) ?? null,
    [reasons, reasonId],
  );

  // Se o motivo pré-selecionado sumiu por conta do filtro, limpa.
  React.useEffect(() => {
    if (reasonId && !reasons.some((r) => r.id === reasonId)) {
      setReasonId("");
    }
  }, [reasons, reasonId]);


  // Emite alterações para o pai no modo inline (usado no dialog de edição).
  React.useEffect(() => {
    onChange?.({ reasonId, reason: selected, notes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasonId, selected, notes]);

  const cats = (
    ["aceite_financeiro", "reclassificacao_clinica", "operacional"] as const
  ).filter((c) => (byCategory[c]?.length ?? 0) > 0);

  const handleConfirm = async () => {
    if (!selected || !onConfirm) return;
    await onConfirm({ reason: selected, notes: notes.trim() });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "flex flex-col gap-2",
          compact ? "min-w-[320px]" : "min-w-[360px]",
        )}
      >
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {actionLabel ? `Motivo — ${actionLabel}` : "Motivo da intervenção"}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Escolha o motivo categorizado antes de confirmar.
          </p>
        </div>

        <div
          className={cn(
            "rounded-md border bg-background",
            compact ? "max-h-[240px]" : "max-h-[320px]",
            "overflow-y-auto",
          )}
        >
          {loading ? (
            <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando motivos…
            </div>
          ) : reasons.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">
              Nenhum motivo cadastrado para esta ação. Cadastre em
              Configurações → Motivos de intervenção.
            </div>
          ) : (
            cats.map((cat) => (
              <div key={cat} className="border-b last:border-b-0">
                <div className="px-3 py-1.5 bg-muted/40 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground sticky top-0">
                  {CATEGORY_TITLE[cat]}
                </div>
                <ul className="divide-y">
                  {byCategory[cat].map((r) => {
                    const active = r.id === reasonId;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setReasonId(r.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/40 transition-colors",
                            active && "bg-primary/5",
                          )}
                        >
                          <input
                            type="radio"
                            className="mt-1 accent-primary"
                            checked={active}
                            readOnly
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[13px] font-medium">
                                {r.label}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                                  impactBadgeClass(r.financial_impact),
                                )}
                              >
                                {impactLabel(r.financial_impact)}
                              </span>
                              {r.description && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="h-3 w-3 text-muted-foreground" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[280px]">
                                    {r.description}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Observações (opcional)
          </Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contexto adicional para auditoria…"
            className="text-[13px]"
          />
        </div>

        {!hideActions && (
          <div className="flex items-center justify-end gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={submitting}
              >
                Cancelar
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!selected || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{" "}
                  Executando…
                </>
              ) : (
                `Confirmar ${actionLabel ?? ""}`.trim()
              )}
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
