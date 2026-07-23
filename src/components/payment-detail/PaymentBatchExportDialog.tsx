/**
 * Diálogo de exportação do lote (nível pagamento) com seleção de empresas
 * e formato (XLSX / CSV / PDF). Espelha a UX do diálogo de exportação da
 * conciliação por empresa, porém aplicado à base completa de itens do lote.
 *
 * - PDF: reusa generatePaymentReportPdf (mesmo cabeçalho Rede D'Or, mesmas
 *   colunas e validações assistenciais).
 * - XLSX: planilha única "Itens do Lote" com colunas operacionais.
 * - CSV: mesmo conjunto de colunas, separador ";" (padrão BR).
 *
 * Nomenclatura do arquivo: Lote_<ref>_<competencia>_<escopo>_<YYYYMMDD>.<ext>
 */
import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, FileText, FileDown, Search, Loader2, Zap, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatDateOnly,
  formatCompetence,
  type ItemAiStatus,
} from "@/lib/status";
// XLSX é gerado no worker (src/workers/excel-export.worker.ts) para paridade
// total com o PaymentReportModal — não importar XLSX/brand helpers aqui.

import { useHospital } from "@/contexts/HospitalContext";
import { generatePaymentReportPdf } from "@/lib/paymentReportPdf";
import { getAgreement } from "@/lib/itemFields";
import type {
  PaymentRow,
  PaymentItemRow,
  GroupRow,
  RuleLite,
  ObservationRow,
} from "@/hooks/usePaymentDetailData";

type ExportFormat = "xlsx" | "csv" | "pdf";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentRow;
  items: PaymentItemRow[];
  groups: GroupRow[];
  rulesIndex?: Record<string, RuleLite>;
  observations?: ObservationRow[];
  profiles?: Record<string, string>;
}

const STATUS_OPTIONS: Array<{ v: ItemAiStatus; label: string }> = [
  { v: "aprovado", label: "Aprovado" },
  { v: "alerta", label: "Alerta" },
  { v: "reprovado", label: "Reprovado" },
];

