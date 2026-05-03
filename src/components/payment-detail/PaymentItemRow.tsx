import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus,
  ShieldCheck,
} from "lucide-react";
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
}: PaymentItemRowProps) => {
  const [excOpen, setExcOpen] = useState(false);
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
      className={`tabular-nums font-medium ${
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
        <td className="px-1.5 py-1.5 text-muted-foreground print:hidden">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </td>
        <td className="px-1.5 py-1.5 text-[11px] font-mono text-muted-foreground break-all">
          {it.attendance_number ?? "—"}
        </td>
        <td className="px-1.5 py-1.5 text-[12px] leading-snug break-words">{paciente}</td>
        <td className="px-1.5 py-1.5 text-[12px] leading-snug text-muted-foreground break-words hidden md:table-cell print:table-cell">
          {convenio}
        </td>
        <td className="px-1.5 py-1.5 leading-snug">
          <div className="font-medium text-[12px] break-words">{it.doctor_name}</div>
          <div className="text-[10px] text-muted-foreground break-words">{it.doctor_role ?? "—"}</div>
        </td>
        <td className="px-1.5 py-1.5 font-mono text-[11px] break-all hidden lg:table-cell print:table-cell">
          {it.procedure_code ?? "—"}
        </td>
        <td className="px-1.5 py-1.5 leading-snug">
          <div className="text-[12px] line-clamp-2">{it.description ?? "—"}</div>
          {!isExpanded && alerts.length > 0 && (
            <div className="mt-0.5 text-[10px] text-warning-foreground line-clamp-1">
              ⚠ {alerts[0]}
              {alerts.length > 1 && ` (+${alerts.length - 1})`}
            </div>
          )}
        </td>
        <td className="px-1.5 py-1.5 text-right tabular-nums text-[12px]">{it.quantity ?? "—"}</td>
        <td className="px-1.5 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
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
        <td className="px-1.5 py-1.5 hidden sm:table-cell print:table-cell">
          {(() => {
            const aiRaw = (it.ai_status as ItemAiStatus) ?? "pendente";
            // Se o analista já encaminhou adiante, "reprovado/alerta" da IA viram "seguido".
            if (analystDone && (aiRaw === "reprovado" || aiRaw === "alerta")) {
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${TONE_CLASSES.success}`}
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
              <span
                className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${TONE_CLASSES[itemToneMap[aiRaw]]}`}
              >
                {aiRaw}
              </span>
            );
          })()}
        </td>
        <td className="pl-1 pr-2 py-1.5 print:hidden" onClick={(e) => e.stopPropagation()}>
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
      {isExpanded && (
        <tr className="bg-muted/20">
          <td colSpan={11} className="px-4 py-4 sm:px-6">
            <div className="space-y-4">
              <div className="rounded-md border border-border/70 bg-background/80 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dados completos do item
                </p>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="font-medium text-muted-foreground">Atendimento</dt>
                    <dd className="mt-0.5 break-words font-mono text-foreground">{it.attendance_number ?? "—"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-medium text-muted-foreground">Paciente</dt>
                    <dd className="mt-0.5 break-words text-foreground">{paciente}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-medium text-muted-foreground">Convênio</dt>
                    <dd className="mt-0.5 break-words text-foreground">{convenio}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="font-medium text-muted-foreground">TUSS</dt>
                    <dd className="mt-0.5 break-words font-mono text-foreground">{it.procedure_code ?? "—"}</dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
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
                  <div className="min-w-0 sm:col-span-2 lg:col-span-4">
                    <dt className="font-medium text-muted-foreground">Descrição</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">{it.description ?? "—"}</dd>
                  </div>
                  {firstRuleLabel && (
                    <div className="min-w-0 sm:col-span-2 lg:col-span-4">
                      <dt className="font-medium text-muted-foreground">Regra vinculada</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
                        {(matchedRuleObjs.length ? matchedRuleObjs.map((r) => r.name) : matchedNames).join(" · ")}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(alerts.length > 0 || it.ai_findings?.calculation_explanation || engine || expectedAmount != null) && (
                  <div className="md:col-span-2 space-y-2">
                    {(engine || expectedAmount != null) && (
                      <div className="rounded-md border border-border/70 bg-background/80 p-2.5 text-xs space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">
                            Motor
                          </span>
                          {priority && (
                            <span
                              className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES[RULE_MATCH_PRIORITY_TONES[priority]]}`}
                              title="Nível de precedência da regra escolhida"
                            >
                              {RULE_MATCH_PRIORITY_LABELS[priority]}
                            </span>
                          )}
                          {calcTypeLabel && (
                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.muted}`}>
                              {calcTypeLabel}
                            </span>
                          )}
                          {expectedAmount != null && (
                            <span className="ml-auto tabular-nums text-foreground">
                              esperado: <strong>{formatCurrency(expectedAmount)}</strong>
                              {diffPct != null && (
                                <span
                                  className={`ml-1 ${
                                    Math.abs(diffPct) > 0.01 ? "text-warning-foreground" : "text-muted-foreground"
                                  }`}
                                >
                                  ({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {engine?.ai_note && (
                          <p className="text-muted-foreground italic">IA: {engine.ai_note}</p>
                        )}
                      </div>
                    )}
                    {alerts.length > 0 && (
                      <ul className="text-xs text-warning-foreground space-y-0.5">
                        {alerts.map((a, i) => (
                          <li key={i}>⚠ {a}</li>
                        ))}
                      </ul>
                    )}
                    {it.ai_findings?.calculation_explanation && (
                      <div className="text-xs text-muted-foreground italic">
                        {it.ai_findings.calculation_explanation}
                      </div>
                    )}
                  </div>
                )}
                {showExceptionAction && (
                  <div className="md:col-span-2 rounded-md border border-border/70 bg-background/80 p-3">
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
                    <ul className="space-y-2 max-h-48 overflow-y-auto">
                      {itemObs.map((o) => (
                        <li key={o.id} className="text-xs">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span
                              className={`inline-flex rounded-full border px-1.5 py-0.5 uppercase tracking-wide ${authorBadgeClass(o.author_type)}`}
                            >
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
            </div>
          </td>
        </tr>
      )}
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
    </Fragment>
  );
};