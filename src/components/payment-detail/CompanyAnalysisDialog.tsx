import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertBanner } from "./AlertBanner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns3,
  FileText,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
  ExternalLink,
} from "lucide-react";
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
  GroupRow,
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";
import { Link, useParams } from "react-router-dom";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: GroupRow;
  items: PaymentItemRowData[];
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations?: ObservationRow[];
  // Permissões e ações de fluxo (footer sticky)
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
  /** "Voltar ao lote" — fecha o dialog e (opcionalmente) navega. Por padrão, fecha. */
  onBackToBatch?: () => void;
};

/**
 * Análise de empresa em modo planilha — dialog full-screen.
 * - Tabela densa estilo Excel
 * - Linha expansível mostra: alerta, regra, explicação IA, valor esperado
 * - Sem navegação para outra rota; mantém contexto do lote
 */

// Colunas opcionais com toggle de visibilidade. Obrigatórias (Paciente, Médico,
// TUSS, Valor, Esperado, Status) ficam sempre visíveis.
type OptionalColKey =
  | "atendimento"
  | "convenio"
  | "via"
  | "funcao"
  | "procedimento"
  | "regra"
  | "diferenca"
  | "observacao";

const OPTIONAL_COLUMNS: { key: OptionalColKey; label: string }[] = [
  { key: "atendimento", label: "Atendimento" },
  { key: "convenio", label: "Convênio" },
  { key: "via", label: "Via de acesso" },
  { key: "funcao", label: "Função" },
  { key: "procedimento", label: "Procedimento" },
  { key: "regra", label: "Regra aplicada" },
  { key: "diferenca", label: "Diferença" },
  { key: "observacao", label: "Observação" },
];

const COLUMN_PREFS_KEY = "companyAnalysis.columnVisibility.v1";
const DEFAULT_COL_VISIBILITY: Record<OptionalColKey, boolean> = {
  atendimento: true,
  convenio: true,
  via: false,
  funcao: false,
  procedimento: true,
  regra: false,
  diferenca: false,
  observacao: false,
};

