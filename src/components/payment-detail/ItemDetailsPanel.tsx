/**
 * ItemDetailsPanel — painel lateral (drawer) que substitui a antiga
 * expansão inline do `ItemDetailsRow`. Abre pela direita, mantém
 * o restante da tabela imóvel e organiza o conteúdo em seções
 * colapsáveis.
 *
 * Hierarquia visual CURA: cada seção tem uma borda esquerda colorida
 * (azul CURA no cálculo, laranja na regra, cinza nas observações,
 * azul-claro nos dados) para o analista escanear rapidamente.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Sparkles } from "lucide-react";
import { MarkSpecialCaseDialog } from "./MarkSpecialCaseDialog";
import { useHasSpecialCaseRules } from "./useHasSpecialCaseRules";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/status";
import { useManualInterventionReasons } from "@/hooks/useManualInterventionReasons";
import { impactBadgeClass, impactLabel } from "@/lib/saveIntervention";
import {
  getAccessRoute,
  getAgreement,
  getDoctor,
  getDoctorRole,
  getPatient,
  getProcedureCode,
  getProcedureName,
} from "@/lib/itemFields";

type AnyItem = Record<string, any>;

interface ItemDetailsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: AnyItem | null;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Slot opcional para o seletor "Tipo deste item" (Só este / Atend.). */
  caseSubtypeSlot?: React.ReactNode;
  observations?: Array<{ id?: string; text?: string | null; author_name?: string | null; created_at?: string | null }>;
}

const SECTION_TITLE = "text-[11px] uppercase tracking-wide text-muted-foreground font-medium";

// Cor da borda esquerda por seção — comunica hierarquia (mais importante = azul CURA sólido)
type AccentTone = "primary" | "accent" | "muted" | "glow";
const ACCENT_BORDER: Record<AccentTone, string> = {
  primary: "border-l-primary",
  accent: "border-l-accent",
  muted: "border-l-muted-foreground/30",
  glow: "border-l-primary-glow",
};
const ACCENT_TINT: Record<AccentTone, string> = {
  primary: "bg-primary/[0.04]",
  accent: "",
  muted: "",
  glow: "",
};

function Section({
  title,
  defaultOpen = false,
  tone = "muted",
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  tone?: AccentTone;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("border-l-[3px]", ACCENT_BORDER[tone], ACCENT_TINT[tone])}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between gap-2 px-4 py-2 bg-muted/40 hover:bg-muted/60 transition-colors",
              open && "border-b border-border/40",
            )}
          >
            <span className="text-[11px] uppercase tracking-wider font-semibold text-foreground">
              {title}
            </span>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-primary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-primary" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 py-3 border-b border-border/40">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Field({
  label,
  value,
  full = false,
  labelClass,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
  labelClass?: string;
}) {
  return (
    <div className={cn("min-w-0", full && "col-span-2")}>
      <div className={cn(SECTION_TITLE, labelClass)}>{label}</div>
      <div className="mt-0.5 text-[13px] text-foreground break-words">
        {value == null || value === "" ? <span className="text-muted-foreground">—</span> : value}
      </div>
    </div>
  );
}

function formatDate(v: any): string {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return String(v);
  }
}

/** Mapeia status para cores CURA semânticas no badge do header. */
function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("acatad") || s.includes("aceit") || s.includes("conciliad")) {
    return "bg-success text-white";
  }
  if (s.includes("reprovad") || s.includes("divergent") || s.includes("erro")) {
    return "bg-destructive text-white";
  }
  if (s.includes("alerta") || s.includes("atencao") || s.includes("atenção") || s.includes("pendent")) {
    return "bg-accent text-white";
  }
  if (s.includes("aprovad")) {
    return "bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/30";
  }
  return "bg-white/15 text-primary-foreground";
}

/** Seção "Caso especial" — mostra a marca existente do item ou, quando o
 *  médico/PJ do item está vinculado a uma regra com cálculo de caso especial,
 *  o botão para o analista sinalizar o atendimento. */
