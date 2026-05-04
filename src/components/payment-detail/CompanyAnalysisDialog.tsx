import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertBanner } from "./AlertBanner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
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
} from "@/lib/status";
import { effectiveItemAiStatus } from "@/lib/paymentFlow";
import type {
  GroupRow,
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
}: Props) {
  const { id } = useParams<{ id: string }>();
  const gStatus = group.status as PaymentStatus;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  useEffect(() => {
    if (!open) {
      setExpanded(new Set());
      setActiveId(null);
      setFilter("");
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

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return items.filter((it) => {
      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (onlyAlerts && alerts.length === 0 && it.ai_status !== "reprovado" && it.ai_status !== "alerta") return false;
      if (!term) return true;
      const raw = (it.raw_data ?? {}) as Record<string, unknown>;
      const paciente =
        (it.patient_name as string | null) ?? ((raw["Paciente"] ?? raw["paciente"]) as string | null) ?? "";
      return [
        paciente,
        it.doctor_name ?? "",
        it.procedure_code ?? "",
        it.procedure_name ?? "",
        it.attendance_number ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [items, filter, onlyAlerts]);

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
        <div className="flex items-center gap-2 border-b px-4 py-2 bg-muted/20">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar por paciente, médico, TUSS…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant={onlyAlerts ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setOnlyAlerts((v) => !v)}
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Só com alertas
          </Button>
          <Badge variant="secondary" className="ml-auto">
            {filtered.length} de {counts.total}
          </Badge>
        </div>

        {/* Tabela */}
        <div className="flex-1 overflow-auto bg-background">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className="border-b">
                <th className="w-6 px-2 py-2"></th>
                <th className="px-2 py-2 text-left font-medium">Paciente</th>
                <th className="px-2 py-2 text-left font-medium">Médico</th>
                <th className="px-2 py-2 text-left font-medium">TUSS</th>
                <th className="px-2 py-2 text-left font-medium hidden lg:table-cell">Procedimento</th>
                <th className="px-2 py-2 text-right font-medium">Valor</th>
                <th className="px-2 py-2 text-right font-medium">Esperado</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
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
                      />
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
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
      <td className="px-2 py-1.5 text-muted-foreground">
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </td>
      <td className="px-2 py-1.5 break-words max-w-[220px]">{paciente}</td>
      <td className="px-2 py-1.5 break-words max-w-[200px]">{it.doctor_name}</td>
      <td className="px-2 py-1.5 font-mono text-[11px]">{it.procedure_code ?? "—"}</td>
      <td className="px-2 py-1.5 hidden lg:table-cell text-muted-foreground truncate max-w-[260px]">
        {it.procedure_name ?? it.description ?? "—"}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums font-medium">
        {formatCurrency(Number(it.gross_amount ?? 0))}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums",
          expected != null && Math.abs(Number(expected) - Number(it.gross_amount ?? 0)) > 0.01
            ? "text-warning-foreground"
            : "text-muted-foreground",
        )}
      >
        {expected != null ? formatCurrency(Number(expected)) : "—"}
      </td>
      <td className="px-2 py-1.5">
        <span className={cn("inline-flex rounded-full border px-1.5 py-0.5 text-[10px]", TONE_CLASSES[tone])}>
          {isCritical && <ShieldAlert className="h-2.5 w-2.5 mr-1 inline" />}
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

  return (
    <tr className="border-b bg-muted/20">
      <td colSpan={8} className="px-4 py-3">
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
