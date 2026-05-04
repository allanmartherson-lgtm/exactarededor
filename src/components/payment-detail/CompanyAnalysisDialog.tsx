import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertBanner } from "./AlertBanner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
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
};

/**
 * Análise de empresa em modo planilha — dialog full-screen.
 * - Tabela densa estilo Excel
 * - Linha expansível mostra: alerta, regra, explicação IA, valor esperado
 * - Sem navegação para outra rota; mantém contexto do lote
 */
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
          <Badge variant="secondary" className="ml-auto">
            {filtered.length} de {counts.total}
          </Badge>
        </div>

        {/* Tabela */}
        <div className="flex-1 overflow-hidden bg-background">
          <div className="h-full w-full overflow-y-auto overflow-x-hidden">
          <table className="w-full text-[11px] border-collapse table-fixed">
            <colgroup>
              <col className="w-6" />
              {/* Ordem segue a planilha: Atend, Paciente, Convênio, Via, TUSS, Procedimento, Médico, Função, Valor, Esperado, Status */}
              <col className="hidden xl:table-column w-[7%]" />
              <col className="w-[18%] md:w-[15%] xl:w-[12%]" />
              <col className="hidden xl:table-column w-[9%]" />
              <col className="hidden lg:table-column w-[6%]" />
              <col className="w-[8%] md:w-[7%]" />
              <col className="w-[22%] md:w-[20%] xl:w-[15%]" />
              <col className="w-[16%] md:w-[14%] xl:w-[12%]" />
              <col className="hidden lg:table-column w-[6%]" />
              <col className="w-[10%] md:w-[9%]" />
              <col className="w-[10%] md:w-[9%]" />
              <col className="w-[10%] md:w-[8%] xl:w-[7%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className="border-b">
                <th className="px-1.5 py-1.5"></th>
                <th className="hidden xl:table-cell px-1.5 py-1.5 text-left font-medium">Atend.</th>
                <th className="px-1.5 py-1.5 text-left font-medium">Paciente</th>
                <th className="hidden xl:table-cell px-1.5 py-1.5 text-left font-medium">Convênio</th>
                <th className="hidden lg:table-cell px-1.5 py-1.5 text-left font-medium">Via</th>
                <th className="px-1.5 py-1.5 text-left font-medium">TUSS</th>
                <th className="px-1.5 py-1.5 text-left font-medium">Procedimento</th>
                <th className="px-1.5 py-1.5 text-left font-medium">Médico</th>
                <th className="hidden lg:table-cell px-1.5 py-1.5 text-left font-medium">Função</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Valor</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Esperado</th>
                <th className="px-1.5 py-1.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-muted-foreground">
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
      <td className="hidden xl:table-cell px-1.5 py-1 truncate font-mono text-[10px]" title={it.attendance_number ?? ""}>
        {it.attendance_number ?? "—"}
      </td>
      <td className="px-1.5 py-1 truncate" title={paciente}>{paciente}</td>
      <td className="hidden xl:table-cell px-1.5 py-1 truncate" title={typeof convenio === "string" ? convenio : ""}>
        {convenio}
      </td>
      <td className="hidden lg:table-cell px-1.5 py-1 truncate" title={it.access_route ?? ""}>{it.access_route ?? "—"}</td>
      <td className="px-1.5 py-1 font-mono text-[10px] truncate">{it.procedure_code ?? "—"}</td>
      <td className="px-1.5 py-1 text-muted-foreground truncate" title={it.procedure_name ?? it.description ?? ""}>
        {it.procedure_name ?? it.description ?? "—"}
      </td>
      <td className="px-1.5 py-1 truncate" title={it.doctor_name ?? ""}>{it.doctor_name}</td>
      <td className="hidden lg:table-cell px-1.5 py-1 truncate" title={it.doctor_role ?? ""}>{it.doctor_role ?? "—"}</td>
      <td className="px-1.5 py-1 text-right tabular-nums font-medium whitespace-nowrap">
        {formatCurrency(Number(it.gross_amount ?? 0))}
      </td>
      <td
        className={cn(
          "px-1.5 py-1 text-right tabular-nums whitespace-nowrap",
          expected != null && Math.abs(Number(expected) - Number(it.gross_amount ?? 0)) > 0.01
            ? "text-warning-foreground"
            : "text-muted-foreground",
        )}
      >
        {expected != null ? formatCurrency(Number(expected)) : "—"}
      </td>
      <td className="px-1.5 py-1">
        <span className={cn("inline-flex rounded-full border px-1 py-0.5 text-[9px]", TONE_CLASSES[tone])}>
          {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-0.5 inline" />}
          {eff}
        </span>
      </td>
    </tr>
  );
}

function ItemDetailsRow({
  it,
  rulesIndex,
  rulesByName,
}: {
  it: PaymentItemRowData;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;
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
  const aiNote = it.ai_findings?.engine?.ai_note;
  const diff =
    expected != null ? Number(expected) - Number(it.gross_amount ?? 0) : null;
  const exceptionMarked = !!(it as unknown as { authorized_exception?: boolean }).authorized_exception;

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

  return (
    <tr className="border-b bg-muted/20">
      <td colSpan={12} className="px-4 py-3">
        <div className="mb-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-[11px]">
          {summary.map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="truncate" title={s.value}>{s.value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Alertas */}
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
              <div className="rounded-md border border-info/20 bg-info-soft px-2.5 py-2 text-xs text-info flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Exceção autorizada registrada para este item.
              </div>
            )}
          </div>

          {/* Regra + IA */}
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

            {(explanation || aiNote || expected != null) && (
              <div className="rounded-md border bg-background p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Explicação da IA
                </p>
                {expected != null && (
                  <p className="tabular-nums text-foreground">
                    Valor esperado: <strong>{formatCurrency(Number(expected))}</strong>
                    {diff != null && Math.abs(diff) > 0.01 && (
                      <span className={cn("ml-2", diff < 0 ? "text-warning-foreground" : "text-success")}>
                        ({diff > 0 ? "+" : ""}
                        {formatCurrency(diff)})
                      </span>
                    )}
                  </p>
                )}
                {explanation && (
                  <p className="mt-1 text-muted-foreground leading-snug">{explanation}</p>
                )}
                {aiNote && (
                  <p className="mt-1 text-muted-foreground italic leading-snug">{aiNote}</p>
                )}
                {diff != null && Math.abs(diff) > 0.01 && (
                  <p className="mt-1.5 text-foreground">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Sugestão de ajuste:{" "}
                    </span>
                    Ajustar valor para <strong>{formatCurrency(Number(expected))}</strong>.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
