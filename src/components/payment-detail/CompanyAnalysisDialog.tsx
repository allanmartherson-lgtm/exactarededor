import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldCheck,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { formatCurrency, type PaymentStatus } from "@/lib/status";
import { resolveResendTarget } from "@/lib/paymentFlow";
import type {
  GroupRow,
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";
import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";
import { ItemsDataGrid } from "./ItemsDataGrid";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: GroupRow;
  items: PaymentItemRowData[];
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations?: ObservationRow[];
  isAnalista?: boolean;
  isValidador?: boolean;
  isDiretor?: boolean;
  busy?: boolean;
  reanalyzingGroupId?: string | null;
  groupCommentDraft?: string;
  onGroupCommentDraftChange?: (v: string) => void;
  onReanalyze?: (g: GroupRow) => void;
  onResend?: (groupId: string) => void;
  onSendForValidation?: (groupId: string) => void;
  onTransition?: (
    groupId: string,
    to: PaymentStatus,
    actor: "validador" | "diretor",
    label: string,
    requireComment?: boolean,
  ) => void;
  onBackToBatch?: () => void;
};

/**
 * Análise de empresa em modo planilha — dialog full-screen.
 * Apenas embrulha o ItemsDataGrid compartilhado com header e
 * footer de ações de fluxo. Todo o data grid (filtros, tabela densa,
 * expandable row) vive em ItemsDataGrid.tsx.
 */
export function CompanyAnalysisDialog({
  open,
  onOpenChange,
  group,
  items,
  rulesIndex,
  rulesByName,
  observations = [],
  isAnalista,
  isValidador,
  isDiretor,
  busy,
  reanalyzingGroupId,
  groupCommentDraft = "",
  onGroupCommentDraftChange,
  onReanalyze,
  onResend,
  onSendForValidation,
  onTransition,
  onBackToBatch,
}: Props) {
  const { id } = useParams<{ id: string }>();
  const gStatus = group.status as PaymentStatus;
  const isGroupAnalista = !!isAnalista && (gStatus === "revisao_analista" || gStatus === "devolvido_analista");
  const isGroupValidador = !!isValidador && gStatus === "aguardando_validacao";
  const isGroupDiretor = !!isDiretor && gStatus === "aguardando_aprovacao";
  const showFooter = isGroupAnalista || isGroupValidador || isGroupDiretor;
  const returnerForResend =
    gStatus === "devolvido_analista"
      ? resolveResendTarget(observations, group.company_name)?.role ?? null
      : null;

  const counts = useMemo(() => {
    const c = { alerta: 0, critico: 0 };
    for (const it of items) {
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (it.ai_status === "reprovado") c.critico += 1;
      else if (alerts.length > 0 || it.ai_status === "alerta") c.alerta += 1;
    }
    return c;
  }, [items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-screen h-screen p-0 gap-0 sm:rounded-none border-0 flex flex-col overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3 pr-12 bg-background">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (onBackToBatch) onBackToBatch();
              else onOpenChange(false);
            }}
            aria-label="Voltar ao lote"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar ao lote
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base truncate">{group.company_name}</DialogTitle>
            <DialogDescription className="text-xs">
              {group.items_count} itens · {formatCurrency(Number(group.total_amount))}
              {counts.alerta > 0 && <> · <span className="text-warning-foreground">{counts.alerta} alerta(s)</span></>}
              {counts.critico > 0 && <> · <span className="text-destructive">{counts.critico} crítico(s)</span></>}
            </DialogDescription>
          </div>
          <StatusBadge status={gStatus} />
          {id && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/pagamentos/${id}/empresa/${group.id}`} onClick={() => onOpenChange(false)}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir tela dedicada
              </Link>
            </Button>
          )}
        </div>

        {/* Data grid compartilhado */}
        <ItemsDataGrid
          items={items}
          groupStatus={gStatus}
          rulesIndex={rulesIndex}
          rulesByName={rulesByName}
          observations={observations}
          storageKey="companyAnalysisDialog"
          className="flex-1 min-h-0"
        />

        {/* Footer sticky com ações de fluxo */}
        {showFooter && (
          <div className="shrink-0 border-t bg-background/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.2)]">
            <div className="flex flex-col md:flex-row md:items-start gap-2">
              <Textarea
                rows={2}
                value={groupCommentDraft}
                onChange={(e) => onGroupCommentDraftChange?.(e.target.value)}
                placeholder="Observação para esta empresa (obrigatória para devolver/rejeitar)..."
                className="md:flex-1 text-xs"
              />
              <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
                {isGroupAnalista && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReanalyze?.(group)}
                      disabled={busy || reanalyzingGroupId === group.id}
                    >
                      <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzingGroupId === group.id && "animate-spin")} />
                      {reanalyzingGroupId === group.id ? "Reaplicando..." : "Reaplicar regras"}
                    </Button>
                    {returnerForResend ? (
                      <Button size="sm" onClick={() => onResend?.(group.id)} disabled={busy}>
                        <Send className="h-4 w-4 mr-2" /> Reencaminhar ao {returnerForResend}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => onSendForValidation?.(group.id)} disabled={busy}>
                        <Send className="h-4 w-4 mr-2" /> Enviar para validação
                      </Button>
                    )}
                  </>
                )}
                {isGroupValidador && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReanalyze?.(group)}
                      disabled={busy || reanalyzingGroupId === group.id}
                    >
                      <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzingGroupId === group.id && "animate-spin")} />
                      Reaplicar regras
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onTransition?.(group.id, "devolvido_analista", "validador", "Devolvido ao analista", true)}
                      disabled={busy}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" /> Devolver para analista
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => onTransition?.(group.id, "aguardando_aprovacao", "validador", "Validado", false)}
                      disabled={busy}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Validar empresa
                    </Button>
                  </>
                )}
                {isGroupDiretor && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReanalyze?.(group)}
                      disabled={busy || reanalyzingGroupId === group.id}
                    >
                      <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzingGroupId === group.id && "animate-spin")} />
                      Reaplicar regras
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onTransition?.(group.id, "devolvido_analista", "diretor", "Devolvido ao analista", true)}
                      disabled={busy}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" /> Devolver para analista
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onTransition?.(group.id, "rejeitado", "diretor", "Rejeitado", true)}
                      disabled={busy}
                    >
                      <XCircle className="h-4 w-4 mr-2" /> Rejeitar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => onTransition?.(group.id, "aprovado", "diretor", "Aprovado", false)}
                      disabled={busy}
                    >
                      <ShieldCheck className="h-4 w-4 mr-2" /> Aprovar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
