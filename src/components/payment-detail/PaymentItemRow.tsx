import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AlertBanner } from "./AlertBanner";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  Loader2,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  formatCurrency,
  formatDate,
  TONE_CLASSES,
  type ItemAiStatus,
  RULE_MATCH_PRIORITY_LABELS,
  RULE_MATCH_PRIORITY_TONES,
  RULE_CALCULATION_TYPE_LABELS,
  type RuleMatchPriority,
  type RuleCalculationType,
} from "@/lib/status";
import type {
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { AuthorizedExceptionDialog } from "./AuthorizedExceptionDialog";

const itemToneMap: Record<ItemAiStatus, keyof typeof TONE_CLASSES> = {
  pendente: "muted",
  aprovado: "success",
  alerta: "warning",
  reprovado: "destructive",
};

const truncate = (s: string, max = 220) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/**
 * Bloco de tooltip com regras casadas — duplicado intencionalmente do
 * PaymentDetail para manter o componente autônomo. Se a página passar a
 * compartilhar mais peças, mover para `components/payment-detail/RuleTooltipContent.tsx`.
 */
const RuleTooltipBlock = ({
  rules,
  fallbackNames,
}: {
  rules: RuleLite[];
  fallbackNames: string[];
}) => {
  const blocks = rules.length
    ? rules.map((r) => ({
        name: r.name,
        text: r.rule_text || r.description || "",
      }))
    : fallbackNames.map((n) => ({ name: n, text: "" }));
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-2 text-xs">
      {blocks.slice(0, 4).map((b, i) => (
        <div key={i}>
          <p className="font-semibold">{truncate(b.name, 80)}</p>
          {b.text && (
            <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground leading-snug">
              {truncate(b.text.trim(), 220)}
            </p>
          )}
        </div>
      ))}
      {blocks.length > 4 && (
        <p className="italic text-muted-foreground">+{blocks.length - 4} regra(s)…</p>
      )}
    </div>
  );
};

const authorBadgeClass = (t: string) =>
  t === "ia" ? TONE_CLASSES.info
    : t === "validador" ? TONE_CLASSES.warning
    : t === "diretor" ? TONE_CLASSES.success
    : TONE_CLASSES.muted;

export type PaymentItemRowProps = {
  it: PaymentItemRowData;
  /** Observações do payment inteiro — o componente filtra pelas suas próprias. */
  obs: ObservationRow[];
  profiles: Record<string, string>;
  /** Cache id->Rule e nome->Rule para resolver as regras citadas pela IA. */
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  isExpanded: boolean;
  onToggleExpanded: (itemId: string) => void;
  /** Quando o analista já encaminhou o pagamento, status "reprovado/alerta" da IA viram "seguido". */
  analystDone: boolean;
  /** Permite comentário inline neste item (controla o textarea + botão). */
  canComment: boolean;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
  busy: boolean;
  /** ID do payment — necessário para marcar exceção autorizada. */
  paymentId: string;
  /** Recarrega os dados após marcar/remover exceção. */
  onExceptionChanged?: () => void;
  /** Densidade visual da linha. */
  density?: "compact" | "comfortable";
  /** Navegação Anterior/Próximo no drawer (respeita ordenação/filtros aplicados pelo pai). */
  onNavigate?: (direction: "prev" | "next") => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Linha está selecionada/foco visual (mantida durante scroll). */
  isSelected?: boolean;
  /** Notificar pai quando a linha for selecionada (clique). */
  onSelect?: (itemId: string) => void;
};

/**
 * Linha de item dentro do card de grupo (PJ).
 *
 * Renderiza um Fragment com 1 ou 2 <tr> (a 2ª aparece quando expandido).
 * Toda a lógica de resolução de regras casadas + popover de "+N regras"
 * + bloco expandido com histórico/comentário está aqui dentro.
 */