export function CompanyAnalysisDialog({
  open,
  onOpenChange,
  group,
  items,
  rulesIndex,
  rulesByName,
  observations = [],
}: Props) {
  const { id } = useParams<{ id: string }>();
  const gStatus = group.status as PaymentStatus;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [patientFilter, setPatientFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [convenioFilter, setConvenioFilter] = useState<string>("__all__");
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  // Visibilidade de colunas opcionais — persistida em localStorage
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
  }, [colVis]);
  const toggleCol = (k: OptionalColKey) =>
    setColVis((v) => ({ ...v, [k]: !v[k] }));

  const getConvenio = (it: PaymentItemRowData): string => {
    const raw = (it.raw_data ?? {}) as Record<string, unknown>;
    const v =
      (it as unknown as { agreement_text?: string | null }).agreement_text ??
      (raw["Convênio"] ?? raw["Convenio"] ?? raw["convenio"] ?? raw["convênio"]);
    return v != null && String(v).trim() !== "" ? String(v) : "—";
  };

  useEffect(() => {
    if (!open) {
      setExpanded(new Set());
      setActiveId(null);
      setFilter("");
      setPatientFilter("");
      setDoctorFilter("__all__");
      setStatusFilter("__all__");
      setConvenioFilter("__all__");
      setOnlyAlerts(false);
    }
  }, [open]);

  const toggleRow = (itId: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(itId)) n.delete(itId);
      else n.add(itId);
      return n;
    });
    setActiveId(itId);
  };

  // Listas únicas para os selects
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
    return items.filter((it) => {
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
      if (onlyAlerts && alerts.length === 0 && it.ai_status !== "reprovado" && it.ai_status !== "alerta") return false;
      if (statusFilter !== "__all__" && eff !== statusFilter) return false;
      if (doctorFilter !== "__all__" && (it.doctor_name ?? "") !== doctorFilter) return false;
      if (convenioFilter !== "__all__" && getConvenio(it) !== convenioFilter) return false;
      const raw = (it.raw_data ?? {}) as Record<string, unknown>;
      const paciente =
        (it.patient_name as string | null) ?? ((raw["Paciente"] ?? raw["paciente"]) as string | null) ?? "";
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
    });
  }, [items, filter, patientFilter, doctorFilter, statusFilter, convenioFilter, onlyAlerts, gStatus]);

  const counts = useMemo(() => {
    const c = { alerta: 0, critico: 0, total: items.length };
    for (const it of items) {
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (it.ai_status === "reprovado") c.critico += 1;
      else if (alerts.length > 0 || it.ai_status === "alerta") c.alerta += 1;
    }
    return c;
  }, [items]);

  // Navegação por teclado entre linhas (j/k, setas)
  useEffect(() => {
    if (!open) return;
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
        toggleRow(activeId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, activeId, filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-screen h-screen p-0 gap-0 sm:rounded-none border-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3 bg-background">
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
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Toolbar */}
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
              <SelectItem value="seguido">Seguido</SelectItem>
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
          <Button
            size="sm"
            variant={onlyAlerts ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setOnlyAlerts((v) => !v)}
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Só com alertas
          </Button>
          {(filter || patientFilter || doctorFilter !== "__all__" || statusFilter !== "__all__" || convenioFilter !== "__all__" || onlyAlerts) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setFilter(""); setPatientFilter("");
                setDoctorFilter("__all__"); setStatusFilter("__all__"); setConvenioFilter("__all__");
                setOnlyAlerts(false);
              }}
            >
              Limpar
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
          <Badge variant="secondary">
            {filtered.length} de {counts.total}
          </Badge>
        </div>

        {/* Tabela / Lista */}
        <div className="flex-1 overflow-hidden bg-background">
          <div className="h-full w-full overflow-y-auto overflow-x-hidden">

          {/* MOBILE — lista de cards empilhados (< md) */}
          <ul className="md:hidden divide-y">
            {filtered.length === 0 && (
              <li className="text-center py-8 text-muted-foreground text-xs">Nenhum item para exibir.</li>
            )}
            {filtered.map((it) => {
              const raw = (it.raw_data ?? {}) as Record<string, unknown>;
              const paciente =
                (it.patient_name as string | null) ??
                ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
                "—";
              const expected = it.ai_findings?.expected_amount;
              const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
              const tone: keyof typeof TONE_CLASSES =
                eff === "reprovado" ? "destructive"
                : eff === "alerta" ? "warning"
                : eff === "aprovado" || eff === "seguido" ? "success"
                : "muted";
              const alerts = (it.ai_findings?.alerts ?? []) as string[];
              const isOpen = expanded.has(it.id);
              const isActive = activeId === it.id;
              const isCritical = eff === "reprovado";
              const hasAlert = alerts.length > 0;
              const convenio =
                (it as unknown as { agreement_text?: string | null }).agreement_text ??
                (() => {
                  for (const k of ["Convênio", "Convenio", "convenio", "convênio"]) {
                    const v = raw[k];
                    if (v != null && String(v).trim() !== "") return String(v);
                  }
                  return "—";
                })();
              const diverges = expected != null && Math.abs(Number(expected) - Number(it.gross_amount ?? 0)) > 0.01;
              return (
                <li
                  key={it.id}
                  className={cn(
                    "px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors",
                    isActive && "bg-primary/5",
                    isCritical && "bg-destructive/5",
                    !isCritical && hasAlert && "bg-warning-soft/30",
                  )}
                  onClick={() => toggleRow(it.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className="text-muted-foreground pt-0.5">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[13px] truncate">{paciente}</p>
                        <span className={cn("ml-auto inline-flex rounded-full border px-1.5 py-0.5 text-[9px] uppercase shrink-0", TONE_CLASSES[tone])}>
                          {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-0.5 inline" />}
                          {eff}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        <span className="font-mono">{it.procedure_code ?? "—"}</span>
                        {" · "}
                        {it.procedure_name ?? it.description ?? "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {it.doctor_name ?? "—"}
                        {it.doctor_role ? <span> · {it.doctor_role}</span> : null}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                        {it.attendance_number && (
                          <span className="text-muted-foreground">
                            Atend. <span className="font-mono text-foreground">{it.attendance_number}</span>
                          </span>
                        )}
                        {it.access_route && (
                          <span className="text-muted-foreground">Via: <span className="text-foreground">{it.access_route}</span></span>
                        )}
                        {convenio && convenio !== "—" && (
                          <span className="text-muted-foreground truncate max-w-[60%]">Conv.: <span className="text-foreground">{convenio}</span></span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="tabular-nums font-medium">{formatCurrency(Number(it.gross_amount ?? 0))}</span>
                        {expected != null && (
                          <span className={cn("tabular-nums text-[11px]", diverges ? "text-warning-foreground" : "text-muted-foreground")}>
                            esp. {formatCurrency(Number(expected))}
                          </span>
                        )}
                      </div>
                      {isOpen && (
                        <div className="mt-2 -mx-1">
                          <div className="rounded-md border bg-background overflow-hidden">
                            <table className="w-full"><tbody>
                              <ItemDetailsRow
                                it={it}
                                rulesIndex={rulesIndex}
                                rulesByName={rulesByName}
                                observations={observations}
                              />
                            </tbody></table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* DESKTOP/TABLET — tabela densa (>= md) */}
          <table className="hidden md:table w-full text-[11px] border-collapse table-fixed">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className="border-b">
                <th className="w-6 px-1.5 py-1.5"></th>
                {colVis.atendimento && <th className="px-1.5 py-1.5 text-left font-medium">Atend.</th>}
                <th className="px-1.5 py-1.5 text-left font-medium">Paciente</th>
                {colVis.convenio && <th className="px-1.5 py-1.5 text-left font-medium">Convênio</th>}
                {colVis.via && <th className="px-1.5 py-1.5 text-left font-medium">Via</th>}
                <th className="px-1.5 py-1.5 text-left font-medium">TUSS</th>
                {colVis.procedimento && <th className="px-1.5 py-1.5 text-left font-medium">Procedimento</th>}
                <th className="px-1.5 py-1.5 text-left font-medium">Médico</th>
                {colVis.funcao && <th className="px-1.5 py-1.5 text-left font-medium">Função</th>}
                {colVis.regra && <th className="px-1.5 py-1.5 text-left font-medium">Regra</th>}
                <th className="px-1.5 py-1.5 text-right font-medium">Valor</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Esperado</th>
                {colVis.diferenca && <th className="px-1.5 py-1.5 text-right font-medium">Diferença</th>}
                <th className="px-1.5 py-1.5 text-left font-medium">Status</th>
                {colVis.observacao && <th className="px-1.5 py-1.5 text-left font-medium">Obs.</th>}
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
              {filtered.map((it) => {
                const raw = (it.raw_data ?? {}) as Record<string, unknown>;
                const paciente =
                  (it.patient_name as string | null) ??
                  ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
                  "—";
                const expected = it.ai_findings?.expected_amount;
                const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
                const tone: keyof typeof TONE_CLASSES =
                  eff === "reprovado"
                    ? "destructive"
                    : eff === "alerta"
                    ? "warning"
                    : eff === "aprovado" || eff === "seguido"
                    ? "success"
                    : "muted";
                const alerts = (it.ai_findings?.alerts ?? []) as string[];
                const isOpen = expanded.has(it.id);
                const isActive = activeId === it.id;
                const isCritical = eff === "reprovado";
                const obsCount = observations.filter((o) => o.item_id === it.id).length;

                return (
                  <tr key={it.id} className="contents">
                    <RowMain
                      it={it}
                      paciente={paciente}
                      expected={expected ?? null}
                      eff={eff}
                      tone={tone}
                      isOpen={isOpen}
                      isActive={isActive}
                      isCritical={isCritical}
                      hasAlert={alerts.length > 0}
                      onToggle={() => toggleRow(it.id)}
                      colVis={colVis}
                      rulesIndex={rulesIndex}
                      rulesByName={rulesByName}
                      obsCount={obsCount}
                    />
                    {isOpen && (
                      <ItemDetailsRow
                        it={it}
                        rulesIndex={rulesIndex}
                        rulesByName={rulesByName}
                        observations={observations}
                      />
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        <div className="border-t px-4 py-1.5 text-[10px] text-muted-foreground bg-muted/20">
          Use ↑/↓ ou j/k para navegar · Enter para expandir
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowMain({
  it,
  paciente,
  expected,
  eff,
  tone,
  isOpen,
  isActive,
  isCritical,
  hasAlert,
  onToggle,
  colVis,
  rulesIndex,
  rulesByName,
  obsCount,
}: {
  it: PaymentItemRowData;
  paciente: string;
  expected: number | null;
  eff: ItemAiStatus | "seguido";
  tone: keyof typeof TONE_CLASSES;
  isOpen: boolean;
  isActive: boolean;
  isCritical: boolean;
  hasAlert: boolean;
  onToggle: () => void;
  colVis: Record<OptionalColKey, boolean>;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  obsCount: number;
}) {
  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const pickRaw = (...keys: string[]): string => {
    for (const k of keys) {
      const v = raw[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "—";
  };
  const convenio =
    (it as unknown as { agreement_text?: string | null }).agreement_text ??
    pickRaw("Convênio", "Convenio", "convenio", "convênio");
  const grossN = Number(it.gross_amount ?? 0);
  const expN = expected != null ? Number(expected) : null;
  const diff = expN != null ? expN - grossN : null;
  const diverges = diff != null && Math.abs(diff) > 0.01;

  // Regra aplicada (nome curto)
  const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
  const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
  let ruleName = "—";
  if (matchedIds[0] && rulesIndex[matchedIds[0]]) ruleName = rulesIndex[matchedIds[0]].name;
  else if (matchedNames[0]) {
    const r = rulesByName[String(matchedNames[0]).trim().toLowerCase()];
    ruleName = r?.name ?? matchedNames[0];
  }

  return (
    <tr
      onClick={onToggle}
      className={cn(
        "border-b cursor-pointer hover:bg-muted/40 transition-colors",
        isActive && "bg-primary/5",
        isCritical && "bg-destructive/5",
        !isCritical && hasAlert && "bg-warning-soft/30",
      )}
    >
      <td className="px-1.5 py-1 text-muted-foreground">
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </td>
      {colVis.atendimento && (
        <td className="px-1.5 py-1 truncate font-mono text-[10px]" title={it.attendance_number ?? ""}>
          {it.attendance_number ?? "—"}
        </td>
      )}
      <td className="px-1.5 py-1 truncate" title={paciente}>{paciente}</td>
      {colVis.convenio && (
        <td className="px-1.5 py-1 truncate" title={typeof convenio === "string" ? convenio : ""}>
          {convenio}
        </td>
      )}
      {colVis.via && (
        <td className="px-1.5 py-1 truncate" title={it.access_route ?? ""}>{it.access_route ?? "—"}</td>
      )}
      <td className="px-1.5 py-1 font-mono text-[10px] truncate">{it.procedure_code ?? "—"}</td>
      {colVis.procedimento && (
        <td className="px-1.5 py-1 text-muted-foreground truncate" title={it.procedure_name ?? it.description ?? ""}>
          {it.procedure_name ?? it.description ?? "—"}
        </td>
      )}
      <td className="px-1.5 py-1 truncate" title={it.doctor_name ?? ""}>{it.doctor_name}</td>
      {colVis.funcao && (
        <td className="px-1.5 py-1 truncate" title={it.doctor_role ?? ""}>{it.doctor_role ?? "—"}</td>
      )}
      {colVis.regra && (
        <td className="px-1.5 py-1 truncate text-muted-foreground" title={ruleName}>{ruleName}</td>
      )}
      <td className="px-1.5 py-1 text-right tabular-nums font-medium whitespace-nowrap">
        {formatCurrency(grossN)}
      </td>
      <td
        className={cn(
          "px-1.5 py-1 text-right tabular-nums whitespace-nowrap",
          diverges ? "text-warning-foreground" : "text-muted-foreground",
        )}
      >
        {expN != null ? formatCurrency(expN) : "—"}
      </td>
      {colVis.diferenca && (
        <td
          className={cn(
            "px-1.5 py-1 text-right tabular-nums whitespace-nowrap",
            diff != null && diverges ? (diff < 0 ? "text-warning-foreground" : "text-success") : "text-muted-foreground",
          )}
        >
          {diff != null ? `${diff > 0 ? "+" : ""}${formatCurrency(diff)}` : "—"}
        </td>
      )}
      <td className="px-1.5 py-1">
        <span className={cn("inline-flex rounded-full border px-1 py-0.5 text-[9px]", TONE_CLASSES[tone])}>
          {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-0.5 inline" />}
          {eff}
        </span>
      </td>
      {colVis.observacao && (
        <td className="px-1.5 py-1 text-center text-[10px] text-muted-foreground">
          {obsCount > 0 ? obsCount : "—"}
        </td>
      )}
    </tr>
  );
}

function ItemDetailsRow({
  it,
  rulesIndex,
  rulesByName,
  observations,
}: {
  it: PaymentItemRowData;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations: ObservationRow[];
}) {
  const alerts = (it.ai_findings?.alerts ?? []) as string[];
  const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
  const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
  const seen = new Set<string>();
  const matchedRules: RuleLite[] = [];
  matchedIds.forEach((rid) => {
    const r = rulesIndex[rid];
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      matchedRules.push(r);
    }
  });
  matchedNames.forEach((nm) => {
    const r = rulesByName[String(nm).trim().toLowerCase()];
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      matchedRules.push(r);
    }
  });
  const isCritical = it.ai_status === "reprovado";
  const expected = it.ai_findings?.expected_amount;
  const explanation = it.ai_findings?.calculation_explanation;
  const engine = it.ai_findings?.engine ?? null;
  const aiNote = engine?.ai_note;
  const diff =
    expected != null ? Number(expected) - Number(it.gross_amount ?? 0) : null;
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
  };
  const exceptionMarked = !!itemAny.authorized_exception;
  const itemObs = observations.filter((o) => o.item_id === it.id);

  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const pickRaw = (...keys: string[]): string => {
    for (const k of keys) {
      const v = raw[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "—";
  };
  const paciente =
    (it.patient_name as string | null) ??
    ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
    "—";
  const convenio =
    (it as unknown as { agreement_text?: string | null }).agreement_text ??
    pickRaw("Convênio", "Convenio", "convenio", "convênio");
  const summary: { label: string; value: string }[] = [
    { label: "Atendimento", value: it.attendance_number ?? "—" },
    { label: "Paciente", value: paciente },
    { label: "Convênio", value: String(convenio ?? "—") },
    { label: "Via de Acesso", value: it.access_route ?? "—" },
    { label: "TUSS", value: it.procedure_code ?? "—" },
    { label: "Procedimento", value: it.procedure_name ?? it.description ?? "—" },
    { label: "Médico", value: it.doctor_name ?? "—" },
    { label: "Função", value: it.doctor_role ?? "—" },
  ];

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return String(d);
    }
  };

  return (
    <tr className="border-b bg-muted/20">
      <td colSpan={12} className="px-4 py-3">
        {/* Linha 1 — Resumo dos campos da planilha */}
        <div className="mb-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-[11px]">
          {summary.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="truncate" title={s.value}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* COL 1 — Alertas e Exceção */}
          <div className="space-y-2">
            {alerts.length > 0 && (
              <AlertBanner
                severity={isCritical ? "critico" : "alerta"}
                title={
                  isCritical
                    ? "Item reprovado pela análise"
                    : alerts.length === 1
                    ? "Alerta"
                    : `${alerts.length} alertas`
                }
              >
                <ul className="space-y-0.5 list-disc pl-4">
                  {alerts.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </AlertBanner>
            )}
            {alerts.length === 0 && !isCritical && (
              <AlertBanner severity="informativo" title="Sem alertas">
                <p>Item sem divergências detectadas pela análise.</p>
              </AlertBanner>
            )}
            {exceptionMarked && (
              <div className="rounded-md border border-info/20 bg-info-soft px-2.5 py-2 text-xs text-info">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Exceção autorizada registrada
                </div>
                <p className="mt-1 text-[11px]">
                  Motivo: <strong>{itemAny.exception_reason ?? "—"}</strong> · Autorizador:{" "}
                  <strong>{itemAny.exception_authorizer ?? "—"}</strong>
                </p>
                {itemAny.exception_note && (
                  <p className="mt-1 italic text-[11px] whitespace-pre-wrap">"{itemAny.exception_note}"</p>
                )}
              </div>
            )}

            {/* Histórico do item */}
            <div className="rounded-md border bg-background p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Histórico deste item ({itemObs.length})
              </p>
              {itemObs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Sem comentários ainda.</p>
              ) : (
                <ul className="space-y-1.5 max-h-40 overflow-y-auto text-[11px]">
                  {itemObs.map((o) => (
                    <li key={o.id} className="border-b border-border/40 pb-1 last:border-0">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
                        <span className="uppercase tracking-wide rounded px-1 py-0.5 bg-muted">
                          {o.author_type}
                        </span>
                        <span className="ml-auto">{fmtDate(o.created_at)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap">{o.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* COL 2 — Regra, motor e IA */}
          <div className="space-y-2 text-xs">
            {matchedRules.length > 0 ? (
              <div className="rounded-md border bg-background p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Regra aplicada
                </p>
                <p className="font-medium text-primary">{matchedRules[0].name}</p>
                {matchedRules[0].rule_text && (
                  <p className="mt-1 text-muted-foreground whitespace-pre-wrap leading-snug">
                    {matchedRules[0].rule_text}
                  </p>
                )}
                {matchedRules.length > 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground italic">
                    + {matchedRules.length - 1} regra(s) também casaram
                  </p>
                )}
              </div>
            ) : matchedNames.length > 0 ? (
              <div className="rounded-md border bg-background p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Regra aplicada
                </p>
                <p className="font-medium">{matchedNames[0]}</p>
              </div>
            ) : null}

            {/* Detalhes do cálculo (motor) */}
            {(engine || expected != null || explanation) && (
              <div className="rounded-md border bg-background p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Detalhes do cálculo
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  {priority && (
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-1.5 py-0.5 text-[10px]",
                        TONE_CLASSES[RULE_MATCH_PRIORITY_TONES[priority]],
                      )}
                    >
                      {RULE_MATCH_PRIORITY_LABELS[priority]}
                    </span>
                  )}
                  {calcTypeLabel && (
                    <span className={cn("inline-flex rounded-full border px-1.5 py-0.5 text-[10px]", TONE_CLASSES.muted)}>
                      {calcTypeLabel}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">Valor informado: </span>
                    <span className="tabular-nums font-medium">{formatCurrency(Number(it.gross_amount ?? 0))}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Valor esperado: </span>
                    <span className="tabular-nums font-medium">
                      {expected != null ? formatCurrency(Number(expected)) : "—"}
                    </span>
                  </div>
                  {diff != null && Math.abs(diff) > 0.01 && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Diferença: </span>
                      <span className={cn("tabular-nums", diff < 0 ? "text-warning-foreground" : "text-success")}>
                        {diff > 0 ? "+" : ""}{formatCurrency(diff)}
                        {diffPct != null && (
                          <span className="ml-1">({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                {explanation && (
                  <p className="mt-1.5 text-muted-foreground italic leading-snug">{explanation}</p>
                )}
              </div>
            )}

            {/* IA */}
            {aiNote && (
              <div className="rounded-md border bg-background p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Explicação sugerida (IA)
                </p>
                <p className="text-muted-foreground italic leading-snug">{aiNote}</p>
              </div>
            )}

            {diff != null && Math.abs(diff) > 0.01 && expected != null && (
              <div className="rounded-md border border-warning/30 bg-warning-soft/40 p-2.5 text-[11px]">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Sugestão de ajuste:{" "}
                </span>
                Ajustar valor para <strong>{formatCurrency(Number(expected))}</strong>.
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
