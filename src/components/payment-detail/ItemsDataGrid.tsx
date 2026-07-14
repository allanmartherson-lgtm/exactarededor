import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "./AlertBanner";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { SafeCard } from "@/components/ui/SafeCard";
import { CalcDuplicityResolverPanel } from "./CalcDuplicityResolverPanel";
import { PaymentTypeOverrideAction } from "./PaymentTypeOverrideAction";
import { useItemTypes } from "@/hooks/useItemTypes";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { X as XIcon } from "lucide-react";
import { deriveConfeccaoStatus, CONFECCAO_STATUS_LABEL, CONFECCAO_STATUS_TONE } from "@/lib/itemConfeccaoStatus";
import { buildReclassifyPatch } from "@/lib/reclassifyItemType";
import {
  AlertTriangle,
  ArrowUpDown,
  Columns3,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  CheckCircle2,
  CheckSquare,
  HandCoins,
  FileText,
  FilterX,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { invokeDispatchAnalysis } from "@/lib/dispatchAnalysis";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  SEVERITY_TOKENS,
  actionToLevel,
  dominantLevel,
  flashHighlight,
  type SeverityLevel,
} from "@/lib/uiSignals";
import {
  formatCurrency,
  TONE_CLASSES,
  type ItemAiStatus,
  type PaymentStatus,
  RULE_MATCH_PRIORITY_LABELS,
  RULE_MATCH_PRIORITY_TONES,
  RULE_CALCULATION_TYPE_LABELS,
  type RuleMatchPriority,
  type RuleCalculationType,
} from "@/lib/status";
import { effectiveItemAiStatus } from "@/lib/paymentFlow";
import type {
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";
import { AttendanceCoherencePanel } from "./AttendanceCoherencePanel";
import { formatDateBR, formatDateTimeBR } from "@/lib/dateUtils";
import { formatSectorName } from "@/lib/sectorDisplay";
import { getAgreement, getPatient, getAccessRoute, getProcedureCode, getProcedureName, getDoctorRole, rawPick } from "@/lib/itemFields";
import { detectTussMismatch, REASON_LABELS as TUSS_REASON_LABELS } from "@/lib/tussPrincipalAudit";
import { useSectorAliases } from "@/hooks/useSectorAliases";

const SECTOR_RAW_KEYS = ["setor", "unidade", "unidade de atendimento", "departamento", "servico", "serviço"] as const;
import { authorRoleLabel } from "@/lib/observations";
import { MarkSpecialCaseDialog } from "./MarkSpecialCaseDialog";
import { useHasSpecialCaseRules } from "./useHasSpecialCaseRules";
import { CalcExceptionDialog } from "./CalcExceptionDialog";
import { ManualInterventionDialog } from "./ManualInterventionDialog";
import { PaymentItemExplainButton } from "@/components/copilot/PaymentItemExplainButton";

/** Botão "Sinalizar caso especial" para um item específico — só aparece
 * quando existe ao menos 1 regra ativa do hospital com special_case_filter. */
function SpecialCaseItemAction({
  paymentId, itemId, attendance, doctorId,
}: {
  paymentId: string;
  itemId: string;
  attendance: string | null;
  doctorId: string | null;
}) {
  const hasRules = useHasSpecialCaseRules(paymentId);
  if (hasRules !== true) return null;
  return (
    <div className="rounded-md border border-dashed border-indigo-300/70 bg-indigo-50/40 dark:bg-indigo-950/15 dark:border-indigo-900/60 px-3 py-2 flex items-center justify-between gap-2">
      <p className="text-xs text-indigo-900/80 dark:text-indigo-200/80">
        Este item se aplica a um caso especial?
      </p>
      <MarkSpecialCaseDialog
        paymentId={paymentId}
        itemId={itemId}
        defaultAttendance={attendance ?? undefined}
        doctorId={doctorId ?? undefined}
        trigger={
          <Button size="sm" variant="outline" className="h-7 text-xs">
            <Sparkles className="h-3.5 w-3.5 mr-1" /> Sinalizar caso especial
          </Button>
        }
      />
    </div>
  );
}

/** Botão "Exceção do cálculo" para um item específico — só aparece quando o
 *  cálculo aplicado ao item tem `item_type_id` setado (ex.: Parecer).
 *  Marcar faz o motor pular esse cálculo e cair no próximo elegível. */
function CalcExceptionItemAction({
  paymentId,
  item,
}: {
  paymentId: string;
  item: PaymentItemRowData & {
    applied_calc_id?: string | null;
    company_name?: string | null;
    calc_exception_skip?: boolean | null;
    calc_exception_reason?: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [calcMeta, setCalcMeta] = useState<{
    item_type_id: string | null;
    label: string | null;
  } | null>(null);

  const calcId = item.applied_calc_id ?? null;
  const isMarked = !!item.calc_exception_skip;

  useEffect(() => {
    if (!calcId) {
      setCalcMeta(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("rule_calculations")
      .select("item_type_id,label")
      .eq("id", calcId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as any;
        setCalcMeta(
          d
            ? { item_type_id: d.item_type_id ?? null, label: d.label ?? null }
            : null,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [calcId]);

  const hasTypedCalc = !!calcMeta?.item_type_id;
  if (!isMarked && !hasTypedCalc) return null;

  return (
    <>
      <div
        className={cn(
          "rounded-md border border-dashed px-3 py-2 flex flex-col gap-2 min-w-0 max-w-full",
          isMarked
            ? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/70"
            : "border-sky-300/70 bg-sky-50/40 dark:bg-sky-950/15 dark:border-sky-900/60",
        )}
      >

        <p
          className={cn(
            "text-xs min-w-0 break-words",
            isMarked
              ? "text-amber-900 dark:text-amber-200"
              : "text-sky-900/80 dark:text-sky-200/80",
          )}
        >


          {isMarked ? (
            <>
              <strong>Exceção do cálculo ativa</strong> — pulando
              {calcMeta?.label ? ` "${calcMeta.label}"` : " cálculo tipado"}.
            </>
          ) : (
            <>
              Item está usando o cálculo tipado
              {calcMeta?.label ? ` "${calcMeta.label}"` : ""}. Pular e pagar
              pelo próximo cálculo da regra?
            </>
          )}
        </p>
        <Button
          size="sm"
          variant={isMarked ? "ghost" : "outline"}
          className="h-7 text-xs whitespace-nowrap self-start shrink-0"

          onClick={() => setOpen(true)}
        >
          {isMarked ? (
            <>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Remover
            </>
          ) : (
            <>
              <FilterX className="h-3.5 w-3.5 mr-1" /> Marcar exceção
            </>
          )}
        </Button>
      </div>
      <CalcExceptionDialog
        open={open}
        onOpenChange={setOpen}
        itemId={item.id}
        paymentId={paymentId}
        companyName={(item as any).company_name ?? null}
        appliedCalcId={calcId}
        current={{
          calc_exception_skip: item.calc_exception_skip ?? false,
          calc_exception_reason: item.calc_exception_reason ?? null,
        }}
        skippedCalcLabel={calcMeta?.label ?? null}
      />
    </>
  );
}

/** Versão compacta em ícone — usada na coluna AÇÕES da grade. */
function CalcExceptionItemIconAction({
  paymentId,
  item,
}: {
  paymentId: string;
  item: PaymentItemRowData & {
    applied_calc_id?: string | null;
    company_name?: string | null;
    calc_exception_skip?: boolean | null;
    calc_exception_reason?: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [calcMeta, setCalcMeta] = useState<{ item_type_id: string | null; label: string | null } | null>(null);
  const calcId = item.applied_calc_id ?? null;
  const isMarked = !!item.calc_exception_skip;

  useEffect(() => {
    if (!calcId) { setCalcMeta(null); return; }
    let cancelled = false;
    supabase.from("rule_calculations").select("item_type_id,label").eq("id", calcId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as any;
        setCalcMeta(d ? { item_type_id: d.item_type_id ?? null, label: d.label ?? null } : null);
      });
    return () => { cancelled = true; };
  }, [calcId]);

  const hasTypedCalc = !!calcMeta?.item_type_id;
  if (!isMarked && !hasTypedCalc) return null;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className={cn(
          "h-6 w-6",
          isMarked && "text-amber-600 hover:text-amber-700 bg-amber-50 dark:bg-amber-950/30"
        )}
        title={
          isMarked
            ? `Exceção do cálculo ativa — pulando ${calcMeta?.label ?? "cálculo tipado"}. Clique para remover.`
            : `Marcar exceção — pular cálculo ${calcMeta?.label ?? "tipado"} e pagar pelo próximo da regra`
        }
        onClick={() => setOpen(true)}
      >
        <FilterX className="h-3.5 w-3.5" />
      </Button>
      <CalcExceptionDialog
        open={open}
        onOpenChange={setOpen}
        itemId={item.id}
        paymentId={paymentId}
        companyName={(item as any).company_name ?? null}
        appliedCalcId={calcId}
        current={{
          calc_exception_skip: item.calc_exception_skip ?? false,
          calc_exception_reason: item.calc_exception_reason ?? null,
        }}
        skippedCalcLabel={calcMeta?.label ?? null}
      />
    </>
  );
}


/** Botão de ícone "Tratar manualmente" — abre o ManualInterventionDialog
 *  unificado (reclassificação clínica + aceite financeiro). Sempre visível
 *  para itens não-bonus; muda de cor quando há um tratamento manual ativo. */
function ManualInterventionItemIconAction({
  paymentId,
  item,
  preferCategory,
  onApplied,
}: {
  paymentId: string;
  item: PaymentItemRowData & {
    company_name?: string | null;
    manual_intervention_reason_id?: string | null;
    manual_intervention_notes?: string | null;
    manual_intervention_source?: string | null;
  };
  preferCategory?: "reclassificacao_clinica" | "aceite_financeiro";
  onApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isMarked = !!item.manual_intervention_reason_id;
  const isAuto = item.manual_intervention_source === "auto_parecer_report";

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className={cn(
          "h-6 w-6",
          isMarked &&
            "text-violet-600 hover:text-violet-700 bg-violet-50 dark:bg-violet-950/30",
        )}
        title={
          isMarked
            ? `Tratamento manual ativo${
                isAuto ? " (aplicado automaticamente via relatório de parecer)" : ""
              }. Clique para revisar ou remover.`
            : "Tratar item manualmente — aceitar valor do convênio com motivo"
        }
        onClick={() => setOpen(true)}
      >
        <Wrench className="h-3.5 w-3.5" />
      </Button>
      <ManualInterventionDialog
        open={open}
        onOpenChange={setOpen}
        itemId={item.id}
        paymentId={paymentId}
        companyName={(item as any).company_name ?? null}
        current={{
          manual_intervention_reason_id:
            item.manual_intervention_reason_id ?? null,
          manual_intervention_notes: item.manual_intervention_notes ?? null,
        }}
        preferCategory={preferCategory}
        onApplied={onApplied}
      />
    </>
  );
}

/** Menu compacto "Mais ações" — agrupa Exceção de cálculo + Tratar manualmente
 *  para não poluir a coluna AÇÕES. Mostra ponto colorido quando há algo ativo. */
function RowMoreActionsMenu({
  paymentId,
  item,
}: {
  paymentId: string;
  item: PaymentItemRowData & {
    applied_calc_id?: string | null;
    company_name?: string | null;
    calc_exception_skip?: boolean | null;
    calc_exception_reason?: string | null;
    manual_intervention_reason_id?: string | null;
    manual_intervention_notes?: string | null;
    manual_intervention_source?: string | null;
  };
}) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [calcMeta, setCalcMeta] = useState<{ item_type_id: string | null; label: string | null } | null>(null);
  const calcId = item.applied_calc_id ?? null;

  useEffect(() => {
    if (!calcId) { setCalcMeta(null); return; }
    let cancelled = false;
    supabase.from("rule_calculations").select("item_type_id,label").eq("id", calcId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as any;
        setCalcMeta(d ? { item_type_id: d.item_type_id ?? null, label: d.label ?? null } : null);
      });
    return () => { cancelled = true; };
  }, [calcId]);

  const hasTypedCalc = !!calcMeta?.item_type_id;
  const calcMarked = !!item.calc_exception_skip;
  const manualMarked = !!item.manual_intervention_reason_id;
  const isAuto = item.manual_intervention_source === "auto_parecer_report";
  const anyActive = calcMarked || manualMarked;
  // Esconde quando nada faz sentido para esse item (sem cálculo tipado e sem nada ativo)
  if (!hasTypedCalc && !anyActive && !calcMarked) {
    // ainda assim mostramos o menu para permitir "tratar manualmente"
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "h-6 w-6 relative",
              anyActive && "text-foreground",
            )}
            title="Mais ações (exceção de cálculo, tratamento manual)"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            {anyActive && (
              <span
                className={cn(
                  "absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full",
                  manualMarked ? "bg-violet-500" : "bg-amber-500",
                )}
                aria-hidden="true"
              />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">Ações avançadas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setManualOpen(true)}>
            <Wrench
              className={cn(
                "h-3.5 w-3.5 mr-2",
                manualMarked ? "text-violet-600" : "text-muted-foreground",
              )}
            />
            <div className="flex flex-col">
              <span className="text-sm">
                {manualMarked ? "Revisar tratamento manual" : "Tratar manualmente"}
              </span>
              {manualMarked && (
                <span className="text-[11px] text-muted-foreground">
                  {isAuto ? "Aplicado automaticamente via parecer" : "Tratamento ativo"}
                </span>
              )}
            </div>
          </DropdownMenuItem>
          {(hasTypedCalc || calcMarked) && (
            <DropdownMenuItem onClick={() => setCalcOpen(true)}>
              <FilterX
                className={cn(
                  "h-3.5 w-3.5 mr-2",
                  calcMarked ? "text-amber-600" : "text-muted-foreground",
                )}
              />
              <div className="flex flex-col">
                <span className="text-sm">
                  {calcMarked ? "Remover exceção de cálculo" : "Marcar exceção de cálculo"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {calcMarked
                    ? `Pulando ${calcMeta?.label ?? "cálculo tipado"}`
                    : `Pular ${calcMeta?.label ?? "cálculo tipado"} e ir para o próximo`}
                </span>
              </div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ManualInterventionDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        itemId={item.id}
        paymentId={paymentId}
        companyName={(item as any).company_name ?? null}
        current={{
          manual_intervention_reason_id: item.manual_intervention_reason_id ?? null,
          manual_intervention_notes: item.manual_intervention_notes ?? null,
        }}
      />

      {(hasTypedCalc || calcMarked) && (
        <CalcExceptionDialog
          open={calcOpen}
          onOpenChange={setCalcOpen}
          itemId={item.id}
          paymentId={paymentId}
          companyName={(item as any).company_name ?? null}
          appliedCalcId={calcId}
          current={{
            calc_exception_skip: item.calc_exception_skip ?? false,
            calc_exception_reason: item.calc_exception_reason ?? null,
          }}
          skippedCalcLabel={calcMeta?.label ?? null}
        />
      )}
    </>
  );
}







// ============ TIPOGRAFIA UNIFICADA (tabela + painel expandido) ============
// Mesmo set tipográfico usado em AlertBanner, headers, cells e detalhes.
// Tamanho de referência = AlertBanner (text-xs / 12px).
export const TEXT_BODY = "text-xs leading-snug tracking-normal";
export const TEXT_LABEL = "text-[10px] uppercase tracking-wide font-medium text-muted-foreground leading-tight [&_button]:uppercase [&_button]:!text-[10px] [&_button]:!font-medium [&_button]:tracking-wide [&_button]:!leading-tight";
// Classe explícita para <button> dentro de headers ordenáveis — garante o mesmo tamanho
// dos headers não-ordenáveis (alguns navegadores ignoram herança de font-size em <button>).
export const HEAD_BTN = "text-[10px] leading-tight uppercase tracking-wide font-medium";
export const TEXT_META = "text-[10px] leading-tight tracking-normal text-muted-foreground";

function ParecerEvidenceBadge({ item }: { item: PaymentItemRowData }) {
  const evidence = ((item as any).parecer_evidence ?? null) as string | null;
  const isWeak = (item as any).parecer_evidence_weak === true;
  const wasReclassified = (item as any).reclassified_from_parecer === true;
  if (!evidence) return null;
  if (evidence === "confirmed") {
    if (wasReclassified) {
      return (
        <span
          className={cn(
            "inline-flex items-center h-4 gap-0.5 rounded px-1 text-[10px] border",
            "bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-900/40 dark:text-slate-200 dark:border-slate-700",
          )}
          title="Parecer cruzado no relatório, MAS rebaixado para Visita (já existe parecer anterior pago neste atendimento). Pagamento segue a regra de Visita."
        >
          <FileText className="h-2.5 w-2.5" />
          P→V
        </span>
      );
    }
    return (
      <span
        className={cn(
          "inline-flex items-center h-4 gap-0.5 rounded px-1 text-[10px] border",
          isWeak
            ? "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800"
            : "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800",
        )}
        title={
          isWeak
            ? "Parecer cruzado por atendimento e médico, mas com confirmação fraca/divergente"
            : "Parecer cruzado por atendimento, data e médico"
        }
      >
        <FileText className="h-2.5 w-2.5" />
        {isWeak ? "P?" : "P✓"}
      </span>
    );
  }
  if (evidence === "unverified") {
    return (
      <span
        className="inline-flex items-center h-4 gap-0.5 rounded px-1 text-[10px] border bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800"
        title="Parecer sem registro no relatório do Tasy — analista precisa confirmar ou reclassificar como Visita"
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        Sem registro Tasy
      </span>
    );
  }
  if (evidence === "not_applicable") {
    return (
      <span
        className="inline-flex items-center h-4 gap-0.5 rounded px-1 text-[10px] bg-muted text-muted-foreground border border-border"
        title="Contato subsequente — classificado como visita"
      >
        <FileText className="h-2.5 w-2.5" />
        V
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center h-4 gap-0.5 rounded px-1 text-[10px] bg-muted text-muted-foreground border border-border"
      title={evidence === "no_report" ? "Nenhum relatório de parecer importado" : "Sem parecer cruzado para atendimento/data/médico"}
    >
      <FileText className="h-2.5 w-2.5" />
      P×
    </span>
  );
}

/** Detecta divergência semântica entre a descrição da linha e a classificação
 *  atual: quando o texto contém "parecer" mas o item foi tratado como Visita
 *  (ou vice-versa). Sinal INFORMATIVO — não bloqueia. */
function computeDescriptionDivergence(
  item: PaymentItemRowData,
  isParecerPayment: boolean,
  visitaPaymentTypeId?: string | null,
  parecerPaymentTypeId?: string | null,
  lotePaymentTypeId?: string | null,
): string | null {
  if (!isParecerPayment || !visitaPaymentTypeId || !parecerPaymentTypeId) return null;
  const name = String((item as any).procedure_name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!name) return null;
  const mentionsParecer = /\bparecer\b/.test(name);
  const mentionsVisita = /\bvisita\b/.test(name);
  if (!mentionsParecer && !mentionsVisita) return null;
  const tid = ((item as any).item_type_id ?? lotePaymentTypeId) as string | null;
  const isVisita = tid === visitaPaymentTypeId;
  const isParecer = tid === parecerPaymentTypeId || tid === lotePaymentTypeId;
  if (mentionsParecer && isVisita) return "Descrição da linha menciona \"parecer\", mas o item foi classificado como Visita.";
  if (mentionsVisita && isParecer) return "Descrição da linha menciona \"visita\", mas o item foi classificado como Parecer.";
  return null;
}

/** Ações para itens com parecer_evidence='unverified' (Parecer sem registro
 *  no relatório Tasy). O analista decide: confirmar mantendo Parecer ou
 *  reclassificar como Visita. Ambos gravam item_type_source='manual' e
 *  registram auditoria. */
function ParecerUnverifiedActions({
  item,
  visitaPaymentTypeId,
  parecerPaymentTypeId,
  onChangeCaseSubtype,
}: {
  item: PaymentItemRowData;
  visitaPaymentTypeId: string | null;
  parecerPaymentTypeId: string | null;
  onChangeCaseSubtype?: (itemIds: string[], newTypeId: string, newTypeLabel: string) => void;
}) {
  const [saving, setSaving] = useState<null | "confirm" | "visita">(null);
  const confirmAsParecer = async () => {
    setSaving("confirm");
    try {
      const { error } = await supabase
        .from("payment_items")
        .update({
          parecer_evidence: "confirmed",
          parecer_evidence_weak: false,
          item_type_source: "manual",
          parecer_checked_at: new Date().toISOString(),
        } as any)
        .eq("id", item.id);
      if (error) throw error;
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const actorId = userRes?.user?.id;
        if (actorId) {
          await supabase.from("audit_log").insert([{
            entity_type: "payment_item",
            entity_id: item.id,
            action: "confirm_parecer_manual",
            actor_id: actorId,
            company_name: (item as any).company_name ?? null,
            diff: { parecer_evidence: "confirmed", source: "manual" },
          } as any]);
        }
      } catch {}
      toast.success("Item confirmado como Parecer");
    } catch (e: any) {
      toast.error(`Falha ao confirmar: ${e?.message ?? e}`);
    } finally {
      setSaving(null);
    }
  };
  const reclassifyAsVisita = async () => {
    if (!visitaPaymentTypeId || !onChangeCaseSubtype) {
      toast.error("Tipo Visita não configurado neste hospital.");
      return;
    }
    setSaving("visita");
    try {
      await onChangeCaseSubtype([item.id], visitaPaymentTypeId, "Visita");
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="rounded-md border border-dashed border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/15 dark:border-amber-900/60 px-3 py-2 flex flex-col gap-2 min-w-0">
      <p className="text-xs text-amber-900 dark:text-amber-200 break-words">
        <strong>Parecer sem registro no Tasy</strong> — decida a classificação para
        este item. A decisão manual será registrada e protegida do motor automático.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!!saving}
          onClick={confirmAsParecer}
        >
          {saving === "confirm" ? "Confirmando..." : "Confirmar como Parecer"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!!saving || !visitaPaymentTypeId}
          onClick={reclassifyAsVisita}
        >
          {saving === "visita" ? "Reclassificando..." : "Reclassificar como Visita"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Tipo de pagamento por item (mostra/alterna entre Parecer × Visita).
 * Reusa `payment_items.item_type_id`: cada item pode pertencer a um
 * item_type diferente do tipo do lote — é assim que a base mista
 * (Parecer Adulto com algumas visitas) é tratada sem criar lotes separados.
 */
function CaseSubtypeBadge({
  item,
  allItems,
  lotePaymentTypeId,
  visitaPaymentTypeId,
  parecerPaymentTypeId,
  onChange,
  canEdit,
}: {
  item: PaymentItemRowData;
  allItems: PaymentItemRowData[];
  lotePaymentTypeId: string | null;
  visitaPaymentTypeId: string | null;
  parecerPaymentTypeId: string | null;
  onChange?: (
    ids: string[],
    newTypeId: string,
    newTypeLabel: "Visita" | "Parecer",
  ) => void;
  canEdit: boolean;
}) {
  const itemTypeId = ((item as any).item_type_id ?? null) as string | null;
  const source = ((item as any).item_type_source ?? null) as string | null;
  const effectiveTypeId = itemTypeId ?? lotePaymentTypeId;
  const isVisita = !!visitaPaymentTypeId && effectiveTypeId === visitaPaymentTypeId;
  const isParecer = !!parecerPaymentTypeId && effectiveTypeId === parecerPaymentTypeId;

  // Só mostra badge para itens de Parecer/Visita (não polui outros tipos)
  if (!isVisita && !isParecer) return null;

  const label = isVisita ? "V" : "P";
  const tone = isVisita
    ? "bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-800"
    : "bg-violet-50 text-violet-800 border-violet-300 dark:bg-violet-950/30 dark:text-violet-200 dark:border-violet-800";
  const sourceLabel: Record<string, string> = {
    base: "lido da planilha",
    auto_tuss: "TUSS cadastrado",
    auto_heuristic: "TUSS fora do lote",
    report_cross: "cruzamento com relatório de parecer",
    manual: "marcação manual do analista",
    company_override: "padrão da empresa no lote",
    default: "padrão do lote",
    inherit: "herdado do lote",
  };
  const sourceText = source ? sourceLabel[source] ?? source : "herdado do lote";
  const title = `${isVisita ? "Visita" : "Parecer"} — origem: ${sourceText}. Clique para alterar.`;

  if (!canEdit || !onChange || !visitaPaymentTypeId || !parecerPaymentTypeId) {
    return (
      <span className={cn("inline-flex items-center h-4 px-1 rounded text-[10px] border", tone)} title={title}>
        {label}
      </span>
    );
  }

  const flipId = isVisita ? parecerPaymentTypeId : visitaPaymentTypeId;
  const flipLabel: "Visita" | "Parecer" = isVisita ? "Parecer" : "Visita";
  const attendIds = (() => {
    const att = String((item as any).attendance_number ?? "").trim();
    if (!att) return [item.id];
    return allItems
      .filter((x) => String((x as any).attendance_number ?? "").trim() === att)
      .map((x) => x.id);
  })();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex items-center h-4 px-1 rounded text-[10px] border hover:opacity-80", tone)}
          title={title}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 space-y-1">
        <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1 px-1">
          Reclassificar como {flipLabel}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onChange([item.id], flipId, flipLabel);
          }}
        >
          Só este item
        </Button>
        {attendIds.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onChange(attendIds, flipId, flipLabel);
            }}
          >
            Todo o atendimento ({attendIds.length} itens)
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}



/**
 * Data grid compartilhado de itens de uma empresa dentro de um lote.
 * Usado pela página dedicada `/pagamentos/:id/empresa/:groupId` —
 * é a única fonte de trabalho da empresa (tabela densa com filtros,
 * expandable row, comentários, exceções autorizadas).
 */

type OptionalColKey =
  | "atendimento"
  | "data"
  | "convenio"
  | "via"
  | "funcao"
  | "procedimento"
  | "setor_lido"
  | "setor_inferido"
  | "regra"
  | "diferenca"
  | "observacao"
  | "tipo_entrada"
  | "subtipo";

const OPTIONAL_COLUMNS: { key: OptionalColKey; label: string }[] = [
  { key: "atendimento", label: "Atendimento" },
  { key: "data", label: "Data" },
  { key: "convenio", label: "Convênio" },
  { key: "via", label: "Via de acesso" },
  { key: "funcao", label: "Função" },
  { key: "procedimento", label: "Procedimento" },
  { key: "setor_lido", label: "Setor (Planilha)" },
  { key: "setor_inferido", label: "Setor" },
  { key: "tipo_entrada", label: "Tipo de entrada (caráter)" },
  { key: "subtipo", label: "Subtipo (Parecer/Visita)" },
  { key: "regra", label: "Regra aplicada" },
  { key: "diferenca", label: "Diferença" },
  { key: "observacao", label: "Observação" },
];

const DEFAULT_COL_VISIBILITY: Record<OptionalColKey, boolean> = {
  atendimento: true,
  data: false,
  convenio: true,
  via: false,
  funcao: false,
  procedimento: true,
  setor_lido: true,
  setor_inferido: true,
  tipo_entrada: false,
  subtipo: false,
  regra: false,
  diferenca: false,
  observacao: false,

};

type Density = "compact" | "comfortable";

export type ItemsDataGridProps = {
  items: PaymentItemRowData[];
  groupStatus: PaymentStatus;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  /** Habilita indicadores/filtros específicos do cruzamento com relatório de Parecer. */
  isParecerPayment?: boolean;
  observations?: ObservationRow[];
  /** Mapa author_id → nome completo (rastreabilidade no histórico). */
  profiles?: Record<string, string>;
  /** Chave de persistência das preferências de coluna/densidade. */
  storageKey?: string;
  /** Mostra a toolbar de filtros + colunas + densidade. */
  showToolbar?: boolean;
  /** Mostra rodapé com dicas de teclado. */
  showKeyboardHint?: boolean;
  /** Quando true, exibe coluna "Ações" com editar/excluir. */
  canEdit?: boolean;
  onEditItem?: (item: PaymentItemRowData) => void;
  onDeleteItem?: (item: PaymentItemRowData) => void;
  /** Acatar divergência usando o valor esperado (sobrescreve gross_amount). */
  onAcceptItem?: (item: PaymentItemRowData) => void;
  /** Acatar divergência mantendo o valor pago (não sobrescreve gross_amount). */
  onAcceptItemKeepPaid?: (item: PaymentItemRowData) => void;
  /** Desfazer acate (volta ao status original). */
  onUndoAcceptItem?: (item: PaymentItemRowData) => void;
  className?: string;
  /**
   * Modo de operação do lote.
   * - "analise" (default): hospital envia "Valor Repasse" (gross_amount) e o sistema calcula "Esperado" para comparar.
   * - "confeccao": base só tem valor da tabela; o sistema CALCULA o repasse. Não há valor pago para comparar,
   *   portanto a coluna "Valor Repasse" (vinda da base) é escondida e "Esperado" é renomeada para
   *   "Valor Repasse (calculado)". A coluna "Diferença" é forçadamente escondida.
   */
  mode?: "analise" | "confeccao";
  /** Callback para recarregar os itens após uma ação (ex.: absorção manual). */
  onRefresh?: () => void;
};

export function ItemsDataGrid({
  items,
  groupStatus,
  rulesIndex,
  rulesByName,
  isParecerPayment = false,
  observations = [],
  profiles = {},
  storageKey = "itemsDataGrid.default",
  showToolbar = true,
  showKeyboardHint = true,
  canEdit = false,
  onEditItem,
  onDeleteItem,
  onAcceptItem,
  onAcceptItemKeepPaid,
  onUndoAcceptItem,
  className,
  mode = "analise",
  onRefresh,
}: ItemsDataGridProps) {
  const { user } = useAuth();
  const isConfeccao = mode === "confeccao";
  // Em confecção a base não traz "Valor Repasse" — o sistema gera. Esperado vira o repasse calculado.
  const showGrossColumn = !isConfeccao;
  // Em confecção exibimos o valor cru de faturamento (procedure_amount) como coluna extra.
  const showProcedureColumn = isConfeccao;
  const expectedLabel = isConfeccao ? "Repasse calculado" : "Esperado";
  const expectedColWidth = isConfeccao ? 160 : 110;
  const COLUMN_PREFS_KEY = `${storageKey}.columnVisibility.v1`;
  const DENSITY_PREFS_KEY = `${storageKey}.density.v1`;
  const FILTERS_PREFS_KEY = `${storageKey}.filters.v1`;

  // Carrega prefs de filtros persistidas (por storageKey). Limpas via "Limpar filtros".
  const persistedFilters = useMemo(() => {
    if (typeof window === "undefined") return {} as Record<string, unknown>;
    try {
      const raw = window.localStorage.getItem(FILTERS_PREFS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pf = persistedFilters as {
    filter?: string;
    patientFilter?: string;
    doctorFilter?: string;
    statusFilter?: string;
    convenioFilter?: string;
    onlyAlerts?: boolean;
    onlyManualBonus?: boolean;
    onlyNeedsReview?: boolean;
    onlyValidationAlerts?: boolean;
    onlyAdjusted?: boolean;
    parecerFilter?: "__all__" | "missing" | "weak";
    onlyZero?: boolean;
    onlySemRegra?: boolean;
    onlyPisoAplicado?: boolean;
  };

  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTypeId, setBulkTypeId] = useState<string | null>(null);
  const { list: itemTypesForBulk } = useItemTypes({ onlyActive: true });
  const { list: paymentTypesForBulk } = usePaymentTypes({ onlyActive: true });
  // `payment_items.item_type_id` FK em item_types(id) — usar os ids do
  // catálogo canônico, não de payment_types (codes batem, ids não).
  const bulkSelectable = itemTypesForBulk;


  const [filter, setFilter] = useState(pf.filter ?? "");
  const [patientFilter, setPatientFilter] = useState(pf.patientFilter ?? "");
  const [doctorFilter, setDoctorFilter] = useState<string>(pf.doctorFilter ?? "__all__");
  const [statusFilter, setStatusFilter] = useState<string>(pf.statusFilter ?? "__all__");
  const [convenioFilter, setConvenioFilter] = useState<string>(pf.convenioFilter ?? "__all__");
  const [onlyAlerts, setOnlyAlerts] = useState(pf.onlyAlerts ?? false);
  const [onlyManualBonus, setOnlyManualBonus] = useState(pf.onlyManualBonus ?? false);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(pf.onlyNeedsReview ?? false);
  const [onlyValidationAlerts, setOnlyValidationAlerts] = useState(pf.onlyValidationAlerts ?? false);
  const [onlyAdjusted, setOnlyAdjusted] = useState(pf.onlyAdjusted ?? false);
  const [parecerFilter, setParecerFilter] = useState<"__all__" | "missing" | "weak">(pf.parecerFilter ?? "__all__");
  // Filtros disparados pelo Zeev (event bus global). Limpos via "Limpar filtros".
  const [onlyZero, setOnlyZero] = useState(pf.onlyZero ?? false);
  const [onlySemRegra, setOnlySemRegra] = useState(pf.onlySemRegra ?? false);
  const [onlyPisoAplicado, setOnlyPisoAplicado] = useState(pf.onlyPisoAplicado ?? false);
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(new Set());
  const [collapsedAttendances, setCollapsedAttendances] = useState<Set<string>>(new Set());

  // Persiste filtros sempre que mudarem (debounce simples via microtask).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FILTERS_PREFS_KEY,
        JSON.stringify({
          filter,
          patientFilter,
          doctorFilter,
          statusFilter,
          convenioFilter,
          onlyAlerts,
          onlyManualBonus,
          onlyNeedsReview,
          onlyValidationAlerts,
          onlyAdjusted,
          parecerFilter,
          onlyZero,
          onlySemRegra,
          onlyPisoAplicado,
        }),
      );
    } catch {
      /* ignore quota */
    }
  }, [
    FILTERS_PREFS_KEY,
    filter,
    patientFilter,
    doctorFilter,
    statusFilter,
    convenioFilter,
    onlyAlerts,
    onlyManualBonus,
    onlyNeedsReview,
    onlyValidationAlerts,
    onlyAdjusted,
    parecerFilter,
    onlyZero,
    onlySemRegra,
    onlyPisoAplicado,
  ]);

  // Tipos de pagamento usados pela reclassificação Visita × Parecer dentro do lote.
  // O tipo do lote (geralmente Parecer Adulto/Pediátrico) é lido do primeiro item;
  // Visita é resolvido por code='visita' no cadastro de tipos.
  const [paymentTypesIndex, setPaymentTypesIndex] = useState<{
    lote: string | null;
    visita: string | null;
    parecer: string | null;
  }>({ lote: null, visita: null, parecer: null });
  useEffect(() => {
    if (!isParecerPayment) return;
    const firstWithType = items.find((i: any) => i.item_type_id);
    const loteId = ((firstWithType as any)?.item_type_id ?? null) as string | null;
    let cancelled = false;
    (async () => {
      // D3.e.2: lê do catálogo canônico item_types (antes lia de payment_types).
      const { data } = await supabase
        .from("item_types")
        .select("id, code")
        .in("code", ["visita", "parecer_adulto", "parecer_pediatrico"]);
      if (cancelled) return;
      const byCode: Record<string, string> = {};
      for (const t of (data ?? []) as any[]) byCode[t.code] = t.id;
      // Parecer "alvo" para retorno = o tipo do lote, se for parecer_*, senão parecer_adulto.
      const parecerId =
        loteId && (loteId === byCode.parecer_adulto || loteId === byCode.parecer_pediatrico)
          ? loteId
          : byCode.parecer_adulto ?? null;
      setPaymentTypesIndex({
        lote: loteId,
        visita: byCode.visita ?? null,
        parecer: parecerId,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isParecerPayment, items]);
  const lotePaymentTypeId = paymentTypesIndex.lote;
  const visitaPaymentTypeId = paymentTypesIndex.visita;
  const parecerPaymentTypeId = paymentTypesIndex.parecer;

  // Painel de absorção manual de códigos no pacote (analista).
  const [absorcoesOpenAtt, setAbsorcoesOpenAtt] = useState<string | null>(null);
  const [absorcaoNoteDraft, setAbsorcaoNoteDraft] = useState<Record<string, string>>({});
  const [absorcaoPending, setAbsorcaoPending] = useState<string | null>(null);
  const [savingAbsorcao, setSavingAbsorcao] = useState<string | null>(null);

  const absorverItem = async (itemId: string, calcId: string | null, note: string) => {
    if (!note.trim() || note.trim().length < 10) return;
    setSavingAbsorcao(itemId);
    try {
      const { error } = await supabase.from("payment_items").update({
        package_absorbed: true,
        package_absorbed_calc_id: calcId,
        package_absorbed_by: user?.id ?? null,
        package_absorbed_at: new Date().toISOString(),
        package_absorbed_note: note.trim(),
        expected_amount: 0,
        ai_status: "aprovado",
        applied_calc_method: "pacote",
      } as any).eq("id", itemId);
      if (error) {
        console.error("Erro ao absorver item:", error);
        toast.error(`Não foi possível absorver o item: ${error.message}`);
        return;
      }
      setAbsorcaoPending(null);
      setAbsorcaoNoteDraft((d) => { const n = { ...d }; delete n[itemId]; return n; });
      onRefresh?.();
    } catch (e: any) {
      console.error("Erro ao absorver item:", e);
      toast.error(`Erro inesperado: ${e?.message ?? e}`);
    } finally {
      setSavingAbsorcao(null);
    }
  };

  const reverterAbsorcao = async (itemId: string) => {
    setSavingAbsorcao(itemId);
    try {
      const { error } = await supabase.from("payment_items").update({
        package_absorbed: false,
        package_absorbed_calc_id: null,
        package_absorbed_by: null,
        package_absorbed_at: null,
        package_absorbed_note: null,
        ai_status: "pendente",
        expected_amount: null,
      } as any).eq("id", itemId);
      if (error) {
        console.error("Erro ao reverter absorção:", error);
        toast.error(`Não foi possível reverter: ${error.message}`);
        return;
      }
      onRefresh?.();
    } catch (e: any) {
      console.error("Erro ao reverter absorção:", e);
      toast.error(`Erro inesperado: ${e?.message ?? e}`);
    } finally {
      setSavingAbsorcao(null);
    }
  };

  const changeCaseSubtype = async (
    itemIds: string[],
    newTypeId: string,
    newTypeLabel: string,
  ) => {
    if (!itemIds.length) return;
    try {
      // Snapshot do estado anterior para auditoria
      const beforeById = new Map<string, string | null>();
      for (const it of items) {
        if (itemIds.includes(it.id)) {
          beforeById.set(it.id, ((it as any).item_type_id ?? null) as string | null);
        }
      }

      const targetType = itemTypesForBulk.find((t) => t.id === newTypeId);
      if (!targetType) {
        toast.error("Tipo de item desconhecido.");
        return;
      }

      const targetItems = items.filter((i) => itemIds.includes(i.id));
      const perItemUpdates = targetItems.map((it) => ({
        id: it.id,
        patch: buildReclassifyPatch(
          { id: it.id, raw_data: (it as any).raw_data ?? null },
          {
            id: targetType.id,
            label: targetType.label,
            tuss_default: targetType.tuss_default ?? null,
          },
          newTypeLabel,
        ),
      }));

      const results = await Promise.all(
        perItemUpdates.map((u) =>
          supabase.from("payment_items").update(u.patch as any).eq("id", u.id),
        ),
      );
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) {
        console.error("Erro ao reclassificar:", firstErr);
        toast.error(`Não foi possível reclassificar: ${firstErr.message}`);
        return;
      }

      // Refresh imediato para a UI refletir o novo tipo antes da reanálise
      // (que pode levar dezenas de segundos). Sem isso o dropdown "voltava"
      // para o tipo antigo até o polling terminar.
      onRefresh?.();



      // Auditoria — um único registro por operação, com diff agregado.
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const actorId = userRes?.user?.id;
        const paymentId = (items[0] as any)?.payment_id ?? null;
        const companyName = (items.find((i) => itemIds.includes(i.id)) as any)?.company_name ?? null;
        if (actorId) {
          const fromCounts: Record<string, number> = {};
          for (const v of beforeById.values()) {
            const k = v ?? "null";
            fromCounts[k] = (fromCounts[k] ?? 0) + 1;
          }
          await supabase.from("audit_log").insert([{
            entity_type: "payment_item",
            entity_id: paymentId ?? itemIds[0],
            action: "reclassify_payment_type",
            actor_id: actorId,
            company_name: companyName,
            diff: {
              item_ids: itemIds,
              count: itemIds.length,
              to_payment_type_id: newTypeId,
              to_label: newTypeLabel,
              from_payment_type_id_counts: fromCounts,
              source: "manual",
            } as any,
          }] as any);
        }
      } catch (e) {
        console.warn("[changeCaseSubtype] audit falhou", e);
      }

      toast.success(
        itemIds.length > 1
          ? `${itemIds.length} itens reclassificados como ${newTypeLabel}. Reanalisando…`
          : `Item reclassificado como ${newTypeLabel}. Reanalisando…`,
      );
      // Dispara reanálise para o motor reaplicar regras com o novo tipo.
      // Filtra por empresa(s) afetada(s) para não rodar o lote inteiro à toa.
      const affectedCompanies = Array.from(new Set(
        items.filter((i) => itemIds.includes(i.id))
             .map((i) => (i as any).company_name)
             .filter(Boolean) as string[],
      ));
      try {
        const paymentId = (items[0] as any)?.payment_id;
        if (paymentId) {
          const res = await invokeDispatchAnalysis(
            {
              payment_id: paymentId,
              ...(affectedCompanies.length > 0 ? { only_companies: affectedCompanies } : {}),
              force_fresh_rules: true,
              skip_ai: true,
            },
            { showToast: false },
          );
          // Polling no job criado pelo dispatch: aguarda o motor confirmar a
          // conclusão antes de refazer o fetch da UI. Sem isso, o onRefresh
          // disparava antes do worker gravar o novo cálculo e o usuário via
          // o item ainda como Visita/reprovado ("sem mudanças").
          const jobId = res.ok ? (res.data as any)?.job_id as string | undefined : undefined;
          const alreadyRunning = res.ok ? (res.data as any)?.already_running === true : false;
          if (jobId || alreadyRunning) {
            const targetJobId = jobId ?? null;
            const deadline = Date.now() + 60_000;
            // Pequeno delay inicial para o orquestrador iniciar.
            await new Promise((r) => setTimeout(r, 800));
            while (Date.now() < deadline) {
              const q = supabase
                .from("payment_processing_jobs")
                .select("id,status,processed_companies,total_companies")
                .eq("payment_id", paymentId)
                .order("started_at", { ascending: false })
                .limit(1);
              const { data: jobs } = await q;
              const job = (jobs ?? [])[0] as any;
              if (!job) break;
              if (targetJobId && job.id !== targetJobId) {
                // Surgiu um job mais novo: passa a observar ele.
              }
              const status = String(job.status ?? "");
              if (status === "concluido" || status === "erro" || status === "parcial") break;
              if (Number(job.total_companies ?? 0) > 0 &&
                  Number(job.processed_companies ?? 0) >= Number(job.total_companies ?? 0)) break;
              await new Promise((r) => setTimeout(r, 1200));
            }
          } else {
            // Sem job (ex.: dispatch retornou 0 empresas) — espera curta para
            // garantir consistência antes do refresh.
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } catch (e) {
        console.warn("[changeCaseSubtype] dispatch/polling falhou", e);
      }
      onRefresh?.();
      // Segundo refresh defensivo cobre o caso em que o worker confirmou o
      // status do job antes de gravar a última fila de UPDATEs nos itens.
      window.setTimeout(() => onRefresh?.(), 1500);
    } catch (e: any) {
      console.error("Erro ao reclassificar:", e);
      toast.error(`Erro inesperado: ${e?.message ?? e}`);
    }
  };


  /**
   * Persiste o tipo padrão da empresa em companies.default_item_type_id (canônico).
   * O trigger sync_companies_default_type_columns mantém `default_payment_type_id`
   * (legada) em paralelo durante a transição. NÃO altera os itens deste lote — só
   * passa a valer dos próximos lotes em diante (na importação). Quem quer mudar o
   * atual também → usa o botão "Marcar todos" acima antes.
   */
  const saveCompanyDefaultType = async (
    typeId: string | null,
    label: string,
  ) => {
    try {
      const companyId = (items[0] as any)?.company_id ?? null;
      const companyName = (items[0] as any)?.company_name ?? null;
      if (!companyId) {
        toast.error("Empresa sem cadastro vinculado — não dá para salvar padrão.");
        return;
      }
      const { error } = await supabase
        .from("companies")
        .update({ default_item_type_id: typeId } as any)
        .eq("id", companyId);
      if (error) {
        toast.error(`Não foi possível salvar padrão: ${error.message}`);
        return;
      }
      toast.success(
        typeId
          ? `Padrão da empresa salvo como ${label}. Próximos lotes já entram classificados.`
          : "Padrão da empresa removido.",
      );
      // Auditoria
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const actorId = userRes?.user?.id;
        if (actorId) {
          await supabase.from("audit_log").insert([{
            entity_type: "company",
            entity_id: companyId,
            action: "set_default_item_type",
            actor_id: actorId,
            company_id: companyId,
            company_name: companyName,
            diff: { default_item_type_id: typeId, label } as any,
          }] as any);
        }
      } catch (e) {
        console.warn("[saveCompanyDefaultType] audit falhou", e);
      }
    } catch (e: any) {
      toast.error(`Erro inesperado: ${e?.message ?? e}`);
    }
  };





  // IDs dos itens que tiveram valor corrigido pelo analista (mesma fonte do
  // relatório "Correções em análise"): observações com author_type='analista'
  // e mensagem iniciando por "Item editado pelo analista".
  const adjustedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of observations) {
      if (
        o.author_type === "analista" &&
        o.item_id &&
        typeof o.message === "string" &&
        o.message.startsWith("Item editado pelo analista")
      ) {
        ids.add(o.item_id);
      }
    }
    return ids;
  }, [observations]);

  // Ordenação clicável das colunas. Bônus sempre permanece ancorado ao item
  // pai (lógica de re-anexar logo após o sort principal). Quando nenhum
  // sortKey está definido, mantém o default (status + gross_amount desc).
  type SortKey =
    | "paciente"
    | "convenio"
    | "tuss"
    | "qtd"
    | "medico"
    | "gross"
    | "esperado"
    | "diferenca"
    | "status";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      // 3-state cycle: asc → desc → none (volta ao default)
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey(null);
        setSortDir("asc");
      }
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  // ============= Classificação personalizada (estilo Excel) =============
  // Aplicada DENTRO de cada grupo de atendimento, respeitando: cluster de
  // pacote antes de outros métodos, ajustes de conciliação no fim absoluto,
  // e bônus grudado no pai. Persistida em localStorage.
  type CustomSortField =
    | "procedure_date"
    | "paciente"
    | "convenio"
    | "medico"
    | "funcao"
    | "tuss"
    | "procedimento"
    | "gross"
    | "esperado"
    | "diferenca"
    | "status"
    | "metodo";
  type CustomSortLevel = { field: CustomSortField; dir: "asc" | "desc" };
  const CUSTOM_SORT_KEY = "medpay:items-grid:custom-sort:v1";
  const CUSTOM_SORT_FIELDS: { value: CustomSortField; label: string; numeric?: boolean }[] = [
    { value: "procedure_date", label: "Data do procedimento" },
    { value: "paciente", label: "Paciente" },
    { value: "convenio", label: "Convênio" },
    { value: "medico", label: "Médico" },
    { value: "funcao", label: "Função" },
    { value: "tuss", label: "Código TUSS" },
    { value: "procedimento", label: "Procedimento" },
    { value: "gross", label: "Valor bruto", numeric: true },
    { value: "esperado", label: "Valor esperado", numeric: true },
    { value: "diferenca", label: "Diferença", numeric: true },
    { value: "status", label: "Status" },
    { value: "metodo", label: "Método de cálculo" },
  ];
  const [customSort, setCustomSort] = useState<CustomSortLevel[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(CUSTOM_SORT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (l: any) => l && typeof l === "object" && typeof l.field === "string" && (l.dir === "asc" || l.dir === "desc"),
      ) as CustomSortLevel[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_SORT_KEY, JSON.stringify(customSort));
    } catch { /* noop */ }
  }, [customSort]);
  const [customSortOpen, setCustomSortOpen] = useState(false);
  const customSortActive = customSort.length > 0 && !sortKey;



  const [colVis, setColVis] = useState<Record<OptionalColKey, boolean>>(() => {
    if (typeof window === "undefined") return DEFAULT_COL_VISIBILITY;
    try {
      const raw = window.localStorage.getItem(COLUMN_PREFS_KEY);
      if (!raw) return DEFAULT_COL_VISIBILITY;
      const parsed = JSON.parse(raw) as Partial<Record<OptionalColKey, boolean>>;
      return { ...DEFAULT_COL_VISIBILITY, ...parsed };
    } catch {
      return DEFAULT_COL_VISIBILITY;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(colVis));
    } catch {
      /* noop */
    }
  }, [colVis, COLUMN_PREFS_KEY]);
  const toggleCol = (k: OptionalColKey) => setColVis((v) => ({ ...v, [k]: !v[k] }));
  // Em confecção, "Diferença" não faz sentido (gross e expected coincidem por
  // construção). Forçamos invisível independentemente da preferência salva.
  const showDiferencaCol = colVis.diferenca && !isConfeccao;




  const [density, setDensity] = useState<Density>(() => {
    if (typeof window === "undefined") return "comfortable";
    try {
      const v = window.localStorage.getItem(DENSITY_PREFS_KEY);
      return v === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_PREFS_KEY, density);
    } catch {
      /* noop */
    }
  }, [density, DENSITY_PREFS_KEY]);
  const isCompact = density === "compact";
  const headPad = isCompact ? "px-1 py-0" : "px-2.5 py-2.5";
  const tableTextSize = isCompact
    ? "text-[10px] leading-[1.1] tracking-tight"
    : "text-[13px] leading-snug tracking-normal";

  const getConvenio = getAgreement;

  // Comparador multi-nível para a classificação personalizada.
  const compareByCustomSort = (
    a: PaymentItemRowData,
    b: PaymentItemRowData,
    levels: CustomSortLevel[],
  ): number => {
    const statusOrder: Record<string, number> = {
      reprovado: 0, alerta: 1, pendente: 2, acatado: 3, aprovado: 4, seguido: 4,
    };
    const valueFor = (it: PaymentItemRowData, field: CustomSortField): string | number => {
      switch (field) {
        case "procedure_date": return ((it as any).procedure_date ?? "") as string;
        case "paciente": return (getPatient(it) ?? "").toLowerCase();
        case "convenio": return (getConvenio(it) ?? "").toLowerCase();
        case "medico": return (it.doctor_name ?? "").toLowerCase();
        case "funcao": return (getDoctorRole(it) ?? "").toLowerCase();
        case "tuss": return (it.procedure_code ?? "").toString();
        case "procedimento": return (getProcedureName(it) ?? "").toLowerCase();
        case "gross": return Number(it.gross_amount ?? 0);
        case "esperado": return Number((it as any).expected_amount ?? it.ai_findings?.expected_amount ?? 0);
        case "diferenca": {
          const exp = (it as any).expected_amount ?? it.ai_findings?.expected_amount;
          return exp != null ? Number(exp) - Number(it.gross_amount ?? 0) : 0;
        }
        case "status": {
          const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
          return statusOrder[eff] ?? 5;
        }
        case "metodo": return ((it as any).applied_calc_method ?? "").toString().toLowerCase();
      }
    };
    for (const lvl of levels) {
      const va = valueFor(a, lvl.field);
      const vb = valueFor(b, lvl.field);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "pt-BR", { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return lvl.dir === "asc" ? cmp : -cmp;
    }
    return 0;
  };


  const selectRow = (itId: string) => {
    setActiveId(itId);
    if (selectionMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(itId)) next.delete(itId);
        else next.add(itId);
        return next;
      });
    }
  };
  const openDetail = (itId?: string) => {
    const target = itId ?? activeId;
    if (!target) return;
    setActiveId(target);
    setExpandedId((prev) => (prev === target ? null : target));
  };

  const doctorOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => it.doctor_name && s.add(it.doctor_name));
    return Array.from(s).sort();
  }, [items]);
  const convenioOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => {
      const c = getConvenio(it);
      if (c && c !== "—") s.add(c);
    });
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const pat = patientFilter.trim().toLowerCase();
    const base = items.filter((it) => {
      const tl = (it as any).tipo_linha as string | null | undefined;
      const src = (it as any).source as string | null | undefined;
      const origem = (it as any).item_origem as string | null | undefined;
      const isBonus = tl === "complemento_bonus";
      const isComplemento = tl === "complemento" || tl === "outros";
      const isManual = src === "manual" || origem === "inclusao_manual";
      const isInformativo = isBonus || isComplemento || isManual;
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
      const needsReview = !!(it.ai_findings as { needs_human_review?: boolean } | null)?.needs_human_review;
      // Filtro "Manuais/Bônus/Complemento" — mostra somente esses lançamentos.
      if (onlyManualBonus) {
        if (!isInformativo) return false;
      }
      // Filtro "Só com alertas" — esconde lançamentos informativos (não são erro).
      // Bônus só permanece ancorado ao pai quando NENHUM filtro restritivo está ativo.
      if (onlyAlerts) {
        if (isInformativo) return false;
        // Só mostra se realmente está em estado de alerta/reprovação.
        // Itens aprovados/acatados/seguidos não devem aparecer mesmo que
        // tenham alerts[] residuais no ai_findings.
        if (it.ai_status !== "reprovado" && it.ai_status !== "alerta") return false;
      }
      if (!isInformativo) {
        if (onlyNeedsReview && !needsReview) return false;
        if (onlyValidationAlerts) {
          const vf = (it as any).validation_findings;
          if (!Array.isArray(vf) || vf.length === 0) return false;
        }
      }
      if (onlyAdjusted && !adjustedItemIds.has(it.id)) return false;
      if (isParecerPayment && parecerFilter !== "__all__") {
        const evidence = ((it as any).parecer_evidence ?? null) as string | null;
        const isWeak = (it as any).parecer_evidence_weak === true;
        if (parecerFilter === "missing" && evidence !== "not_found") return false;
        if (parecerFilter === "weak" && !(evidence === "confirmed" && isWeak)) return false;
      }
      if (statusFilter !== "__all__" && eff !== statusFilter) return false;
      if (onlyZero) {
        const g = Number(it.gross_amount ?? 0);
        const e = Number((it as any).expected_amount ?? it.ai_findings?.expected_amount ?? 0);
        if (Math.abs(g) > 0.005 || Math.abs(e) > 0.005) return false;
      }
      if (onlySemRegra) {
        if (((it as any).applied_calc_method ?? "") !== "sem_regra") return false;
      }
      if (onlyPisoAplicado) {
        if (((it as any).piso_metodo_vencedor ?? "") !== "piso") return false;
      }
      if (doctorFilter !== "__all__" && (it.doctor_name ?? "") !== doctorFilter) return false;
      if (convenioFilter !== "__all__" && getConvenio(it) !== convenioFilter) return false;
      const paciente = getPatient(it);
      if (pat && !paciente.toLowerCase().includes(pat)) return false;
      if (!term) return true;
      return [
        paciente,
        it.doctor_name ?? "",
        it.procedure_code ?? "",
        it.procedure_name ?? "",
        it.attendance_number ?? "",
        getConvenio(it),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    }).sort((a, b) => {
      // Ajustes de conciliação sempre no final
      const aIsAdjust = !!(a as any).item_origem && (a as any).item_origem !== "pagamento_atual";
      const bIsAdjust = !!(b as any).item_origem && (b as any).item_origem !== "pagamento_atual";
      const aIsBonus = (a as any).tipo_linha === "complemento_bonus";
      const bIsBonus = (b as any).tipo_linha === "complemento_bonus";
      // Bônus não obedece a ordenação principal — será realocado abaixo
      // (sempre logo após o item pai do mesmo atendimento).
      // Ajustes de conciliação (não-bônus) ficam no final.
      const aPureAdjust = aIsAdjust && !aIsBonus;
      const bPureAdjust = bIsAdjust && !bIsBonus;
      if (aPureAdjust && !bPureAdjust) return 1;
      if (!aPureAdjust && bPureAdjust) return -1;

      // Ordenação escolhida pelo usuário (clique no header) tem prioridade
      // sobre o default. Bônus continuará sendo realocado abaixo do pai.
      if (sortKey) {
        const valueFor = (it: typeof items[number]) => {
          switch (sortKey) {
            case "paciente": return getPatient(it).toLowerCase();
            case "convenio": return getConvenio(it).toLowerCase();
            case "tuss": return (it.procedure_code ?? "").toString();
            case "qtd": return Number(it.quantity ?? 1);
            case "medico": return (it.doctor_name ?? "").toLowerCase();
            case "gross": return Number(it.gross_amount ?? 0);
            case "esperado": return Number((it as any).expected_amount ?? it.ai_findings?.expected_amount ?? 0);
            case "diferenca": {
              const exp = (it as any).expected_amount ?? it.ai_findings?.expected_amount;
              return exp != null ? Number(exp) - Number(it.gross_amount ?? 0) : 0;
            }
            case "status": {
              const order: Record<string, number> = {
                reprovado: 0, alerta: 1, pendente: 2, acatado: 3, aprovado: 4, seguido: 4,
              };
              const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
              return order[eff] ?? 5;
            }
          }
        };
        const va = valueFor(a);
        const vb = valueFor(b);
        let cmp = 0;
        if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), "pt-BR", { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        // Tiebreaker estável: gross_amount desc
        return Number(b.gross_amount ?? 0) - Number(a.gross_amount ?? 0);
      }

      const prioOf = (it: typeof items[number]) => {
        const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
        if (eff === "reprovado") return 0;
        if (eff === "alerta") return 1;
        if (eff === "pendente") return 2;
        if (eff === "acatado") return 3;
        return 4;
      };
      const pa = prioOf(a);
      const pb = prioOf(b);
      if (pa !== pb) return pa - pb;
      return Number(b.gross_amount ?? 0) - Number(a.gross_amount ?? 0);
    });

    // Segunda passagem: cada linha de bônus é movida para imediatamente após
    // o item pai do mesmo atendimento (procedimento com maior gross_amount).
    // Se o pai não estiver na lista filtrada, o bônus permanece no final
    // do bloco do atendimento (ou no fim absoluto, se não houver itens do
    // mesmo atendimento).
    const bonuses = base.filter((x) => (x as any).tipo_linha === "complemento_bonus");
    if (bonuses.length === 0) return base;
    const nonBonus = base.filter((x) => (x as any).tipo_linha !== "complemento_bonus");
    const result: typeof base = [];
    // Para cada item não-bônus, anexa os bônus do mesmo atendimento cujo
    // pai (maior gross dentro do atendimento) é este item.
    const parentIdByAtt = new Map<string, string>();
    const grossByAtt = new Map<string, number>();
    for (const it of nonBonus) {
      const att = (it.attendance_number ?? "").toString();
      if (!att) continue;
      const g = Number(it.gross_amount ?? 0);
      const curG = grossByAtt.get(att);
      if (curG == null || g > curG) {
        grossByAtt.set(att, g);
        parentIdByAtt.set(att, it.id);
      }
    }
    const bonusByParentId = new Map<string, typeof bonuses>();
    const orphanBonus: typeof bonuses = [];
    for (const b of bonuses) {
      const att = (b.attendance_number ?? "").toString();
      const parentId = att ? parentIdByAtt.get(att) : undefined;
      if (parentId) {
        const arr = bonusByParentId.get(parentId) ?? [];
        arr.push(b);
        bonusByParentId.set(parentId, arr);
      } else {
        orphanBonus.push(b);
      }
    }
    for (const it of nonBonus) {
      result.push(it);
      const attached = bonusByParentId.get(it.id);
      if (attached) result.push(...attached);
    }
    if (orphanBonus.length) result.push(...orphanBonus);
    return result;
  }, [items, filter, patientFilter, doctorFilter, statusFilter, convenioFilter, onlyAlerts, onlyManualBonus, onlyNeedsReview, onlyValidationAlerts, onlyAdjusted, onlyZero, onlySemRegra, onlyPisoAplicado, adjustedItemIds, isParecerPayment, parecerFilter, groupStatus, sortKey, sortDir]);

  // Bridge global do Zeev → aplica filtro pedido via chat ("me leva pros zerados", etc.).
  // Limpa os filtros anteriores e marca apenas o requerido para evitar combinações esquisitas.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ filter?: string }>).detail;
      const f = detail?.filter;
      if (!f) return;
      // reset base
      setFilter(""); setPatientFilter("");
      setDoctorFilter("__all__"); setConvenioFilter("__all__");
      setOnlyManualBonus(false); setOnlyNeedsReview(false);
      setOnlyValidationAlerts(false); setOnlyAdjusted(false); setParecerFilter("__all__");
      setOnlyAlerts(false); setOnlyZero(false); setOnlySemRegra(false);
      setStatusFilter("__all__");
      if (f === "zerados") setOnlyZero(true);
      else if (f === "sem_regra") setOnlySemRegra(true);
      else if (f === "reprovados" || f === "divergentes") setStatusFilter("reprovado");
      // dá um nudge visual rolando até o grid
      try {
        const el = document.querySelector('[data-grid-root="items"]');
        (el as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch { /* noop */ }
    };
    window.addEventListener("zeev:apply-filter", handler as EventListener);
    return () => window.removeEventListener("zeev:apply-filter", handler as EventListener);
  }, []);

  // Reagrupa por atendimento: TODOS os itens do mesmo atendimento ficam
  // contíguos (não só os do pacote). Itens sem atendimento mantêm a ordem
  // original. Para cada atendimento calcula metadados para o header-card
  // (paciente, totais, pior status, presença de pacote).
  const { packageGroups, displayRows, attendanceMeta, attendanceFirstIdxByAtt } = useMemo(() => {
    type PkgGroup = {
      firstItemIdx: number;
      items: PaymentItemRowData[];
      ruleName: string;
      totalGross: number;
      totalExpected: number | null;
      worstStatus: "reprovado" | "alerta" | "aprovado";
    };
    type AttMeta = {
      paciente: string;
      count: number;
      totalGross: number;
      totalExpected: number | null;
      worstStatus: "reprovado" | "alerta" | "aprovado" | "cancelado";
      hasPackage: boolean;
    };

    // 1) Descobrir atendimentos com pacote para sinalizar o header e habilitar
    //    o painel "Gerenciar absorções".
    //    Pacote "real" = atendimento tem (a) algum item já absorvido ou
    //    (b) algum item cujo cálculo é do tipo pacote E existe pelo menos
    //    um sibling não-cancelado no mesmo atendimento (candidato à absorção).
    //    Cálculos "pacote" que rodam sozinhos, sem siblings, NÃO contam —
    //    esse é o caso de "valor fixo por função" mal-catalogado.
    const pkgAtts = new Set<string>();
    const absorbedAtts = new Set<string>();
    const attCountAll = new Map<string, number>();
    for (const it of filtered) {
      const att = (it.attendance_number ?? "").toString().trim();
      if (!att) continue;
      attCountAll.set(att, (attCountAll.get(att) ?? 0) + 1);
      if ((it as any).package_absorbed === true) {
        absorbedAtts.add(att);
        pkgAtts.add(att);
      }
    }
    // Adiciona atendimentos com método pacote + siblings.
    const pkgMethodAtts = new Set<string>();
    for (const it of filtered) {
      if ((it as any).applied_calc_method !== "pacote") continue;
      const att = (it.attendance_number ?? "").toString().trim();
      if (!att) continue;
      pkgMethodAtts.add(att);
      if ((attCountAll.get(att) ?? 0) > 1) pkgAtts.add(att);
    }


    // 2) Reordenar: para CADA atendimento, despejar todos os seus itens em
    //    sequência na primeira ocorrência. Dentro do atendimento, agrupa
    //    por método de cálculo — pacote (e absorvidos) PRIMEIRO, depois os
    //    demais métodos agrupados — para evitar "quebra" visual entre a
    //    banda do pacote e itens de outras regras do mesmo paciente.
    //    Bônus segue seu pai (já reordenado em passada posterior).
    const handledAtt = new Set<string>();
    const display: PaymentItemRowData[] = [];
    const clusterKey = (it: PaymentItemRowData): string => {
      const isPkg =
        (it as any).applied_calc_method === "pacote" ||
        (it as any).package_absorbed === true;
      if (isPkg) return "0_pacote";
      const m = ((it as any).applied_calc_method ?? "zz_none") as string;
      return `1_${m}`;
    };
    for (const it of filtered) {
      const att = (it.attendance_number ?? "").toString().trim();
      if (att) {
        if (handledAtt.has(att)) continue;
        handledAtt.add(att);
        const ofAtt = filtered.filter(
          (m) => (m.attendance_number ?? "").toString().trim() === att,
        );
        // Estável: preserva ordem original dentro de cada cluster.
        // Se houver classificação personalizada ativa (customSort) e nenhum
        // header estiver ordenando globalmente, aplica os níveis dentro do
        // cluster respeitando pacote-antes-de-outros-métodos.
        const indexed = ofAtt.map((m, i) => ({ m, i, k: clusterKey(m) }));
        indexed.sort((a, b) => {
          if (a.k !== b.k) return a.k < b.k ? -1 : 1;
          if (customSortActive) {
            const cmp = compareByCustomSort(a.m, b.m, customSort);
            if (cmp !== 0) return cmp;
          }
          return a.i - b.i;
        });
        for (const { m } of indexed) display.push(m);

      } else {
        display.push(it);
      }
    }

    // 3) Metadados por atendimento + índice da primeira ocorrência.
    const meta = new Map<string, AttMeta>();
    const firstIdx = new Map<string, number>();
    display.forEach((it, idx) => {
      const att = (it.attendance_number ?? "").toString().trim();
      if (!att) return;
      if (!firstIdx.has(att)) firstIdx.set(att, idx);
      let m = meta.get(att);
      if (!m) {
        m = {
          paciente: getPatient(it) || "—",
          count: 0,
          totalGross: 0,
          totalExpected: null,
          worstStatus: "aprovado",
          hasPackage: pkgAtts.has(att),
        };
        meta.set(att, m);
      }
      if ((it as any).is_cancelled) {
        if (m.worstStatus === "aprovado") m.worstStatus = "cancelado";
      } else if (!(it as any).package_absorbed) {
        m.count += 1;
        m.totalGross += Number(it.gross_amount ?? 0);
        const exp = ((it as any).expected_amount as number | undefined) ??
          (it.ai_findings?.expected_amount as number | undefined);
        if (exp != null) m.totalExpected = (m.totalExpected ?? 0) + Number(exp);
      }
      if (it.ai_status === "reprovado") m.worstStatus = "reprovado";
      else if (it.ai_status === "alerta" && m.worstStatus !== "reprovado") m.worstStatus = "alerta";
    });

    // 4) Recomputar packageGroups a partir do displayRows.
    const isMember = (it: PaymentItemRowData) =>
      (it as any).applied_calc_method === "pacote" || (it as any).package_absorbed === true;
    const groups = new Map<string, PkgGroup>();
    display.forEach((it, idx) => {
      const att = (it.attendance_number ?? "").toString().trim();
      if (!att || !pkgAtts.has(att) || !isMember(it)) return;
      let g = groups.get(att);
      if (!g) {
        const ruleNameRaw =
          (it as any).applied_rule_label ??
          ((it.ai_findings?.matched_rules as string[] | undefined)?.[0]) ??
          "Pacote";
        const ruleName = String(ruleNameRaw).replace(/\s*—\s*Pacote\s*$/i, "");
        g = {
          firstItemIdx: idx,
          items: [],
          ruleName,
          totalGross: 0,
          totalExpected: 0,
          worstStatus: "aprovado",
        };
        groups.set(att, g);
      }
      g.items.push(it);
      g.totalGross += Number(it.gross_amount ?? 0);
      if ((it as any).applied_calc_method === "pacote") {
        const exp =
          ((it as any).expected_amount as number | undefined) ??
          (it.ai_findings?.expected_amount as number | undefined);
        if (exp != null) g.totalExpected = (g.totalExpected ?? 0) + Number(exp);
      }
      if (it.ai_status === "reprovado") g.worstStatus = "reprovado";
      else if (it.ai_status === "alerta" && g.worstStatus !== "reprovado")
        g.worstStatus = "alerta";
    });

    return { packageGroups: groups, displayRows: display, attendanceMeta: meta, attendanceFirstIdxByAtt: firstIdx };
  }, [filtered, customSort, customSortActive]);




  // Totais da seleção atual (após filtros).
  // gross_amount/expected_amount já representam o valor da linha como
  // mostrado em "Valor"/"Esperado" — somar direto para bater com o
  // total do lote exibido no header.
  const totals = useMemo(() => {
    let valor = 0;
    let esperado = 0;
    let procedure = 0;
    let temEsperado = false;
    let count = 0;
    for (const it of filtered) {
      // Itens cancelados (via conciliação ou grupo cancelado) saem do total
      // financeiro — não somam mais ao "Valor Repasse" nem ao "Esperado".
      if ((it as any).is_cancelled) continue;
      // Itens absorvidos manualmente em pacote: o valor já está no banner do
      // pacote (totalGross) — somar de novo geraria duplicidade no total.
      if ((it as any).package_absorbed) continue;
      count++;
      valor += Number(it.gross_amount ?? 0);
      procedure += Number((it as any).procedure_amount ?? 0);
      const exp = (it as any).expected_amount ?? it.ai_findings?.expected_amount;
      if (exp != null) {
        esperado += Number(exp);
        temEsperado = true;
      }
    }
    return {
      count,
      valor,
      procedure,
      esperado: temEsperado ? esperado : null,
      diferenca: temEsperado ? esperado - valor : null,
    };
  }, [filtered]);

  const validationImpact = useMemo(() => {
    let count = 0;
    let valor = 0;
    for (const it of filtered) {
      const findings = (it as any).validation_findings;
      if (Array.isArray(findings) && findings.length > 0) {
        count++;
        valor += Number(it.gross_amount ?? 0);
      }
    }
    return { count, valor };
  }, [filtered]);

  const needsReviewCount = useMemo(
    () => items.filter((it) => !!(it.ai_findings as { needs_human_review?: boolean } | null)?.needs_human_review).length,
    [items],
  );

  const parecerCounts = useMemo(() => {
    if (!isParecerPayment) return { checked: 0, confirmed: 0, missing: 0, weak: 0 };
    return items.reduce(
      (acc, it) => {
        const evidence = ((it as any).parecer_evidence ?? null) as string | null;
        const isWeak = (it as any).parecer_evidence_weak === true;
        if (evidence) acc.checked += 1;
        if (evidence === "confirmed") acc.confirmed += 1;
        if (evidence === "not_found") acc.missing += 1;
        if (evidence === "confirmed" && isWeak) acc.weak += 1;
        return acc;
      },
      { checked: 0, confirmed: 0, missing: 0, weak: 0 },
    );
  }, [items, isParecerPayment]);

  // Contagem por tipo (Parecer × Visita) — só em lotes de Parecer com tipos resolvidos.
  const subtypeCounts = useMemo(() => {
    if (!isParecerPayment || !visitaPaymentTypeId || !parecerPaymentTypeId) {
      return { parecer: 0, visita: 0, total: 0 };
    }
    let parecer = 0;
    let visita = 0;
    for (const it of items) {
      const tid = ((it as any).item_type_id ?? lotePaymentTypeId) as string | null;
      if (tid === visitaPaymentTypeId) visita += 1;
      else if (tid === parecerPaymentTypeId || tid === lotePaymentTypeId) parecer += 1;
    }
    return { parecer, visita, total: parecer + visita };
  }, [items, isParecerPayment, visitaPaymentTypeId, parecerPaymentTypeId, lotePaymentTypeId]);

  const counts = useMemo(() => {
    const c = { alerta: 0, critico: 0, total: items.length };
    for (const it of items) {
      // Crítico = reprovado pelo motor. Alerta = status efetivo "alerta".
      // Observações informativas (ex.: "ℹ Caso especial ativo") NÃO contam:
      // o item está aprovado, a observação é só sinalização para validador/diretor.
      // Sem esse alinhamento, a pílula diz "N alertas" mas o filtro do grid
      // (que exige ai_status alerta/reprovado) mostra a lista vazia.
      if (it.ai_status === "reprovado") c.critico += 1;
      else if (it.ai_status === "alerta") c.alerta += 1;
    }
    return c;
  }, [items]);


  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (filtered.length === 0) return;
      const idx = activeId ? filtered.findIndex((x) => x.id === activeId) : -1;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = filtered[Math.min(filtered.length - 1, idx + 1)];
        if (next) setActiveId(next.id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = filtered[Math.max(0, idx - 1)];
        if (prev) setActiveId(prev.id);
      } else if (e.key === "Enter" && activeId) {
        e.preventDefault();
        openDetail(activeId);
      } else if (e.key === "Escape" && expandedId) {
        e.preventDefault();
        setExpandedId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, filtered, expandedId]);

  const tableMinWidth = 24 +
    (colVis.atendimento ? 160 : 0) +
    (colVis.data ? 90 : 0) +
    160 +

    (colVis.convenio ? 120 : 0) +
    (colVis.via ? 110 : 0) +
    88 +
    56 +
    (colVis.procedimento ? 200 : 0) +
    (colVis.setor_lido ? 110 : 0) +
    (colVis.setor_inferido ? 110 : 0) +
    (colVis.tipo_entrada ? 110 : 0) +
    (colVis.subtipo && isParecerPayment ? 80 : 0) +
    150 +
    (colVis.funcao ? 100 : 0) +
    (colVis.regra ? 150 : 0) +
    (showGrossColumn ? 110 : 0) +
    (showProcedureColumn ? 130 : 0) +
    expectedColWidth +
    (showDiferencaCol ? 110 : 0) +
    110 +
    (colVis.observacao ? 70 : 0) +
    (canEdit ? 120 : 0);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  // Largura real do conteúdo do grid (pode divergir do `tableMinWidth`
  // calculado quando células crescem por conteúdo). Mantém a barra de
  // rolagem superior 1:1 com a inferior — sem isso, o thumb do top scroll
  // fica desproporcional em relação ao scroll real do grid.
  const [measuredScrollWidth, setMeasuredScrollWidth] = useState<number>(0);
  // Diferença entre offsetWidth e clientWidth do grid = largura do scrollbar
  // vertical. Precisamos aplicar a mesma reserva de espaço no rail superior,
  // senão ele fica mais largo que o inferior e os thumbs ficam desalinhados.
  const [vScrollbarWidth, setVScrollbarWidth] = useState<number>(0);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const update = () => {
      setMeasuredScrollWidth(el.scrollWidth);
      setVScrollbarWidth(Math.max(0, el.offsetWidth - el.clientWidth));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [items.length, expandedId]);


  // Auto-scroll: quando o usuário expande uma linha inline, garantimos que o
  // painel apareça visível dentro da grid (e na viewport da página).
  useEffect(() => {
    if (!expandedId) return;
    const raf = requestAnimationFrame(() => {
      const panel = gridScrollRef.current?.querySelector<HTMLElement>(
        `[data-expanded-row="${CSS.escape(expandedId)}"]`,
      );
      panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [expandedId]);


  const syncScrollLeft = (source: "top" | "grid", left: number) => {
    const target = source === "top" ? gridScrollRef.current : topScrollRef.current;
    if (target && Math.abs(target.scrollLeft - left) > 1) target.scrollLeft = left;
  };

  // Estimativa de altura: rows + banners de pacote/regra + painel expandido + chrome.
  // ~38px por linha (compacto), ~44px por banner de grupo, ~320px quando há painel
  // expandido inline, ~140px de chrome (toolbar + header + scrollbar + footer).
  const estimatedHeight =
    items.length * 38 +
    packageGroups.size * 44 +
    (expandedId ? 320 : 0) +
    140;

  return (
    // Altura própria pra ativar o scroll interno mesmo dentro de um pai sem altura.
    // Baseline maior (640px) + expansão dinâmica quando o usuário abre um painel
    // ou quando há banners de grupo (regra/pacote) ocupando espaço extra.
    <div
      data-grid-root="items"
      className={cn("flex flex-col min-h-[640px]", className)}
      style={{
        // 2026-06-24: reduzido offset de 120→40px para ocupar o máximo da viewport.
        // Antes sobravam ~80px de espaço morto abaixo do grid.
        height: `min(calc(100vh - 40px), max(640px, ${estimatedHeight}px))`,
      }}
    >
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border bg-background shadow-lg px-4 py-2">
          <span className="text-xs font-medium">
            {selectedIds.size} item(ns) selecionado(s)
          </span>
          <span className="text-[11px] text-muted-foreground">Reclassificar para:</span>
          <Select
            value={bulkTypeId ?? undefined}
            onValueChange={(v) => setBulkTypeId(v)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Escolher tipo…" />
            </SelectTrigger>
            <SelectContent>
              {bulkSelectable.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!bulkTypeId}
            onClick={async () => {
              if (!bulkTypeId) return;
              const t = bulkSelectable.find((x) => x.id === bulkTypeId);
              if (!t) return;
              const ids = Array.from(selectedIds);
              await changeCaseSubtype(ids, bulkTypeId, t.label);
              setSelectedIds(new Set());
              setBulkTypeId(null);
            }}
          >
            Aplicar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => {
              setSelectedIds(new Set());
              setBulkTypeId(null);
            }}
            title="Limpar seleção"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}




      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 bg-muted/20">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Busca geral (paciente, médico, TUSS, convênio…)"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Input
            value={patientFilter}
            onChange={(e) => setPatientFilter(e.target.value)}
            placeholder="Paciente"
            className="h-8 w-36 text-xs"
          />
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Médico" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os médicos</SelectItem>
              {doctorOptions.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos status</SelectItem>
              <SelectItem value="reprovado">Reprovado</SelectItem>
              <SelectItem value="alerta">Alerta</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="seguido">Acatado / Seguido</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
            </SelectContent>
          </Select>
          <Select value={convenioFilter} onValueChange={setConvenioFilter}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Convênio" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos convênios</SelectItem>
              {convenioOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={(onlyAlerts || onlyManualBonus || onlyAdjusted) ? "default" : "outline"}
                className="h-8 text-xs"
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                {onlyAdjusted
                  ? "Só ajustados pelo analista"
                  : onlyManualBonus
                  ? "Manuais / Bônus / Compl."
                  : onlyAlerts
                  ? "Só com alertas"
                  : "Filtrar itens"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Filtros rápidos</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { setOnlyAlerts(true); setOnlyManualBonus(false); setOnlyAdjusted(false); }}
                className={cn(onlyAlerts && "bg-accent")}
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-2 text-warning" />
                Só com alertas
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setOnlyManualBonus(true); setOnlyAlerts(false); setOnlyAdjusted(false); }}
                className={cn(onlyManualBonus && "bg-accent")}
              >
                <Sparkles className="h-3.5 w-3.5 mr-2 text-indigo-600" />
                Manuais, bônus e complemento
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setOnlyAdjusted(true); setOnlyAlerts(false); setOnlyManualBonus(false); }}
                className={cn(onlyAdjusted && "bg-accent")}
                disabled={adjustedItemIds.size === 0}
              >
                <Pencil className="h-3.5 w-3.5 mr-2" style={{ color: "hsl(var(--warning))" }} />
                Só ajustados pelo analista ({adjustedItemIds.size})
              </DropdownMenuItem>
              {(onlyAlerts || onlyManualBonus || onlyAdjusted) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setOnlyAlerts(false); setOnlyManualBonus(false); setOnlyAdjusted(false); }}>
                    Limpar este filtro
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant={onlyNeedsReview ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setOnlyNeedsReview((v) => !v)}
            title="Itens sem regra que casa — precisam de decisão humana"
          >
            <ShieldAlert className="h-3.5 w-3.5 mr-1" />
            Sem regra ({needsReviewCount})
          </Button>
          <Button
            size="sm"
            variant={onlyValidationAlerts ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setOnlyValidationAlerts((v) => !v)}
          >
            <ShieldAlert className="h-3.5 w-3.5 mr-1" />
            Alertas assistenciais
          </Button>
          <Button
            size="sm"
            variant={onlyPisoAplicado ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setOnlyPisoAplicado((v) => !v)}
            title="Itens em que o piso mínimo superou o valor do convênio e foi aplicado"
          >
            <span aria-hidden className="mr-1">🛡️</span>
            Piso aplicado
          </Button>
          {isParecerPayment && (
            <Select value={parecerFilter} onValueChange={(v) => setParecerFilter(v as typeof parecerFilter)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <FileText className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Parecer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos pareceres</SelectItem>
                <SelectItem value="missing">Sem parecer cruzado ({parecerCounts.missing})</SelectItem>
                <SelectItem value="weak">Parecer divergente ({parecerCounts.weak})</SelectItem>
              </SelectContent>
            </Select>
          )}
          {isParecerPayment && subtypeCounts.total > 0 && (
            <div
              className="inline-flex items-center h-8 px-2 rounded-md border bg-card text-xs gap-2"
              title="Distribuição dos itens por tipo de pagamento (Parecer × Visita)"
            >
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                <span className="font-medium">Parecer:</span> {subtypeCounts.parecer}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                <span className="font-medium">Visita:</span> {subtypeCounts.visita}
              </span>
              {canEdit && visitaPaymentTypeId && parecerPaymentTypeId && items.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      title="Reclassificar empresa inteira"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2 space-y-1">
                    <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1 px-1">
                      Reclassificar empresa
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => {
                        const ids = items.map((i) => i.id);
                        changeCaseSubtype(ids, visitaPaymentTypeId, "Visita");
                      }}
                    >
                      Marcar todos como Visita ({items.length})
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => {
                        const ids = items.map((i) => i.id);
                        changeCaseSubtype(ids, parecerPaymentTypeId, "Parecer");
                      }}
                    >
                      Marcar todos como Parecer ({items.length})
                    </Button>
                    <div className="border-t my-1" />
                    <div className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1 px-1">
                      Padrão para próximos lotes
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => saveCompanyDefaultType(visitaPaymentTypeId, "Visita")}
                    >
                      Empresa é sempre Visita
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-7 text-xs"
                      onClick={() => saveCompanyDefaultType(parecerPaymentTypeId, "Parecer")}
                    >
                      Empresa é sempre Parecer
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-7 text-xs text-muted-foreground"
                      onClick={() => saveCompanyDefaultType(null, "—")}
                    >
                      Remover padrão (segue o lote)
                    </Button>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
          {(filter || patientFilter || doctorFilter !== "__all__" || statusFilter !== "__all__" || convenioFilter !== "__all__" || onlyAlerts || onlyManualBonus || onlyNeedsReview || onlyValidationAlerts || onlyAdjusted || onlyZero || onlySemRegra || onlyPisoAplicado || (isParecerPayment && parecerFilter !== "__all__")) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setFilter(""); setPatientFilter("");
                setDoctorFilter("__all__"); setStatusFilter("__all__"); setConvenioFilter("__all__");
                setOnlyAlerts(false); setOnlyManualBonus(false); setOnlyNeedsReview(false);
                setOnlyValidationAlerts(false); setOnlyAdjusted(false); setParecerFilter("__all__");
                setOnlyZero(false); setOnlySemRegra(false); setOnlyPisoAplicado(false);
              }}
            >
              Limpar
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant={selectionMode ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => {
                setSelectionMode((on) => {
                  if (on) setSelectedIds(new Set());
                  return !on;
                });
              }}
              title="Ativar seleção múltipla para reclassificar vários itens de uma vez"
            >
              {selectionMode ? "Sair da seleção" : "Selecionar"}
              {selectionMode && selectedIds.size > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-background/20 px-1.5 text-[10px]">
                  {selectedIds.size}
                </span>
              )}
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs ml-auto">
                <Columns3 className="h-3.5 w-3.5 mr-1" />
                Colunas
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              <p className="px-1.5 pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                Colunas opcionais
              </p>
              <div className="space-y-0.5">
                {OPTIONAL_COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={colVis[c.key]}
                      onCheckedChange={() => toggleCol(c.key)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-1 flex justify-between gap-2 border-t pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] flex-1"
                  onClick={() =>
                    setColVis(
                      Object.fromEntries(
                        OPTIONAL_COLUMNS.map((c) => [c.key, false]),
                      ) as Record<OptionalColKey, boolean>,
                    )
                  }
                >
                  Limpar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] flex-1"
                  onClick={() => setColVis(DEFAULT_COL_VISIBILITY)}
                >
                  Padrão
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="inline-flex items-center rounded-md border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setDensity("compact")}
              className={cn(
                "h-7 px-2 text-[11px] rounded-sm transition-colors",
                isCompact ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              title="Modo compacto"
            >
              Compacto
            </button>
            <button
              type="button"
              onClick={() => setDensity("comfortable")}
              className={cn(
                "h-7 px-2 text-[11px] rounded-sm transition-colors",
                !isCompact ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              title="Modo confortável"
            >
              Confortável
            </button>
          </div>
          {validationImpact.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>{validationImpact.count}</strong> item{validationImpact.count !== 1 ? "s" : ""} com alerta de validação ·
                <strong> {formatCurrency(validationImpact.valor)}</strong> em risco
              </span>
            </div>
          )}
          <Badge variant="secondary">
            {filtered.length} de {counts.total}
          </Badge>
        </div>
      )}

      {(counts.critico > 0 || counts.alerta > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs border-b bg-muted/30">
          <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 border">
            Total: <strong>{counts.total}</strong>
          </span>
          {counts.critico > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-destructive/30 bg-destructive/10 text-destructive font-medium">
              🔴 {counts.critico} crítico{counts.critico > 1 ? "s" : ""}
            </span>
          )}
          {counts.alerta > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 font-medium">
              🟡 {counts.alerta} alerta{counts.alerta > 1 ? "s" : ""}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border bg-background">
            ✅ {Math.max(0, counts.total - counts.critico - counts.alerta)} aprovado(s)
          </span>
        </div>
      )}

      {/* Tabela / Lista */}
      <div className="flex-1 min-h-0 overflow-hidden bg-background isolate pb-2">
        <div
          ref={topScrollRef}
          className="grid-scroll-rail hidden md:block h-4 overflow-x-scroll overflow-y-hidden border-b bg-muted/20"
          aria-label="Rolagem horizontal da tabela"
          onScroll={(e) => syncScrollLeft("top", e.currentTarget.scrollLeft)}
          style={{ paddingRight: vScrollbarWidth, boxSizing: "border-box" }}
        >
          <div style={{ width: Math.max(measuredScrollWidth, tableMinWidth), height: 1 }} />
        </div>

        <div
          ref={gridScrollRef}
          className="grid-scroll-area h-[calc(100%-1rem)] w-full overflow-scroll isolate pb-4"
          onScroll={(e) => syncScrollLeft("grid", e.currentTarget.scrollLeft)}
        >
          {/* MOBILE — lista de cards (< md) */}
          <ul className="md:hidden divide-y">
            {filtered.length === 0 && (
              <li className="text-center py-8 text-muted-foreground text-xs">Nenhum item para exibir.</li>
            )}
            {displayRows.map((it, idx) => {
              const paciente = getPatient(it);
              const expected = (it as any).expected_amount ?? it.ai_findings?.expected_amount;
              const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus, (it as any).is_cancelled);
              const tone: keyof typeof TONE_CLASSES =
                eff === "cancelado" ? "muted"
                : eff === "reprovado" ? "destructive"
                : eff === "alerta" ? "warning"
                : eff === "aprovado" || eff === "seguido" ? "success"
                : "muted";
              const alerts = (it.ai_findings?.alerts ?? []) as string[];
              const isActive = activeId === it.id;
              const isCritical = eff === "reprovado";
              const hasAlert = alerts.length > 0;
              const diverges = expected != null && Math.abs(Number(expected) - Number(it.gross_amount ?? 0)) > 0.01;
              const itemOrigem = (it as any).item_origem as string | null | undefined;
              const isAdjust = !!itemOrigem && itemOrigem !== "pagamento_atual";
              const isBonus = (it as any).tipo_linha === "complemento_bonus";
              const prev = idx > 0 ? displayRows[idx - 1] : null;
              const prevIsAdjust = !!prev && !!(prev as any).item_origem && (prev as any).item_origem !== "pagamento_atual" && (prev as any).tipo_linha !== "complemento_bonus";
              const prevIsBonus = !!prev && (prev as any).tipo_linha === "complemento_bonus";
              const isFirstAdjust = isAdjust && !isBonus && !prevIsAdjust;
              const isFirstBonus = isBonus && !prevIsBonus;
              return (
                <Fragment key={it.id}>

                  {isFirstAdjust && (
                    <li
                      key={`adj-sep-${it.id}`}
                      className="px-4 py-2 bg-muted text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
                    >
                      Ajustes de conciliação
                    </li>
                  )}
                  {isBonus ? (
                    <li
                      key={it.id}
                      className={cn(
                        "px-3 py-2 cursor-pointer hover:bg-indigo-100/40 transition-colors border-l-2 border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/20",
                      )}
                      onClick={() => { selectRow(it.id); openDetail(it.id); }}
                    >
                      <div className="min-w-0 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              role="img"
                              aria-label="Linha de bônus de plantão de final de semana"
                              data-testid="bonus-badge-mobile"
                              className="inline-flex items-center gap-1 rounded-full border border-indigo-400 bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100 dark:border-indigo-700 px-1.5 py-0.5 text-[10px] font-bold"
                            >
                              <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> Bônus FdS
                            </span>
                            <span className="truncate text-[12px] text-indigo-900 dark:text-indigo-100 font-medium">
                              {it.procedure_name ?? (it as any).applied_rule_label ?? "Bônus Final de Semana"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{it.doctor_name ?? "—"}</p>
                        </div>
                        <span className="tabular-nums font-semibold text-indigo-700 text-[12px] shrink-0">
                          {formatCurrency(Number(it.gross_amount ?? 0))}
                        </span>
                      </div>
                    </li>
                  ) : (
                  <li
                    key={it.id}
                    className={cn(
                      "px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors",
                      isActive && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                    )}
                    onClick={() => { selectRow(it.id); openDetail(it.id); }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[13px] truncate">{paciente}</p>
                        <span className={cn("ml-auto inline-flex rounded-full border px-1.5 py-0.5 text-[9px] uppercase shrink-0", TONE_CLASSES[tone])}>
                          {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-0.5 inline" />}
                          {eff}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        <span className="font-mono">{it.procedure_code ?? "—"}</span>
                        {Number(it.quantity ?? 1) > 1 && (
                          <>
                            {" · "}
                            Qtd <span className="font-mono text-foreground">{Number(it.quantity ?? 1)}</span>
                          </>
                        )}
                        {" · "}
                        {it.procedure_name ?? it.description ?? "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{it.doctor_name ?? "—"}</p>
                      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="tabular-nums font-medium inline-flex items-center">
                          {formatCurrency(Number(it.gross_amount ?? 0))}
                          {isAdjust && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 9999,
                              background: itemOrigem === 'conciliacao_credito' ? 'hsl(var(--success-soft))' : 'hsl(var(--destructive-soft))',
                              color: itemOrigem === 'conciliacao_credito' ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
                              marginLeft: 4, whiteSpace: 'nowrap',
                            }}>
                              {itemOrigem === 'conciliacao_credito' ? 'Conc. +' : 'Conc. −'}
                            </span>
                          )}
                        </span>
                        {expected != null && (
                          <span className={cn("tabular-nums text-[11px]", diverges ? "text-warning-text" : "text-muted-foreground")}>
                            esp. {formatCurrency(Number(expected))}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                  )}
                  {expandedId === it.id && !isBonus && (
                    <li key={`exp-${it.id}`} className="bg-muted/20 p-0">
                      <table className="w-full">
                        <tbody>
                          <ItemDetailsRow
                            it={it}
                            allItems={items}
                            rulesIndex={rulesIndex}
                            rulesByName={rulesByName}
                            observations={observations}
                            profiles={profiles}
                            colSpan={1}
                            showTipoEntrada={!!colVis.tipo_entrada}
                            visitaPaymentTypeId={visitaPaymentTypeId}
                            parecerPaymentTypeId={parecerPaymentTypeId}
                            lotePaymentTypeId={lotePaymentTypeId}
                            isParecerPayment={isParecerPayment}
                            canEdit={canEdit}
                            onChangeCaseSubtype={changeCaseSubtype}
                          />
                        </tbody>
                      </table>
                    </li>
                  )}
                </Fragment>

              );
            })}

          </ul>
          {filtered.length > 0 && (
            <div className="md:hidden sticky bottom-0 z-20 flex items-center justify-between gap-2 border-t bg-muted/95 backdrop-blur px-4 py-4 shadow-[0_-8px_10px_-4px_rgba(0,0,0,0.1)]">
              <div className="flex flex-col gap-0.5">
                <span className={cn(TEXT_LABEL, "text-[10px] font-bold text-foreground")}>Total ({totals.count})</span>
                {totals.esperado != null && (
                  <span className={cn(TEXT_META, "tabular-nums text-[10px] font-medium")}>
                    Esp. {formatCurrency(totals.esperado)}
                  </span>
                )}
              </div>
              <span className="tabular-nums font-bold text-sm text-foreground">
                {formatCurrency(totals.valor)}
              </span>
            </div>
          )}

          {/* DESKTOP/TABLET — tabela densa (>= md). Apenas a coluna Paciente
              é sticky à esquerda — múltiplas sticky causavam sobreposição
              de conteúdo no scroll horizontal. As demais colunas truncam
              normalmente com larguras controladas via colgroup. */}
          <table
            data-density={isCompact ? "compact" : "comfortable"}
            className={cn("hidden md:table border-separate border-spacing-0 table-fixed", tableTextSize)}
            style={{ width: tableMinWidth, minWidth: tableMinWidth }}
          >
            <colgroup>
              {colVis.atendimento && <col style={{ width: 160 }} />}
              {colVis.data && <col style={{ width: 90 }} />}
              <col style={{ width: 160 }} />

              {colVis.convenio && <col style={{ width: 120 }} />}
              {colVis.via && <col style={{ width: 110 }} />}
              <col style={{ width: 88 }} />
              <col style={{ width: 56 }} />
              {colVis.procedimento && <col style={{ width: 200 }} />}
              {colVis.setor_lido && <col style={{ width: 110 }} />}
              {colVis.setor_inferido && <col style={{ width: 110 }} />}
              {colVis.tipo_entrada && <col style={{ width: 110 }} />}
              {colVis.subtipo && isParecerPayment && <col style={{ width: 80 }} />}
              <col style={{ width: 150 }} />
              {colVis.funcao && <col style={{ width: 100 }} />}
              {colVis.regra && <col style={{ width: 150 }} />}
              {showGrossColumn && <col style={{ width: 110 }} />}
              {showProcedureColumn && <col style={{ width: 130 }} />}
              <col style={{ width: expectedColWidth }} />
              {showDiferencaCol && <col style={{ width: 110 }} />}
              <col style={{ width: 110 }} />
              {colVis.observacao && <col style={{ width: 70 }} />}
              {canEdit && <col style={{ width: 120 }} />}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-muted text-muted-foreground">
              <tr>
                {colVis.atendimento && (
                  <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>
                    <div className="inline-flex items-center gap-1">
                      <span>Atend.</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Legenda dos selos do atendimento"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <HelpCircle className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 p-3 text-xs">
                          <div className="font-semibold text-foreground mb-2">Selos do atendimento</div>
                          <ul className="space-y-2">
                            <li className="flex items-start gap-2">
                              <span className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-muted text-muted-foreground border border-border shrink-0">CE</span>
                              <span className="text-muted-foreground">Caso especial aprovado para este item.</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-amber-100 text-amber-900 border border-amber-300 shrink-0">EX</span>
                              <span className="text-muted-foreground">Exceção de cálculo — o motor pulou o cálculo tipado da regra.</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-violet-100 text-violet-900 border border-violet-300 shrink-0">MAN</span>
                              <span className="text-muted-foreground">Tratamento manual — analista (ou auto via parecer) aceitou valor diferente do calculado.</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-300 shrink-0">
                                <FileText className="h-2.5 w-2.5 mr-0.5" />P✓
                              </span>
                              <span className="text-muted-foreground">Parecer cruzado: atendimento + data + médico bateram com o relatório.</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-300 shrink-0">
                                <FileText className="h-2.5 w-2.5 mr-0.5" />P?
                              </span>
                              <span className="text-muted-foreground">Parecer cruzado fraco: bateu atendimento e médico, mas data diverge.</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-muted text-muted-foreground border border-border shrink-0">
                                <FileText className="h-2.5 w-2.5 mr-0.5" />P×
                              </span>
                              <span className="text-muted-foreground">Sem parecer cruzado para este atendimento/médico no relatório importado.</span>
                            </li>
                          </ul>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </th>
                )}
                {colVis.data && (
                  <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Data</th>
                )}
                <th

                  scope="col"
                  aria-sort={sortKey === "paciente" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap sticky left-0 z-30 shadow-[1px_0_0_0_hsl(var(--border))]")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("paciente")}
                    className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                    aria-label={`Ordenar por Paciente${sortKey === "paciente" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                  >
                    Paciente
                    {sortKey === "paciente"
                      ? (sortDir === "asc"
                          ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </th>
                {colVis.convenio && (
                  <th
                    scope="col"
                    aria-sort={sortKey === "convenio" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort("convenio")}
                      className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                      aria-label={`Ordenar por Convênio${sortKey === "convenio" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                    >
                      Convênio
                      {sortKey === "convenio"
                        ? (sortDir === "asc"
                            ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                            : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                        : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                    </button>
                  </th>
                )}
                {colVis.via && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Via</th>}
                <th
                  scope="col"
                  aria-sort={sortKey === "tuss" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("tuss")}
                    className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                    aria-label={`Ordenar por TUSS${sortKey === "tuss" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                  >
                    TUSS
                    {sortKey === "tuss"
                      ? (sortDir === "asc"
                          ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={sortKey === "qtd" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(headPad, TEXT_LABEL, "text-right border-b bg-muted whitespace-nowrap")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("qtd")}
                    className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ml-auto !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                    aria-label={`Ordenar por Quantidade${sortKey === "qtd" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                  >
                    Qtd
                    {sortKey === "qtd"
                      ? (sortDir === "asc"
                          ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </th>
                {colVis.procedimento && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Procedimento</th>}
                {colVis.setor_lido && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Setor (Planilha)</th>}
                {colVis.setor_inferido && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Setor</th>}
                {colVis.tipo_entrada && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Caráter</th>}
                {colVis.subtipo && isParecerPayment && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")} title="Tipo de pagamento do item (Parecer × Visita)">Subtipo</th>}
                <th
                  scope="col"
                  aria-sort={sortKey === "medico" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("medico")}
                    className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                    aria-label={`Ordenar por Médico${sortKey === "medico" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                  >
                    Médico
                    {sortKey === "medico"
                      ? (sortDir === "asc"
                          ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </th>
                {colVis.funcao && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Função</th>}
                {colVis.regra && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Regra</th>}
                {showGrossColumn && (
                  <th
                    scope="col"
                    aria-sort={sortKey === "gross" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn(headPad, TEXT_LABEL, "text-right border-b bg-muted whitespace-nowrap")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort("gross")}
                      className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ml-auto !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                      aria-label={`Ordenar por Valor Repasse${sortKey === "gross" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                    >
                      Valor Repasse
                      {sortKey === "gross"
                        ? (sortDir === "asc"
                            ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                            : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                        : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                    </button>
                  </th>
                )}
                {showProcedureColumn && (
                  <th
                    scope="col"
                    className={cn(headPad, TEXT_LABEL, "text-right border-b bg-muted whitespace-nowrap")}
                  >
                    Valor Faturamento
                  </th>
                )}
                <th
                  scope="col"
                  aria-sort={sortKey === "esperado" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(headPad, TEXT_LABEL, "text-right border-b bg-muted whitespace-nowrap")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("esperado")}
                    className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ml-auto !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                    aria-label={`Ordenar por ${expectedLabel}${sortKey === "esperado" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                  >
                    {expectedLabel}
                    {sortKey === "esperado"
                      ? (sortDir === "asc"
                          ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </th>
                {showDiferencaCol && (
                  <th
                    scope="col"
                    aria-sort={sortKey === "diferenca" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn(headPad, TEXT_LABEL, "text-right border-b bg-muted whitespace-nowrap")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort("diferenca")}
                      className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ml-auto !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                      aria-label={`Ordenar por Diferença${sortKey === "diferenca" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                    >
                      Diferença
                      {sortKey === "diferenca"
                        ? (sortDir === "asc"
                            ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                            : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                        : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                    </button>
                  </th>
                )}
                <th
                  scope="col"
                  aria-sort={sortKey === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("status")}
                    className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded !text-[10px] !leading-tight uppercase tracking-wide !font-medium"
                    aria-label={`Ordenar por Status${sortKey === "status" ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
                  >
                    Status
                    {sortKey === "status"
                      ? (sortDir === "asc"
                          ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronDown className="h-3 w-3" aria-hidden="true" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                  </button>
                </th>
                {colVis.observacao && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-left border-b bg-muted whitespace-nowrap")}>Obs.</th>}
                {canEdit && <th scope="col" className={cn(headPad, TEXT_LABEL, "text-center border-b bg-muted whitespace-nowrap pr-4 sticky right-0 z-30 shadow-[-1px_0_0_0_hsl(var(--border))]")}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={20} className="text-center py-8 text-muted-foreground">
                    Nenhum item para exibir.
                  </td>
                </tr>
              )}
              {displayRows.map((it, idx) => {
                const paciente = getPatient(it);
                const expected = (it as any).expected_amount ?? it.ai_findings?.expected_amount;
                const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus, (it as any).is_cancelled);
                const tone: keyof typeof TONE_CLASSES =
                  eff === "cancelado"
                    ? "muted"
                    : eff === "reprovado"
                    ? "destructive"
                    : eff === "alerta"
                    ? "warning"
                    : eff === "aprovado" || eff === "seguido"
                    ? "success"
                    : "muted";
                const alerts = (it.ai_findings?.alerts ?? []) as string[];
                const isActive = activeId === it.id;
                const isCritical = eff === "reprovado";
                const obsCount = observations.filter((o) => o.item_id === it.id).length;

                const totalCols =
                  7 + 1 +
                  (showGrossColumn ? 1 : 0) +
                  (showProcedureColumn ? 1 : 0) - 1 +
                  (colVis.atendimento ? 1 : 0) +
                  (colVis.data ? 1 : 0) +
                  (colVis.convenio ? 1 : 0) +

                  (colVis.via ? 1 : 0) +
                  (colVis.setor_lido ? 1 : 0) +
                  (colVis.setor_inferido ? 1 : 0) +
                  (colVis.tipo_entrada ? 1 : 0) +
                  (colVis.subtipo && isParecerPayment ? 1 : 0) +
                  (colVis.funcao ? 1 : 0) +
                  (colVis.regra ? 1 : 0) +
                  (showDiferencaCol ? 1 : 0) +
                  (colVis.observacao ? 1 : 0) +
                  (canEdit ? 1 : 0);
                const isExpanded = expandedId === it.id;
                const itemOrigem = (it as any).item_origem as string | null | undefined;
                const isAdjust = !!itemOrigem && itemOrigem !== "pagamento_atual";
                const isBonus = (it as any).tipo_linha === "complemento_bonus";
                const prev = idx > 0 ? displayRows[idx - 1] : null;
                const prevIsAdjust = !!prev && !!(prev as any).item_origem && (prev as any).item_origem !== "pagamento_atual" && (prev as any).tipo_linha !== "complemento_bonus";
                const prevIsBonus = !!prev && (prev as any).tipo_linha === "complemento_bonus";
                const isFirstAdjust = isAdjust && !isBonus && !prevIsAdjust;
                const isFirstBonus = isBonus && !prevIsBonus;

                // Detecção de pacote — inclui itens manualmente absorvidos
                // (package_absorbed=true) como membros do mesmo atendimento,
                // para que sejam ocultados quando o pacote está colapsado e
                // não apareçam como linhas independentes (reprovado/aprovado).
                const isPacoteMethod = (it as any).applied_calc_method === "pacote";
                const isManuallyAbsorbed = (it as any).package_absorbed === true;
                const attForPkg = (it.attendance_number ?? "").toString().trim();
                const pkgGroup = attForPkg ? packageGroups.get(attForPkg) : undefined;
                const isPackageItem = (isPacoteMethod || isManuallyAbsorbed) && !!pkgGroup;
                const pkgAtt = isPackageItem ? attForPkg : "";
                const isFirstPkgItem = !!(pkgGroup && pkgGroup.firstItemIdx === idx);
                const isPackageCollapsed = isPackageItem && pkgAtt ? collapsedPackages.has(pkgAtt) : false;
                if (isPackageItem && isPackageCollapsed && !isFirstPkgItem) return null;
                const showItemRow = (!isPackageItem || !isPackageCollapsed);

                // === Agrupamento por atendimento (card) ===
                const attKey = (it.attendance_number ?? "").toString().trim();
                const attMeta = attKey ? attendanceMeta.get(attKey) : undefined;
                const isFirstAtt = !!attKey && attendanceFirstIdxByAtt.get(attKey) === idx;
                const isAttCollapsed = !!attKey && collapsedAttendances.has(attKey);
                // Quando atendimento colapsado: esconder TODAS as linhas (header substitui).
                if (attKey && isAttCollapsed && !isFirstAtt) return null;
                // Pula também banners/sub-bandas internos se colapsado.
                const hideInnerBands = attKey && isAttCollapsed;

                // Sub-banda por método de cálculo (dentro do mesmo atendimento)
                // — não emite banda para pacote (PackageBannerRow já cobre) nem
                //   para bonus/ajustes (já têm separadores próprios).
                const calcMethod = (it as any).applied_calc_method as string | null | undefined;
                const prevAttKey = prev ? (prev.attendance_number ?? "").toString().trim() : "";
                const prevCalcMethod = prev ? ((prev as any).applied_calc_method as string | null | undefined) : null;
                const sameAtt = !!attKey && prevAttKey === attKey;
                const calcChanged = sameAtt && calcMethod !== prevCalcMethod;
                const isPacoteBand = calcMethod === "pacote" || (it as any).package_absorbed === true;
                const shouldEmitRuleBand =
                  !isFirstAtt && sameAtt && calcChanged && !isPacoteBand && !isAdjust && !isBonus && !!calcMethod;


                return (
                  <Fragment key={it.id}>

                    {isFirstAtt && attMeta && (
                      <AttendanceHeaderRow
                        att={attKey}
                        meta={attMeta}
                        isCollapsed={isAttCollapsed}
                        onToggle={() =>
                          setCollapsedAttendances((prev) => {
                            const next = new Set(prev);
                            if (next.has(attKey)) next.delete(attKey);
                            else next.add(attKey);
                            return next;
                          })
                        }
                        totalCols={totalCols}
                        isCompact={isCompact}
                        showGrossColumn={showGrossColumn}
                      />
                    )}

                    {shouldEmitRuleBand && !hideInnerBands && (
                      <RuleBandRow
                        calcMethod={calcMethod!}
                        ruleLabel={(it as any).applied_rule_label ?? null}
                        totalCols={totalCols}
                      />
                    )}


                    {isFirstAdjust && (
                      <tr key={`adj-sep-${it.id}`}>
                        <td
                          colSpan={totalCols}
                          style={{
                            padding: '8px 16px',
                            background: 'hsl(var(--muted))',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: 'hsl(var(--muted-foreground))',
                          }}
                        >
                          Ajustes de conciliação
                        </td>
                      </tr>
                    )}
                    {isFirstPkgItem && pkgGroup && !hideInnerBands && (
                      <>
                        <PackageBannerRow
                          group={pkgGroup}
                          att={pkgAtt}
                          isCollapsed={isPackageCollapsed}
                          onToggle={() =>
                            setCollapsedPackages((prev) => {
                              const next = new Set(prev);
                              if (next.has(pkgAtt)) next.delete(pkgAtt);
                              else next.add(pkgAtt);
                              return next;
                            })
                          }
                          totalCols={totalCols}
                          isCompact={isCompact}
                          showGrossColumn={showGrossColumn}
                          canEdit={canEdit}
                          isAbsorcoesOpen={absorcoesOpenAtt === pkgAtt}
                          onToggleAbsorcoes={() =>
                            setAbsorcoesOpenAtt((cur) => (cur === pkgAtt ? null : pkgAtt))
                          }
                        />
                        {canEdit && absorcoesOpenAtt === pkgAtt && (
                          <tr key={`absorcoes-${pkgAtt}`}>
                            <td colSpan={totalCols} style={{ padding: 0, background: "hsl(45 100% 97%)", borderBottom: "1px solid hsl(var(--border))" }}>
                              <div className="p-3 space-y-2">
                                <div className="text-xs font-semibold text-amber-900">
                                  Gerenciar absorções — Atend. {pkgAtt}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  Marque códigos deste atendimento que devem ser absorvidos pelo pacote (expected = 0, aprovado).
                                  Os códigos já incluídos pela regra são automáticos.
                                </div>

                                {/* Itens já no pacote — via regra, bloqueados */}
                                {pkgGroup.items.map((pi) => (
                                  <div key={`pkg-locked-${pi.id}`} className="flex items-center gap-2 text-[11px] py-0.5">
                                    <CheckSquare className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                    <span className="font-mono">{getProcedureCode(pi)}</span>
                                    <span className="flex-1 truncate text-muted-foreground">{getProcedureName(pi) ?? "—"}</span>
                                    <span className="text-[10px] uppercase tracking-wide text-emerald-700">via regra</span>
                                  </div>
                                ))}

                                {/* Itens fora do pacote no mesmo atendimento */}
                                {(filtered as PaymentItemRowData[])
                                  .filter((x) => (x.attendance_number ?? "").toString().trim() === pkgAtt
                                    && !pkgGroup.items.some((p) => p.id === x.id))
                                  .map((x) => {
                                    const isAbsorbed = (x as any).package_absorbed === true;
                                    const isPending = absorcaoPending === x.id;
                                    const note = absorcaoNoteDraft[x.id] ?? "";
                                    return (
                                      <div key={`pkg-cand-${x.id}`} className="border border-amber-200 bg-white/60 rounded px-2 py-1.5 space-y-1">
                                        <div className="flex items-center gap-2 text-[11px]">
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              if (isAbsorbed) {
                                                const ok = await confirmDialog({
                                                  title: "Reverter absorção?",
                                                  description: "O código volta a ser cobrado fora do pacote.",
                                                  confirmText: "Reverter",
                                                  tone: "warning",
                                                });
                                                if (ok) reverterAbsorcao(x.id);
                                              } else {
                                                setAbsorcaoPending(isPending ? null : x.id);
                                              }
                                            }}
                                            disabled={!!savingAbsorcao}
                                            className="flex-shrink-0"
                                            title={isAbsorbed ? "Reverter absorção" : "Absorver no pacote"}
                                          >
                                            {isAbsorbed
                                              ? <CheckSquare className="h-4 w-4 text-amber-700" />
                                              : <Square className="h-4 w-4 text-muted-foreground" />
                                            }
                                          </button>
                                          <span className="font-mono">{getProcedureCode(x)}</span>
                                          <span className="flex-1 truncate text-muted-foreground">{getProcedureName(x) ?? "—"}</span>
                                          <span className="font-mono text-[10px] text-muted-foreground">R$ {Number(x.gross_amount ?? 0).toFixed(2)}</span>
                                          {isAbsorbed && (
                                            <button
                                              type="button"
                                              onClick={async () => {
                                                const ok = await confirmDialog({
                                                  title: "Reverter absorção?",
                                                  description: "O código volta a ser cobrado fora do pacote.",
                                                  confirmText: "Reverter",
                                                  tone: "warning",
                                                });
                                                if (ok) reverterAbsorcao(x.id);
                                              }}
                                              disabled={!!savingAbsorcao}
                                              className="inline-flex items-center gap-1 text-[10px] text-red-600 hover:text-red-700"
                                              title="Reverter absorção manual"
                                            >
                                              <RotateCcw className="h-3 w-3" /> reverter
                                            </button>
                                          )}
                                        </div>
                                        {isAbsorbed && (x as any).package_absorbed_note && (
                                          <div className="text-[10px] italic text-muted-foreground pl-6">
                                            "{(x as any).package_absorbed_note}"
                                          </div>
                                        )}
                                        {isPending && !isAbsorbed && (
                                          <div className="pl-6 space-y-1">
                                            <textarea
                                              value={note}
                                              placeholder="Justifique a absorção (mín. 10 caracteres)…"
                                              onChange={(e) => setAbsorcaoNoteDraft((d) => ({ ...d, [x.id]: e.target.value }))}
                                              rows={2}
                                              className="w-full text-[11px] rounded border border-amber-300 bg-white px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
                                            />
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                disabled={note.trim().length < 10 || !!savingAbsorcao}
                                                onClick={() => absorverItem(x.id, (x as any).package_absorbed_calc_id ?? null, note)}
                                                className="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-medium disabled:opacity-40 hover:bg-amber-700"
                                              >
                                                {savingAbsorcao === x.id ? "Salvando…" : "Confirmar absorção"}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setAbsorcaoPending(null)}
                                                className="px-2 py-0.5 rounded border text-[10px] text-muted-foreground hover:bg-muted"
                                              >
                                                Cancelar
                                              </button>
                                              <span className="text-[10px] text-muted-foreground">{note.trim().length}/mín.10</span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )}

                    {showItemRow && !(attKey && isAttCollapsed) && (
                      <RowMain
                        key={it.id}
                        it={it}
                        allItems={items}
                        paciente={paciente}
                        expected={expected ?? null}
                        eff={eff}
                        tone={tone}
                        isActive={isActive}
                        isExpanded={isExpanded}
                        isCritical={isCritical}
                        hasAlert={alerts.length > 0}
                        onSelect={() => selectRow(it.id)}
                        onOpen={() => openDetail(it.id)}
                        colVis={colVis}
                        rulesIndex={rulesIndex}
                        rulesByName={rulesByName}
                        observations={observations}
                        profiles={profiles}
                        obsCount={obsCount}
                        isCompact={isCompact}
                        totalCols={totalCols}
                        canEdit={canEdit}
                        onEditItem={onEditItem}
                        onDeleteItem={onDeleteItem}
                        onAcceptItem={onAcceptItem}
                        onAcceptItemKeepPaid={onAcceptItemKeepPaid}
                        onUndoAcceptItem={onUndoAcceptItem}
                        showGrossColumn={showGrossColumn}
                        showProcedureColumn={showProcedureColumn}
                        showDiferencaCol={showDiferencaCol}
                        mode={mode}
                        isParecerPayment={isParecerPayment}
                        lotePaymentTypeId={lotePaymentTypeId}
                        visitaPaymentTypeId={visitaPaymentTypeId}
                        parecerPaymentTypeId={parecerPaymentTypeId}
                        onChangeCaseSubtype={changeCaseSubtype}
                        onRefresh={onRefresh}
                      />
                    )}
                  </Fragment>

                );
              })}

            </tbody>
            {filtered.length > 0 && (() => {
              const leadingCols =
                (colVis.atendimento ? 1 : 0) +
                (colVis.data ? 1 : 0) +
                1 /* paciente */ +
                (colVis.convenio ? 1 : 0) +

                (colVis.via ? 1 : 0) +
                1 /* tuss */ +
                1 /* qtd */ +
                (colVis.procedimento ? 1 : 0) /* procedimento */ +
                (colVis.setor_lido ? 1 : 0) +
                (colVis.setor_inferido ? 1 : 0) +
                (colVis.tipo_entrada ? 1 : 0) +
                (colVis.subtipo && isParecerPayment ? 1 : 0) +
                1 /* medico */ +
                (colVis.funcao ? 1 : 0) +
                (colVis.regra ? 1 : 0);
              const trailingCols = 1 /* status */ + (colVis.observacao ? 1 : 0) + (canEdit ? 1 : 0);
              const footPad = isCompact ? "px-1.5 py-3" : "px-2 py-4";
              return (
                <tfoot className="sticky bottom-0 z-20 shadow-[0_-8px_10px_-4px_rgba(0,0,0,0.1)]">
                  <tr>
                    <td
                      colSpan={leadingCols}
                      className={cn(footPad, "text-right border-t bg-muted/95 backdrop-blur whitespace-nowrap")}
                    >
                      <span className={cn(TEXT_LABEL, "text-xs font-bold text-foreground")}>
                        Total ({totals.count} {totals.count === 1 ? "item" : "itens"})
                      </span>
                    </td>
                    {showGrossColumn && (
                      <td className={cn(footPad, "text-right tabular-nums font-bold text-sm border-t bg-muted/95 backdrop-blur whitespace-nowrap")}>
                        {formatCurrency(totals.valor)}
                      </td>
                    )}
                    {showProcedureColumn && (
                      <td className={cn(footPad, "text-right tabular-nums font-bold text-sm border-t bg-muted/95 backdrop-blur whitespace-nowrap")}>
                        {totals.procedure > 0 ? formatCurrency(totals.procedure) : "—"}
                      </td>
                    )}
                    <td className={cn(footPad, "text-right tabular-nums font-bold text-sm border-t bg-muted/95 backdrop-blur whitespace-nowrap")}>
                      {totals.esperado != null ? formatCurrency(totals.esperado) : "—"}
                    </td>
                    {showDiferencaCol && (
                      <td
                        className={cn(
                          footPad,
                          "text-right tabular-nums font-bold text-sm border-t bg-muted/95 backdrop-blur whitespace-nowrap",
                          totals.diferenca != null && Math.abs(totals.diferenca) > 0.01
                            ? totals.diferenca < 0 ? "text-warning-text" : "text-success"
                            : "text-muted-foreground",
                        )}
                      >
                        {totals.diferenca != null
                          ? `${totals.diferenca > 0 ? "+" : ""}${formatCurrency(totals.diferenca)}`
                          : "—"}
                      </td>
                    )}
                    <td colSpan={trailingCols} className={cn(footPad, "border-t bg-muted/95 backdrop-blur")} />
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      </div>

      {showKeyboardHint && (
        <div className="border-t px-4 py-1.5 text-[10px] text-muted-foreground bg-muted/20">
          Use ↑/↓ ou j/k para navegar · Enter para expandir/colapsar · Esc para fechar
        </div>
      )}
    </div>
  );
}

// ============================================================
//  PackageBannerRow — cabeçalho colapsável de grupo de pacote
// ============================================================
// ============================================================
//  AttendanceHeaderRow — header-card colapsável por atendimento
// ============================================================
const CALC_METHOD_LABELS: Record<string, { label: string; emoji: string }> = {
  // 📦 fica reservado para o PackageBannerRow (pacote REAL com itens absorvidos).
  // Na banda fina por método usamos um ícone neutro para não criar a impressão
  // visual de que todo item "pacote" cataloga um pacote consolidado.
  pacote: { label: "Pacote", emoji: "🧮" },
  tabela_diferenciada: { label: "Tabela diferenciada", emoji: "📊" },
  percentual_convenio: { label: "% do convênio", emoji: "%" },
  percentual_sobre_convenio: { label: "% sobre convênio", emoji: "%" },
  valor_fixo: { label: "Valor fixo", emoji: "₣" },
  bonus: { label: "Bônus", emoji: "★" },
  sem_acordo: { label: "Sem acordo", emoji: "○" },
  sem_regra: { label: "Sem regra", emoji: "⚠" },
};

// ============================================================
//  buildCalcFormula — deriva fórmula auditável a partir do item
//  Retorna lista de linhas {label, value} para exibir no expand.
//  Usa apenas dados já presentes no payment_item — sem fetch extra.
// ============================================================
function buildCalcFormula(it: {
  applied_calc_method?: string | null;
  procedure_amount?: number | null;
  expected_amount?: number | null;
  gross_amount?: number | null;
  quantity?: number | null;
  convenio_basis_detected?: string | null;
  ai_findings?: { calculation_explanation?: string } | null;
}): Array<{ label: string; value: string; mono?: boolean }> {
  const method = it.applied_calc_method ?? "";
  const proc = Number(it.procedure_amount ?? 0);
  const exp = Number(it.expected_amount ?? 0);
  const qty = Number(it.quantity ?? 1) || 1;
  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtPct = (n: number) =>
    `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  const lines: Array<{ label: string; value: string; mono?: boolean }> = [];

  if (method === "percentual_convenio" || method === "percentual_sobre_convenio") {
    const pct = proc > 0 ? (exp / proc) * 100 : null;
    if (it.convenio_basis_detected) lines.push({ label: "Base", value: it.convenio_basis_detected });
    lines.push({ label: "Tabela do convênio", value: fmt(proc), mono: true });
    if (pct != null && isFinite(pct)) {
      lines.push({ label: "Percentual aplicado", value: fmtPct(pct), mono: true });
      lines.push({
        label: "Fórmula",
        value: `${fmt(proc)} × ${fmtPct(pct)} = ${fmt(exp)}`,
        mono: true,
      });
    } else {
      lines.push({ label: "Esperado", value: fmt(exp), mono: true });
    }
  } else if (method === "tabela_diferenciada") {
    const mult = proc > 0 ? exp / proc : null;
    lines.push({ label: "Base (tabela)", value: fmt(proc), mono: true });
    if (mult != null && isFinite(mult)) {
      lines.push({ label: "Multiplicador", value: `× ${mult.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`, mono: true });
      lines.push({ label: "Fórmula", value: `${fmt(proc)} × ${mult.toFixed(2)} = ${fmt(exp)}`, mono: true });
    } else {
      lines.push({ label: "Esperado", value: fmt(exp), mono: true });
    }
  } else if (method === "valor_fixo") {
    lines.push({ label: "Valor fixo por item", value: fmt(qty > 0 ? exp / qty : exp), mono: true });
    if (qty > 1) lines.push({ label: "Quantidade", value: `× ${qty}`, mono: true });
    lines.push({ label: "Esperado", value: fmt(exp), mono: true });
  } else if (method === "pacote") {
    lines.push({ label: "Valor do pacote", value: fmt(exp), mono: true });
    lines.push({ label: "Tipo", value: "Fechado (não soma por item)" });
  } else if (method === "bonus") {
    lines.push({ label: "Bônus", value: fmt(exp || Number(it.gross_amount ?? 0)), mono: true });
  } else if (method === "sem_acordo") {
    lines.push({ label: "Sem tabela cadastrada", value: "verifica presença + quantidade" });
    if (proc > 0) lines.push({ label: "Valor da base", value: fmt(proc), mono: true });
  } else if (method === "sem_regra") {
    lines.push({ label: "Sem regra cadastrada", value: "item não foi calculado" });
  } else if (exp > 0 || proc > 0) {
    lines.push({ label: "Base", value: fmt(proc), mono: true });
    lines.push({ label: "Esperado", value: fmt(exp), mono: true });
  }

  const ai = it.ai_findings?.calculation_explanation;
  if (ai && lines.length > 0) lines.push({ label: "Explicação", value: ai });
  return lines;
}

/**
 * Badge do piso por procedimento (mínimo garantido).
 * Aparece só quando o motor gravou `piso_aplicado_valor`. Mostra qual valor
 * venceu — o cálculo do convênio ou o piso configurado na regra.
 */
function PisoAppliedBadge({ item }: { item: Record<string, unknown> }) {
  const valor = Number((item as { piso_aplicado_valor?: number | string | null }).piso_aplicado_valor ?? 0);
  const metodo = (item as { piso_metodo_vencedor?: string | null }).piso_metodo_vencedor ?? null;
  if (!metodo || !Number.isFinite(valor) || valor <= 0) return null;
  const venceuPiso = metodo === "piso";
  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
          venceuPiso
            ? "border-warning/40 bg-warning-soft text-warning-text"
            : "border-success/40 bg-success-soft text-success",
        )}
        title={venceuPiso
          ? "O piso mínimo garantido superou o cálculo do convênio e foi aplicado."
          : "O cálculo do convênio superou o piso — piso não foi necessário."}
      >
        <span aria-hidden>🛡️</span>
        {venceuPiso ? "Piso aplicado" : "Convênio > piso"}
        <span className="opacity-80">· {formatCurrency(valor)}</span>
      </span>
    </div>
  );
}

function CalcFormulaBlock({
  item,
}: {
  item: Parameters<typeof buildCalcFormula>[0] & {
    applied_calc_id?: string | null;
    applied_rule_id?: string | null;
    procedure_code?: string | null;
    doctor_role?: string | null;
    package_absorbed?: boolean | null;
  };
}) {
  const lines = buildCalcFormula(item);
  const [calcMeta, setCalcMeta] = useState<{
    id: string;
    label: string | null;
    package_main_code: string | null;
    rule_id: string | null;
    calculation_type: string | null;
    rule_name?: string | null;
  } | null>(null);

  useEffect(() => {
    const calcId = item.applied_calc_id;
    if (!calcId) {
      setCalcMeta(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("rule_calculations")
      .select("id,label,package_main_code,rule_id,calculation_type,rules(name)")
      .eq("id", calcId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as any;
        setCalcMeta(
          d
            ? {
                id: d.id,
                label: d.label ?? null,
                package_main_code: d.package_main_code ?? null,
                rule_id: d.rule_id ?? null,
                calculation_type: d.calculation_type ?? null,
                rule_name: d.rules?.name ?? null,
              }
            : null,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [item.applied_calc_id]);

  // Trilha de decisão (puramente derivada — sem mexer no motor)
  const mismatch = detectTussMismatch(
    {
      procedure_code: item.procedure_code ?? null,
      applied_calc_method: item.applied_calc_method ?? null,
      applied_calc_id: item.applied_calc_id ?? null,
      applied_rule_id: item.applied_rule_id ?? null,
      package_absorbed: item.package_absorbed ?? null,
      ai_findings: (item.ai_findings as any) ?? null,
    },
    calcMeta,
  );
  const tussItemNorm = (item.procedure_code ?? "").toString().replace(/\D/g, "").slice(0, 8) || null;
  const ruleName = calcMeta?.rule_name ?? null;
  const calcLabel = calcMeta?.label ?? null;
  const calcMethodLabel = item.applied_calc_method
    ? (CALC_METHOD_LABELS[item.applied_calc_method] ?? { label: item.applied_calc_method }).label
    : null;
  const doctorRole = (item.doctor_role ?? "").toString().trim() || null;
  const aiPriority = (item.ai_findings as any)?.engine?.matched_priority ?? null;

  if (lines.length === 0 && !calcMeta?.label && !mismatch) return null;
  return (
    <div className="mt-2 pt-2 border-t border-border/60 space-y-3">
      {calcMeta?.label && (
        <div>
          <Label>Linha de cálculo</Label>
          <p className="mt-0.5 text-[13px] font-medium break-words">
            {calcMeta.label}
            {calcMeta.package_main_code && (
              <span className="ml-2 text-[11px] font-mono text-muted-foreground">
                · TUSS {calcMeta.package_main_code}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Trilha de decisão */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>Trilha de decisão</Label>
          <PaymentItemExplainButton
            item={item as Record<string, unknown>}
            itemStatus={(item as { ai_status?: string }).ai_status ?? "—"}
          />
        </div>
        <ol className="mt-1 space-y-1 text-[12px]">
          <li className="flex gap-2">
            <span aria-hidden>✅</span>
            <span>
              <span className="text-muted-foreground">TUSS principal do item:</span>{" "}
              <span className="font-mono">{tussItemNorm ?? "—"}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>{doctorRole ? "✅" : "⚠️"}</span>
            <span>
              <span className="text-muted-foreground">Função do profissional:</span>{" "}
              <span>{doctorRole ?? "não informada"}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>{ruleName ? "✅" : "⚠️"}</span>
            <span>
              <span className="text-muted-foreground">Regra avaliada:</span>{" "}
              <span>{ruleName ?? "—"}</span>
              {aiPriority && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  (prioridade: {aiPriority})
                </span>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>{calcLabel ? "✅" : "⚠️"}</span>
            <span>
              <span className="text-muted-foreground">Cálculo aplicado:</span>{" "}
              <span>{calcLabel ?? calcMethodLabel ?? "—"}</span>
              {calcMethodLabel && calcLabel && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  ({calcMethodLabel})
                </span>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>{mismatch ? "⛔" : "✅"}</span>
            <span>
              <span className="text-muted-foreground">Match de chave:</span>{" "}
              {mismatch ? (
                <span className="text-destructive font-medium">
                  {TUSS_REASON_LABELS[mismatch.reason]}
                </span>
              ) : (
                <span>TUSS do item coerente com o cálculo aplicado</span>
              )}
            </span>
          </li>
        </ol>

        {mismatch && (
          <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[12px] text-destructive">
            <div className="font-semibold">
              TUSS principal não usado como chave
            </div>
            <div className="text-[11px] mt-0.5 text-destructive/90">
              {mismatch.detalhe}
            </div>
            {mismatch.tuss_regra && (
              <div className="text-[11px] mt-0.5 font-mono">
                item TUSS {mismatch.tuss_item ?? "—"} · cálculo TUSS{" "}
                {mismatch.tuss_regra}
              </div>
            )}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <div>
          <Label>Fórmula aplicada</Label>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            {lines.map((l, i) => (
              <Fragment key={i}>
                <dt className="text-muted-foreground">{l.label}</dt>
                <dd className={cn("break-words", l.mono && "tabular-nums font-mono")}>{l.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function AttendanceHeaderRow({
  att,
  meta,
  isCollapsed,
  onToggle,
  totalCols,
  isCompact,
  showGrossColumn,
}: {
  att: string;
  meta: {
    paciente: string;
    count: number;
    totalGross: number;
    totalExpected: number | null;
    worstStatus: "reprovado" | "alerta" | "aprovado" | "cancelado";
    hasPackage: boolean;
  };
  isCollapsed: boolean;
  onToggle: () => void;
  totalCols: number;
  isCompact: boolean;
  showGrossColumn: boolean;
}) {
  const palette =
    meta.worstStatus === "reprovado"
      ? { bg: "hsl(0 70% 97%)", border: "hsl(0 70% 55%)", text: "hsl(0 65% 35%)", badge: "destructive" as const, label: "Com divergência" }
      : meta.worstStatus === "alerta"
      ? { bg: "hsl(38 85% 96%)", border: "hsl(38 80% 55%)", text: "hsl(28 70% 30%)", badge: "warning" as const, label: "Com alertas" }
      : meta.worstStatus === "cancelado"
      ? { bg: "hsl(var(--muted))", border: "hsl(var(--border))", text: "hsl(var(--muted-foreground))", badge: "muted" as const, label: "Cancelado" }
      : { bg: "hsl(142 45% 96%)", border: "hsl(142 45% 50%)", text: "hsl(142 45% 25%)", badge: "success" as const, label: "OK" };

  const pad = isCompact ? "8px 14px" : "10px 16px";
  const diff = meta.totalExpected != null ? meta.totalGross - meta.totalExpected : null;

  return (
    <tr
      className="cursor-pointer select-none hover:brightness-[0.98] transition-all"
      style={{ background: palette.bg }}
      onClick={onToggle}
      title={isCollapsed ? "Expandir atendimento" : "Colapsar atendimento"}
    >
      <td
        colSpan={totalCols}
        style={{
          padding: pad,
          borderTop: `3px solid ${palette.border}`,
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            minWidth: 0,
            position: "sticky",
            left: 12,
            maxWidth: "min(calc(100vw - 32px), 100%)",
          }}
        >
          <span style={{ color: palette.text, display: "flex", alignItems: "center", flexShrink: 0 }}>
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: palette.text, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            Atend. {att}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
            {meta.paciente}
          </span>
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
            · {meta.count} {meta.count === 1 ? "item" : "itens"}
          </span>
          {meta.hasPackage && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap flex-shrink-0">
              📦 Pacote
            </span>
          )}
          <span className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap flex-shrink-0",
            TONE_CLASSES[palette.badge],
          )}>
            {palette.label}
          </span>
          <div style={{ flex: 1 }} />
          {showGrossColumn && (
            <span style={{
              fontFamily: "monospace",
              fontSize: 13,
              fontWeight: 700,
              color: palette.text,
              whiteSpace: "nowrap",
            }}>
              {formatCurrency(meta.totalGross)}
            </span>
          )}
          {meta.totalExpected != null && diff != null && Math.abs(diff) > 0.02 && (
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
              esp. {formatCurrency(meta.totalExpected)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ============================================================
//  RuleBandRow — sub-banda fina indicando troca de método de cálculo
// ============================================================
function RuleBandRow({
  calcMethod,
  ruleLabel,
  totalCols,
}: {
  calcMethod: string;
  ruleLabel: string | null;
  totalCols: number;
}) {
  const meta = CALC_METHOD_LABELS[calcMethod] ?? { label: calcMethod, emoji: "•" };
  return (
    <tr style={{ background: "hsl(var(--muted) / 0.4)" }}>
      <td
        colSpan={totalCols}
        style={{
          padding: "3px 16px 3px 32px",
          borderLeft: "3px solid hsl(var(--border))",
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
          <span>{meta.emoji}</span>
          <span>{meta.label}</span>
          {ruleLabel && (
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: "normal", color: "hsl(var(--muted-foreground))" }}>
              · {ruleLabel}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ============================================================
//  PackageBannerRow — cabeçalho colapsável de grupo de pacote
// ============================================================
function PackageBannerRow({
  group,
  att,
  isCollapsed,
  onToggle,
  totalCols,
  isCompact,
  showGrossColumn,
  canEdit = false,
  isAbsorcoesOpen = false,
  onToggleAbsorcoes,
}: {
  group: {
    items: import("@/hooks/usePaymentDetailData").PaymentItemRow[];
    ruleName: string;
    totalGross: number;
    totalExpected: number | null;
    worstStatus: "reprovado" | "alerta" | "aprovado";
  };
  att: string;
  isCollapsed: boolean;
  onToggle: () => void;
  totalCols: number;
  isCompact: boolean;
  showGrossColumn: boolean;
  canEdit?: boolean;
  isAbsorcoesOpen?: boolean;
  onToggleAbsorcoes?: () => void;
}) {
  const statusColor =
    group.worstStatus === "reprovado"
      ? { bg: "hsl(0 70% 96%)", border: "hsl(0 60% 65%)", text: "hsl(0 60% 35%)" }
      : group.worstStatus === "alerta"
      ? { bg: "hsl(38 80% 95%)", border: "hsl(38 70% 58%)", text: "hsl(38 60% 30%)" }
      : { bg: "hsl(142 40% 95%)", border: "hsl(142 40% 62%)", text: "hsl(142 40% 25%)" };

  const statusLabel =
    group.worstStatus === "aprovado"
      ? "✓ Pacote OK"
      : group.worstStatus === "alerta"
      ? "⚠ Com alertas"
      : "✗ Com divergência";

  const tone: keyof typeof TONE_CLASSES =
    group.worstStatus === "reprovado"
      ? "destructive"
      : group.worstStatus === "alerta"
      ? "warning"
      : "success";

  const pad = isCompact ? "5px 12px" : "8px 16px";

  return (
    <tr
      className="cursor-pointer select-none hover:brightness-95 transition-all"
      style={{ background: statusColor.bg }}
      onClick={onToggle}
      title={isCollapsed ? "Expandir itens do pacote" : "Colapsar itens do pacote"}
    >
      <td
        colSpan={totalCols}
        style={{
          padding: pad,
          borderBottom: "1px solid hsl(var(--border))",
          borderTop: `2px solid ${statusColor.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            minWidth: 0,
            position: "sticky",
            left: 12,
            // Mantém o conteúdo do banner sempre dentro da viewport do scroll
            // horizontal (caso contrário, badges e totais ficam cortados na
            // ponta direita da tabela, fora da tela). Em telas pequenas o
            // wrap garante que o badge "COM ALERTAS" nunca seja cortado.
            maxWidth: "min(calc(100vw - 32px), 100%)",
          }}
        >
          <span style={{ color: statusColor.text, display: "flex", alignItems: "center", flexShrink: 0 }}>
            {isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: statusColor.text, whiteSpace: "nowrap" }}>
            📦 {group.ruleName}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
            Atend. {att}
          </span>
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
            · {group.items.length} {group.items.length === 1 ? "item" : "itens"}
          </span>
          {/* Badge logo após o contador de itens — alinhamento consistente em todas as variantes */}
          <span className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap flex-shrink-0",
            TONE_CLASSES[tone],
          )}>
            {statusLabel}
          </span>
          {canEdit && onToggleAbsorcoes && !isCollapsed && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleAbsorcoes(); }}
              className={cn(
                "ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-border transition-colors flex-shrink-0",
                isAbsorcoesOpen ? "bg-amber-100 text-amber-900 border-amber-300" : "text-muted-foreground hover:bg-muted/60",
              )}
              title="Gerenciar absorções do pacote neste atendimento"
            >
              <Settings2 className="h-3 w-3" />
              Absorções
            </button>
          )}
          {showGrossColumn && (
            <span style={{
              fontFamily: "monospace",
              fontSize: 13,
              fontWeight: 700,
              color: statusColor.text,
              whiteSpace: "nowrap",
              marginLeft: 4,
            }}>
              {formatCurrency(group.totalGross)}
            </span>
          )}
          {group.totalExpected != null && Math.abs(group.totalGross - group.totalExpected) > 0.02 && (
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
              esp. {formatCurrency(group.totalExpected)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function RowMain({
  it,
  allItems,
  paciente,
  expected,
  eff,
  tone,
  isActive,
  isExpanded,
  isCritical,
  hasAlert,
  onSelect,
  onOpen,
  colVis,
  rulesIndex,
  rulesByName,
  observations,
  profiles,
  obsCount,
  isCompact,
  totalCols,
  canEdit,
  onEditItem,
  onDeleteItem,
  onAcceptItem,
  onAcceptItemKeepPaid,
  onUndoAcceptItem,
  showGrossColumn = true,
  showProcedureColumn = false,
  showDiferencaCol = true,
  mode = "analise",
  isParecerPayment = false,
  lotePaymentTypeId = null,
  visitaPaymentTypeId = null,
  parecerPaymentTypeId = null,
  onChangeCaseSubtype,
  onRefresh,
}: {
  it: PaymentItemRowData;
  allItems: PaymentItemRowData[];
  paciente: string;
  expected: number | null;
  eff: ItemAiStatus | "seguido" | "cancelado";
  tone: keyof typeof TONE_CLASSES;
  isActive: boolean;
  isExpanded: boolean;
  isCritical: boolean;
  hasAlert: boolean;
  onSelect: () => void;
  onOpen: () => void;
  colVis: Record<OptionalColKey, boolean>;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations: ObservationRow[];
  profiles: Record<string, string>;
  obsCount: number;
  isCompact: boolean;
  totalCols: number;
  canEdit?: boolean;
  onEditItem?: (item: PaymentItemRowData) => void;
  onDeleteItem?: (item: PaymentItemRowData) => void;
  onAcceptItem?: (item: PaymentItemRowData) => void;
  onAcceptItemKeepPaid?: (item: PaymentItemRowData) => void;
  onUndoAcceptItem?: (item: PaymentItemRowData) => void;
  showGrossColumn?: boolean;
  showProcedureColumn?: boolean;
  showDiferencaCol?: boolean;
  mode?: "analise" | "confeccao";
  isParecerPayment?: boolean;
  lotePaymentTypeId?: string | null;
  visitaPaymentTypeId?: string | null;
  parecerPaymentTypeId?: string | null;
  onChangeCaseSubtype?: (
    itemIds: string[],
    newTypeId: string,
    newTypeLabel: string,
  ) => void;
  onRefresh?: () => void;
}) {
  const convenio = getAgreement(it);
  // Itens absorvidos manualmente em pacote: zerados visualmente — o valor
  // foi incorporado ao pacote principal, não devem aparecer como repasse próprio.
  const isAbsorbed = (it as any).package_absorbed === true;
  const grossN = isAbsorbed ? 0 : Number(it.gross_amount ?? 0);
  const expN = isAbsorbed ? 0 : (expected != null ? Number(expected) : null);
  const diff = expN != null ? expN - grossN : null;
  const diverges = diff != null && Math.abs(diff) > 0.01;
  const sectorAliases = useSectorAliases();
  const rawSetor = rawPick(it.raw_data, SECTOR_RAW_KEYS as unknown as string[]) ?? null;
  // "Setor (Sistema)": resolve via alias map a partir da planilha — assim o display fica
  // correto mesmo quando `it.sector` foi persistido errado (override antigo do bucket).
  const resolvedSystemSector =
    (sectorAliases?.resolve(rawSetor) ??
      sectorAliases?.resolve(it.sector) ??
      it.sector ??
      rawSetor) || null;

  const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
  const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
  let ruleName = "—";
  if (matchedIds[0] && rulesIndex[matchedIds[0]]) ruleName = rulesIndex[matchedIds[0]].name;
  else if (matchedNames[0]) {
    const r = rulesByName[String(matchedNames[0]).trim().toLowerCase()];
    ruleName = r?.name ?? matchedNames[0];
  }

  const isBonus = (it as any).tipo_linha === "complemento_bonus";
  const baseCellBg = isBonus
    ? "bg-indigo-50/60 dark:bg-indigo-950/20"
    : isExpanded
    ? "bg-primary/10"
    : isActive
    ? "bg-primary/5"
    : "bg-background";
  const stickyBg = isExpanded
    ? "bg-primary-soft"
    : isActive
    ? "bg-primary-soft/60"
    : "bg-card";
  const stickyHover = !isActive && !isExpanded ? "group-hover:bg-muted" : "";
  const cellPad = isCompact ? "px-1 py-0" : "px-2.5 py-2";
  // Sempre permitir quebra de linha natural. Sem line-clamp (que estava clipando
  // texto em 1 linha quando o span ficava como flex item sem min-w-0).
  const wrapClass = isCompact
    ? "block whitespace-normal break-words leading-[1.1] min-w-0"
    : "block whitespace-normal break-words leading-snug min-w-0";
  const cell = cn(cellPad, "border-b align-top break-words", baseCellBg);
  const stickyCell = cn(
    cellPad,
    "border-b align-top break-words sticky left-0 z-10 shadow-[1px_0_0_0_hsl(var(--border))]",
    stickyBg,
    stickyHover,
  );

  return (
    <>
      <tr
        onClick={() => { onSelect(); }}
        onDoubleClick={() => { onSelect(); onOpen(); }}
        data-row-id={it.id}
        aria-selected={isActive}
        aria-expanded={isExpanded}
        tabIndex={-1}
        title="Duplo clique para expandir detalhes"
        className={cn(
          "group cursor-pointer hover:bg-muted/40 transition-colors select-text",
          isExpanded && "ring-1 ring-inset ring-primary/40",
        )}
      >
        {colVis.atendimento && (
          <td className={cn(cell, "font-mono", TEXT_META)} title={it.attendance_number ?? ""}>
            <div className="flex items-center gap-1 flex-wrap">
              <span>{it.attendance_number ?? "—"}</span>
              {(it as any).special_case_status === "approved" && (it as any).special_case_code && (
                <span
                  className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-muted text-muted-foreground border border-border"
                  title={`Caso especial ativo: ${(it as any).special_case_code}`}
                >
                  CE
                </span>
              )}
              {(it as any).calc_exception_skip === true && (
                <span
                  className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/70"
                  title="Exceção do cálculo ativa — item pulou o cálculo tipado da regra"
                >
                  EX
                </span>
              )}
              {!!(it as any).manual_intervention_reason_id && (
                <span
                  className="inline-flex items-center h-4 px-1 rounded text-[10px] bg-violet-100 text-violet-900 border border-violet-300 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-800/70"
                  title={
                    (it as any).manual_intervention_source === "auto_parecer_report"
                      ? "Tratamento manual aplicado automaticamente via relatório de parecer"
                      : "Tratamento manual ativo — motor aceitou valor do convênio"
                  }
                >
                  MAN
                </span>
              )}
              {isParecerPayment && <ParecerEvidenceBadge item={it} />}
              {isParecerPayment && (() => {
                const div = computeDescriptionDivergence(it, isParecerPayment, visitaPaymentTypeId, parecerPaymentTypeId, lotePaymentTypeId);
                if (!div) return null;
                return (
                  <span
                    className="inline-flex items-center h-4 gap-0.5 rounded px-1 text-[10px] border bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-800"
                    title={`${div} Verifique se a classificação está correta.`}
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Divergência
                  </span>
                );
              })()}
              {isParecerPayment && (
                <CaseSubtypeBadge
                  item={it}
                  allItems={allItems}
                  lotePaymentTypeId={lotePaymentTypeId}
                  visitaPaymentTypeId={visitaPaymentTypeId}
                  parecerPaymentTypeId={parecerPaymentTypeId}
                  canEdit={canEdit}
                  onChange={onChangeCaseSubtype}
                />
              )}
            </div>
          </td>
        )}
        {colVis.data && (() => {
          const pd = (it as any).procedure_date as string | null | undefined;
          return (
            <td className={cn(cell, TEXT_META, "whitespace-nowrap")} title={pd ?? ""}>
              {formatDateBR(pd)}
            </td>
          );
        })()}
        <td className={cn(stickyCell, TEXT_BODY)} title={paciente}>

          <div className="flex items-center gap-1.5 min-w-0">
            {observations.some(o => o.item_id === it.id && o.observation_type === "justificativa_override") && (
              <Badge 
                variant="outline" 
                className="h-4 px-1 bg-success/10 text-success border-success/30 shrink-0" 
                title="Este item possui justificativa de aprovação manual"
              >
                <Pencil className="h-2.5 w-2.5" />
              </Badge>
            )}
            <span className={wrapClass}>{paciente}</span>
          </div>
        </td>
        {colVis.convenio && (
          <td className={cn(cell, TEXT_META)} title={typeof convenio === "string" ? convenio : ""}>
            {convenio}
          </td>
        )}
        {colVis.via && (
          <td className={cn(cell, TEXT_BODY)} title={it.access_route ?? ""}>{it.access_route ?? "—"}</td>
        )}
        <td className={cn(cell, "font-mono", TEXT_META)}>
          {isBonus ? (
            <span
              role="img"
              aria-label="Bônus de final de semana (não é um código TUSS)"
              className="inline-flex items-center gap-1 text-indigo-900 dark:text-indigo-100 font-semibold"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" /> Bônus
            </span>
          ) : (it.procedure_code ?? "—")}
        </td>
        <td className={cn(cellPad, "text-right tabular-nums font-mono border-b whitespace-nowrap", TEXT_META, baseCellBg)}>
          {isBonus
            ? "—"
            : (Number.isFinite(Number(it.quantity)) && Number(it.quantity) > 0 ? Number(it.quantity) : 1)}
        </td>
        {colVis.procedimento && (
          <td className={cn(cell, TEXT_BODY)} title={it.procedure_name ?? (it as any).applied_rule_label ?? it.description ?? ""}>
            {isBonus ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span
                  role="img"
                  aria-label="Bônus de plantão de final de semana"
                  className="inline-flex items-center rounded border border-indigo-400 bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100 dark:border-indigo-700 px-1 text-[10px] font-bold shrink-0"
                >
                  <span aria-hidden="true">🎯 FdS</span>
                </span>
                <span className={cn(wrapClass, "text-indigo-900 dark:text-indigo-100")}>
                  {it.procedure_name ?? (it as any).applied_rule_label ?? "Bônus Final de Semana"}
                </span>
              </span>
            ) : (
              <span className={wrapClass}>{it.procedure_name ?? it.description ?? "—"}</span>
            )}
          </td>
        )}
        {colVis.setor_lido && (() => {
          const planilhaSetor = rawSetor ?? it.sector ?? null;
          return (
            <td className={cn(cell, TEXT_META)} title={planilhaSetor ?? ""}>{formatSectorName(planilhaSetor)}</td>
          );
        })()}
        {colVis.setor_inferido && (
          <td className={cn(cell, TEXT_META)} title={resolvedSystemSector ?? ""}>{formatSectorName(resolvedSystemSector)}</td>
        )}
        {colVis.tipo_entrada && (() => {
          const raw = ((it as unknown as { attendance_character?: string | null }).attendance_character ?? "").toString().trim();
          const label = raw
            ? (/^elet/i.test(raw) ? "Eletivo" : /^urg/i.test(raw) ? "Urgência" : /^emerg/i.test(raw) ? "Emergência" : raw)
            : "—";
          return <td className={cn(cell, TEXT_META)} title={raw}>{label}</td>;
        })()}
        {colVis.subtipo && isParecerPayment && (
          <td className={cn(cell, TEXT_META)}>
            <CaseSubtypeBadge
              item={it}
              allItems={allItems}
              lotePaymentTypeId={lotePaymentTypeId}
              visitaPaymentTypeId={visitaPaymentTypeId}
              parecerPaymentTypeId={parecerPaymentTypeId}
              canEdit={canEdit}
              onChange={onChangeCaseSubtype}
            />
          </td>
        )}
        <td className={cn(cell, TEXT_BODY)} title={it.doctor_name ?? ""}>
          <span className={wrapClass}>{it.doctor_name}</span>
        </td>
        {colVis.funcao && (
          <td className={cn(cell, TEXT_META)} title={it.doctor_role ?? ""}>{it.doctor_role ?? "—"}</td>
        )}
        {colVis.regra && (
          <td className={cn(cell, TEXT_META)} title={ruleName}>{ruleName}</td>
        )}
        {showGrossColumn && (
          <td className={cn(cellPad, TEXT_BODY, "text-right tabular-nums font-medium whitespace-nowrap border-b", baseCellBg, isBonus && "text-indigo-700 font-semibold")}>
            <span className="inline-flex items-center justify-end">
              {formatCurrency(grossN)}
              {!isBonus && (it as any).item_origem && (it as any).item_origem !== 'pagamento_atual' && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 9999,
                  background: (it as any).item_origem === 'conciliacao_credito' ? 'hsl(var(--success-soft))' : 'hsl(var(--destructive-soft))',
                  color: (it as any).item_origem === 'conciliacao_credito' ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
                  marginLeft: 4, whiteSpace: 'nowrap',
                }}>
                  {(it as any).item_origem === 'conciliacao_credito' ? 'Conc. +' : 'Conc. −'}
                </span>
              )}
            </span>
          </td>
        )}
        {showProcedureColumn && (() => {
          const procN = Number((it as any).procedure_amount ?? 0);
          return (
            <td className={cn(cellPad, TEXT_BODY, "text-right tabular-nums font-medium whitespace-nowrap border-b", baseCellBg, isBonus && "text-muted-foreground")}>
              {isBonus ? "—" : (procN > 0 ? formatCurrency(procN) : "—")}
            </td>
          );
        })()}



        <td
          className={cn(
            cellPad,
            TEXT_BODY,
            "text-right tabular-nums whitespace-nowrap border-b font-medium",
            isBonus ? "text-muted-foreground" : (diverges ? "text-warning-text" : "text-foreground"),
            baseCellBg,
          )}
        >
          <span className="inline-flex items-center gap-1 justify-end">
            {(() => {
              const metodo = (it as any).piso_metodo_vencedor as string | null | undefined;
              const pisoVal = Number((it as any).piso_aplicado_valor ?? 0);
              if (!metodo || !(pisoVal > 0)) return null;
              const venceu = metodo === "piso";
              return (
                <span
                  className={cn(
                    "text-[10px] leading-none",
                    venceu ? "text-warning-text" : "text-success",
                  )}
                  aria-label={venceu ? "Piso mínimo garantido aplicado" : "Cálculo do convênio superou o piso"}
                  title={venceu
                    ? `Piso mínimo garantido aplicado (R$ ${pisoVal.toFixed(2)}).`
                    : `Convênio superou o piso (R$ ${pisoVal.toFixed(2)}).`}
                >
                  🛡️
                </span>
              );
            })()}
            <span>
              {isBonus
                ? (!showGrossColumn && expN != null ? formatCurrency(expN) : "—")
                : (expN != null ? formatCurrency(expN) : "—")}
            </span>
          </span>
        </td>
        {showDiferencaCol && (
          <td
            className={cn(
              cellPad,
              TEXT_BODY,
              "text-right tabular-nums whitespace-nowrap border-b",
              isBonus ? "text-muted-foreground" : (diff != null && diverges ? (diff < 0 ? "text-warning-text" : "text-success") : "text-muted-foreground"),
              baseCellBg,
            )}
          >
            {isBonus ? "—" : (diff != null ? `${diff > 0 ? "+" : ""}${formatCurrency(diff)}` : "—")}
          </td>
        )}
        <td className={cn(cellPad, "border-b", baseCellBg)}>
          {isBonus ? (
            <span
              role="status"
              aria-label="Status: bônus aplicado automaticamente"
              data-testid="bonus-status-badge"
              className="inline-flex items-center rounded-full border border-indigo-400 bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100 dark:border-indigo-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            >
              Bônus
            </span>
          ) : (
          <div className="flex flex-row flex-wrap items-center gap-1">
          {mode === "confeccao" ? (() => {
            // Em CONFECÇÃO, status de análise não se aplica. Mostramos apenas
            // se o motor calculou (com_regra), não casou regra (sem_regra) ou
            // gerou inconsistência (divergente). Ver itemConfeccaoStatus.ts.
            const confStatus = deriveConfeccaoStatus(it as any);
            const confTone = CONFECCAO_STATUS_TONE[confStatus];
            return (
              <span
                data-testid={`confeccao-status-${confStatus}`}
                className={cn(
                  "inline-flex rounded-full border px-1 py-0.5 uppercase tracking-wide",
                  TEXT_META,
                  TONE_CLASSES[confTone],
                )}
                title={
                  confStatus === "sem_regra"
                    ? "Nenhuma regra cadastrada cobre este procedimento — bloqueia o envio para análise."
                    : confStatus === "divergente"
                    ? "Regra casou, mas o motor não conseguiu calcular um valor consistente — verifique."
                    : "Motor calculou o repasse esperado."
                }
              >
                {CONFECCAO_STATUS_LABEL[confStatus]}
              </span>
            );
          })() : it.ai_status === "acatado" ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 uppercase tracking-wide font-semibold",
                TEXT_META,
                TONE_CLASSES.success,
              )}
              title={(() => {
                const origin = it.acatado_status_original
                  ? `Acatado (era ${it.acatado_status_original})`
                  : "Acatado";
                const orig = (it as any).gross_amount_original;
                const overridden = (it as any).gross_override_at;
                if (overridden && orig != null && Number(orig) !== Number(it.gross_amount ?? 0)) {
                  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                  return `${origin} · valor ajustado de ${fmt(Number(orig))} para ${fmt(Number(it.gross_amount ?? 0))}`;
                }
                return origin;
              })()}
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              ACATADO
            </span>

          ) : (
            <span className={cn("inline-flex rounded-full border px-1 py-0.5", TEXT_META, "uppercase tracking-wide", TONE_CLASSES[tone])}>
              {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-0.5 inline" />}
              {eff}
            </span>
          )}
          {(() => {
            const adjObs = observations
              .filter(
                (o) =>
                  o.item_id === it.id &&
                  o.author_type === "analista" &&
                  typeof o.message === "string" &&
                  o.message.startsWith("Item editado pelo analista"),
              )
              .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
            if (adjObs.length === 0) return null;
            const latest = adjObs[0];
            const m = /valor:\s*([\d.,-]+)\s*→\s*([\d.,-]+)/i.exec(latest.message ?? "");
            const parseNum = (s: string) => {
              const n = Number(s.replace(/\./g, "").replace(",", "."));
              return Number.isFinite(n) ? n : Number(s);
            };
            const oldV = m ? parseNum(m[1]) : null;
            const newV = m ? parseNum(m[2]) : null;
            const autor = (latest.author_id && profiles[latest.author_id]) || "Analista";
            const data = latest.created_at
              ? new Date(latest.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
              : "";
            const tip = [
              oldV != null && newV != null && Number.isFinite(oldV) && Number.isFinite(newV)
                ? `${formatCurrency(oldV)} → ${formatCurrency(newV)}`
                : "Valor ajustado pelo analista",
              `${autor}${data ? " • " + data : ""}`,
              adjObs.length > 1 ? `${adjObs.length} ajustes` : null,
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 uppercase tracking-wide font-semibold",
                  TEXT_META,
                  TONE_CLASSES.warning,
                )}
                title={tip}
                data-testid="analyst-adjusted-badge"
              >
                <Pencil className="h-2.5 w-2.5" />
                AJUSTADO
              </span>

            );
          })()}
          {(() => {
            // Badge "Validação" representa SOMENTE achados da validação assistencial
            // (duplicidade, sobreposição, etc.) — gerados quando o analista dispara
            // a análise assistencial e gravados em payment_items.validation_findings.
            //
            // Importante: NÃO sintetizar findings a partir de ai_findings.matched_rules.
            // Aquele array lista TODAS as regras casadas pelo motor de cálculo (inclui
            // regras de repasse/percentual), o que fazia o badge aparecer em todo item.
            const rawFindings: any[] = Array.isArray((it as any).validation_findings)
              ? (it as any).validation_findings
              : [];
            if (rawFindings.length === 0) return null;
            return (
              <ValidationFindingsBadge
                findings={rawFindings}
                currentPaymentId={it.payment_id}
                item={it}
                canEdit={canEdit}
                onAcceptItem={onAcceptItem}
                onCancelValidationItem={onDeleteItem}
              />
            );
          })()}
          </div>
          )}
        </td>
        {colVis.observacao && (
          <td className={cn(cellPad, "text-center border-b", TEXT_META, baseCellBg)}>
            {obsCount > 0 ? obsCount : "—"}
          </td>
        )}
        {canEdit && (
          <td
            className={cn(cellPad, "text-center border-b whitespace-nowrap pr-4 sticky right-0 z-10 shadow-[-1px_0_0_0_hsl(var(--border))]", baseCellBg)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end items-center gap-1">
              {!isBonus && onAcceptItem && (it.ai_status === "reprovado" || it.ai_status === "alerta") && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  style={{ color: "hsl(var(--success))" }}
                  title="Acatar usando o valor ESPERADO (sobrescreve o pago)"
                  onClick={() => onAcceptItem(it)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              )}
              {!isBonus && onAcceptItemKeepPaid && (it.ai_status === "reprovado" || it.ai_status === "alerta") && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  style={{ color: "hsl(var(--success))" }}
                  title="Acatar mantendo o valor PAGO (não sobrescreve)"
                  onClick={() => onAcceptItemKeepPaid(it)}
                >
                  <HandCoins className="h-3.5 w-3.5" />
                </Button>
              )}
              {!isBonus && onUndoAcceptItem && it.ai_status === "acatado" && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title={`Desfazer acate — volta para ${it.acatado_status_original ?? "reprovado"}`}
                  onClick={() => onUndoAcceptItem(it)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              {!isBonus && (
                <ManualInterventionItemIconAction paymentId={it.payment_id} item={it as any} onApplied={onRefresh} />
              )}


              {!isBonus && onEditItem && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Editar item"
                  onClick={() => onEditItem(it)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              {onDeleteItem && (!isBonus || !(it as any).applied_rule_id) && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  title={isBonus ? "Excluir bônus importado da base (o motor já gerou o bônus correspondente)" : "Excluir item"}
                  onClick={() => onDeleteItem(it)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </td>
        )}
      </tr>
      {isExpanded && (
        <ItemDetailsRow
          it={it}
          allItems={allItems}
          rulesIndex={rulesIndex}
          rulesByName={rulesByName}
          observations={observations}
          profiles={profiles}
          colSpan={totalCols}
          showTipoEntrada={!!colVis.tipo_entrada}
          visitaPaymentTypeId={visitaPaymentTypeId}
          parecerPaymentTypeId={parecerPaymentTypeId}
          lotePaymentTypeId={lotePaymentTypeId}
          isParecerPayment={isParecerPayment}
          canEdit={canEdit}
          onChangeCaseSubtype={onChangeCaseSubtype}
        />
      )}
    </>
  );
}

function ItemDetailsRow({
  it,
  allItems,
  rulesIndex,
  rulesByName,
  observations,
  profiles,
  colSpan,
  showTipoEntrada,
  visitaPaymentTypeId,
  parecerPaymentTypeId,
  lotePaymentTypeId,
  isParecerPayment,
  canEdit,
  onChangeCaseSubtype,
}: {
  it: PaymentItemRowData;
  allItems: PaymentItemRowData[];
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations: ObservationRow[];
  profiles: Record<string, string>;
  colSpan: number;
  showTipoEntrada?: boolean;
  visitaPaymentTypeId?: string | null;
  parecerPaymentTypeId?: string | null;
  lotePaymentTypeId?: string | null;
  isParecerPayment?: boolean;
  canEdit?: boolean;
  onChangeCaseSubtype?: (itemIds: string[], newTypeId: string, newTypeLabel: string) => void;
}) {
  const alerts = (it.ai_findings?.alerts ?? []) as string[];
  const sectorAliases = useSectorAliases();
  const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
  const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
  const seen = new Set<string>();
  const matchedRules: RuleLite[] = [];
  matchedIds.forEach((rid) => {
    const r = rulesIndex[rid];
    if (r && !seen.has(r.id)) { seen.add(r.id); matchedRules.push(r); }
  });
  matchedNames.forEach((nm) => {
    const r = rulesByName[String(nm).trim().toLowerCase()];
    if (r && !seen.has(r.id)) { seen.add(r.id); matchedRules.push(r); }
  });
  const isCritical = it.ai_status === "reprovado";
  const expected = (it as any).expected_amount ?? it.ai_findings?.expected_amount;
  const explanation = it.ai_findings?.calculation_explanation;
  const engine = it.ai_findings?.engine ?? null;
  const aiNote = engine?.ai_note;
  // Colapso "Detalhes técnicos": esconde por padrão fórmula completa, trilha de
  // decisão, justificativa, auditoria de normalização, hierarquia e coerência.
  // Mantém visível só o essencial: Regra + Valor calculado + Alertas + Histórico.
  const [showTechnical, setShowTechnical] = useState(false);
  const diff = expected != null ? Number(expected) - Number(it.gross_amount ?? 0) : null;
  const diffPct = (engine?.diff_pct ?? null) as number | null;
  const priority = (engine?.matched_priority ?? null) as RuleMatchPriority | null;
  const calcType = (engine?.calculation_type_used ?? null) as
    | RuleCalculationType
    | "default_geral"
    | "default_hemodinamica"
    | null;
  const calcTypeLabel = calcType
    ? (RULE_CALCULATION_TYPE_LABELS as Record<string, string>)[calcType] ??
      (calcType === "default_geral"
        ? "Padrão geral (100%)"
        : calcType === "default_hemodinamica"
        ? "Padrão hemodinâmica (88%)"
        : calcType)
    : null;
  const itemAny = it as unknown as {
    authorized_exception?: boolean;
    exception_reason?: string | null;
    exception_authorizer?: string | null;
    exception_note?: string | null;
    special_case_code?: string | null;
    special_case_status?: string | null;
  };
  const exceptionMarked = !!itemAny.authorized_exception;
  const specialCaseApproved = itemAny.special_case_status === "approved" && !!itemAny.special_case_code;
  const specialCasePending = itemAny.special_case_status === "pending" && !!itemAny.special_case_code;
  const itemObs = observations.filter((o) => o.item_id === it.id);
  const [appliedCalcTypeMeta, setAppliedCalcTypeMeta] = useState<{
    item_type_id: string | null;
    label: string | null;
  } | null>(null);

  useEffect(() => {
    const calcId = (it as any).applied_calc_id ?? null;
    if (!calcId) {
      setAppliedCalcTypeMeta(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("rule_calculations")
      .select("item_type_id,label")
      .eq("id", calcId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as any;
        setAppliedCalcTypeMeta(
          d ? { item_type_id: d.item_type_id ?? null, label: d.label ?? null } : null,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [(it as any).applied_calc_id]);

  const itemTypeIdLocal = ((it as any).item_type_id ?? null) as string | null;
  const isItemParecer = !!parecerPaymentTypeId && itemTypeIdLocal === parecerPaymentTypeId;
  const isItemVisita = !!visitaPaymentTypeId && itemTypeIdLocal === visitaPaymentTypeId;
  const calcItemTypeId = appliedCalcTypeMeta?.item_type_id ?? null;
  const calcIsParecer = !!parecerPaymentTypeId && calcItemTypeId === parecerPaymentTypeId;
  const calcIsVisita = !!visitaPaymentTypeId && calcItemTypeId === visitaPaymentTypeId;
  const subtypeMismatch =
    !!itemTypeIdLocal && !!calcItemTypeId && itemTypeIdLocal !== calcItemTypeId;
  const parecerEvidence = ((it as any).parecer_evidence ?? null) as string | null;
  const reclassifiedFromParecer = (it as any).reclassified_from_parecer === true;
  const reclassReason = ((it as any).manual_intervention_notes ?? "").toString().trim();
  const amountReason = expected != null
    ? `A regra esperava ${formatCurrency(Number(expected))} e o pagamento veio ${formatCurrency(Number(it.gross_amount ?? 0))}${diffPct != null ? ` (${(Math.abs(diffPct) * 100).toFixed(1)}% de diferença)` : ""}.`
    : null;
  const parecerVisitaReason = (() => {
    if (!isItemParecer && !isItemVisita && !reclassifiedFromParecer && !subtypeMismatch) return null;
    if (subtypeMismatch) {
      const itemLabel = isItemParecer ? "Parecer" : isItemVisita ? "Visita" : "outro tipo";
      const calcLabel = calcIsParecer ? "Parecer" : calcIsVisita ? "Visita" : (appliedCalcTypeMeta?.label ?? "outro tipo");
      return `A classificação atual do item está como ${itemLabel}, mas o cálculo salvo ainda está ligado a ${calcLabel}. Isso indica resultado antigo ou reanálise pendente; reanalise as regras para o cálculo acompanhar a classificação.`;
    }
    if (reclassifiedFromParecer && isItemVisita) {
      return `O relatório encontrou o parecer, mas o item foi tratado como Visita porque ${reclassReason || "houve parecer prévio para o mesmo atendimento/especialidade"}. ${amountReason ?? ""}`.trim();
    }
    if (isItemParecer && parecerEvidence === "confirmed") {
      return `O item foi confirmado como Parecer pelo relatório de parecer. ${amountReason ?? "A recusa vem da comparação entre o valor esperado pela regra e o valor pago."}`.trim();
    }
    if (isItemVisita && parecerEvidence === "not_found") {
      return `Não houve correspondência no relatório para atendimento, data e médico; por isso o item foi tratado como Visita. ${amountReason ?? ""}`.trim();
    }
    return null;
  })();

  const rawCharacter = ((it as unknown as { attendance_character?: string | null }).attendance_character ?? "").toString().trim();
  const characterLabel = rawCharacter
    ? (/^elet/i.test(rawCharacter) ? "Eletivo" : /^urg/i.test(rawCharacter) ? "Urgência" : /^emerg/i.test(rawCharacter) ? "Emergência" : rawCharacter)
    : "—";
  const summary: { label: string; value: string }[] = [
    { label: "Atendimento", value: it.attendance_number ?? "—" },
    { label: "Paciente", value: getPatient(it) },
    { label: "Convênio", value: getAgreement(it) },
    { label: "Via de Acesso", value: getAccessRoute(it) },
    ...(showTipoEntrada ? [{ label: "Caráter (Tipo Entrada)", value: characterLabel }] : []),
    { label: "TUSS", value: getProcedureCode(it) },
    { label: "Procedimento", value: getProcedureName(it) },
    { label: "Médico", value: it.doctor_name ?? "—" },
    { label: "Função", value: getDoctorRole(it) },
    { label: "Setor (Planilha)", value: formatSectorName(rawPick(it.raw_data, SECTOR_RAW_KEYS as unknown as string[]) ?? it.sector ?? null) },
    { label: "Setor", value: formatSectorName(
        sectorAliases?.resolve(rawPick(it.raw_data, SECTOR_RAW_KEYS as unknown as string[])) ??
        sectorAliases?.resolve(it.sector) ??
        (it.ai_findings?.engine as any)?.inferred_sector ??
        it.sector ??
        rawPick(it.raw_data, SECTOR_RAW_KEYS as unknown as string[]) ??
        null
      ) },
  ];

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    try { return formatDateTimeBR(d); }
    catch { return String(d); }
  };

  // ============ TIPOGRAFIA UNIFICADA ============
  // Reusa o set tipográfico exportado no topo do arquivo (TEXT_BODY/TEXT_LABEL/TEXT_META)
  // para manter o painel expandido idêntico ao restante da tela (headers + cells + AlertBanner).
  // Card base (SafeCard já provê o comportamento correto).

  const Label = ({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) => (
    <p className={cn(TEXT_LABEL, "flex items-center gap-1")}>
      {Icon && <Icon className="h-3 w-3" />} {children}
    </p>
  );

  const isBonus = (it as any).tipo_linha === "complemento_bonus";
  if (isBonus) {
    return (
      <tr className="border-b bg-indigo-50/40 dark:bg-indigo-950/15" data-expanded-row={it.id}>
        <td colSpan={colSpan} className="p-0 align-top">
          <div
            className={cn("sticky left-0 px-3 sm:px-4 py-3 sm:py-4", TEXT_BODY)}
            style={{ width: "min(100%, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-bold text-indigo-800 dark:text-indigo-200">Linha de bônus</span>
              <span className="text-[11px] text-muted-foreground">
                Esta linha é um complemento automático ao honorário do procedimento pai.
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
              <div>
                <p className={cn(TEXT_LABEL)}>Atendimento</p>
                <p className="font-mono">{it.attendance_number ?? "—"}</p>
              </div>
              <div>
                <p className={cn(TEXT_LABEL)}>Médico</p>
                <p>{it.doctor_name ?? "—"}</p>
              </div>
              <div>
                <p className={cn(TEXT_LABEL)}>Regra aplicada</p>
                <p>{(it as any).applied_rule_label ?? "—"}</p>
              </div>
              <div>
                <p className={cn(TEXT_LABEL)}>Valor do bônus</p>
                <p className="tabular-nums font-semibold text-indigo-700">
                  {formatCurrency(Number(it.gross_amount ?? 0))}
                </p>
              </div>
              <div className="col-span-2 md:col-span-1">
                <p className={cn(TEXT_LABEL)}>Referência (item pai)</p>
                <p className="font-mono text-[11px] break-all">{(it as any).origem_referencia ?? "—"}</p>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b bg-muted/20" data-expanded-row={it.id}>
      <td colSpan={colSpan} className="p-0 align-top">
        {/*
          O <td> com colSpan ocupa toda a largura do <table> (table-fixed, pode ser
          maior que a viewport). Para que o painel não herde essa largura nem seja
          cortado pelo scroll horizontal, usamos sticky + max-width baseado em 100vw.
        */}
        <div
          className={cn("sticky left-0 px-4 sm:px-5 py-4 sm:py-5 animate-accordion-down overflow-hidden", TEXT_BODY)}
          style={{ width: "min(100%, calc(100vw - 1rem))", maxWidth: "calc(100vw - 1rem)" }}
        >
          {/* Resumo do item */}
          <div className="mb-5 grid gap-x-4 gap-y-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-8">
            {summary.map((s) => (
              <div key={s.label} className="min-w-0">
                <Label>{s.label}</Label>
                <p className={cn(TEXT_BODY, "break-words whitespace-normal max-w-full mt-1")}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setShowTechnical((v) => !v); }}
              className="h-6 text-[11px] text-muted-foreground hover:text-foreground gap-1"
            >
              {showTechnical ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showTechnical ? "Ocultar detalhes técnicos" : "Mostrar detalhes técnicos"}
            </Button>
          </div>

          <div className="grid gap-3 grid-cols-1 lg:grid-cols-3 items-start">

            {/* Coluna 1 (mobile: 1º — alertas + histórico) */}
            <div className="space-y-2 min-w-0 order-1 lg:order-1">
              {alerts.length > 0 && (
                <AlertBanner
                  severity={isCritical ? "critico" : "alerta"}
                  title={isCritical ? "Item reprovado pela análise" : alerts.length === 1 ? "Alerta" : `${alerts.length} alertas`}
                >
                  <ul className="space-y-0.5 list-disc pl-4 break-words [overflow-wrap:anywhere]">
                    {alerts.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </AlertBanner>
              )}
              {alerts.length === 0 && !isCritical && (
                <AlertBanner severity="informativo" title="Sem alertas">
                  <p>Item sem divergências detectadas pela análise.</p>
                </AlertBanner>
              )}
              {parecerVisitaReason && (
                <AlertBanner
                  severity={subtypeMismatch || it.ai_status === "reprovado" ? "critico" : it.ai_status === "alerta" ? "alerta" : "informativo"}
                  title={subtypeMismatch ? "Classificação e cálculo divergentes" : it.ai_status === "reprovado" ? "Motivo da recusa" : "Classificação Parecer/Visita"}
                >
                  <p>{parecerVisitaReason}</p>
                </AlertBanner>
              )}
              {exceptionMarked && (
                <div className={cn("rounded-md border border-info/20 bg-info-soft px-4 py-3 text-info min-w-0 break-words whitespace-normal", TEXT_BODY)}>
                  <div className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    Exceção autorizada registrada
                  </div>
                  <p className="mt-1">
                    Motivo: <strong>{itemAny.exception_reason ?? "—"}</strong> · Autorizador:{" "}
                    <strong>{itemAny.exception_authorizer ?? "—"}</strong>
                  </p>
                  {itemAny.exception_note && (
                    <p className="mt-1 italic whitespace-pre-wrap">"{itemAny.exception_note}"</p>
                  )}
                </div>
              )}
              {(specialCaseApproved || specialCasePending) && (
                <div className={cn(
                  "rounded-md border px-4 py-3 min-w-0 break-words whitespace-normal",
                  specialCaseApproved
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                    : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
                  TEXT_BODY,
                )}>
                  <div className="flex items-center gap-1.5 font-medium">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      Caso especial
                    </Badge>
                    <span className="font-mono text-xs">{itemAny.special_case_code}</span>
                    <span className="ml-1 text-xs opacity-80">
                      {specialCaseApproved ? "aprovado pela gestão médica" : "aguardando aprovação"}
                    </span>
                  </div>
                </div>
              )}
              {!specialCaseApproved && !specialCasePending && (
                <SpecialCaseItemAction
                  paymentId={it.payment_id}
                  itemId={it.id}
                  attendance={it.attendance_number ?? null}
                  doctorId={(it as any).doctor_id ?? null}
                />
              )}

              <CalcExceptionItemAction paymentId={it.payment_id} item={it as any} />

              {isParecerPayment && ((it as any).parecer_evidence === "unverified") && canEdit && (
                <ParecerUnverifiedActions
                  item={it}
                  visitaPaymentTypeId={visitaPaymentTypeId ?? null}
                  parecerPaymentTypeId={parecerPaymentTypeId ?? null}
                  onChangeCaseSubtype={onChangeCaseSubtype}
                />
              )}

              <PaymentTypeOverrideAction
                item={it as any}
                allItems={allItems as any}
                lotePaymentTypeId={lotePaymentTypeId}
                hidden={isParecerPayment}
                canEdit={canEdit}
                onChange={onChangeCaseSubtype}
              />



              {(it.ai_status === "reprovado" || it.ai_status === "alerta") && (it.ai_status as string) !== "acatado" && (() => {
                const getNextStep = (): string => {
                  if (priority === "sem_regra") {
                    return "Nenhuma regra cadastrada cobre este procedimento neste setor. Verifique se o código TUSS está correto ou se é necessário cadastrar uma nova regra para este caso.";
                  }
                  if (priority === "conflito") {
                    return "Duas ou mais regras com a mesma prioridade se aplicam. Revise as regras conflitantes ou acate como exceção com justificativa.";
                  }
                  if (it.ai_status === "reprovado" && diffPct != null && Math.abs(diffPct) > 0.1) {
                    return `Divergência de ${(Math.abs(diffPct) * 100).toFixed(1)}% em relação ao valor esperado. Se o valor está correto, autorize como exceção com justificativa. Se está errado, corrija na planilha original e reimporte.`;
                  }
                  if (it.ai_status === "alerta") {
                    return "Alerta ativo: confira se o valor está dentro da faixa esperada para este procedimento. Se correto, acate com justificativa para registrar a decisão.";
                  }
                  if (it.ai_status === "reprovado") {
                    return "Item reprovado. Verifique os alertas acima, corrija na fonte se necessário, ou acate com justificativa documentando a decisão.";
                  }
                  return "";
                };
                const step = getNextStep();
                if (!step) return null;
                return (
                  <SafeCard className="border-info/30 bg-info-soft/40">
                    <Label icon={ChevronRight}>Próximo passo sugerido</Label>
                    <p className="text-muted-foreground mt-1.5">{step}</p>
                  </SafeCard>
                );
              })()}
              <SafeCard>
                <Label>Histórico deste item ({itemObs.length})</Label>
                {itemObs.length === 0 ? (
                  <p className="text-muted-foreground mt-1.5 italic">Sem comentários ainda.</p>
                ) : (
                  <ul className="space-y-2 max-h-56 overflow-y-auto mt-1.5 pr-1">
                    {itemObs.map((o) => (
                      <li key={o.id} className="border-b border-border/40 pb-1.5 last:border-0 min-w-0 flex flex-col items-start">
                        <div className={cn("flex items-center gap-1.5 w-full", TEXT_META)}>
                          <span className="uppercase tracking-wide rounded px-1 py-0.5 bg-muted shrink-0">{authorRoleLabel(o.author_type)}</span>
                          {(() => {
                            const resolvedName = o.author_id ? profiles[o.author_id] : null;
                            const roleLabel = authorRoleLabel(o.author_type);
                            if (resolvedName) {
                              return (
                                <span className="text-muted-foreground truncate flex-1 min-w-0">
                                  {resolvedName} <span className="opacity-70">({roleLabel})</span>
                                </span>
                              );
                            }
                            return (
                              <span className="text-muted-foreground truncate flex-1 min-w-0">
                                {roleLabel}
                              </span>
                            );
                          })()}
                          <span className="shrink-0 ml-auto">{fmtDate(o.created_at)}</span>
                        </div>
                        <p className="mt-1 whitespace-normal break-words w-full">{o.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </SafeCard>
            </div>

            {/* Coluna 2 (mobile: 3º — regra + IA) */}
            <div className="space-y-3 min-w-0 order-3 lg:order-2">
              {matchedRules.length > 0 ? (
                <SafeCard>
                  <Label>Regra aplicada</Label>
                  <p className="font-medium text-primary mt-1 break-words whitespace-normal">{matchedRules[0].name}</p>
                  {matchedRules[0].rule_text && (
                    <p className="mt-1 text-muted-foreground break-words whitespace-normal">{matchedRules[0].rule_text}</p>
                  )}
                  {it.applied_calc_method && (
                    <div className="mt-2 pt-2 border-t border-border/60">
                      <Label>Cálculo utilizado</Label>
                      <p className="mt-1 text-[13px] font-medium flex items-center gap-1.5">
                        <span aria-hidden>{(CALC_METHOD_LABELS[it.applied_calc_method] ?? { emoji: "•" }).emoji}</span>
                        <span>{(CALC_METHOD_LABELS[it.applied_calc_method] ?? { label: it.applied_calc_method }).label}</span>
                      </p>
                      <PisoAppliedBadge item={it} />
                    </div>
                  )}
                  {showTechnical && <CalcFormulaBlock item={it} />}
                  {matchedRules.length > 1 && (
                    <p className={cn("mt-1 italic", TEXT_META)}>
                      + {matchedRules.length - 1} regra(s) também casaram
                    </p>
                  )}
                </SafeCard>
              ) : matchedNames.length > 0 ? (
                <SafeCard>
                  <Label>Regra aplicada</Label>
                  <p className="font-medium mt-1">{matchedNames[0]}</p>
                  {it.applied_calc_method && (
                    <div className="mt-2 pt-2 border-t border-border/60">
                      <Label>Cálculo utilizado</Label>
                      <p className="mt-1 text-[13px] font-medium flex items-center gap-1.5">
                        <span aria-hidden>{(CALC_METHOD_LABELS[it.applied_calc_method] ?? { emoji: "•" }).emoji}</span>
                        <span>{(CALC_METHOD_LABELS[it.applied_calc_method] ?? { label: it.applied_calc_method }).label}</span>
                      </p>
                      <PisoAppliedBadge item={it} />
                    </div>
                  )}
                  {showTechnical && <CalcFormulaBlock item={it} />}
                </SafeCard>
              ) : (
                <SafeCard className="text-muted-foreground italic">Nenhuma regra específica casou.</SafeCard>
              )}

              {aiNote && (
                <SafeCard className="border-info/30 bg-info-soft/40 shadow-none mt-4">
                  <Label icon={Sparkles}>Explicação sugerida (IA)</Label>
                  <p className="text-muted-foreground italic mt-2 leading-relaxed break-words whitespace-normal [overflow-wrap:anywhere]">
                    {aiNote}
                  </p>
                </SafeCard>
              )}

              {showTechnical && (it.ai_findings?.selection_trace || it.ai_status !== "aprovado") && (
                <SafeCard>
                  <Label icon={ShieldAlert}>Justificativa da Classificação</Label>
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] leading-relaxed">
                      Este item foi marcado como <span className={cn("font-bold uppercase", TONE_CLASSES[it.ai_status === "reprovado" ? "destructive" : it.ai_status === "alerta" ? "warning" : "success"])}>{it.ai_status}</span> porque:
                    </p>
                    <ul className="text-[11px] space-y-2 list-none pl-0 text-muted-foreground">
                      {it.ai_status === "reprovado" && (
                        <li className="flex items-start gap-1.5 break-words whitespace-normal min-w-0">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          <span>Divergência de valor superior a <strong>10%</strong> em relação à regra aplicada.</span>
                        </li>
                      )}
                      {it.ai_status === "alerta" && diffPct != null && (
                        <li className="flex items-start gap-1.5 break-words whitespace-normal min-w-0">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          <span>Divergência de valor identificada (entre 1% e 10%), exigindo conferência.</span>
                        </li>
                      )}
                      {priority === "sem_regra" && (
                        <li className="flex items-start gap-1.5 break-words whitespace-normal min-w-0">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          <span>Nenhuma regra correspondente foi encontrada para este procedimento no setor informado.</span>
                        </li>
                      )}
                      {priority === "conflito" && (
                        <li className="flex items-start gap-1.5 break-words whitespace-normal min-w-0">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          <span>Múltiplas regras aplicáveis com a mesma prioridade geraram um conflito de decisão.</span>
                        </li>
                      )}
                      {diffPct != null && (
                        <li className="flex items-start gap-1.5 break-words whitespace-normal min-w-0">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          <span>
                            Diferença calculada: <strong>{(diffPct * 100).toFixed(1)}%</strong> 
                            {diff != null && <> ({diff > 0 ? "+" : ""}{formatCurrency(diff)})</>}.
                          </span>
                        </li>
                      )}
                      {priority && (
                        <li className="flex items-start gap-1.5 break-words whitespace-normal min-w-0">
                          <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          <span>Baseado na regra: <strong>{RULE_MATCH_PRIORITY_LABELS[priority]}</strong>.</span>
                        </li>
                      )}
                    </ul>
                    
                    {it.ai_findings?.selection_trace && (
                      <div className="mt-4 p-3 rounded-md border border-info/20 bg-info-soft/10">
                        <Label icon={ShieldAlert}>Auditoria de Normalização & Cruzamento</Label>
                        <div className="mt-2 space-y-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Normalização</p>
                              <div className="space-y-1.5">
                                <div className="min-w-0">
                                  <span className="text-[9px] text-muted-foreground block mb-0.5">Médico (Normalizado)</span>
                                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/40 block break-all whitespace-normal" title={(it.ai_findings as any)?.decision_fields?.used?.doctor_name}>
                                    {(it.ai_findings as any)?.decision_fields?.used?.doctor_name || "—"}
                                  </code>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-[9px] text-muted-foreground block mb-0.5">Convênio (Normalizado)</span>
                                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/40 block break-all whitespace-normal" title={(it.ai_findings as any)?.decision_fields?.used?.agreement_name}>
                                    {(it.ai_findings as any)?.decision_fields?.used?.agreement_name || "—"}
                                  </code>
                                </div>
                              </div>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Alias Aplicado</p>
                              <div>
                                <span className="text-[9px] text-muted-foreground block mb-0.5">Função (Role)</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] font-medium break-all">{it.doctor_role || "—"}</span>
                                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <Badge variant="outline" className="h-4 px-1.5 bg-primary/10 text-primary border-primary/20 text-[9px] font-bold break-all whitespace-normal h-auto py-0.5">
                                    {(it.ai_findings as any)?.decision_fields?.used?.doctor_role || "—"}
                                  </Badge>
                                </div>
                                <p className="text-[9px] text-muted-foreground mt-1.5 leading-tight italic">
                                  Alias resolvido via mapeamento inteligente (medical_role_aliases) para busca na tabela de referência.
                                </p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="pt-2 border-t border-border/40">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Hierarquia validada:</p>
                            <ul className="space-y-2 list-none pl-0 text-muted-foreground">
                              <li className="flex items-start gap-1.5 text-[10px] break-words whitespace-normal min-w-0">
                                <div className={cn("h-1.5 w-1.5 rounded-full mt-1 shrink-0", (priority?.includes("medico") || priority?.includes("empresa") || priority?.includes("grupo") || priority?.includes("convenio")) ? "bg-success" : "bg-muted-foreground/30")} />
                                <span>Regra Específica / Grupo / Convênio</span>
                              </li>
                              <li className="flex items-start gap-1.5 text-[10px] break-words whitespace-normal min-w-0">
                                <div className={cn("h-1.5 w-1.5 rounded-full mt-1 shrink-0", (priority === "setor_master_geral" || priority === "setor_codigo" || priority === "setor_outro") ? "bg-success" : "bg-muted-foreground/30")} />
                                <span>Regra Master / Geral (Independente de Setor)</span>
                              </li>
                            </ul>
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-7 text-[9px] text-muted-foreground hover:text-foreground mt-1 border border-dashed border-border/60"
                            onClick={(e) => {
                              e.stopPropagation();
                              console.log("Full Selection Trace for Item " + it.id, it.ai_findings.selection_trace);
                              toast.success("Trace técnico enviado para o Console (F12).");
                            }}
                          >
                            <FileText className="h-3 w-3 mr-1" /> Ver detalhes técnicos (Console)
                          </Button>
                        </div>
                      </div>
                    )}
                    {it.attendance_number && (
                      <AttendanceCoherencePanel
                        attendanceNumber={it.attendance_number}
                        currentItemId={it.id}
                        items={allItems}
                      />
                    )}
                  </div>
                </SafeCard>
              )}
            </div>

            {/* Coluna 3 (mobile: 2º — cálculo, prioridade no mobile pois resume divergência) */}
            <div className="space-y-2 min-w-0 order-2 lg:order-3">
              {(engine || expected != null || explanation) && (
                <SafeCard>
                  <Label icon={FileText}>Detalhes do cálculo</Label>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 mb-2">
                    {priority && (
                      <span className={cn("inline-flex rounded-full border px-1.5 py-0.5", TEXT_META, TONE_CLASSES[RULE_MATCH_PRIORITY_TONES[priority]])}>
                        {RULE_MATCH_PRIORITY_LABELS[priority]}
                      </span>
                    )}
                    {calcTypeLabel && (
                      <span className={cn("inline-flex rounded-full border px-1.5 py-0.5", TEXT_META, TONE_CLASSES.muted)}>
                        {calcTypeLabel}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <div className="min-w-0">
                      <Label>Valor Repasse</Label>
                      <p className="tabular-nums font-medium mt-0.5">{formatCurrency(Number(it.gross_amount ?? 0))}</p>
                    </div>
                    <div className="min-w-0">
                      <Label>Valor esperado</Label>
                      <p className="tabular-nums font-medium mt-0.5">{expected != null ? formatCurrency(Number(expected)) : "—"}</p>
                    </div>
                    {diff != null && Math.abs(diff) > 0.01 && (
                      <div className="col-span-2 min-w-0">
                        <Label>Diferença</Label>
                        <p className={cn("tabular-nums font-medium mt-0.5", diff < 0 ? "text-warning-text" : "text-success")}>
                          {diff > 0 ? "+" : ""}{formatCurrency(diff)}
                          {diffPct != null && (
                            <span className="ml-1">({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  {explanation && (
                    <p className="mt-2 text-muted-foreground italic break-all whitespace-normal">
                      {explanation}
                    </p>
                  )}
                </SafeCard>
              )}


              {it.ai_status === "erro_duplicidade_calculo" &&
                Array.isArray((it.ai_findings as any)?.calc_duplicity?.matched_calculations) && (
                  <CalcDuplicityResolverPanel
                    itemId={it.id}
                    matchedCalculations={(it.ai_findings as any).calc_duplicity.matched_calculations}
                    resolutionStale={(it.ai_findings as any)?.calc_duplicity?.resolution_stale === true}
                  />
                )}

              {diff != null && Math.abs(diff) > 0.01 && expected != null && (
                <SafeCard className="border-warning/30 bg-warning-soft/40">
                  <Label>Sugestão de ajuste</Label>
                  <p className="mt-1">
                    Ajustar valor para <strong>{formatCurrency(Number(expected))}</strong>.
                  </p>
                </SafeCard>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ====================================================================
// Badge + popover dos achados do motor de validação assistencial.
// Lê `validation_findings` (jsonb gravado por validate-payment) e mostra
// detalhes do item conflitante. Botão "Ver item conflitante →":
//  - mesmo lote: scroll + highlight amber temporário na linha alvo
//  - lote diferente: abre /pagamentos/{id}/empresa/{company} em nova aba
// ====================================================================
type ValidationFinding = {
  rule_id: string;
  rule_name: string;
  kind: string;
  severity: string;
  action: string;
  message: string;
  conflicting_item_id?: string;
  conflicting_item?: {
    attendance_number: string | null;
    patient_name: string | null;
    procedure_code: string | null;
    procedure_name: string | null;
    doctor_name: string | null;
    procedure_date: string | null;
    company_name: string | null;
    payment_id: string;
    payment_reference: string | null;
  };
  detected_at: string;
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const iso = d.slice(0, 10);
  const [y, m, day] = iso.split("-");
  return y && m && day ? `${day}/${m}/${y}` : iso;
}

function ValidationFindingsBadge({
  findings,
  currentPaymentId,
  item,
  canEdit,
  onAcceptItem,
  onCancelValidationItem,
}: {
  findings: ValidationFinding[];
  currentPaymentId: string;
  item: PaymentItemRowData;
  canEdit?: boolean;
  onAcceptItem?: (item: PaymentItemRowData) => void;
  onCancelValidationItem?: (item: PaymentItemRowData) => void;
}) {
  const navigate = useNavigate();

  // Severidade dominante para colorir o trigger.
  const dominant: SeverityLevel = dominantLevel(
    findings.map((f) => actionToLevel(f.action)),
  );
  const token = SEVERITY_TOKENS[dominant];
  const TriggerIcon = token.icon;

  const severityColors: Record<string, string> = {
    critico: "bg-red-50 text-red-700 border-red-300 hover:bg-red-100",
    alerta: "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100",
    informativo: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
  };
  const badgeColor = severityColors[dominant] ?? severityColors.informativo;

  const KIND_LABELS: Record<string, string> = {
    duplicidade_lancamento: "Duplicidade",
    duplicidade_exata: "Duplicidade",
    duplicidade_atendimento: "Duplicidade",
    sobreposicao_assistencial: "Sobreposição",
    parecer_virou_cirurgia: "Parecer absorvido",
    restricao_contratual: "Restrição contratual",
    outlier_valor: "Outlier de valor",
  };

  const firstFinding = findings[0];
  const kindLabel = KIND_LABELS[firstFinding?.kind ?? ""] ?? "Validação";

  const goToConflict = (f: ValidationFinding, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ci = f.conflicting_item;
    const targetId = f.conflicting_item_id;
    if (!targetId) return;
    const sameBatch = !ci || ci.payment_id === currentPaymentId;
    if (sameBatch) {
      const el = document.querySelector<HTMLElement>(`[data-row-id="${targetId}"]`);
      flashHighlight(el);
    } else if (ci) {
      const url = `/pagamentos/${ci.payment_id}/empresa/${encodeURIComponent(
        ci.company_name ?? "",
      )}?highlight=${encodeURIComponent(targetId)}`;
      navigate(url);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 cursor-pointer",
            TEXT_META,
            badgeColor,
          )}
          title={`${kindLabel} · ${token.label}`}
        >
          <TriggerIcon className="h-2.5 w-2.5 shrink-0" />
          {kindLabel}{findings.length > 1 ? ` (${findings.length})` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] min-w-[320px] p-0 bg-[#FAF7F2] border-[0.5px] border-[#D9D2C5] shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-h-[420px] overflow-y-auto">
          {findings.map((f, idx) => {
            const ci = f.conflicting_item;
            const sameBatch = !ci || ci.payment_id === currentPaymentId;
            return (
              <div key={`${f.rule_id}-${idx}`} className={cn("p-3", idx > 0 && "border-t border-[#D9D2C5]")}>

                <div className="flex items-start gap-1.5 mb-2">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#9A6B3A] mt-0.5 shrink-0" />
                  <div className="text-xs font-semibold text-[#9A6B3A] leading-tight break-words">{f.rule_name}</div>
                </div>
                <div className="text-[11px] text-foreground/80 mb-2 leading-snug break-words">{f.message}</div>
                {ci ? (
                  <>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Conflita com:</div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
                      <dt className="text-muted-foreground">Atendimento:</dt>
                      <dd className="font-mono break-all">{ci.attendance_number ?? "—"}</dd>
                      <dt className="text-muted-foreground">Paciente:</dt>
                      <dd className="break-words whitespace-normal">{ci.patient_name ?? "—"}</dd>
                      <dt className="text-muted-foreground">Procedimento:</dt>
                      <dd className="break-words whitespace-normal">
                        {ci.procedure_name ?? "—"}
                        {ci.procedure_code && (
                          <span className="text-muted-foreground font-mono"> ({ci.procedure_code})</span>
                        )}
                      </dd>
                      <dt className="text-muted-foreground">Médico:</dt>
                      <dd className="break-words whitespace-normal">{ci.doctor_name ?? "—"}</dd>
                      <dt className="text-muted-foreground">Data:</dt>
                      <dd>{fmtDate(ci.procedure_date)}</dd>
                      <dt className="text-muted-foreground">Empresa:</dt>
                      <dd className="break-words whitespace-normal">{ci.company_name ?? "—"}</dd>
                      <dt className="text-muted-foreground">Lote:</dt>
                      <dd className="break-words whitespace-normal">{ci.payment_reference ?? "—"}</dd>
                    </dl>
                    <div className="mt-2.5 flex justify-end">
                      <button
                        type="button"
                        onClick={(e) => goToConflict(f, e)}
                        className="text-[11px] text-[#9A6B3A] hover:text-[#7A5530] hover:underline font-medium"
                      >
                        {sameBatch ? "Ver item conflitante →" : "Abrir lote do conflito ↗"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">
                    Detalhes do item conflitante indisponíveis. Rode a validação novamente para enriquecer.
                  </div>
                )}
                {canEdit && (
                  <div className="mt-3 pt-2.5 border-t border-[#D9D2C5] flex flex-col gap-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Ação sobre o alerta</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-1">
                      <span className="font-semibold">Valor em risco: {formatCurrency(Number(item.gross_amount ?? 0))}</span>
                    </div>
                    {(item.ai_status === "aprovado" || item.ai_status === "acatado") ? (
                      onAcceptItem && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAcceptItem({ ...item, _validationAction: "manter" } as unknown as PaymentItemRowData);
                          }}
                          className="w-full text-left flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-green-200 bg-green-50 text-green-800 hover:bg-green-100 transition-colors font-medium"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          Manter pagamento (registrar revisão)
                        </button>
                      )
                    ) : (
                      onAcceptItem && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAcceptItem(item);
                          }}
                          className="w-full text-left flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-green-200 bg-green-50 text-green-800 hover:bg-green-100 transition-colors font-medium"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          Acatar como válido (com justificativa)
                        </button>
                      )
                    )}
                    {onCancelValidationItem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelValidationItem(item);
                        }}
                        className="w-full text-left flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 transition-colors font-medium"
                      >
                        <Trash2 className="h-3.5 w-3.5 shrink-0" />
                        Cancelar pagamento deste item
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