function sanitize(name: string): string {
  return (name || "lote")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function buildFileName(
  payment: PaymentRow,
  scopeLabel: string,
  ext: string,
): string {
  const ref = sanitize(payment.reference || payment.id.slice(0, 8));
  const comp = sanitize(
    formatCompetence(payment.competence_months || payment.competence_month || ""),
  );
  const scope = sanitize(scopeLabel);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `Lote_${ref}_${comp}_${scope}_${stamp}.${ext}`;
}

export function PaymentBatchExportDialog({
  open,
  onOpenChange,
  payment,
  items,
  groups,
  rulesIndex,
  observations = [],
  profiles = {},
}: Props) {
  const { toast } = useToast();
  const { hospital } = useHospital();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [companySearch, setCompanySearch] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<ItemAiStatus>>(
    new Set(["aprovado", "alerta", "reprovado"]),
  );
  const [includeHistory, setIncludeHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  // Empresas com contagem de itens (do lote inteiro)
  const companies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const name = it.company_name || "Sem PJ";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const fromGroups = groups
      .map((g) => g.company_name)
      .filter((n): n is string => !!n);
    const all = Array.from(new Set([...fromGroups, ...counts.keys()]));
    return all
      .map((name) => ({ name, count: counts.get(name) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [items, groups]);

  // Seleciona todas por padrão ao abrir
  useEffect(() => {
    if (open) {
      setSelectedCompanies(new Set(companies.map((c) => c.name)));
      setSelectedStatuses(new Set(["aprovado", "alerta", "reprovado"]));
      setCompanySearch("");
      setIncludeHistory(false);
    }
  }, [open, companies]);

  const filteredCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(q));
  }, [companies, companySearch]);

  const allFilteredSelected =
    filteredCompanies.length > 0 &&
    filteredCompanies.every((c) => selectedCompanies.has(c.name));

  const toggleAllFiltered = () => {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const c of filteredCompanies) next.delete(c.name);
      } else {
        for (const c of filteredCompanies) next.add(c.name);
      }
      return next;
    });
  };

  const toggleCompany = (name: string) => {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleStatus = (s: ItemAiStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  // Itens efetivos da exportação
  const itemsToExport = useMemo(() => {
    return items.filter((it) => {
      const company = it.company_name || "Sem PJ";
      if (!selectedCompanies.has(company)) return false;
      const status = (it.ai_status as ItemAiStatus) ?? "aprovado";
      return selectedStatuses.has(status);
    });
  }, [items, selectedCompanies, selectedStatuses]);

  const scopeLabel = useMemo(() => {
    const total = companies.length;
    const sel = selectedCompanies.size;
    const parts: string[] = [];
    if (sel === total) parts.push("todas_empresas");
    else if (sel === 1) parts.push(sanitize(Array.from(selectedCompanies)[0]));
    else parts.push(`${sel}_empresas`);
    if (selectedStatuses.size === 3) parts.push("todos_status");
    else parts.push(Array.from(selectedStatuses).join("-"));
    return parts.join("_");
  }, [companies.length, selectedCompanies, selectedStatuses]);

  const canExport = selectedCompanies.size > 0 && selectedStatuses.size > 0 && itemsToExport.length > 0;

  // Aplica um preset rápido: define status + seleciona apenas empresas que
  // contenham itens nesses status. Útil para exportar "tudo", "só divergentes",
  // "só reprovados" etc. sem ter que marcar manualmente.
  const applyPreset = (statuses: ItemAiStatus[]) => {
    const statusSet = new Set<ItemAiStatus>(statuses);
    setSelectedStatuses(statusSet);
    const companiesWithMatches = new Set<string>();
    for (const it of items) {
      const st = (it.ai_status as ItemAiStatus) ?? "aprovado";
      if (statusSet.has(st)) {
        companiesWithMatches.add(it.company_name || "Sem PJ");
      }
    }
    setSelectedCompanies(companiesWithMatches);
  };

  const presetCounts = useMemo(() => {
    let aprovado = 0, alerta = 0, reprovado = 0;
    for (const it of items) {
      const st = (it.ai_status as ItemAiStatus) ?? "aprovado";
      if (st === "aprovado") aprovado++;
      else if (st === "alerta") alerta++;
      else if (st === "reprovado") reprovado++;
    }
    return { aprovado, alerta, reprovado, divergentes: alerta + reprovado, total: items.length };
  }, [items]);


  // ============ EXPORTAÇÕES ============

  const buildRows = () => {
    return itemsToExport.map((it) => {
      const findings: any[] = Array.isArray((it as any).validation_findings)
        ? (it as any).validation_findings
        : [];
      const ruleIds = it.ai_findings?.matched_rule_ids || [];
      const ruleNames = ruleIds.map((id) => rulesIndex?.[id]?.name).filter(Boolean);
      const ruleSummary =
        ruleNames.length > 0
          ? ruleNames.join(" | ")
          : it.ai_findings?.matched_rules?.join(" | ") || "";
      const validationSummary = findings
        .map((f: any) => {
          const n = f?.rule_name || f?.kind || "Validação";
          const m = f?.message || "";
          return m ? `${n}: ${m}` : n;
        })
        .join(" | ");
      return {
        empresa: it.company_name || "Sem PJ",
        atendimento: it.attendance_number || "",
        paciente: it.patient_name || "",
        data: it.procedure_date ? formatDateOnly(it.procedure_date) : "",
        medico: it.doctor_name || "",
        crm: (it as any).doctor_document || "",
        especialidade: it.specialty || "",
        procedimento_codigo: it.procedure_code || "",
        procedimento_nome: it.procedure_name || "",
        quantidade: Number((it as any).quantity ?? 1),
        convenio: getAgreement(it as any) || "",
        setor: (it as any).sector_name || "",
        valor_bruto: Number(it.gross_amount ?? 0),
        valor_esperado: Number((it as any).expected_amount ?? 0),
        diferenca:
          Number((it as any).expected_amount ?? 0) - Number(it.gross_amount ?? 0),
        piso_aplicado: (it as any).piso_aplicado_valor != null
          ? Number((it as any).piso_aplicado_valor)
          : "",
        piso_metodo: (it as any).piso_metodo_vencedor === "piso"
          ? "Piso"
          : (it as any).piso_metodo_vencedor === "convenio"
            ? "Convênio"
            : "",
        status: String(it.ai_status ?? ""),
        regras_aplicadas: ruleSummary,
        validacoes: validationSummary,
      };
    });
  };

  /**
   * Exportação XLSX — reusa o mesmo worker do PaymentReportModal para garantir
   * paridade total (mesmas 4 abas: Resumo, Por Empresa, Detalhe dos Itens,
   * Alertas Assistenciais) entre a exportação do lote e a exportação feita
   * dentro do pagamento da empresa.
   */
  const handleExportXlsx = () =>
    new Promise<void>((resolve, reject) => {
      // Resumo agregado
      const stats = {
        approved: { count: 0, value: 0 },
        alert: { count: 0, value: 0 },
        rejected: { count: 0, value: 0 },
        accepted: { count: 0, value: 0 },
      };
      for (const it of itemsToExport) {
        const val = Number(it.gross_amount ?? 0);
        const st = it.ai_status as ItemAiStatus;
        if (st === "aprovado") { stats.approved.count++; stats.approved.value += val; }
        else if (st === "alerta") { stats.alert.count++; stats.alert.value += val; }
        else if (st === "reprovado") { stats.rejected.count++; stats.rejected.value += val; }
        else if (st === "acatado") { stats.accepted.count++; stats.accepted.value += val; }
      }
      const totalValue =
        stats.approved.value + stats.alert.value + stats.rejected.value + stats.accepted.value;
      const summary = {
        approved: { ...stats.approved, pct: totalValue > 0 ? (stats.approved.value / totalValue) * 100 : 0 },
        alert: { ...stats.alert, pct: totalValue > 0 ? (stats.alert.value / totalValue) * 100 : 0 },
        rejected: { ...stats.rejected, pct: totalValue > 0 ? (stats.rejected.value / totalValue) * 100 : 0 },
        accepted: { ...stats.accepted, pct: totalValue > 0 ? (stats.accepted.value / totalValue) * 100 : 0 },
        riskValue: stats.alert.value + stats.rejected.value,
        totalValue,
        totalCount: stats.approved.count + stats.alert.count + stats.rejected.count + stats.accepted.count,
      };

      // Agrupamento por empresa
      const grouped = new Map<string, {
        name: string;
        totalValue: number;
        riskValue: number;
        counts: { aprovado: number; alerta: number; reprovado: number; acatado: number };
      }>();
      for (const it of itemsToExport) {
        const name = it.company_name || "Sem PJ";
        const g = grouped.get(name) ?? {
          name,
          totalValue: 0,
          riskValue: 0,
          counts: { aprovado: 0, alerta: 0, reprovado: 0, acatado: 0 },
        };
        const val = Number(it.gross_amount ?? 0);
        g.totalValue += val;
        const st = it.ai_status as ItemAiStatus;
        if (st === "alerta" || st === "reprovado") g.riskValue += val;
        if (st === "aprovado" || st === "alerta" || st === "reprovado" || st === "acatado") {
          g.counts[st]++;
        }
        grouped.set(name, g);
      }
      const companyGroups = Array.from(grouped.values()).sort((a, b) => b.riskValue - a.riskValue);

      // Itens enriquecidos com rule_summary + validation_summary + data BR,
      // no mesmo formato que o PaymentReportModal envia ao worker.
      const filteredItemsPayload = itemsToExport.map((it) => {
        const anyIt = it as unknown as Record<string, unknown>;
        const ruleIds = it.ai_findings?.matched_rule_ids || [];
        const ruleNames = ruleIds.map((id) => rulesIndex?.[id]?.name).filter(Boolean);
        const ruleSummary = ruleNames.length > 0
          ? ruleNames.join(" | ")
          : (it.ai_findings?.matched_rules?.join(" | ") || "");

        const rawFindings = Array.isArray((anyIt).validation_findings)
          ? ((anyIt).validation_findings as Array<Record<string, unknown>>)
          : [];
        const knownKeys = new Set(
          rawFindings.map((f) => String(f.rule_id ?? f.rule_name ?? "").toLowerCase()),
        );
        const synth: Array<Record<string, unknown>> = [];
        (it.ai_findings?.matched_rule_ids ?? []).forEach((rid) => {
          const key = String(rid).toLowerCase();
          if (knownKeys.has(key)) return;
          const rule = rulesIndex?.[rid];
          if (!rule) return;
          knownKeys.add(key);
          synth.push({
            rule_name: rule.name,
            message: rule.description || "Regra disparada — sem conflito ou bloqueio.",
          });
        });
        const allFindings = [...rawFindings, ...synth];
        const validationSummary = allFindings
          .map((f) => {
            const name = (f?.rule_name as string) || (f?.kind as string) || "Validação";
            const ci = f?.conflicting_item as Record<string, unknown> | undefined;
            let conflictDetail = "";
            if (ci) {
              const parts: string[] = [];
              if (ci.doctor_name) parts.push(`Médico: ${ci.doctor_name}`);
              if (ci.company_name) parts.push(`Empresa: ${ci.company_name}`);
              if (ci.attendance_number) parts.push(`Atend: ${ci.attendance_number}`);
              if (parts.length > 0) conflictDetail = ` → conflita com [${parts.join(" · ")}]`;
            }
            const msg = (f?.message as string) || "";
            if (conflictDetail) return `${name}: ${msg}${conflictDetail}`;
            return msg ? `${name}: ${msg}` : name;
          })
          .join(" | ");

        return {
          ...it,
          agreement_text: getAgreement(it as never),
          procedure_date: it.procedure_date ? formatDateOnly(it.procedure_date) : "",
          rule_summary: ruleSummary,
          validation_summary: validationSummary,
        };
      });

      const workerData = {
        summary,
        companyGroups,
        filteredItems: filteredItemsPayload,
        fileName: buildFileName(payment, scopeLabel, "xlsx"),
        hospitalName: hospital?.name ?? null,
        competence: formatCompetence(payment.competence_months || payment.competence_month || ""),
      };

      const worker = new Worker(
        new URL("../../workers/excel-export.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type === "success") {
          const blob = new Blob([e.data.buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = e.data.fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          worker.terminate();
          resolve();
        } else if (e.data?.type === "error") {
          worker.terminate();
          reject(new Error(e.data.error || "Erro ao gerar Excel"));
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err.error ?? new Error("Erro no worker de exportação"));
      };
      worker.postMessage(workerData);
    });


  const handleExportCsv = () => {
    const rows = buildRows();
    const headers = [
      "Empresa", "Atendimento", "Paciente", "Data", "Médico", "CRM",
      "Especialidade", "Cód. Procedimento", "Procedimento", "Qtd",
      "Convênio", "Setor", "Valor Bruto", "Valor Esperado", "Diferença",
      "Piso Aplicado", "Método Piso",
      "Status", "Regras Aplicadas", "Validações",
    ];
    const esc = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[";\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmtNum = (n: number) =>
      Number(n).toFixed(2).replace(".", ",");
    const lines = [headers.join(";")];
    for (const r of rows) {
      lines.push([
        esc(r.empresa), esc(r.atendimento), esc(r.paciente), esc(r.data),
        esc(r.medico), esc(r.crm), esc(r.especialidade), esc(r.procedimento_codigo),
        esc(r.procedimento_nome), esc(r.quantidade), esc(r.convenio), esc(r.setor),
        esc(fmtNum(r.valor_bruto)), esc(fmtNum(r.valor_esperado)), esc(fmtNum(r.diferenca)),
        esc(r.piso_aplicado === "" ? "" : fmtNum(Number(r.piso_aplicado))), esc(r.piso_metodo),
        esc(r.status), esc(r.regras_aplicadas), esc(r.validacoes),
      ].join(";"));
    }
    // BOM para Excel reconhecer UTF-8 (acentos)
    const blob = new Blob(["\ufeff" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildFileName(payment, scopeLabel, "csv");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    const filteredGroups = groups.filter((g) =>
      g.company_name ? selectedCompanies.has(g.company_name) : false,
    );
    const doc = await generatePaymentReportPdf({
      payment,
      items: itemsToExport,
      groups: filteredGroups.length ? filteredGroups : groups,
      observations,
      profiles,
      rulesIndex,
      includeHistory,
    });
    doc.save(buildFileName(payment, scopeLabel, "pdf"));
  };

  const handleExport = async () => {
    if (!canExport || busy) return;
    setBusy(true);
    try {
      if (format === "xlsx") await handleExportXlsx();
      else if (format === "csv") handleExportCsv();
      else await handleExportPdf();
      toast({
        title: "Exportação concluída",
        description: `${itemsToExport.length} item(ns) · ${selectedCompanies.size} empresa(s)`,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error("[batch-export]", err);
      toast({
        title: "Falha ao exportar",
        description: err?.message || "Erro inesperado",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const formatOptions: Array<{ v: ExportFormat; label: string; icon: any; hint: string }> = [
    { v: "xlsx", label: "Excel (XLSX)", icon: FileSpreadsheet, hint: "Planilha formatada" },
    { v: "csv", label: "CSV", icon: FileText, hint: "Padrão BR (;)" },
    { v: "pdf", label: "PDF", icon: FileDown, hint: "Relatório completo Rede D'Or" },
  ];

  const totalValue = itemsToExport.reduce(
    (acc, it) => acc + Number(it.gross_amount ?? 0),
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Exportar lote</DialogTitle>
          <DialogDescription>
            Escolha o formato, as empresas e os status que deseja exportar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* Atalhos rápidos */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Atalhos rápidos</span>
              <span className="text-xs text-muted-foreground">
                aplica status + empresas automaticamente
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => applyPreset(["aprovado", "alerta", "reprovado"])}
                className="flex flex-col items-start gap-1 rounded-md border border-border p-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <FileDown className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium">Tudo</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {presetCounts.total} itens
                </span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset(["alerta", "reprovado"])}
                className="flex flex-col items-start gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-left hover:bg-amber-500/10 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-sm font-medium">Só divergentes</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {presetCounts.divergentes} itens (alerta + reprovado)
                </span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset(["reprovado"])}
                className="flex flex-col items-start gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-left hover:bg-destructive/10 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-sm font-medium">Só reprovados</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {presetCounts.reprovado} itens
                </span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset(["aprovado"])}
                className="flex flex-col items-start gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-left hover:bg-emerald-500/10 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-sm font-medium">Só aprovados</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {presetCounts.aprovado} itens
                </span>
              </button>
            </div>
          </div>

          {/* Formato */}
          <div>
            <div className="text-sm font-medium mb-2">Formato</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {formatOptions.map((opt) => {
                const Icon = opt.icon;
                const active = format === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFormat(opt.v)}
                    className={cn(
                      "flex items-start gap-2 text-left rounded-md border p-3 transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Opções específicas do PDF */}
          {format === "pdf" && (
            <div className="rounded-md border border-dashed p-3">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={includeHistory}
                  onCheckedChange={(v) => setIncludeHistory(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="font-medium">Incluir histórico de observações</div>
                  <div className="text-xs text-muted-foreground">
                    Por padrão o relatório é executivo e não traz o histórico. Marque
                    para anexar todas as observações registradas no lote.
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Status */}
          <div>
            <div className="text-sm font-medium mb-2">Status dos itens</div>
            <div className="flex flex-wrap gap-3">
              {STATUS_OPTIONS.map((s) => (
                <label key={s.v} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedStatuses.has(s.v)}
                    onCheckedChange={() => toggleStatus(s.v)}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Empresas */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="text-sm font-medium">
                Empresas ({selectedCompanies.size}/{companies.length})
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleAllFiltered}
                className="h-7 px-2 text-xs"
              >
                {allFilteredSelected ? "Desmarcar visíveis" : "Selecionar visíveis"}
              </Button>
            </div>
            <div className="relative mb-2">
              <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Filtrar empresa..."
                className="pl-8 h-9"
              />
            </div>
            <ScrollArea className="h-56 rounded-md border">
              <div className="p-2 space-y-1">
                {filteredCompanies.length === 0 && (
                  <div className="text-sm text-muted-foreground p-3 text-center">
                    Nenhuma empresa encontrada.
                  </div>
                )}
                {filteredCompanies.map((c) => {
                  const checked = selectedCompanies.has(c.name);
                  return (
                    <label
                      key={c.name}
                      className={cn(
                        "flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer text-sm",
                        checked ? "bg-primary/5" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleCompany(c.name)}
                        />
                        <span className="truncate" title={c.name}>{c.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {c.count}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Resumo */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm flex flex-wrap items-center gap-x-5 gap-y-1">
            <span><strong>{itemsToExport.length}</strong> itens</span>
            <span><strong>{selectedCompanies.size}</strong> empresas</span>
            <span>Valor bruto: <strong>{formatCurrency(totalValue)}</strong></span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleExport} disabled={!canExport || busy}>
            {busy ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando…</>
            ) : (
              <><FileDown className="h-4 w-4 mr-2" />Exportar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