function SpecialCaseSection({ item }: { item: AnyItem }) {
  const paymentId: string | null = item.payment_id ?? null;
  const hasRules = useHasSpecialCaseRules(paymentId);

  const code = item.special_case_code ?? null;
  const status = item.special_case_status ?? null;
  const approved = status === "approved" && !!code;
  const pending = status === "pending" && !!code;

  if (approved || pending) {
    return (
      <Section title="Caso especial" defaultOpen tone="accent">
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-[12px]",
            approved
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-xs">{String(code)}</span>
            <span className="opacity-80">
              {approved ? "aprovado pela gestão médica" : "aguardando aprovação"}
            </span>
          </div>
        </div>
      </Section>
    );
  }

  if (hasRules !== true || !paymentId || !item.id) return null;

  return (
    <Section title="Caso especial" defaultOpen tone="accent">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12px] text-muted-foreground">
          Este item se aplica a um caso especial?
        </p>
        <MarkSpecialCaseDialog
          paymentId={paymentId}
          itemId={String(item.id)}
          defaultAttendance={item.attendance_number ?? undefined}
          doctorId={item.doctor_id ?? undefined}
          trigger={
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Sparkles className="h-3.5 w-3.5 mr-1" /> Sinalizar caso especial
            </Button>
          }
        />
      </div>
    </Section>
  );
}

