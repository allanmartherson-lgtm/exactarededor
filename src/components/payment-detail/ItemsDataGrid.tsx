import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "./AlertBanner";
import {
  AlertTriangle,
  Columns3,
  FileText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";
import { getAgreement, getPatient, getAccessRoute, getProcedureCode, getProcedureName, getDoctorRole } from "@/lib/itemFields";

/**
 * Data grid compartilhado de itens de uma empresa dentro de um lote.
 * Usado tanto pelo CompanyAnalysisDialog (modal habitual) quanto pela
 * página dedicada CompanyAnalysis. Garante hierarquia tipográfica,
 * mapeamento header-based de convênio/paciente, expandable row e
 * controles de densidade idênticos nos dois lugares.
 */

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

type Density = "compact" | "comfortable";

export type ItemsDataGridProps = {
  items: PaymentItemRowData[];
  groupStatus: PaymentStatus;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations?: ObservationRow[];
  /** Chave de persistência das preferências de coluna/densidade. */
  storageKey?: string;
  /** Mostra a toolbar de filtros + colunas + densidade. */
  showToolbar?: boolean;
  /** Mostra rodapé com dicas de teclado. */
  showKeyboardHint?: boolean;
  className?: string;
};

export function ItemsDataGrid({
  items,
  groupStatus,
  rulesIndex,
  rulesByName,
  observations = [],
  storageKey = "itemsDataGrid.default",
  showToolbar = true,
  showKeyboardHint = true,
  className,
}: ItemsDataGridProps) {
  const COLUMN_PREFS_KEY = `${storageKey}.columnVisibility.v1`;
  const DENSITY_PREFS_KEY = `${storageKey}.density.v1`;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [filter, setFilter] = useState("");
  const [patientFilter, setPatientFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [convenioFilter, setConvenioFilter] = useState<string>("__all__");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);

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
  const headPad = isCompact ? "px-1.5 py-1" : "px-2 py-2";
  const tableTextSize = isCompact ? "text-[12px]" : "text-[13px]";

  const getConvenio = getAgreement;

  const selectRow = (itId: string) => setActiveId(itId);
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
    return items.filter((it) => {
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
      const needsReview = !!(it.ai_findings as { needs_human_review?: boolean } | null)?.needs_human_review;
      if (onlyAlerts && alerts.length === 0 && it.ai_status !== "reprovado" && it.ai_status !== "alerta") return false;
      if (onlyNeedsReview && !needsReview) return false;
      if (statusFilter !== "__all__" && eff !== statusFilter) return false;
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
    });
  }, [items, filter, patientFilter, doctorFilter, statusFilter, convenioFilter, onlyAlerts, onlyNeedsReview, groupStatus]);

  const needsReviewCount = useMemo(
    () => items.filter((it) => !!(it.ai_findings as { needs_human_review?: boolean } | null)?.needs_human_review).length,
    [items],
  );

  const counts = useMemo(() => {
    const c = { alerta: 0, critico: 0, total: items.length };
    for (const it of items) {
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (it.ai_status === "reprovado") c.critico += 1;
      else if (alerts.length > 0 || it.ai_status === "alerta") c.alerta += 1;
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

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
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
          {(filter || patientFilter || doctorFilter !== "__all__" || statusFilter !== "__all__" || convenioFilter !== "__all__" || onlyAlerts || onlyNeedsReview) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setFilter(""); setPatientFilter("");
                setDoctorFilter("__all__"); setStatusFilter("__all__"); setConvenioFilter("__all__");
                setOnlyAlerts(false); setOnlyNeedsReview(false);
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
          <Badge variant="secondary">
            {filtered.length} de {counts.total}
          </Badge>
        </div>
      )}

      {/* Tabela / Lista */}
      <div className="flex-1 min-h-0 overflow-hidden bg-background isolate">
        <div className="h-full w-full overflow-auto isolate">
          {/* MOBILE — lista de cards (< md) */}
          <ul className="md:hidden divide-y">
            {filtered.length === 0 && (
              <li className="text-center py-8 text-muted-foreground text-xs">Nenhum item para exibir.</li>
            )}
            {filtered.map((it) => {
              const paciente = getPatient(it);
              const expected = it.ai_findings?.expected_amount;
              const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
              const tone: keyof typeof TONE_CLASSES =
                eff === "reprovado" ? "destructive"
                : eff === "alerta" ? "warning"
                : eff === "aprovado" || eff === "seguido" ? "success"
                : "muted";
              const alerts = (it.ai_findings?.alerts ?? []) as string[];
              const isActive = activeId === it.id;
              const isCritical = eff === "reprovado";
              const hasAlert = alerts.length > 0;
              const diverges = expected != null && Math.abs(Number(expected) - Number(it.gross_amount ?? 0)) > 0.01;
              return (
                <li
                  key={it.id}
                  className={cn(
                    "px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors",
                    isActive && "bg-primary/10 ring-1 ring-inset ring-primary/30",
                    !isActive && isCritical && "bg-destructive/5",
                    !isActive && !isCritical && hasAlert && "bg-warning-soft/30",
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
                      {" · "}
                      {it.procedure_name ?? it.description ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{it.doctor_name ?? "—"}</p>
                    <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="tabular-nums font-medium">{formatCurrency(Number(it.gross_amount ?? 0))}</span>
                      {expected != null && (
                        <span className={cn("tabular-nums text-[11px]", diverges ? "text-warning-foreground" : "text-muted-foreground")}>
                          esp. {formatCurrency(Number(expected))}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* DESKTOP/TABLET — tabela densa (>= md) */}
          <table
            data-density={isCompact ? "compact" : "comfortable"}
            className={cn("hidden md:table w-max min-w-full border-separate border-spacing-0", tableTextSize)}
          >
            <thead className="sticky top-0 z-20 bg-muted text-muted-foreground">
              <tr>
                {colVis.atendimento && <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Atend.</th>}
                <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap sticky left-0 z-30 min-w-[180px]")}>Paciente</th>
                {colVis.convenio && <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Convênio</th>}
                {colVis.via && <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Via</th>}
                <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>TUSS</th>
                <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap sticky left-[180px] z-30 min-w-[200px]")}>Procedimento</th>
                <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap sticky left-[380px] z-30 min-w-[160px] shadow-[1px_0_0_0_hsl(var(--border))]")}>Médico</th>
                {colVis.funcao && <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Função</th>}
                {colVis.regra && <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Regra</th>}
                <th className={cn(headPad, "text-right font-medium border-b bg-muted whitespace-nowrap")}>Valor</th>
                <th className={cn(headPad, "text-right font-medium border-b bg-muted whitespace-nowrap")}>Esperado</th>
                {colVis.diferenca && <th className={cn(headPad, "text-right font-medium border-b bg-muted whitespace-nowrap")}>Diferença</th>}
                <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Status</th>
                {colVis.observacao && <th className={cn(headPad, "text-left font-medium border-b bg-muted whitespace-nowrap")}>Obs.</th>}
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
                const paciente = getPatient(it);
                const expected = it.ai_findings?.expected_amount;
                const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, groupStatus);
                const tone: keyof typeof TONE_CLASSES =
                  eff === "reprovado"
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
                  6 + 1 +
                  (colVis.atendimento ? 1 : 0) +
                  (colVis.convenio ? 1 : 0) +
                  (colVis.via ? 1 : 0) +
                  (colVis.funcao ? 1 : 0) +
                  (colVis.regra ? 1 : 0) +
                  (colVis.diferenca ? 1 : 0) +
                  (colVis.observacao ? 1 : 0);
                const isExpanded = expandedId === it.id;
                return (
                  <RowMain
                    key={it.id}
                    it={it}
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
                    obsCount={obsCount}
                    isCompact={isCompact}
                    totalCols={totalCols}
                  />
                );
              })}
            </tbody>
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

function RowMain({
  it,
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
  obsCount,
  isCompact,
  totalCols,
}: {
  it: PaymentItemRowData;
  paciente: string;
  expected: number | null;
  eff: ItemAiStatus | "seguido";
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
  obsCount: number;
  isCompact: boolean;
  totalCols: number;
}) {
  const convenio = getAgreement(it);
  const grossN = Number(it.gross_amount ?? 0);
  const expN = expected != null ? Number(expected) : null;
  const diff = expN != null ? expN - grossN : null;
  const diverges = diff != null && Math.abs(diff) > 0.01;

  const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
  const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
  let ruleName = "—";
  if (matchedIds[0] && rulesIndex[matchedIds[0]]) ruleName = rulesIndex[matchedIds[0]].name;
  else if (matchedNames[0]) {
    const r = rulesByName[String(matchedNames[0]).trim().toLowerCase()];
    ruleName = r?.name ?? matchedNames[0];
  }

  const baseCellBg = isExpanded
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
  const cellPad = isCompact ? "px-1.5 py-0.5" : "px-2 py-2";
  const stickyCell = cn(cellPad, "truncate border-b sticky z-10", stickyBg, stickyHover);
  const cell = cn(cellPad, "truncate border-b whitespace-nowrap");

  return (
    <>
      <tr
        onClick={() => { onSelect(); onOpen(); }}
        data-row-id={it.id}
        aria-selected={isActive}
        aria-expanded={isExpanded}
        tabIndex={-1}
        className={cn(
          "group cursor-pointer hover:bg-muted/40 transition-colors",
          isExpanded && "ring-1 ring-inset ring-primary/40",
        )}
      >
        {colVis.atendimento && (
          <td className={cn(cell, "font-mono text-[10px]", baseCellBg)} title={it.attendance_number ?? ""}>
            {it.attendance_number ?? "—"}
          </td>
        )}
        <td className={cn(stickyCell, "left-0 min-w-[180px]")} title={paciente}>
          <span className="truncate block">{paciente}</span>
        </td>
        {colVis.convenio && (
          <td className={cn(cell, "text-muted-foreground", baseCellBg)} title={typeof convenio === "string" ? convenio : ""}>
            {convenio}
          </td>
        )}
        {colVis.via && (
          <td className={cn(cell, baseCellBg)} title={it.access_route ?? ""}>{it.access_route ?? "—"}</td>
        )}
        <td className={cn(cell, "font-mono text-[10px]", baseCellBg)}>{it.procedure_code ?? "—"}</td>
        <td
          className={cn(stickyCell, "left-[180px] min-w-[200px]")}
          title={it.procedure_name ?? it.description ?? ""}
        >
          <span className="truncate block">{it.procedure_name ?? it.description ?? "—"}</span>
        </td>
        <td
          className={cn(stickyCell, "left-[380px] min-w-[160px] shadow-[1px_0_0_0_hsl(var(--border))]")}
          title={it.doctor_name ?? ""}
        >
          <span className="truncate block">{it.doctor_name}</span>
        </td>
        {colVis.funcao && (
          <td className={cn(cell, "text-muted-foreground", baseCellBg)} title={it.doctor_role ?? ""}>{it.doctor_role ?? "—"}</td>
        )}
        {colVis.regra && (
          <td className={cn(cell, "text-muted-foreground", baseCellBg)} title={ruleName}>{ruleName}</td>
        )}
        <td className={cn("px-1.5 py-1 text-right tabular-nums font-medium whitespace-nowrap border-b", baseCellBg)}>
          {formatCurrency(grossN)}
        </td>
        <td
          className={cn(
            "px-1.5 py-1 text-right tabular-nums whitespace-nowrap border-b font-medium",
            diverges ? "text-warning-foreground" : "text-foreground",
            baseCellBg,
          )}
        >
          {expN != null ? formatCurrency(expN) : "—"}
        </td>
        {colVis.diferenca && (
          <td
            className={cn(
              "px-1.5 py-1 text-right tabular-nums whitespace-nowrap border-b",
              diff != null && diverges ? (diff < 0 ? "text-warning-foreground" : "text-success") : "text-muted-foreground",
              baseCellBg,
            )}
          >
            {diff != null ? `${diff > 0 ? "+" : ""}${formatCurrency(diff)}` : "—"}
          </td>
        )}
        <td className={cn("px-1.5 py-1 border-b", baseCellBg)}>
          <span className={cn("inline-flex rounded-full border px-1 py-0.5 text-[9px]", TONE_CLASSES[tone])}>
            {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-0.5 inline" />}
            {eff}
          </span>
        </td>
        {colVis.observacao && (
          <td className={cn("px-1.5 py-1 text-center text-[10px] text-muted-foreground border-b", baseCellBg)}>
            {obsCount > 0 ? obsCount : "—"}
          </td>
        )}
      </tr>
      {isExpanded && (
        <ItemDetailsRow
          it={it}
          rulesIndex={rulesIndex}
          rulesByName={rulesByName}
          observations={observations}
          colSpan={totalCols}
        />
      )}
    </>
  );
}

function ItemDetailsRow({
  it,
  rulesIndex,
  rulesByName,
  observations,
  colSpan,
}: {
  it: PaymentItemRowData;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
  observations: ObservationRow[];
  colSpan: number;
}) {
  const alerts = (it.ai_findings?.alerts ?? []) as string[];
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
  const expected = it.ai_findings?.expected_amount;
  const explanation = it.ai_findings?.calculation_explanation;
  const engine = it.ai_findings?.engine ?? null;
  const aiNote = engine?.ai_note;
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
  };
  const exceptionMarked = !!itemAny.authorized_exception;
  const itemObs = observations.filter((o) => o.item_id === it.id);

  const summary: { label: string; value: string }[] = [
    { label: "Atendimento", value: it.attendance_number ?? "—" },
    { label: "Paciente", value: getPatient(it) },
    { label: "Convênio", value: getAgreement(it) },
    { label: "Via de Acesso", value: getAccessRoute(it) },
    { label: "TUSS", value: getProcedureCode(it) },
    { label: "Procedimento", value: getProcedureName(it) },
    { label: "Médico", value: it.doctor_name ?? "—" },
    { label: "Função", value: getDoctorRole(it) },
  ];

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
    catch { return String(d); }
  };

  return (
    <tr className="border-b bg-muted/20">
      <td colSpan={colSpan} className="p-0 align-top">
        <div className="px-5 py-4 animate-accordion-down overflow-hidden" style={{ fontSize: "13px", lineHeight: 1.4 }}>
          <div
            className="mb-4 grid gap-x-4 gap-y-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          >
            {summary.map((s) => (
              <div key={s.label} className="min-w-0">
                <p className="uppercase tracking-wide text-muted-foreground" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>{s.label}</p>
                <p style={{ fontSize: "13px", lineHeight: 1.4, overflowWrap: "anywhere", wordBreak: "break-word" }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            <div className="space-y-2 min-w-0">
              {alerts.length > 0 && (
                <AlertBanner
                  severity={isCritical ? "critico" : "alerta"}
                  title={isCritical ? "Item reprovado pela análise" : alerts.length === 1 ? "Alerta" : `${alerts.length} alertas`}
                >
                  <ul className="space-y-0.5 list-disc pl-4">
                    {alerts.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </AlertBanner>
              )}
              {alerts.length === 0 && !isCritical && (
                <AlertBanner severity="informativo" title="Sem alertas">
                  <p>Item sem divergências detectadas pela análise.</p>
                </AlertBanner>
              )}
              {exceptionMarked && (
                <div className="rounded-md border border-info/20 bg-info-soft px-3 py-2.5 text-info">
                  <div className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Exceção autorizada registrada
                  </div>
                  <p className="mt-1 break-words">
                    Motivo: <strong>{itemAny.exception_reason ?? "—"}</strong> · Autorizador:{" "}
                    <strong>{itemAny.exception_authorizer ?? "—"}</strong>
                  </p>
                  {itemAny.exception_note && (
                    <p className="mt-1 italic whitespace-pre-wrap break-words">"{itemAny.exception_note}"</p>
                  )}
                </div>
              )}
              <div className="rounded-md border bg-background p-3">
                <p className="uppercase tracking-wide text-muted-foreground mb-1.5" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>
                  Histórico deste item ({itemObs.length})
                </p>
                {itemObs.length === 0 ? (
                  <p className="text-muted-foreground">Sem comentários ainda.</p>
                ) : (
                  <ul className="space-y-2 max-h-56 overflow-y-auto">
                    {itemObs.map((o) => (
                      <li key={o.id} className="border-b border-border/40 pb-1.5 last:border-0">
                        <div className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: "11px" }}>
                          <span className="uppercase tracking-wide rounded px-1 py-0.5 bg-muted">{o.author_type}</span>
                          <span className="ml-auto">{fmtDate(o.created_at)}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap break-words">{o.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="space-y-2 min-w-0">
              {matchedRules.length > 0 ? (
                <div className="rounded-md border bg-background p-3">
                  <p className="uppercase tracking-wide text-muted-foreground mb-1" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>Regra aplicada</p>
                  <p className="font-medium text-primary break-words">{matchedRules[0].name}</p>
                  {matchedRules[0].rule_text && (
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap break-words">{matchedRules[0].rule_text}</p>
                  )}
                  {matchedRules.length > 1 && (
                    <p className="mt-1 text-muted-foreground italic" style={{ fontSize: "11px" }}>
                      + {matchedRules.length - 1} regra(s) também casaram
                    </p>
                  )}
                </div>
              ) : matchedNames.length > 0 ? (
                <div className="rounded-md border bg-background p-3">
                  <p className="uppercase tracking-wide text-muted-foreground mb-1" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>Regra aplicada</p>
                  <p className="font-medium break-words">{matchedNames[0]}</p>
                </div>
              ) : (
                <div className="rounded-md border bg-background p-3 text-muted-foreground">Nenhuma regra específica casou.</div>
              )}

              {aiNote && (
                <div className="rounded-md border bg-background p-3">
                  <p className="uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>
                    <Sparkles className="h-3 w-3" /> Explicação sugerida (IA)
                  </p>
                  <p className="text-muted-foreground italic whitespace-pre-wrap break-words">{aiNote}</p>
                </div>
              )}
            </div>

            <div className="space-y-2 min-w-0">
              {(engine || expected != null || explanation) && (
                <div className="rounded-md border bg-background p-3">
                  <p className="uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>
                    <FileText className="h-3 w-3" /> Detalhes do cálculo
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {priority && (
                      <span
                        className={cn("inline-flex rounded-full border px-1.5 py-0.5", TONE_CLASSES[RULE_MATCH_PRIORITY_TONES[priority]])}
                        style={{ fontSize: "11px" }}
                      >
                        {RULE_MATCH_PRIORITY_LABELS[priority]}
                      </span>
                    )}
                    {calcTypeLabel && (
                      <span className={cn("inline-flex rounded-full border px-1.5 py-0.5", TONE_CLASSES.muted)} style={{ fontSize: "11px" }}>
                        {calcTypeLabel}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <div className="min-w-0">
                      <p className="text-muted-foreground" style={{ fontSize: "11px" }}>Valor informado</p>
                      <p className="tabular-nums font-medium break-words">{formatCurrency(Number(it.gross_amount ?? 0))}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted-foreground" style={{ fontSize: "11px" }}>Valor esperado</p>
                      <p className="tabular-nums font-medium break-words">{expected != null ? formatCurrency(Number(expected)) : "—"}</p>
                    </div>
                    {diff != null && Math.abs(diff) > 0.01 && (
                      <div className="col-span-2 min-w-0">
                        <p className="text-muted-foreground" style={{ fontSize: "11px" }}>Diferença</p>
                        <p className={cn("tabular-nums font-medium break-words", diff < 0 ? "text-warning-foreground" : "text-success")}>
                          {diff > 0 ? "+" : ""}{formatCurrency(diff)}
                          {diffPct != null && (
                            <span className="ml-1">({diffPct > 0 ? "+" : ""}{(diffPct * 100).toFixed(1)}%)</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  {explanation && (
                    <p className="mt-2 text-muted-foreground italic whitespace-pre-wrap break-words">{explanation}</p>
                  )}
                </div>
              )}

              {diff != null && Math.abs(diff) > 0.01 && expected != null && (
                <div className="rounded-md border border-warning/30 bg-warning-soft/40 p-3">
                  <p className="uppercase tracking-wide text-muted-foreground mb-1" style={{ fontSize: "11px", letterSpacing: "0.05em" }}>
                    Sugestão de ajuste
                  </p>
                  <p className="break-words">
                    Ajustar valor para <strong>{formatCurrency(Number(expected))}</strong>.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
