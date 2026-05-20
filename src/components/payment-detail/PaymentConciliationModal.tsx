import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileDown,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Loader2,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Building2,
} from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/status";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

type ReconciliationRun = {
  id: string;
  payment_id: string;
  status: "processing" | "done" | "error";
  file_name: string | null;
  total_items: number;
  conciliado: number;
  valor_divergente: number;
  so_hospital: number;
  so_medpay: number;
  risco_mais: number;
  risco_menos: number;
  divergencia_valor: number;
  created_at: string;
};

type ReconciliationItem = {
  id: string;
  run_id: string;
  payment_item_id: string | null;
  attendance_number: string | null;
  patient_name: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  doctor_name: string | null;
  procedure_date: string | null;
  valor_medpay: number;
  valor_hospital: number;
  status: "conciliado" | "valor_divergente" | "so_hospital" | "so_medpay";
  ia_obs: string | null;
  company_name: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentReference: string;
  paymentItems: PaymentItemRow[];
}

type Step = "upload" | "mapping" | "result";

const detectColumns = (rows: Record<string, unknown>[]): Record<string, string> => {
  if (rows.length === 0) return {};
  const aliases: Record<string, string[]> = {
    attendance: ["atendimento", "nr atendimento", "nratendimento"],
    account: ["conta", "nrconta", "numeroconta"],
    patient: ["nome", "paciente", "nomepaciente"],
    procCode: ["código tuss (8d)", "codigotuss8d", "tuss8d", "codigo tuss (8d)", "codigo", "código", "codprocedimento", "codigoprocedimento", "codtuss"],
    procName: ["procedimento/mat-med", "procedimento", "descricao", "nomeprocedimento"],
    doctor: ["médico exec.", "medico exec.", "medicoexec", "medico", "profissional"],
    date: ["dt. proced.", "dt proced", "data", "dataatendimento", "dtproced"],
    value: ["vl. rep. calc.", "vl rep calc", "vlrepcalc", "valor", "valorbruto"],
    company: ["terceiro", "empresa", "prestador"],
  };
  const normKey = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]/g, "");
  const map: Record<string, string> = {};
  for (const col of Object.keys(rows[0])) {
    const normCol = normKey(col);
    for (const [field, aliasList] of Object.entries(aliases)) {
      if (aliasList.some((a) => normKey(a) === normCol)) {
        map[field] = col;
        break;
      }
    }
  }
  return map;
};

const STATUS_LABEL: Record<ReconciliationItem["status"], string> = {
  conciliado: "Conciliado",
  valor_divergente: "Valor divergente",
  so_hospital: "Só no hospital",
  so_medpay: "Só no MedPay",
};

const STATUS_TONE: Record<ReconciliationItem["status"], string> = {
  conciliado: "bg-success/10 text-success border-success/30",
  valor_divergente: "bg-warning/10 text-warning-foreground border-warning/30",
  so_hospital: "bg-destructive/10 text-destructive border-destructive/30",
  so_medpay: "bg-info/10 text-info border-info/30",
};

