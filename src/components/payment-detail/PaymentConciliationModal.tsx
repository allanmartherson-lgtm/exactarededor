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
} from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn, normalizeString } from "@/lib/utils";
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

const HEADER_ALIASES: Record<string, string[]> = {
  attendance: ["atendimento", "conta", "nratendimento", "numeroatendimento", "nr atendimento"],
  patient: ["paciente", "nome", "nomepaciente"],
  procCode: ["procedimento", "codprocedimento", "codigoprocedimento", "codigo", "codtuss", "tuss"],
  procName: ["descricao", "nomeprocedimento", "descprocedimento"],
  doctor: ["medico", "profissional", "prestador"],
  date: ["data", "dataatendimento", "dataprocedimento"],
  value: ["valor", "valorbruto", "grossamount", "valorpago", "valortotal"],
};

const pickHeader = (row: Record<string, unknown>, keys: string[]): unknown => {
  const normKeys = keys.map(normalizeString);
  for (const k of Object.keys(row)) {
    if (normKeys.includes(normalizeString(k))) {
      const v = row[k];
      if (v != null && String(v).trim() !== "") return v;
    }
  }
  return null;
};

const toNumber = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

const toDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // BR dd/mm/yyyy
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

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
      } else {
        setRun(null);
        setItems([]);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    try {
      // Upload arquivo para storage
      const storagePath = `${paymentId}/${Date.now()}_${file.name}`;
      await supabase.storage.from("reconciliation-files").upload(storagePath, file, { upsert: false });

      // Cria run
      const { data: newRun, error: runErr } = await (supabase as any)
        .from("reconciliation_runs")
        .insert({
          payment_id: paymentId,
          created_by: user?.id ?? null,
          status: "processing",
          file_name: file.name,
        })
        .select()
        .single();
      if (runErr) throw runErr;

      // Parse XLSX/CSV
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

      // Indexa MedPay por chave attendance + procedure_code
      const keyOf = (att: unknown, code: unknown) =>
        `${normalizeString(String(att ?? ""))}|${normalizeString(String(code ?? ""))}`;

      const medpayMap = new Map<string, PaymentItemRow[]>();
      for (const it of paymentItems) {
        const k = keyOf(it.attendance_number, it.procedure_code);
        if (!medpayMap.has(k)) medpayMap.set(k, []);
        medpayMap.get(k)!.push(it);
      }
      const matchedMedpayIds = new Set<string>();

      const toInsert: Omit<ReconciliationItem, "id" | "run_id">[] & Array<Record<string, unknown>> = [] as any;
      let conciliado = 0;
      let valor_divergente = 0;
      let so_hospital = 0;
      let so_medpay = 0;
      let risco_mais = 0; // hospital cobrou mais que MedPay pagou (valor_hospital > valor_medpay)
      let risco_menos = 0; // hospital cobrou menos que MedPay (possível pagamento a maior)
      let divergencia_valor = 0;

      for (const row of rows) {
        const att = pickHeader(row, HEADER_ALIASES.attendance);
        const code = pickHeader(row, HEADER_ALIASES.procCode);
        const valHosp = toNumber(pickHeader(row, HEADER_ALIASES.value));
        const k = keyOf(att, code);
        const matches = medpayMap.get(k) ?? [];
        const match = matches.find((m) => !matchedMedpayIds.has(m.id)) ?? matches[0];

        const base: Record<string, unknown> = {
          attendance_number: att ? String(att) : null,
          patient_name: (pickHeader(row, HEADER_ALIASES.patient) as string) || null,
          procedure_code: code ? String(code) : null,
          procedure_name: (pickHeader(row, HEADER_ALIASES.procName) as string) || null,
          doctor_name: (pickHeader(row, HEADER_ALIASES.doctor) as string) || null,
          procedure_date: toDate(pickHeader(row, HEADER_ALIASES.date)),
          valor_hospital: valHosp,
          valor_medpay: 0,
          payment_item_id: null,
          company_name: null,
          ia_obs: null,
          status: "so_hospital",
        };

        if (match) {
          matchedMedpayIds.add(match.id);
          const valMed = Number((match as any).gross_amount ?? 0);
          base.payment_item_id = match.id;
          base.valor_medpay = valMed;
          base.company_name = match.company_name ?? null;
          if (!base.patient_name) base.patient_name = match.patient_name ?? null;
          if (!base.doctor_name) base.doctor_name = (match as any).doctor_name ?? null;
          if (!base.procedure_name) base.procedure_name = (match as any).procedure_name ?? null;
          if (!base.procedure_date) base.procedure_date = (match as any).procedure_date ?? null;

          const diff = valHosp - valMed;
          if (Math.abs(diff) < 0.01) {
            base.status = "conciliado";
            conciliado++;
          } else {
            base.status = "valor_divergente";
            valor_divergente++;
            const pct = valMed > 0 ? (diff / valMed) * 100 : 0;
            base.ia_obs = `Divergência de ${formatCurrency(Math.abs(diff))} (${pct.toFixed(1)}%) entre MedPay (${formatCurrency(valMed)}) e extrato hospitalar (${formatCurrency(valHosp)}).`;
            divergencia_valor += Math.abs(diff);
            if (diff > 0) risco_mais += diff;
            else risco_menos += Math.abs(diff);
          }
        } else {
          base.status = "so_hospital";
          base.ia_obs = "Item ausente na base MedPay — possível inclusão após importação.";
          so_hospital++;
          risco_mais += valHosp;
        }

        toInsert.push(base);
      }

      // Itens MedPay sem match no hospital
      for (const it of paymentItems) {
        if (matchedMedpayIds.has(it.id)) continue;
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
          ia_obs: "Item presente no MedPay mas ausente no extrato hospitalar — verificar glosa.",
        } as any);
        so_medpay++;
        risco_menos += valMed;
      }

      // Insert em chunks
      const CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK).map((r) => ({ ...r, run_id: newRun.id }));
        const { error: insErr } = await (supabase as any).from("reconciliation_items").insert(slice);
        if (insErr) throw insErr;
      }

      const totals = {
        total_items: toInsert.length,
        conciliado,
        valor_divergente,
        so_hospital,
        so_medpay,
        risco_mais: Number(risco_mais.toFixed(2)),
        risco_menos: Number(risco_menos.toFixed(2)),
        divergencia_valor: Number(divergencia_valor.toFixed(2)),
        status: "done",
      };
      await (supabase as any).from("reconciliation_runs").update(totals).eq("id", newRun.id);

      toast({ title: "Conciliação concluída", description: `${toInsert.length} itens processados.` });
      await loadLatestRun();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Falha na conciliação", description: msg, variant: "destructive" });
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  const triggerNew = () => fileInputRef.current?.click();

  const filters: Array<{ key: string; label: string; count: number }> = [
    { key: "todos", label: "Todos", count: items.length },
    { key: "conciliado", label: "Conciliados", count: run?.conciliado ?? 0 },
    { key: "valor_divergente", label: "Valor divergente", count: run?.valor_divergente ?? 0 },
    { key: "so_hospital", label: "Só no hospital", count: run?.so_hospital ?? 0 },
    { key: "so_medpay", label: "Só no MedPay", count: run?.so_medpay ?? 0 },
  ];

  const total = run?.total_items ?? 0;
  const pendentes = (run?.valor_divergente ?? 0) + (run?.so_hospital ?? 0) + (run?.so_medpay ?? 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-none p-0 flex flex-col h-screen overflow-hidden">
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
            {run && (
              <Button variant="outline" size="sm" onClick={triggerNew} disabled={processing}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Nova conciliação
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!run || run.status !== "done"}>
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
          onChange={handleFileUpload}
        />

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-muted/10">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          )}

          {!loading && !run && (
            <Card>
              <CardContent className="p-6">
                <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                  {processing ? (
                    <>
                      <Loader2 className="h-8 w-8 mx-auto mb-3 text-primary animate-spin" />
                      <p className="text-sm font-medium">Processando conciliação...</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Cruzando linhas do extrato com a base MedPay.
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-sm font-medium">Carregar extrato hospitalar</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Arquivo .xlsx ou .csv exportado do sistema hospitalar
                      </p>
                      <Button className="mt-4" onClick={triggerNew}>
                        Selecionar arquivo
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && run && (
            <>
              {processing && (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Processando nova conciliação...
                </div>
              )}

              {/* KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KpiCard
                  icon={CheckCircle2}
                  tone="success"
                  label="Conciliados"
                  value={`${run.conciliado} itens`}
                  hint={total ? `${((run.conciliado / total) * 100).toFixed(1)}% do total` : ""}
                  active={activeFilter === "conciliado"}
                  onClick={() => setActiveFilter(activeFilter === "conciliado" ? "todos" : "conciliado")}
                />
                <KpiCard
                  icon={AlertTriangle}
                  tone="warning"
                  label="Valor divergente"
                  value={`${run.valor_divergente} itens`}
                  hint="revisar valor"
                  active={activeFilter === "valor_divergente"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "valor_divergente" ? "todos" : "valor_divergente")
                  }
                />
                <KpiCard
                  icon={XCircle}
                  tone="destructive"
                  label="Só no hospital"
                  value={`${run.so_hospital} itens`}
                  hint="possível inclusão"
                  active={activeFilter === "so_hospital"}
                  onClick={() => setActiveFilter(activeFilter === "so_hospital" ? "todos" : "so_hospital")}
                />
                <KpiCard
                  icon={Info}
                  tone="info"
                  label="Só no MedPay"
                  value={`${run.so_medpay} itens`}
                  hint="possível glosa"
                  active={activeFilter === "so_medpay"}
                  onClick={() => setActiveFilter(activeFilter === "so_medpay" ? "todos" : "so_medpay")}
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

              {/* Tabela */}
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider">Atend.</TableHead>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider">
                        Paciente / Procedimento
                      </TableHead>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider">Médico</TableHead>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider">Data</TableHead>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">
                        MedPay (R$)
                      </TableHead>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider text-right">
                        Hospital (R$)
                      </TableHead>
                      <TableHead className="px-3 py-2 text-[10px] uppercase tracking-wider">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                          Nenhum item encontrado para o filtro selecionado.
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredItems.map((it) => {
                      const isOpen = expanded === it.id;
                      const hasObs = !!it.ia_obs;
                      return (
                        <>
                          <TableRow
                            key={it.id}
                            className="cursor-pointer"
                            onClick={() => setExpanded(isOpen ? null : it.id)}
                          >
                            <TableCell className="px-3 py-2 text-[12px]">
                              <div className="flex items-center gap-1">
                                {hasObs ? (
                                  isOpen ? (
                                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                  )
                                ) : (
                                  <span className="w-3" />
                                )}
                                {it.attendance_number ?? "—"}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2 text-[12px]">
                              <div className="font-medium">{it.patient_name ?? "—"}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {it.procedure_code ? `${it.procedure_code} · ` : ""}
                                {it.procedure_name ?? ""}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2 text-[12px]">{it.doctor_name ?? "—"}</TableCell>
                            <TableCell className="px-3 py-2 text-[12px]">
                              {it.procedure_date
                                ? new Date(it.procedure_date).toLocaleDateString("pt-BR")
                                : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums">
                              {it.valor_medpay ? formatCurrency(Number(it.valor_medpay)) : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums">
                              {it.valor_hospital ? formatCurrency(Number(it.valor_hospital)) : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <span
                                className={cn(
                                  "pill inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                                  STATUS_TONE[it.status],
                                )}
                              >
                                {STATUS_LABEL[it.status]}
                              </span>
                            </TableCell>
                          </TableRow>
                          {isOpen && hasObs && (
                            <TableRow key={`${it.id}-exp`}>
                              <TableCell colSpan={7} className="bg-info/5 px-4 py-3">
                                <div className="flex gap-3">
                                  <div className="shrink-0 p-1.5 rounded-full bg-info/10 text-info h-fit">
                                    <Lightbulb className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-info mb-1">
                                      Análise IA
                                    </p>
                                    <p className="text-[12px] text-foreground">{it.ia_obs}</p>
                                    <div className="flex gap-2 mt-3">
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
                <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
                  Exibindo {filteredItems.length} de {total} itens · {run.conciliado} conciliados ·{" "}
                  {pendentes} pendentes de revisão
                </div>
              </Card>
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