export const PaymentItemRow = ({
  it,
  obs,
  profiles,
  rulesIndex,
  rulesByName,
  isExpanded,
  onToggleExpanded,
  analystDone,
  canComment,
  commentDraft,
  onCommentDraftChange,
  onAddComment,
  busy,
  paymentId,
  onExceptionChanged,
  density = "compact",
  onNavigate,
  hasPrev = false,
  hasNext = false,
  isSelected = false,
  onSelect,
}: PaymentItemRowProps) => {
  const isComfy = density === "comfortable";
  // Compacto profissional: padding 6-8px / 10-12px, linha ~36-40px.
  // Confortável: padding 10-12px, linha mais alta.
  const cellPad = isComfy ? "px-3 py-2.5" : "px-2.5 py-1.5";
  const cellPadRight = `${cellPad} text-right`;
  const fMain = isComfy ? "text-[14px]" : "text-[13px]"; // texto principal
  const fSec = isComfy ? "text-[13px]" : "text-[12px]"; // texto secundário
  const fVal = isComfy ? "text-[14px] font-semibold" : "text-[13px] font-semibold"; // valores
  const fSm = fMain;
  const fXs = fSec;
  const [excOpen, setExcOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // Atalhos: ↑/↓ navegam entre itens enquanto o drawer estiver aberto.
  useEffect(() => {
    if (!isExpanded || !onNavigate) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "ArrowUp" && hasPrev) {
        e.preventDefault();
        onNavigate("prev");
      } else if (e.key === "ArrowDown" && hasNext) {
        e.preventDefault();
        onNavigate("next");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded, onNavigate, hasPrev, hasNext]);
  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const paciente = (raw["Paciente"] ?? raw["paciente"] ?? "—") as string;
  const convenio = (raw["Convênio"] ?? raw["Convenio"] ?? raw["convenio"] ?? "—") as string;
  const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
  const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
  const seen = new Set<string>();
  const matchedRuleObjs: RuleLite[] = [];
  matchedIds.forEach((rid) => {
    const r = rulesIndex[rid];
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      matchedRuleObjs.push(r);
    }
  });
  matchedNames.forEach((nm) => {
    const r = rulesByName[String(nm).trim().toLowerCase()];
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      matchedRuleObjs.push(r);
    }
  });
  const hasRule = matchedRuleObjs.length > 0 || matchedNames.length > 0;
  const firstRule = matchedRuleObjs[0] ?? null;
  // Suporte à "Exclusão / não pagar" com exceção autorizada:
  // mostra a ação somente quando a regra vencedora é de exclusão e admite exceção.
  const isExclusionRule = firstRule?.calculation_type === "exclusao";
  const allowsException = !!firstRule?.allows_authorized_exception;
  const itemAny = it as unknown as {
    authorized_exception?: boolean | null;
    exception_reason?: string | null;
    exception_authorizer?: string | null;
    exception_note?: string | null;
    exception_attachment_path?: string | null;
  };
  const exceptionMarked = !!itemAny.authorized_exception;
  const showExceptionAction = isExclusionRule && (allowsException || exceptionMarked);
  const firstRuleLabel = firstRule?.name ?? matchedNames[0] ?? null;
  const tooltipNode = hasRule ? (
    <RuleTooltipBlock rules={matchedRuleObjs} fallbackNames={matchedNames} />
  ) : null;
  const itemObs = obs.filter((o) => o.item_id === it.id);
  const totalRules = matchedRuleObjs.length || matchedNames.length;
  const extra = Math.max(0, totalRules - 1);
  const alerts = it.ai_findings?.alerts ?? [];
  const engine = it.ai_findings?.engine ?? null;
  const expectedAmount = (it.ai_findings?.expected_amount ?? null) as number | null;

  // Explicação IA sob demanda (não persistida — apenas auxilia interpretação)
  const [aiExplain, setAiExplain] = useState<{
    explanation: string;
    possible_causes: string[];
    what_to_check: string;
  } | null>(null);
  const [aiExplainLoading, setAiExplainLoading] = useState(false);
  const requestAiExplain = async () => {
    setAiExplainLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("explain-alert", {
        body: { item_id: it.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAiExplain((data as any).ai);
    } catch (e: any) {
      toast({
        title: "Não foi possível gerar a explicação",
        description: e?.message ?? "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setAiExplainLoading(false);
    }
  };
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
  const valueEl = (
    <span
      className={`tabular-nums ${fVal} ${
        firstRule?.id
          ? "text-primary underline decoration-dotted decoration-primary/50 cursor-help"
          : tooltipNode
          ? "underline decoration-dotted decoration-muted-foreground/50 cursor-help"
          : ""
      }`}
    >
      {formatCurrency(it.gross_amount)}
    </span>
  );

  return (
    <Fragment>
      <tr
        className="align-top hover:bg-muted/20 cursor-pointer"
        onClick={() => onToggleExpanded(it.id)}
      >
        <td className={`${cellPad} text-muted-foreground print:hidden align-top md:sticky md:left-0 z-[1] bg-background`}>
          <ChevronRight className="h-3 w-3" />
        </td>
        <td className={`${cellPad} ${fXs} font-mono text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis md:sticky md:left-6 z-[1] bg-background`} title={it.attendance_number ?? ""}>
          {it.attendance_number ?? "—"}
        </td>
        <td className={`${cellPad} ${fSm} leading-tight whitespace-nowrap overflow-hidden text-ellipsis md:sticky md:left-[104px] z-[1] bg-background shadow-[1px_0_0_0_hsl(var(--border))]`} title={paciente}>{paciente}</td>
        <td className={`${cellPad} ${fSm} leading-tight text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis hidden md:table-cell print:table-cell`} title={typeof convenio === "string" ? convenio : ""}>
          {convenio}
        </td>
        <td className={`${cellPad} leading-tight overflow-hidden`}>
          <div className={`font-medium ${fSm} whitespace-nowrap overflow-hidden text-ellipsis`} title={it.doctor_name ?? ""}>{it.doctor_name}</div>
          <div className={`${fXs} text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis`} title={it.doctor_role ?? ""}>{it.doctor_role ?? "—"}</div>
        </td>
        <td className={`${cellPad} font-mono ${fXs} whitespace-nowrap overflow-hidden text-ellipsis hidden lg:table-cell print:table-cell`} title={it.procedure_code ?? ""}>
          {it.procedure_code ?? "—"}
        </td>
        <td className={`${cellPad} leading-tight overflow-hidden`}>
          <div className={`${fSm} text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis`} title={it.description ?? ""}>{it.description ?? "—"}</div>
          {!isExpanded && alerts.length > 0 && (
            <div className={`mt-0.5 ${fXs} text-warning-foreground whitespace-nowrap overflow-hidden text-ellipsis`} title={alerts.join(" · ")}>
              ⚠ {alerts[0]}
              {alerts.length > 1 && ` (+${alerts.length - 1})`}
            </div>
          )}
        </td>
        <td className={`${cellPadRight} tabular-nums ${fSec} whitespace-nowrap text-right`}>{it.quantity ?? "—"}</td>
        <td className={`${cellPadRight} whitespace-nowrap text-right`} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1.5">
            {tooltipNode ? (
              <Tooltip>
                <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  {tooltipNode}
                </TooltipContent>
              </Tooltip>
            ) : (
              valueEl
            )}
            {extra > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition"
                  >
                    +{extra}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="left" align="end" className="w-80 p-0">
                  <ul className="max-h-72 overflow-y-auto divide-y divide-border/60">
                    {(matchedRuleObjs.length
                      ? matchedRuleObjs
                      : matchedNames.map((n) => ({
                          id: "",
                          name: n,
                          rule_text: "",
                          description: null,
                        }))
                    ).map((r, i) => (
                      <li key={i} className="px-3 py-2 text-xs">
                        <span className={`font-medium ${r.id ? "text-primary" : ""}`}>
                          {truncate(r.name, 80)}
                        </span>
                        {r.rule_text && (
                          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground leading-snug">
                            {truncate(r.rule_text.trim(), 180)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
          {firstRuleLabel && (
            <span
              className={`block text-[10px] truncate max-w-[180px] ml-auto ${
                firstRule?.id ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {firstRuleLabel}
            </span>
          )}
          {expectedAmount != null && (
            <span
              className={`block text-[10px] tabular-nums ml-auto ${
                diffPct != null && Math.abs(diffPct) > 0.01
                  ? "text-warning-foreground"
                  : "text-muted-foreground"
              }`}
              title="Valor esperado pelo motor"
            >
              esp: {formatCurrency(expectedAmount)}
              {diffPct != null && Math.abs(diffPct) > 0.001 && (
                <> ({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)</>
              )}
            </span>
          )}
        </td>
        <td className={`${cellPad} hidden sm:table-cell print:table-cell`}>
          {(() => {
            const aiRaw = (it.ai_status as ItemAiStatus) ?? "pendente";
            // Se o analista já encaminhou adiante, "reprovado/alerta" da IA viram "seguido".
            if (analystDone && (aiRaw === "reprovado" || aiRaw === "alerta")) {
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={`inline-flex rounded-full border px-1.5 py-0 text-[10px] whitespace-nowrap ${TONE_CLASSES.success}`}
                    >
                      seguido
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs text-xs">
                    Análise inicial da IA: <strong>{aiRaw}</strong>. O analista revisou e seguiu com este item.
                  </TooltipContent>
                </Tooltip>
              );
            }
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex rounded-full border px-1.5 py-0 text-[10px] whitespace-nowrap cursor-help ${TONE_CLASSES[itemToneMap[aiRaw]]}`}
                  >
                    {aiRaw}
                  </span>
                </TooltipTrigger>
                {(alerts.length > 0 || expectedAmount != null) && (
                  <TooltipContent side="left" className="max-w-xs text-xs space-y-1">
                    {expectedAmount != null && (
                      <p className="tabular-nums">
                        Esperado: <strong>{formatCurrency(expectedAmount)}</strong>
                        {diffPct != null && Math.abs(diffPct) > 0.001 && (
                          <> ({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)</>
                        )}
                      </p>
                    )}
                    {alerts.length > 0 && (
                      <ul className="space-y-0.5">
                        {alerts.slice(0, 3).map((a, i) => <li key={i}>• {a}</li>)}
                        {alerts.length > 3 && <li className="italic">+{alerts.length - 3} alerta(s)…</li>}
                      </ul>
                    )}
                    <p className="text-[10px] text-muted-foreground italic">Clique na linha para ver detalhes</p>
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })()}
          {exceptionMarked && (
            <span
              className={`mt-0.5 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] whitespace-nowrap ${TONE_CLASSES.info}`}
              title={`Exceção autorizada — ${itemAny.exception_authorizer ?? "—"}`}
            >
              <ShieldCheck className="h-2.5 w-2.5" /> exceção
            </span>
          )}
        </td>
        <td className={`${isComfy ? "pl-2 pr-2 py-2" : "pl-1 pr-2 py-1"} print:hidden`} onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => onToggleExpanded(it.id)}
              className="relative inline-flex items-center justify-center rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
              title={`${itemObs.length} comentário(s)`}
              aria-label={`${itemObs.length} comentário(s)`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {itemObs.length > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] px-1">
                  {itemObs.length}
                </span>
              )}
            </button>
          </div>
        </td>
      </tr>
      <Sheet
        open={isExpanded}
        onOpenChange={(o) => {
          if (!o && isExpanded) onToggleExpanded(it.id);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[520px] overflow-y-auto p-0">
          <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-5 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Detalhes do item
                </SheetTitle>
                <SheetDescription className="text-xs">
                  {paciente} · Atend. {it.attendance_number ?? "—"} · {formatCurrency(it.gross_amount)}
                </SheetDescription>
              </div>
              {onNavigate && (
                <div className="flex items-center gap-1 mr-8 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={!hasPrev}
                    onClick={() => onNavigate("prev")}
                    title="Item anterior (↑)"
                    aria-label="Item anterior"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={!hasNext}
                    onClick={() => onNavigate("next")}
                    title="Próximo item (↓)"
                    aria-label="Próximo item"
                  >
                    Próximo <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </SheetHeader>
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dados do item
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="min-w-0">
                  <dt className="font-medium text-muted-foreground">Convênio</dt>
                  <dd className="mt-0.5 break-words text-foreground">{convenio}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-medium text-muted-foreground">TUSS</dt>
                  <dd className="mt-0.5 break-words font-mono text-foreground">{it.procedure_code ?? "—"}</dd>
                </div>
                <div className="min-w-0 col-span-2">
                  <dt className="font-medium text-muted-foreground">Médico / Função</dt>
                  <dd className="mt-0.5 break-words text-foreground">
                    {it.doctor_name ?? "—"}
                    <span className="text-muted-foreground"> · {it.doctor_role ?? "—"}</span>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-medium text-muted-foreground">Quantidade</dt>
                  <dd className="mt-0.5 tabular-nums text-foreground">{it.quantity ?? "—"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-medium text-muted-foreground">Valor</dt>
                  <dd className="mt-0.5 tabular-nums font-medium text-foreground">{formatCurrency(it.gross_amount)}</dd>
                </div>
                <div className="min-w-0 col-span-2">
                  <dt className="font-medium text-muted-foreground">Descrição</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">{it.description ?? "—"}</dd>
                </div>
                {firstRuleLabel && (
                  <div className="min-w-0 col-span-2">
                    <dt className="font-medium text-muted-foreground">Regra vinculada</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
                      {(matchedRuleObjs.length ? matchedRuleObjs.map((r) => r.name) : matchedNames).join(" · ")}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {it.ai_status === "reprovado" && !analystDone && (
              <AlertBanner severity="critico" title="Item reprovado pela análise">
                {alerts.length > 0 ? (
                  <ul className="space-y-0.5">
                    {alerts.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                ) : (
                  <p>Revisar antes de seguir.</p>
                )}
              </AlertBanner>
            )}
            {it.ai_status !== "reprovado" && alerts.length > 0 && (
              <AlertBanner severity="alerta" title={alerts.length === 1 ? "Alerta" : `${alerts.length} alertas`}>
                <ul className="space-y-0.5">
                  {alerts.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </AlertBanner>
            )}

            {(engine || expectedAmount != null || it.ai_findings?.calculation_explanation || alerts.length > 0) && (
              <Accordion type="single" collapsible defaultValue="motor" className="border border-border/60 rounded-md bg-muted/10">
                {(engine || expectedAmount != null || it.ai_findings?.calculation_explanation) && (
                  <AccordionItem value="motor" className="border-b-0">
                    <AccordionTrigger className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground hover:no-underline">
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3" /> Detalhes do cálculo
                        {expectedAmount != null && (
                          <span className="ml-1 normal-case tracking-normal text-foreground tabular-nums">
                            · esperado {formatCurrency(expectedAmount)}
                            {diffPct != null && Math.abs(diffPct) > 0.001 && (
                              <span className={`ml-1 ${Math.abs(diffPct) > 0.01 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                                ({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 text-xs space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {priority && (
                          <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES[RULE_MATCH_PRIORITY_TONES[priority]]}`}>
                            {RULE_MATCH_PRIORITY_LABELS[priority]}
                          </span>
                        )}
                        {calcTypeLabel && (
                          <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.muted}`}>
                            {calcTypeLabel}
                          </span>
                        )}
                      </div>
                      {it.ai_findings?.calculation_explanation && (
                        <p className="text-muted-foreground italic">{it.ai_findings.calculation_explanation}</p>
                      )}
                      {engine?.ai_note && (
                        <p className="text-muted-foreground italic">IA: {engine.ai_note}</p>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setLogOpen(true); }}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2 inline-flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" /> Ver log completo
                      </button>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {(alerts.length > 0 || it.ai_status === "alerta" || it.ai_status === "reprovado") && (
                  <AccordionItem value="ia" className="border-b-0">
                    <AccordionTrigger className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground hover:no-underline">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" /> Explicação sugerida (IA)
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          Apenas interpreta. Não altera valor, status ou regra.
                        </span>
                        {!aiExplain && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={aiExplainLoading} onClick={requestAiExplain}>
                            {aiExplainLoading ? (
                              <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Gerando…</>
                            ) : (
                              <><Sparkles className="h-3 w-3 mr-1" /> Explicar com IA</>
                            )}
                          </Button>
                        )}
                      </div>
                      {aiExplain ? (
                        <div className="space-y-1.5">
                          <p className="text-foreground">{aiExplain.explanation}</p>
                          {aiExplain.possible_causes?.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Possíveis causas</p>
                              <ul className="list-disc pl-4 text-muted-foreground">
                                {aiExplain.possible_causes.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            </div>
                          )}
                          {aiExplain.what_to_check && (
                            <p className="text-muted-foreground">
                              <span className="font-semibold text-foreground">O que conferir: </span>
                              {aiExplain.what_to_check}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Gere uma interpretação contextual deste alerta (histórico, auxiliares, múltiplos procedimentos, pacote/tabela diferenciada).
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}

            {showExceptionAction && (
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" /> Exceção autorizada
                    </p>
                    {exceptionMarked ? (
                      <p className="text-xs text-foreground">
                        Marcada — motivo: <strong>{itemAny.exception_reason ?? "—"}</strong>
                        {" · "}autorizador: <strong>{itemAny.exception_authorizer ?? "—"}</strong>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Esta regra de exclusão admite exceção. Marque para reprocessar com a próxima regra calculável.
                      </p>
                    )}
                    {exceptionMarked && itemAny.exception_note && (
                      <p className="text-[11px] whitespace-pre-wrap text-muted-foreground">
                        “{itemAny.exception_note}”
                      </p>
                    )}
                  </div>
                  {canComment && (
                    <Button size="sm" variant={exceptionMarked ? "outline" : "default"} onClick={() => setExcOpen(true)}>
                      {exceptionMarked ? "Editar exceção" : "Marcar exceção"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Histórico deste item
              </p>
              {itemObs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem comentários ainda.</p>
              ) : (
                <ul className="space-y-2">
                  {itemObs.map((o) => (
                    <li key={o.id} className="text-xs">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className={`inline-flex rounded-full border px-1.5 py-0.5 uppercase tracking-wide ${authorBadgeClass(o.author_type)}`}>
                          {o.author_type}
                        </span>
                        {o.author_id && <span>{profiles[o.author_id] ?? ""}</span>}
                        <span className="ml-auto">{formatDate(o.created_at)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{o.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canComment && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Adicionar comentário neste item
                </p>
                <Textarea
                  rows={3}
                  value={commentDraft}
                  onChange={(e) => onCommentDraftChange(e.target.value)}
                  placeholder="Motivo de dúvida, reprovação, observação..."
                />
                <div className="flex justify-end mt-2">
                  <Button size="sm" disabled={busy || !commentDraft.trim()} onClick={onAddComment}>
                    <MessageSquarePlus className="h-3.5 w-3.5 mr-1" /> Salvar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {showExceptionAction && (
        <AuthorizedExceptionDialog
          open={excOpen}
          onOpenChange={setExcOpen}
          itemId={it.id}
          paymentId={paymentId}
          current={{
            authorized_exception: itemAny.authorized_exception ?? false,
            exception_reason: itemAny.exception_reason ?? null,
            exception_authorizer: itemAny.exception_authorizer ?? null,
            exception_note: itemAny.exception_note ?? null,
            exception_attachment_path: itemAny.exception_attachment_path ?? null,
          }}
          onSaved={() => onExceptionChanged?.()}
        />
      )}
      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[460px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Log de decisão do motor
            </SheetTitle>
            <SheetDescription className="text-xs">
              Registro auditável do raciocínio determinístico. A IA pode resumir, mas não altera o resultado.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 text-xs">
            {(() => {
              const tl = (it as any).tipo_linha as string | null;
              const sector = (it as any).classification_sector ?? null;
              const groupKey = (it as any).attendance_group_key as string | null;
              const exceptionMarkedLocal = !!itemAny.authorized_exception;
              const findings = it.ai_findings ?? null;
              const updated = (it as any).updated_at ?? (it as any).created_at ?? null;
              const Row = ({ label, value }: { label: string; value: unknown }) => (
                <div className="grid grid-cols-[140px_1fr] gap-2 border-b border-border/40 pb-1.5">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="text-foreground break-words">{(value as any) ?? "—"}</dd>
                </div>
              );
              return (
                <dl className="space-y-1.5">
                  <Row label="Tipo de linha" value={tl ?? "—"} />
                  <Row label="Tipo / Setor" value={sector ?? "—"} />
                  <Row label="Grupo atendimento" value={groupKey ? <span className="font-mono text-[10px]">{groupKey}</span> : "—"} />
                  <Row label="Regra aplicada" value={firstRuleLabel ?? "—"} />
                  <Row label="Tipo de cálculo" value={calcTypeLabel ?? "—"} />
                  <Row label="Precedência" value={priority ? RULE_MATCH_PRIORITY_LABELS[priority] : "—"} />
                  <Row label="Valor esperado" value={expectedAmount != null ? formatCurrency(expectedAmount) : "—"} />
                  <Row label="Valor informado" value={formatCurrency(it.gross_amount)} />
                  <Row label="Diferença" value={diffPct != null ? `${(diffPct * 100).toFixed(1)}%` : "—"} />
                  <Row label="Status final" value={<span className="uppercase">{it.ai_status}</span>} />
                  <Row
                    label="Exceção autorizada"
                    value={exceptionMarkedLocal
                      ? `Sim — ${itemAny.exception_reason ?? "—"} (${itemAny.exception_authorizer ?? "—"})`
                      : "Não"}
                  />
                  <Row label="Processado em" value={updated ? formatDate(updated) : "—"} />
                  <div className="pt-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Cálculo / motivo</p>
                    <p className="whitespace-pre-wrap text-foreground bg-muted/40 rounded p-2 leading-snug">
                      {findings?.calculation_explanation ?? "—"}
                    </p>
                  </div>
                  {alerts.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Alertas / regras de validação acionadas</p>
                      <ul className="space-y-0.5">
                        {alerts.map((a, i) => (
                          <li key={i} className="text-warning-foreground">⚠ {a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {engine?.ai_note && (
                    <div className="pt-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Resumo IA (apenas interpretação)</p>
                      <p className="italic text-muted-foreground">{engine.ai_note}</p>
                    </div>
                  )}
                </dl>
              );
            })()}
          </div>
        </SheetContent>
      </Sheet>
    </Fragment>
  );
};