export function PaymentConciliationModal({
  open,
  onOpenChange,
  paymentId,
  paymentReference,
  paymentItems,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [run, setRun] = useState<ReconciliationRun | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("todos");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [step, setStep] = useState<Step>("upload");
  const [hospitalCompanies, setHospitalCompanies] = useState<string[]>([]);
  const [companyMapping, setCompanyMapping] = useState<Record<string, string | null>>({});
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [parsedColMap, setParsedColMap] = useState<Record<string, string>>({});
  const [pendingFileName, setPendingFileName] = useState<string>("");

  const loteCompanies = useMemo(
    () =>
      Array.from(
        new Set(paymentItems.map((it) => it.company_name ?? "").filter(Boolean)),
      ).sort(),
    [paymentItems],
  );

  const loadLatestRun = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("reconciliation_runs")
        .select("*")
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setRun(data as ReconciliationRun);
        const { data: its } = await (supabase as any)
          .from("reconciliation_items")
          .select("*")
          .eq("run_id", data.id)
          .order("created_at");
        setItems((its ?? []) as ReconciliationItem[]);
        setStep("result");
      } else {
        setRun(null);
        setItems([]);
        setStep("upload");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Erro ao carregar conciliação", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [paymentId, toast]);

  useEffect(() => {
    if (open) loadLatestRun();
  }, [open, loadLatestRun]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

      const colMap = detectColumns(rows);
      const companyCol = colMap["company"];

      const terceiros = Array.from(
        new Set(
          rows
            .map((r) => (companyCol ? String(r[companyCol] ?? "").trim() : ""))
            .filter(Boolean),
        ),
      ).sort();

      const normFull = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

      const autoMapping: Record<string, string | null> = {};
      for (const terceiro of terceiros) {
        const normT = normFull(terceiro);
        const match = loteCompanies.find((lc) => {
          const normL = normFull(lc);
          return normT === normL || normT.includes(normL) || normL.includes(normT);
        });
        autoMapping[terceiro] = match ?? null;
      }

      setParsedRows(rows);
      setParsedColMap(colMap);
      setPendingFileName(file.name);
      setHospitalCompanies(terceiros);
      setCompanyMapping(autoMapping);
      setStep("mapping");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Erro ao ler arquivo", description: msg, variant: "destructive" });
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleProcessReconciliation = async () => {
    setProcessing(true);
    try {
      const { data: newRun, error: runErr } = await (supabase as any)
        .from("reconciliation_runs")
        .insert({
          payment_id: paymentId,
          created_by: user?.id ?? null,
          status: "processing",
          file_name: pendingFileName,
        })
        .select()
        .single();
      if (runErr) throw runErr;

      const normFull = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

      const getCell = (row: Record<string, unknown>, field: string): unknown => {
        const col = parsedColMap[field];
        if (!col) return null;
        const v = row[col];
        return v != null && String(v).trim() !== "" ? v : null;
      };

      const toVal = (v: unknown): number => {
        if (v == null || v === "") return 0;
        if (typeof v === "number") return isNaN(v) ? 0 : v;
        const s = String(v).replace(/[R$\s.]/g, "").replace(",", ".");
        return parseFloat(s) || 0;
      };

      const toDateStr = (v: unknown): string | null => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v).trim();
        const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (br) return `${br[3]}-${br[2]}-${br[1]}`;
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[0];
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };

      const filteredRows = parsedRows.filter((row) => {
        const col = parsedColMap["company"];
        const terceiro = col ? String(row[col] ?? "").trim() : "";
        return terceiro && companyMapping[terceiro];
      });

      const normalizeCode = (code: unknown): string => {
        if (code == null || code === '') return '';
        // Remove casas decimais (ex: 31005470.0 -> 31005470)
        const num = parseFloat(String(code));
        if (!isNaN(num)) return String(Math.round(num));
        return String(code).replace(/\D/g, '');
      };

      const normAtt = (att: unknown): string =>
        String(Number(att) || att).replace(/\D/g, "");

      const makeKey = (att: unknown, code: unknown): string =>
        `${normAtt(att)}|${normalizeCode(code)}`;

      const medpayByKey = new Map<string, PaymentItemRow[]>();
      for (const it of paymentItems) {
        const k = makeKey(it.attendance_number, it.procedure_code);
        if (!medpayByKey.has(k)) medpayByKey.set(k, []);
        medpayByKey.get(k)!.push(it);
      }

      const matchedMedpayIds = new Set<string>();
      const toInsert: Array<Record<string, unknown>> = [];
      let conciliado = 0,
        valor_divergente = 0,
        so_hospital = 0,
        so_medpay = 0;
      let risco_mais = 0,
        risco_menos = 0,
        divergencia_valor = 0;

      for (const row of filteredRows) {
        const att = getCell(row, "attendance");
        const account = getCell(row, "account");
        const code = getCell(row, "procCode");
        const valHosp = toVal(getCell(row, "value"));
        const patient = getCell(row, "patient");
        const doctor = getCell(row, "doctor");
        const procName = getCell(row, "procName");
        const dateRaw = getCell(row, "date");
        const col = parsedColMap["company"];
        const terceiro = col ? String(row[col] ?? "").trim() : "";
        const mappedCompany = companyMapping[terceiro] ?? terceiro;
        const dateStr = toDateStr(dateRaw);
        const k = makeKey(att, code);
        const candidates = medpayByKey.get(k) ?? [];
        const match = candidates.find((m) => !matchedMedpayIds.has(m.id));

        const base: Record<string, unknown> = {
          attendance_number: att ? String(att) : (account ? String(account) : null),
          patient_name: patient ? String(patient) : null,
          procedure_code: code ? String(code) : null,
          procedure_name: procName ? String(procName) : null,
          doctor_name: doctor ? String(doctor) : null,
          procedure_date: dateStr,
          valor_hospital: valHosp,
          valor_medpay: 0,
          payment_item_id: null,
          company_name: mappedCompany,
          ia_obs: null,
          status: "so_hospital",
        };

        if (match) {
          matchedMedpayIds.add(match.id);
          const valMed = Number((match as any).gross_amount ?? 0);
          base.payment_item_id = match.id;
          base.valor_medpay = valMed;
          if (!base.patient_name) base.patient_name = match.patient_name ?? null;
          if (!base.doctor_name) base.doctor_name = (match as any).doctor_name ?? null;
          if (!base.procedure_name) base.procedure_name = (match as any).procedure_name ?? null;
          if (!base.procedure_date) base.procedure_date = (match as any).procedure_date ?? null;
          if (!base.company_name) base.company_name = match.company_name ?? null;

          const diff = valHosp - valMed;
          if (Math.abs(diff) < 0.02) {
            base.status = "conciliado";
            conciliado++;
          } else {
            base.status = "valor_divergente";
            valor_divergente++;
            const pct = valMed > 0 ? (diff / valMed) * 100 : 0;
            const signal = diff > 0 ? "a mais" : "a menos";
            base.ia_obs = `Hospital cobrou ${formatCurrency(Math.abs(diff))} ${signal} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%). MedPay: ${formatCurrency(valMed)} · Hospital: ${formatCurrency(valHosp)}.`;
            divergencia_valor += Math.abs(diff);
            if (diff > 0) risco_mais += diff;
            else risco_menos += Math.abs(diff);
          }
        } else {
          base.status = "so_hospital";
          base.ia_obs = `Item de ${mappedCompany} presente no extrato hospitalar mas ausente na base MedPay. Possível inclusão após importação do lote.`;
          so_hospital++;
          risco_mais += valHosp;
        }
        toInsert.push(base);
      }

      const mappedLoteCompanies = new Set(
        Object.values(companyMapping).filter(Boolean) as string[],
      );
      for (const it of paymentItems) {
        if (matchedMedpayIds.has(it.id)) continue;
        if (!mappedLoteCompanies.has(it.company_name ?? "")) continue;
        const valMed = Number((it as any).gross_amount ?? 0);
        toInsert.push({
          payment_item_id: it.id,
          attendance_number: it.attendance_number ?? null,
          patient_name: it.patient_name ?? null,
          procedure_code: it.procedure_code ?? null,
          procedure_name: (it as any).procedure_name ?? null,
          doctor_name: (it as any).doctor_name ?? null,
          procedure_date: (it as any).procedure_date ?? null,
          valor_medpay: valMed,
          valor_hospital: 0,
          company_name: it.company_name ?? null,
          status: "so_medpay",
          ia_obs: `Item de ${it.company_name ?? "empresa"} presente no MedPay mas ausente no extrato hospitalar — verificar glosa.`,
        });
        so_medpay++;
        risco_menos += valMed;
      }

      const CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK).map((r) => ({ ...r, run_id: newRun.id }));
        const { error: insErr } = await (supabase as any)
          .from("reconciliation_items")
          .insert(slice);
        if (insErr) throw insErr;
      }

      await (supabase as any)
        .from("reconciliation_runs")
        .update({
          total_items: toInsert.length,
          conciliado,
          valor_divergente,
          so_hospital,
          so_medpay,
          risco_mais: Number(risco_mais.toFixed(2)),
          risco_menos: Number(risco_menos.toFixed(2)),
          divergencia_valor: Number(divergencia_valor.toFixed(2)),
          status: "done",
        })
        .eq("id", newRun.id);

      toast({
        title: "Conciliação concluída",
        description: `${toInsert.length} itens processados.`,
      });
      await loadLatestRun();
      setStep("result");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Falha na conciliação", description: msg, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (activeFilter === "todos") return items;
    return items.filter((it) => it.status === activeFilter);
  }, [items, activeFilter]);

  const handleExport = () => {
    if (!run) return;
    const data = items.map((it) => ({
      Status: STATUS_LABEL[it.status],
      Atendimento: it.attendance_number ?? "",
      Paciente: it.patient_name ?? "",
      Codigo: it.procedure_code ?? "",
      Procedimento: it.procedure_name ?? "",
      Medico: it.doctor_name ?? "",
      Data: it.procedure_date ?? "",
      "MedPay (R$)": it.valor_medpay,
      "Hospital (R$)": it.valor_hospital,
      "Diferença (R$)": Number((it.valor_hospital - it.valor_medpay).toFixed(2)),
      "Observação IA": it.ia_obs ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conciliação");
    XLSX.writeFile(wb, `conciliacao_${paymentReference.replace(/[^a-z0-9]/gi, "_")}.xlsx`);
  };

  const triggerNew = () => {
    setStep("upload");
    setRun(null);
    setItems([]);
    setParsedRows([]);
    setCompanyMapping({});
    setHospitalCompanies([]);
    setPendingFileName("");
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const filters: Array<{ key: string; label: string; count: number }> = [
    { key: "todos", label: "Todos", count: items.length },
    { key: "conciliado", label: "Conciliados", count: run?.conciliado ?? 0 },
    { key: "valor_divergente", label: "Valor divergente", count: run?.valor_divergente ?? 0 },
    { key: "so_hospital", label: "Só no hospital", count: run?.so_hospital ?? 0 },
    { key: "so_medpay", label: "Só no MedPay", count: run?.so_medpay ?? 0 },
  ];

  const total = run?.total_items ?? 0;
  const pendentes =
    (run?.valor_divergente ?? 0) + (run?.so_hospital ?? 0) + (run?.so_medpay ?? 0);

  const vinculadasCount = Object.values(companyMapping).filter(Boolean).length;
  const ignoradasCount = Object.values(companyMapping).filter((v) => v === null).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-none p-0 flex flex-col h-screen overflow-hidden"
      >
        {/* Header */}
        <div className="border-b bg-muted/30 p-4 sticky top-0 z-10 flex items-center justify-between">
          <div>
            <SheetTitle className="text-xl">
              Conciliação de Produção — {paymentReference}
            </SheetTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Cruzamento entre base MedPay e extrato hospitalar
            </p>
          </div>
          <div className="flex gap-2">
            {step === "result" && run && (
              <Button variant="outline" size="sm" onClick={triggerNew} disabled={processing}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Nova conciliação
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!run || run.status !== "done" || step !== "result"}
            >
              <FileDown className="h-4 w-4 mr-1.5" />
              Exportar relatório
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-muted/10">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          )}

          {!loading && step === "upload" && (
            <Card>
              <CardContent className="p-6">
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                  {processing ? (
                    <>
                      <Loader2 className="h-8 w-8 mx-auto mb-3 text-primary animate-spin" />
                      <p className="text-sm font-medium">Lendo arquivo...</p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-sm font-medium">Carregar extrato hospitalar</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Arquivo .xlsx ou .csv exportado do sistema hospitalar
                      </p>
                      <Button className="mt-4" onClick={() => fileInputRef.current?.click()}>
                        Selecionar arquivo
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && step === "mapping" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-4 bg-info-soft/40 border border-info/20 rounded-lg">
                <div className="p-2 rounded-full bg-info/10 text-info shrink-0">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Vincular empresas da planilha ao lote</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {hospitalCompanies.length} empresas encontradas em{" "}
                    <strong>{pendingFileName}</strong>. Vincule cada uma a uma empresa do lote ou
                    deixe como "Ignorar" para excluir da conciliação.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-success" /> Auto-vinculado
                </span>
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-warning" /> Não vinculado
                </span>
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Ignorado
                </span>
              </div>

              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {hospitalCompanies.map((terceiro) => {
                  const mapped = companyMapping[terceiro];
                  return (
                    <div
                      key={terceiro}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border",
                        mapped
                          ? "border-success/30 bg-success/5"
                          : mapped === null
                            ? "border-border bg-muted/30"
                            : "border-warning/30 bg-warning/5",
                      )}
                    >
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          mapped
                            ? "bg-success"
                            : mapped === null
                              ? "bg-muted-foreground/40"
                              : "bg-warning",
                        )}
                      />
                      <p
                        className="text-xs flex-1 min-w-0 truncate font-medium"
                        title={terceiro}
                      >
                        {terceiro}
                      </p>
                      <select
                        value={mapped ?? "__ignore__"}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCompanyMapping((prev) => ({
                            ...prev,
                            [terceiro]: val === "__ignore__" ? null : val,
                          }));
                        }}
                        className="h-8 text-xs border border-border rounded-md bg-background px-2 shrink-0 w-[280px]"
                      >
                        <option value="__ignore__">— Ignorar —</option>
                        {loteCompanies.map((lc) => (
                          <option key={lc} value={lc}>
                            {lc}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <span className="text-success font-semibold">{vinculadasCount}</span>{" "}
                  vinculadas ·{" "}
                  <span className="text-muted-foreground">{ignoradasCount}</span> ignoradas
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStep("upload");
                      setParsedRows([]);
                    }}
                  >
                    ← Voltar
                  </Button>
                  <Button
                    size="sm"
                    disabled={processing || vinculadasCount === 0}
                    onClick={handleProcessReconciliation}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        Processando...
                      </>
                    ) : (
                      `Conciliar ${vinculadasCount} empresa(s) →`
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!loading && step === "result" && run && (
            <>
              {processing && (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Processando nova
                  conciliação...
                </div>
              )}

              {/* Info do arquivo */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-lg text-xs text-muted-foreground">
                <FileDown className="h-4 w-4 shrink-0" />
                <span>
                  <strong>{run.file_name}</strong> · {run.total_items} linhas do lote processadas
                  · conciliação em {new Date(run.created_at).toLocaleString("pt-BR")}
                </span>
              </div>

              {/* KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KpiCard
                  icon={CheckCircle2}
                  tone="success"
                  label="Conciliados"
                  value={`${run.conciliado} itens`}
                  hint={total ? `${((run.conciliado / total) * 100).toFixed(1)}% do total` : ""}
                  active={activeFilter === "conciliado"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "conciliado" ? "todos" : "conciliado")
                  }
                />
                <KpiCard
                  icon={AlertTriangle}
                  tone="warning"
                  label="Valor divergente"
                  value={`${run.valor_divergente} itens`}
                  hint="revisar valor"
                  active={activeFilter === "valor_divergente"}
                  onClick={() =>
                    setActiveFilter(
                      activeFilter === "valor_divergente" ? "todos" : "valor_divergente",
                    )
                  }
                />
                <KpiCard
                  icon={XCircle}
                  tone="destructive"
                  label="Só no hospital"
                  value={`${run.so_hospital} itens`}
                  hint="possível inclusão"
                  active={activeFilter === "so_hospital"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "so_hospital" ? "todos" : "so_hospital")
                  }
                />
                <KpiCard
                  icon={Info}
                  tone="info"
                  label="Só no MedPay"
                  value={`${run.so_medpay} itens`}
                  hint="possível glosa"
                  active={activeFilter === "so_medpay"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "so_medpay" ? "todos" : "so_medpay")
                  }
                />
              </div>

              {/* Impacto financeiro */}
              <Card>
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Risco pagamento a mais
                    </p>
                    <p className="text-lg font-bold text-destructive mt-1">
                      {formatCurrency(Number(run.risco_mais))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Risco pagamento a menos
                    </p>
                    <p className="text-lg font-bold text-success mt-1">
                      {formatCurrency(Number(run.risco_menos))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Divergência de valores
                    </p>
                    <p className="text-lg font-bold text-warning-foreground mt-1">
                      {formatCurrency(Number(run.divergencia_valor))}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Tabs de filtro */}
              <div className="filter-tabs flex flex-wrap gap-2 border-b border-border pb-2">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-colors border",
                      activeFilter === f.key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-muted",
                    )}
                  >
                    {f.label} ({f.count})
                  </button>
                ))}
              </div>

              {/* Visão agrupada por empresa */}
              <div className="space-y-2">
                {filteredItems.length === 0 && (
                  <Card>
                    <div className="text-center text-sm text-muted-foreground py-8">
                      Nenhum item encontrado para o filtro selecionado.
                    </div>
                  </Card>
                )}
                {(() => {
                  const grouped = new Map<string, ReconciliationItem[]>();
                  for (const it of filteredItems) {
                    const key = it.company_name ?? "(sem empresa)";
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key)!.push(it);
                  }

                  return Array.from(grouped.entries()).map(([company, companyItems]) => {
                    const isOpen = expandedCompany === company;
                    const counts = {
                      conciliado: companyItems.filter((i) => i.status === "conciliado").length,
                      valor_divergente: companyItems.filter((i) => i.status === "valor_divergente").length,
                      so_hospital: companyItems.filter((i) => i.status === "so_hospital").length,
                      so_medpay: companyItems.filter((i) => i.status === "so_medpay").length,
                    };
                    const totalHosp = companyItems.reduce((s, i) => s + Number(i.valor_hospital), 0);
                    const totalMed = companyItems.reduce((s, i) => s + Number(i.valor_medpay), 0);
                    const hasPendencias =
                      counts.valor_divergente + counts.so_hospital + counts.so_medpay > 0;

                    return (
                      <Card
                        key={company}
                        className={cn(
                          "shadow-card overflow-hidden",
                          hasPendencias && "border-warning/30",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedCompany(isOpen ? null : company)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{company}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {companyItems.length} itens
                              {counts.conciliado > 0 && (
                                <span className="text-success ml-2">
                                  · {counts.conciliado} conciliados
                                </span>
                              )}
                              {counts.valor_divergente > 0 && (
                                <span className="text-warning-foreground ml-2">
                                  · {counts.valor_divergente} com divergência
                                </span>
                              )}
                              {counts.so_hospital > 0 && (
                                <span className="text-destructive ml-2">
                                  · {counts.so_hospital} só no hospital
                                </span>
                              )}
                              {counts.so_medpay > 0 && (
                                <span className="text-info ml-2">
                                  · {counts.so_medpay} só no MedPay
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-muted-foreground">Hospital</p>
                            <p className="text-sm font-semibold tabular-nums">
                              {formatCurrency(totalHosp)}
                            </p>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className="text-xs text-muted-foreground">MedPay</p>
                            <p className="text-sm font-semibold tabular-nums">
                              {formatCurrency(totalMed)}
                            </p>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="border-t border-border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Médico</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">
                                    Paciente / Procedimento
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Data</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    MedPay (R$)
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    Hospital (R$)
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {companyItems.map((it) => {
                                  const isRowOpen = expanded === it.id;
                                  return (
                                    <>
                                      <TableRow
                                        key={it.id}
                                        className="cursor-pointer"
                                        onClick={() => setExpanded(isRowOpen ? null : it.id)}
                                      >
                                        <TableCell className="px-3 py-2 text-[12px]">
                                          {it.doctor_name ?? "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px]">
                                          <div className="font-medium">{it.patient_name ?? "—"}</div>
                                          <div className="text-[11px] text-muted-foreground">
                                            {it.procedure_code ? `${it.procedure_code} · ` : ""}
                                            {it.procedure_name ?? ""}
                                          </div>
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px]">
                                          {it.procedure_date
                                            ? new Date(it.procedure_date).toLocaleDateString("pt-BR")
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums">
                                          {it.valor_medpay
                                            ? formatCurrency(Number(it.valor_medpay))
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums">
                                          {it.valor_hospital
                                            ? formatCurrency(Number(it.valor_hospital))
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                          <span
                                            className={cn(
                                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                                              STATUS_TONE[it.status],
                                            )}
                                          >
                                            {STATUS_LABEL[it.status]}
                                          </span>
                                        </TableCell>
                                      </TableRow>
                                      {isRowOpen && it.ia_obs && (
                                        <TableRow key={`${it.id}-exp`}>
                                          <TableCell colSpan={6} className="bg-info/5 px-4 py-3">
                                            <div className="flex gap-3">
                                              <Lightbulb className="h-4 w-4 text-info shrink-0 mt-0.5" />
                                              <div className="flex-1">
                                                <p className="text-[11px] font-semibold uppercase tracking-wider text-info mb-1">
                                                  Análise IA
                                                </p>
                                                <p className="text-[12px]">{it.ia_obs}</p>
                                                <div className="flex gap-2 mt-2">
                                                  {it.status === "so_hospital" && (
                                                    <Button size="sm">Incorporar ao ciclo</Button>
                                                  )}
                                                  {it.status === "so_medpay" && (
                                                    <Button size="sm" variant="outline">
                                                      Marcar como glosado
                                                    </Button>
                                                  )}
                                                  {it.status === "valor_divergente" && (
                                                    <Button size="sm" variant="outline">
                                                      Revisar manualmente
                                                    </Button>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </TableCell>
                                        </TableRow>
                                      )}
                                    </>
                                  );
                                })}
                              </TableBody>
                            </Table>
                            <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                              <span>{companyItems.length} itens</span>
                              <div className="flex gap-6">
                                <span>
                                  MedPay:{" "}
                                  <strong className="tabular-nums">{formatCurrency(totalMed)}</strong>
                                </span>
                                <span>
                                  Hospital:{" "}
                                  <strong className="tabular-nums">{formatCurrency(totalHosp)}</strong>
                                </span>
                                <span
                                  className={cn(
                                    "font-semibold tabular-nums",
                                    totalHosp - totalMed > 0
                                      ? "text-destructive"
                                      : totalHosp - totalMed < 0
                                        ? "text-success"
                                        : "text-muted-foreground",
                                  )}
                                >
                                  Δ {formatCurrency(Math.abs(totalHosp - totalMed))}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  });
                })()}
              </div>

              {/* Footer geral */}
              <div className="text-xs text-muted-foreground pt-1">
                {filteredItems.length} itens de {total} · {run?.conciliado ?? 0} conciliados ·{" "}
                {pendentes} pendentes de revisão
              </div>

            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "success" | "warning" | "destructive" | "info";
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClasses: Record<string, string> = {
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/30 bg-warning/5 text-warning-foreground",
    destructive: "border-destructive/30 bg-destructive/5 text-destructive",
    info: "border-info/30 bg-info/5 text-info",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-2xl border bg-card shadow-card transition-all p-4 flex items-center gap-3 hover:shadow-md",
        toneClasses[tone],
        active && "ring-2 ring-offset-1 ring-current",
      )}
    >
      <div className={cn("p-2 rounded-full bg-background/60")}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider">{label}</p>
        <p className="text-lg font-bold text-foreground">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </button>
  );
}
