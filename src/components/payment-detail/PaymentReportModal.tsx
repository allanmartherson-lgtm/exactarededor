import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileDown,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  BarChart3,
  Building2,
  User,
  Stethoscope,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import {
  formatCurrency,
  formatDateOnly,
  formatCompetence,
  TONE_CLASSES,
  type ItemAiStatus,
} from "@/lib/status";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx-js-style";
import type {
  PaymentRow,
  PaymentItemRow,
  GroupRow,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import type { ObservationRow } from "@/hooks/usePaymentDetailData";
import { supabase } from "@/integrations/supabase/client";
import { generatePaymentReportPdf } from "@/lib/paymentReportPdf";

interface PaymentReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentRow;
  items: PaymentItemRow[];
  groups: GroupRow[];
  rulesIndex?: Record<string, RuleLite>;
  analystName?: string;
  observations?: ObservationRow[];
  profiles?: Record<string, string>;
}

export function PaymentReportModal({
  open,
  onOpenChange,
  payment,
  items,
  groups,
  rulesIndex,
  analystName,
}: PaymentReportModalProps) {
  const { toast } = useToast();
  // --- Estados de Filtro ---
  const [search, setSearch] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState({
    aprovado: true,
    alerta: true,
    reprovado: true,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [auditData, setAuditData] = useState<any>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    if (open && payment.id) {
      loadAudit();
    }
  }, [open, payment.id]);

  const loadAudit = async () => {
    setLoadingAudit(true);
    try {
      const { data, error } = await supabase.rpc('calculate_payment_audit', {
        p_payment_id: payment.id
      });
      if (error) throw error;
      setAuditData(data);
    } catch (err: any) {
      console.error("Erro ao carregar auditoria:", err);
      toast({
        title: "Erro ao carregar auditoria",
        description: err.message || "Não foi possível calcular os dados de auditoria do lote.",
        variant: "destructive"
      });
    } finally {
      setLoadingAudit(false);
    }
  };

  // --- Opções para Filtros ---
  const companyOptions = useMemo(() => 
    Array.from(new Set(groups.map(g => g.company_name))).sort(), 
  [groups]);
  
  const doctorOptions = useMemo(() => 
    Array.from(new Set(items.map(it => it.doctor_name).filter(Boolean))).sort() as string[], 
  [items]);

  const specialtyOptions = useMemo(() => 
    Array.from(new Set(items.map(it => it.specialty).filter(Boolean))).sort() as string[], 
  [items]);

  // --- Lógica de Filtragem ---
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const matchesSearch = !search || 
        [it.attendance_number, it.patient_name, it.procedure_code, it.procedure_name, it.doctor_name, it.company_name]
          .some(field => String(field ?? "").toLowerCase().includes(search.toLowerCase()));
      
      const matchesCompany = selectedCompanies.length === 0 || (it.company_name && selectedCompanies.includes(it.company_name));
      const matchesDoctor = selectedDoctors.length === 0 || (it.doctor_name && selectedDoctors.includes(it.doctor_name));
      const matchesSpecialty = selectedSpecialties.length === 0 || (it.specialty && selectedSpecialties.includes(it.specialty));
      
      const status = it.ai_status as ItemAiStatus;
      const matchesStatus = 
        (status === "aprovado" && statusFilter.aprovado) ||
        (status === "alerta" && statusFilter.alerta) ||
        (status === "reprovado" && statusFilter.reprovado);

      return matchesSearch && matchesCompany && matchesDoctor && matchesSpecialty && matchesStatus;
    });
  }, [items, search, selectedCompanies, selectedDoctors, selectedSpecialties, statusFilter]);

  // --- Resumo Executivo ---
  const summary = useMemo(() => {
    const stats = {
      approved: { count: 0, value: 0 },
      alert: { count: 0, value: 0 },
      rejected: { count: 0, value: 0 },
    };

    filteredItems.forEach(it => {
      const val = Number(it.gross_amount ?? 0);
      if (it.ai_status === "aprovado") {
        stats.approved.count++;
        stats.approved.value += val;
      } else if (it.ai_status === "alerta") {
        stats.alert.count++;
        stats.alert.value += val;
      } else if (it.ai_status === "reprovado") {
        stats.rejected.count++;
        stats.rejected.value += val;
      }
    });

    const totalValue = stats.approved.value + stats.alert.value + stats.rejected.value;
    const totalCount = stats.approved.count + stats.alert.count + stats.rejected.count;

    return {
      approved: { ...stats.approved, pct: totalValue > 0 ? (stats.approved.value / totalValue) * 100 : 0 },
      alert: { ...stats.alert, pct: totalValue > 0 ? (stats.alert.value / totalValue) * 100 : 0 },
      rejected: { ...stats.rejected, pct: totalValue > 0 ? (stats.rejected.value / totalValue) * 100 : 0 },
      riskValue: stats.alert.value + stats.rejected.value,
      totalValue,
      totalCount,
    };
  }, [filteredItems]);

  // --- Agrupamento por Empresa ---
  const companyGroups = useMemo(() => {
    const grouped = new Map<string, {
      name: string;
      items: PaymentItemRow[];
      totalValue: number;
      riskValue: number;
      counts: Record<ItemAiStatus, number>;
    }>();

    filteredItems.forEach(it => {
      const companyName = it.company_name || "Sem PJ";
      const group = grouped.get(companyName) || {
        name: companyName,
        items: [],
        totalValue: 0,
        riskValue: 0,
        counts: { aprovado: 0, alerta: 0, reprovado: 0, pendente: 0, seguido: 0 } as any,
      };
      
      group.items.push(it);
      const val = Number(it.gross_amount ?? 0);
      group.totalValue += val;
      if (it.ai_status === "alerta" || it.ai_status === "reprovado") {
        group.riskValue += val;
      }
      group.counts[it.ai_status as ItemAiStatus]++;
      grouped.set(companyName, group);
    });

    return Array.from(grouped.values()).sort((a, b) => b.riskValue - a.riskValue);
  }, [filteredItems]);

  // --- Exportação Excel via Web Worker ---
  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    
    try {
      const competence = payment.competence_months || payment.competence_month || "";
      const fileName = `Relatorio_Lote_${formatCompetence(competence).replace(/\s/g, "")}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${new Date().getHours()}${new Date().getMinutes()}.xlsx`;

      // Preparar dados para o worker (garantir que são serializáveis)
      const workerData = {
        summary,
        companyGroups,
        filteredItems: filteredItems.map(it => {
          const ruleIds = it.ai_findings?.matched_rule_ids || [];
          const ruleNames = ruleIds.map(id => rulesIndex?.[id]?.name).filter(Boolean);
          const ruleSummary = ruleNames.length > 0 
            ? ruleNames.join(" | ") 
            : (it.ai_findings?.matched_rules?.join(" | ") || "");

          // Replica a mesma lógica do popover "Validação (N)" da tela
          // expandida: findings explícitos + entradas sintetizadas para regras
          // disparadas que não geraram conflito (action=informar).
          const rawFindings: any[] = Array.isArray((it as any).validation_findings)
            ? (it as any).validation_findings
            : [];
          const knownKeys = new Set(
            rawFindings.map((f) => String(f.rule_id ?? f.rule_name ?? "").toLowerCase()),
          );
          const synth: any[] = [];
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
            .map((f: any) => {
              const name = f?.rule_name || f?.kind || "Validação";
              const msg = f?.message || "";
              return msg ? `${name}: ${msg}` : name;
            })
            .join(" | ");

          return {
            ...it,
            procedure_date: it.procedure_date ? formatDateOnly(it.procedure_date) : "",
            rule_summary: ruleSummary,
            validation_summary: validationSummary,
          };
        }),
        fileName
      };

      // Criar o worker
      const worker = new Worker(new URL('../../workers/excel-export.worker.ts', import.meta.url), {
        type: 'module'
      });

      worker.onmessage = (e) => {
        if (e.data.type === 'success') {
          const blob = new Blob([e.data.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', e.data.fileName);
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
          setIsExporting(false);
          toast({ title: "Excel gerado com sucesso" });
        } else if (e.data.type === 'error') {
          console.error("Erro no worker:", e.data.error);
          toast({ title: "Falha ao gerar Excel", variant: "destructive" });
          setIsExporting(false);
        }
        worker.terminate();
      };

      worker.onerror = (err) => {
        console.error("Worker error:", err);
        toast({ title: "Erro no processo de exportação", variant: "destructive" });
        setIsExporting(false);
        worker.terminate();
      };

      worker.postMessage(workerData);
    } catch (error) {
      console.error("Export error:", error);
      setIsExporting(false);
      toast({ title: "Erro inesperado", variant: "destructive" });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-none p-0 flex flex-col h-screen overflow-hidden">
        <div className="border-b bg-muted/30 p-4 sticky top-0 z-10 flex items-center justify-between">
          <div>
            <SheetTitle className="text-xl">
              Relatório do Lote — {formatCompetence(payment.competence_months || payment.competence_month)}
              {payment.reference && ` — ${payment.reference}`}
            </SheetTitle>
            <div className="flex gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
              <span><strong>Data:</strong> {new Date().toLocaleDateString("pt-BR")}</span>
              <span><strong>Analista:</strong> {analystName || "Sistema"}</span>
              <span><strong>Empresas:</strong> {groups.length}</span>
              <span><strong>Itens:</strong> {items.length}</span>
              <span><strong>Total:</strong> {formatCurrency(payment.total_amount)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportExcel} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              Exportar Excel
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <Search className="h-4 w-4 rotate-45" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-muted/10">
          {/* Cards de Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="border-success/30 bg-success/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-success/10 rounded-full text-success">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-success uppercase tracking-wider">Aprovados</p>
                  <p className="text-lg font-bold">{summary.approved.count} itens</p>
                  <p className="text-sm text-muted-foreground">{formatCurrency(summary.approved.value)} ({summary.approved.pct.toFixed(1)}%)</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-warning/10 rounded-full text-warning-foreground">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-warning-foreground uppercase tracking-wider">Alertas</p>
                  <p className="text-lg font-bold">{summary.alert.count} itens</p>
                  <p className="text-sm text-muted-foreground">{formatCurrency(summary.alert.value)} ({summary.alert.pct.toFixed(1)}%)</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-destructive/10 rounded-full text-destructive">
                  <XCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-destructive uppercase tracking-wider">Reprovados</p>
                  <p className="text-lg font-bold">{summary.rejected.count} itens</p>
                  <p className="text-sm text-muted-foreground">{formatCurrency(summary.rejected.value)} ({summary.rejected.pct.toFixed(1)}%)</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-full text-primary">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-primary uppercase tracking-wider">Valor em Risco</p>
                  <p className="text-lg font-bold text-destructive">{formatCurrency(summary.riskValue)}</p>
                  <p className="text-sm text-muted-foreground">{((summary.riskValue / summary.totalValue) * 100 || 0).toFixed(1)}% do total</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Painel de Auditoria Automática */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-primary">
                <ClipboardCheck className="h-4 w-4" /> Auditoria Automática de Processamento
              </div>
              {loadingAudit && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </CardHeader>
            <CardContent className="p-4">
              {auditData ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">
                      Resumo da Importação
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-background border rounded-lg">
                        <p className="text-[10px] text-muted-foreground uppercase">Esperado (Planilha)</p>
                        <p className="text-xl font-bold">{auditData.summary.expected_total}</p>
                      </div>
                      <div className="p-3 bg-background border rounded-lg">
                        <p className="text-[10px] text-muted-foreground uppercase">Processado (Banco)</p>
                        <p className="text-xl font-bold text-primary">{auditData.summary.processed_total}</p>
                      </div>
                    </div>
                    {auditData.summary.missing_total > 0 ? (
                      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <div>
                          <p className="text-sm font-bold text-destructive">Atenção: {auditData.summary.missing_total} itens não processados</p>
                          <p className="text-[11px] text-destructive/80">O total de itens no banco é inferior ao esperado pelo cabeçalho do lote.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-success/10 border border-success/20 rounded-lg flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-success" />
                        <div>
                          <p className="text-sm font-bold text-success">Processamento Íntegro</p>
                          <p className="text-[11px] text-success/80">Todos os itens esperados foram encontrados no banco de dados.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase text-muted-foreground">Discrepâncias Financeiras</h4>
                    <div className="max-h-[140px] overflow-y-auto border rounded-lg bg-background">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                             <TableHead className="text-[10px] h-7">PJ / Empresa</TableHead>
                             <TableHead className="text-[10px] h-7 text-center">Itens (Proc/Esp)</TableHead>
                             <TableHead className="text-[10px] h-7 text-center">Status / Motivo</TableHead>
                             <TableHead className="text-[10px] h-7 text-right">Diferença Fin.</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditData.by_company?.map((comp: any) => (
                            <TableRow key={comp.company_name} className="h-7 hover:bg-muted/10">
                               <TableCell className="text-[11px] py-1 font-medium truncate max-w-[150px]" title={comp.company_name}>
                                 {comp.company_name}
                               </TableCell>
                               <TableCell className="text-[11px] py-1 text-center font-mono">
                                 <span className={comp.missing_items > 0 ? "text-destructive font-bold" : "text-muted-foreground"}>
                                   {comp.processed_items}/{comp.expected_items}
                                 </span>
                               </TableCell>
                               <TableCell className="text-[10px] py-1 text-center">
                                 <div className="flex flex-col">
                                   <Badge variant="outline" className={cn("text-[8px] h-3 px-1 mx-auto", comp.missing_items > 0 ? "text-destructive border-destructive/30" : "text-success border-success/30")}>
                                     {comp.reason}
                                   </Badge>
                                 </div>
                               </TableCell>
                               <TableCell className={cn(
                                 "text-[11px] py-1 text-right font-mono",
                                 Math.abs(comp.discrepancy_amount) > 0.01 ? (comp.discrepancy_amount > 0 ? "text-destructive" : "text-success") : "text-muted-foreground"
                               )}>
                                 {formatCurrency(comp.discrepancy_amount)}
                               </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-6 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  <p className="text-xs italic">Calculando métricas de auditoria...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Filtros Internos */}
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="h-4 w-4" /> Filtros do Relatório
              </div>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Busca</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Paciente, atendimento..." 
                    className="pl-8 h-9 text-xs" 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Status do Item</label>
                <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox 
                      checked={statusFilter.aprovado}
                      onCheckedChange={(c) => setStatusFilter(prev => ({ ...prev, aprovado: !!c }))}
                    /> ✓ Aprovado
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox 
                      checked={statusFilter.alerta}
                      onCheckedChange={(c) => setStatusFilter(prev => ({ ...prev, alerta: !!c }))}
                    /> ⚠ Alerta
                  </label>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox 
                      checked={statusFilter.reprovado}
                      onCheckedChange={(c) => setStatusFilter(prev => ({ ...prev, reprovado: !!c }))}
                    /> ✗ Reprovado
                  </label>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">PJ / Empresa</label>
                <select 
                  multiple
                  className="w-full border rounded-md h-24 text-xs p-1"
                  value={selectedCompanies}
                  onChange={(e) => setSelectedCompanies(Array.from(e.target.selectedOptions, o => o.value))}
                >
                  {companyOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Médico</label>
                <select 
                  multiple
                  className="w-full border rounded-md h-24 text-xs p-1"
                  value={selectedDoctors}
                  onChange={(e) => setSelectedDoctors(Array.from(e.target.selectedOptions, o => o.value))}
                >
                  {doctorOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Especialidade</label>
                <select 
                  multiple
                  className="w-full border rounded-md h-24 text-xs p-1"
                  value={selectedSpecialties}
                  onChange={(e) => setSelectedSpecialties(Array.from(e.target.selectedOptions, o => o.value))}
                >
                  {specialtyOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Tabela de Empresas */}
          <div className="space-y-3 pb-10">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Detalhamento por Empresa
            </h3>
            
            <Accordion type="multiple" className="space-y-3">
              {companyGroups.map((g) => {
                const isClean = g.counts.reprovado === 0 && g.counts.alerta === 0;
                const statusLabel = g.counts.reprovado > 0 ? "Com reprovações" : g.counts.alerta > 0 ? "Com alertas" : "Limpa";
                const statusTone = g.counts.reprovado > 0 ? "destructive" : g.counts.alerta > 0 ? "warning" : "success";
                
                return (
                  <AccordionItem key={g.name} value={g.name} className="border rounded-lg bg-background overflow-hidden">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline [&[data-state=open]]:bg-muted/30">
                      <div className="flex-1 flex items-center justify-between gap-4 mr-4">
                        <div className="flex items-center gap-3">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-bold text-left">{g.name}</span>
                          <Badge variant="outline" className={cn("text-[10px] h-5", TONE_CLASSES[statusTone])}>
                            {statusLabel}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center gap-6 text-sm">
                          <div className="flex items-center gap-2">
                            {g.counts.aprovado > 0 && <span className="text-success text-xs font-bold">✓ {g.counts.aprovado}</span>}
                            {g.counts.alerta > 0 && <span className="text-warning-foreground text-xs font-bold">⚠ {g.counts.alerta}</span>}
                            {g.counts.reprovado > 0 && <span className="text-destructive text-xs font-bold">✗ {g.counts.reprovado}</span>}
                          </div>
                          <div className="text-right tabular-nums min-w-[120px]">
                            <p className="font-bold">{formatCurrency(g.totalValue)}</p>
                            {g.riskValue > 0 && (
                              <p className="text-[10px] text-destructive">Risco: {formatCurrency(g.riskValue)} ({((g.riskValue / g.totalValue) * 100).toFixed(1)}%)</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-0 overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="text-[10px] h-8 uppercase">Atendimento</TableHead>
                            <TableHead className="text-[10px] h-8 uppercase">Data</TableHead>
                            <TableHead className="text-[10px] h-8 uppercase">Paciente / Médico</TableHead>
                            <TableHead className="text-[10px] h-8 uppercase">Procedimento</TableHead>
                            <TableHead className="text-[10px] h-8 uppercase text-right">Valor Repasse</TableHead>
                            <TableHead className="text-[10px] h-8 uppercase">Status / Motivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.items.map((it) => {
                            const findings = it.ai_findings as any;
                            const statusTone = it.ai_status === "aprovado" ? "success" : it.ai_status === "alerta" ? "warning" : "destructive";
                            const diff = Number(it.gross_amount ?? 0) - Number(findings?.expected_amount ?? 0);
                            const diffPct = findings?.engine?.diff_pct;

                            return (
                              <TableRow key={it.id} className="text-xs">
                                <TableCell className="font-mono">#{it.attendance_number}</TableCell>
                                <TableCell>{it.procedure_date ? formatDateOnly(it.procedure_date) : "—"}</TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium flex items-center gap-1"><User className="h-3 w-3" /> {it.patient_name || "—"}</span>
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Stethoscope className="h-2.5 w-2.5" /> {it.doctor_name} {it.specialty ? `· ${it.specialty}` : ""}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-mono text-[10px]">{it.procedure_code}</span>
                                    <span className="truncate max-w-[200px]">{it.procedure_name}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <p className="font-semibold">{formatCurrency(it.gross_amount)}</p>
                                  {findings?.expected_amount != null && (
                                    <p className="text-[10px] text-muted-foreground">Esperado: {formatCurrency(findings.expected_amount)}</p>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant="outline" className={cn("text-[9px] h-4 px-1 font-bold", TONE_CLASSES[statusTone])}>
                                        {it.ai_status === "aprovado" ? "✓" : it.ai_status === "alerta" ? "⚠" : "✗"}
                                      </Badge>
                                      {Math.abs(diff) > 0.01 && (
                                        <span className={cn("text-[10px] font-medium", diff > 0 ? "text-destructive" : "text-success")}>
                                          {diff > 0 ? "+" : ""}{formatCurrency(diff)} ({diffPct != null ? `${diffPct.toFixed(1)}%` : ""})
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] leading-tight text-muted-foreground max-w-[300px]">
                                      {findings?.alerts?.map((a: string, i: number) => (
                                        <p key={i}>• {a}</p>
                                      ))}
                                      {findings?.engine?.ai_note && <p className="italic">IA: {findings.engine.ai_note}</p>}
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