export function ItemDetailsPanel({

  open,
  onOpenChange,
  item,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  caseSubtypeSlot,
  observations = [],
}: ItemDetailsPanelProps) {
  if (!item) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-[440px] w-full p-0" />
      </Sheet>
    );
  }

  const patient = getPatient(item);
  const procCode = getProcedureCode(item);
  const procName = getProcedureName(item);
  const statusLabel = String(item.ai_status ?? item.status ?? "—");

  const grossAmount = Number(item.gross_amount ?? 0);
  const expectedAmount = Number(item.expected_amount ?? 0);
  const diff = grossAmount - expectedAmount;
  const diffTone =
    Math.abs(diff) < 0.01
      ? "text-muted-foreground"
      : diff > 0
        ? "text-success"
        : "text-destructive";

  const appliedRuleLabel =
    item.applied_rule_label ?? item.rule_name ?? item.matched_rule_name ?? null;
  const appliedMethod = item.applied_calc_method ?? null;

  const calcMemory: string | null =
    item.ai_findings?.calculation_explanation ??
    item.ai_findings?.explanation ??
    item.calculation_explanation ??
    null;

  const alerts: string[] = Array.isArray(item.ai_findings?.alerts) ? item.ai_findings.alerts : [];
  const matchedRules: string[] = Array.isArray(item.ai_findings?.matched_rules)
    ? item.ai_findings.matched_rules
    : [];
  const engine = item.ai_findings?.engine ?? null;

  // Motivo categorizado de intervenção — snapshotado em payment_items
  // pelas ações do split-button (acatar/excluir) e pela edição.
  const { reasons: allReasons } = useManualInterventionReasons();
  const interventionReasonId: string | null =
    item.intervention_reason_id ?? null;
  const interventionReason = interventionReasonId
    ? allReasons.find((r) => r.id === interventionReasonId) ?? null
    : null;
  const interventionImpact = (item.intervention_financial_impact ??
    interventionReason?.financial_impact ??
    null) as "economia" | "perda" | "neutro" | null;
  const interventionNotes: string | null = item.intervention_notes ?? null;
  const hasIntervention = !!interventionReasonId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-[440px] w-full p-0 overflow-hidden flex flex-col"
      >
        {/* Header — pr-14 garante espaço para o X do Sheet não sobrepor conteúdo */}
        <div className="border-b bg-primary text-primary-foreground px-4 py-3 pr-14 shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-[11px] uppercase tracking-wide opacity-80">Detalhes do item</div>
            <span className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-primary-foreground hover:bg-white/10"
                disabled={!hasPrev}
                onClick={onPrev}
                title="Item anterior"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-primary-foreground hover:bg-white/10"
                disabled={!hasNext}
                onClick={onNext}
                title="Próximo item"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </span>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <div className="text-sm font-semibold truncate flex-1 min-w-0" title={patient}>
              {patient}
            </div>
            <span
              className={cn(
                "shrink-0 text-[10px] uppercase font-semibold rounded px-2 py-0.5",
                statusBadgeClass(statusLabel),
              )}
            >
              {statusLabel}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] opacity-90 truncate" title={`${procCode} — ${procName}`}>
            {procCode} — {procName}
          </div>
        </div>

        {/* Scroll interno */}
        <div className="flex-1 overflow-y-auto">
          {/* 1. Cálculo — aberto por padrão, azul CURA sólido (destaque máximo) */}
          <Section title="Cálculo" defaultOpen tone="primary">
            <div className="grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-primary/70 font-medium">Pago</div>
                <div className="mt-0.5 text-[18px] font-bold tabular-nums text-foreground">
                  {formatCurrency(grossAmount)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-primary/70 font-medium">Esperado</div>
                <div className="mt-0.5 text-[18px] font-bold tabular-nums text-foreground">
                  {formatCurrency(expectedAmount)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-primary/70 font-medium">Diferença</div>
                <div className={cn("mt-0.5 text-[18px] font-bold tabular-nums", diffTone)}>
                  {formatCurrency(diff)}
                </div>
              </div>
            </div>
            {calcMemory && (
              <div className="mt-3 bg-primary/[0.06] rounded-lg p-3 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                {calcMemory}
              </div>
            )}
            {appliedMethod && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                <span>Método aplicado:</span>
                <span className="inline-flex items-center bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  {appliedMethod}
                </span>
              </div>
            )}
          </Section>

          {/* 2. Regra aplicada — laranja CURA */}
          <Section title="Regra aplicada" defaultOpen tone="accent">
            <div className="space-y-2">
              <div className="min-w-0">
                <div className={SECTION_TITLE}>Nome da regra</div>
                <div className="mt-0.5 text-[14px] font-semibold text-foreground break-words">
                  {appliedRuleLabel ?? (
                    <span className="text-muted-foreground italic font-normal">Sem regra vinculada</span>
                  )}
                </div>
              </div>
              {item.applied_layer && <Field label="Camada" value={String(item.applied_layer)} />}
              {item.applied_rule_id && (
                <div className="min-w-0">
                  <div className={SECTION_TITLE}>ID da regra</div>
                  <div className="mt-0.5">
                    <span className="inline-block text-[11px] font-mono text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                      {String(item.applied_rule_id)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* 2b. Intervenção do analista — só aparece quando há motivo gravado */}
          {hasIntervention && (
            <Section title="Intervenção do analista" defaultOpen tone="accent">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-foreground">
                    {interventionReason?.label ?? "Motivo (removido)"}
                  </span>
                  {interventionImpact && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        impactBadgeClass(interventionImpact),
                      )}
                    >
                      Impacto: {impactLabel(interventionImpact)}
                    </span>
                  )}
                </div>
                {interventionReason?.description && (
                  <div className="text-[12px] text-muted-foreground">
                    {interventionReason.description}
                  </div>
                )}
                {interventionNotes && (
                  <div className="rounded-md bg-muted/40 border border-border/40 p-2 text-[12px] whitespace-pre-wrap break-words text-foreground">
                    {interventionNotes}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* 2c. Caso especial — marca existente ou ação para sinalizar */}
          <SpecialCaseSection item={item} />


          {/* 3. Observações — cinza (menos importante) */}
          <Section title="Observações" tone="muted">
            {observations.length === 0 ? (
              <div className="text-[12px] text-muted-foreground italic">Nenhuma observação registrada.</div>
            ) : (
              <ul className="space-y-0">
                {observations.map((o, idx) => (
                  <li
                    key={o.id ?? idx}
                    className={cn(
                      "py-2 text-[12px]",
                      idx < observations.length - 1 && "border-b border-border/40",
                    )}
                  >
                    <div className="whitespace-pre-wrap break-words text-foreground">{o.text ?? "—"}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {o.author_name ?? "—"}{o.created_at ? ` • ${o.created_at}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 4. Dados do item — azul claro CURA */}
          <Section title="Dados do item" tone="glow">
            {caseSubtypeSlot && (
              <div className="mb-3 pb-3 border-b border-border/40">
                <div className="text-[11px] uppercase tracking-wide text-primary/60 font-medium">Tipo deste item</div>
                <div className="mt-1">{caseSubtypeSlot}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              <Field label="Atendimento" value={item.attendance_number ?? item.atendimento ?? null} labelClass="text-primary/60" />
              <Field label="Data" value={formatDate(item.procedure_date ?? item.data ?? item.date)} labelClass="text-primary/60" />
              <Field label="Paciente" value={patient} full labelClass="text-primary/60" />
              <Field label="Convênio" value={getAgreement(item)} full labelClass="text-primary/60" />
              <Field label="Via de acesso" value={getAccessRoute(item)} labelClass="text-primary/60" />
              <Field label="TUSS" value={procCode} labelClass="text-primary/60" />
              <Field label="Procedimento" value={procName} full labelClass="text-primary/60" />
              <Field label="Médico" value={getDoctor(item)} full labelClass="text-primary/60" />
              <Field label="Função" value={getDoctorRole(item)} labelClass="text-primary/60" />
              <Field label="Quantidade" value={item.quantity ?? 1} labelClass="text-primary/60" />
              <Field label="Setor" value={item.sector_name ?? item.sector ?? null} full labelClass="text-primary/60" />
              <Field label="Setor (planilha)" value={item.raw_sector ?? item.sector_raw ?? null} full labelClass="text-primary/60" />
              <Field label="Tipo do item" value={item.item_type_label ?? item.item_type ?? null} full labelClass="text-primary/60" />
            </div>
          </Section>

          {/* 5. Histórico e análise — cinza (contexto de apoio) */}
          <Section title="Histórico e análise" tone="muted">
            <div className="space-y-3">
              {alerts.length > 0 && (
                <div className="border-l-2 border-accent pl-3">
                  <div className={SECTION_TITLE}>Alertas</div>
                  <ul className="mt-1 space-y-1 text-[12px] text-foreground">
                    {alerts.map((a, i) => (
                      <li key={i} className="break-words">• {a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {matchedRules.length > 0 && (
                <div className="border-l-2 border-primary/40 pl-3">
                  <div className={SECTION_TITLE}>Regras avaliadas</div>
                  <ul className="mt-1 space-y-1 text-[12px] text-foreground">
                    {matchedRules.map((r, i) => (
                      <li key={i} className="break-words">• {r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {engine && (
                <div className="border-l-2 border-muted-foreground/40 pl-3">
                  <div className={SECTION_TITLE}>Motor</div>
                  <div className="mt-1 space-y-1 text-[12px] text-foreground">
                    {engine.calculation_type_used && (
                      <div><span className="text-muted-foreground">Tipo de cálculo:</span> {String(engine.calculation_type_used)}</div>
                    )}
                    {engine.matched_priority && (
                      <div><span className="text-muted-foreground">Prioridade:</span> {String(engine.matched_priority)}</div>
                    )}
                    {engine.diff_pct != null && (
                      <div><span className="text-muted-foreground">Diferença %:</span> {Number(engine.diff_pct).toFixed(2)}%</div>
                    )}
                    {engine.ai_note && (
                      <div className="mt-1 bg-muted/40 rounded p-2 whitespace-pre-wrap break-words">{String(engine.ai_note)}</div>
                    )}
                  </div>
                </div>
              )}

              {item.created_at && (
                <div className="border-l-2 border-muted-foreground/40 pl-3">
                  <div className={SECTION_TITLE}>Criado em</div>
                  <div className="mt-1 text-[12px] text-foreground">{formatDate(item.created_at)}</div>
                </div>
              )}

              {alerts.length === 0 && matchedRules.length === 0 && !engine && !item.created_at && (
                <div className="text-[12px] text-muted-foreground italic">Sem histórico registrado.</div>
              )}
            </div>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
