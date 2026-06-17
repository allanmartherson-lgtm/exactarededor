import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Upload, Loader2, Download, FlaskConical, AlertTriangle, XCircle, CheckCircle2, Building2 } from "lucide-react";

type Status = "ok" | "sem_regra" | "divergente" | "hospital_errado";

interface RowResult {
  idx: number;
  item: {
    attendance_number: string | null;
    procedure_code: string | null;
    procedure_name: string | null;
    doctor_name: string | null;
    company_name: string | null;
    agreement_name: string | null;
    gross_amount: number;
  };
  status: Status;
  matched_rule_id: string | null;
  matched_rule_name: string | null;
  calculation_type_used: string | null;
  expected_amount: number | null;
  diff: number | null;
  diff_pct: number | null;
  alerts: string[];
  leaked_rule: { rule_id: string; rule_name: string | null; hospital_id: string | null } | null;
}

interface Summary {
  total: number; ok: number; sem_regra: number; divergente: number; hospital_errado: number;
  rules_hospital: number; rules_other: number; tolerance_pct: number; tolerance_abs: number;
}

// mapping leve da planilha de teste (mesmas chaves do parser real, mas simplificado)
const HEADER_MAP: Record<string, keyof RawItem> = {
  atendimento: "attendance_number", "nr atendimento": "attendance_number", "nº atendimento": "attendance_number",
  tuss: "procedure_code", codigo: "procedure_code", código: "procedure_code", "cod tuss": "procedure_code",
  procedimento: "procedure_name", descricao: "procedure_name", descrição: "procedure_name",
  medico: "doctor_name", médico: "doctor_name", profissional: "doctor_name",
  funcao: "doctor_role", função: "doctor_role", papel: "doctor_role",
  empresa: "company_name", terceiro: "company_name", prestadora: "company_name",
  convenio: "agreement_name", convênio: "agreement_name", operadora: "agreement_name",
  setor: "sector", "centro de custo": "sector",
  especialidade: "specialty",
  via: "access_route", "via de acesso": "access_route",
  data: "procedure_date", "data procedimento": "procedure_date", "data atendimento": "procedure_date",
  paciente: "patient_name",
  valor: "gross_amount", "valor pago": "gross_amount", "valor bruto": "gross_amount", "vl pago": "gross_amount",
  "valor procedimento": "procedure_amount", "valor convenio": "procedure_amount", "valor convênio": "procedure_amount",
  quantidade: "quantity", qtd: "quantity",
};

interface RawItem {
  attendance_number?: string; procedure_code?: string; procedure_name?: string;
  doctor_name?: string; doctor_role?: string; company_name?: string;
  agreement_name?: string; sector?: string; specialty?: string;
  access_route?: string; procedure_date?: string; patient_name?: string;
  gross_amount?: number; procedure_amount?: number; quantity?: number;
}

const norm = (s: string) => s.toString().toLowerCase().trim()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function parseNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return v;
  const s = v.toString().replace(/[^\d,.\-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseSheet(file: File): Promise<RawItem[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        const out: RawItem[] = rows.map((r) => {
          const item: RawItem = {};
          for (const [hdr, val] of Object.entries(r)) {
            const key = HEADER_MAP[norm(hdr)];
            if (!key) continue;
            if (key === "gross_amount" || key === "procedure_amount" || key === "quantity") {
              const n = parseNumber(val); if (n != null) (item as any)[key] = n;
            } else {
              const s = val?.toString().trim(); if (s) (item as any)[key] = s;
            }
          }
          return item;
        }).filter((it) => Object.keys(it).length > 0);
        resolve(out);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

const STATUS_LABEL: Record<Status, { label: string; cls: string; icon: any }> = {
  ok: { label: "OK", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  sem_regra: { label: "Sem regra", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: AlertTriangle },
  divergente: { label: "Divergente", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300", icon: XCircle },
  hospital_errado: { label: "Hospital errado", cls: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", icon: Building2 },
};

const BRL = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function RuleSimulatorBatch() {
  const { currentHospital } = useHospital();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<RawItem[]>([]);
  const [rows, setRows] = useState<RowResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [tolPct, setTolPct] = useState(0.5);
  const [tolAbs, setTolAbs] = useState(1);

  const onPickFile = async (f: File) => {
    try {
      const parsed = await parseSheet(f);
      if (parsed.length === 0) { toast({ title: "Planilha vazia ou sem colunas reconhecidas", variant: "destructive" }); return; }
      setItems(parsed);
      setRows([]); setSummary(null);
      toast({ title: `${parsed.length} linhas carregadas`, description: "Clique em 'Rodar simulação'." });
    } catch (e) {
      toast({ title: "Falha ao ler planilha", description: (e as Error).message, variant: "destructive" });
    }
  };

  const run = async () => {
    if (!currentHospital) { toast({ title: "Selecione um hospital", variant: "destructive" }); return; }
    if (items.length === 0) { toast({ title: "Carregue uma planilha primeiro", variant: "destructive" }); return; }
    setRunning(true);
    try {
      const CHUNK = 500;
      const all: RowResult[] = [];
      let summed: Summary | null = null;
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("simulate-rule-batch", {
          body: {
            items: chunk,
            hospital_id: currentHospital.id,
            tolerance_pct: tolPct,
            tolerance_abs: tolAbs,
          },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Falha");
        all.push(...(data.rows as RowResult[]).map((r) => ({ ...r, idx: r.idx + i })));
        const s: Summary = data.summary;
        summed = summed ? {
          ...s,
          total: summed.total + s.total,
          ok: summed.ok + s.ok,
          sem_regra: summed.sem_regra + s.sem_regra,
          divergente: summed.divergente + s.divergente,
          hospital_errado: summed.hospital_errado + s.hospital_errado,
        } : s;
      }
      setRows(all);
      setSummary(summed);
      toast({ title: "Simulação concluída", description: `${all.length} itens processados.` });
    } catch (e) {
      toast({ title: "Erro na simulação", description: (e as Error).message, variant: "destructive" });
    } finally { setRunning(false); }
  };

  const filtered = useMemo(() => filter === "all" ? rows : rows.filter((r) => r.status === filter), [rows, filter]);

  const downloadCsv = () => {
    if (rows.length === 0) return;
    const headers = ["status","atendimento","tuss","procedimento","medico","empresa","convenio","pago","esperado","diff","diff_pct","regra","tipo_calculo","alerta_hospital_errado","alertas"];
    const lines = [headers.join(";")];
    for (const r of rows) {
      lines.push([
        r.status,
        r.item.attendance_number ?? "",
        r.item.procedure_code ?? "",
        (r.item.procedure_name ?? "").replace(/;/g, ","),
        (r.item.doctor_name ?? "").replace(/;/g, ","),
        (r.item.company_name ?? "").replace(/;/g, ","),
        (r.item.agreement_name ?? "").replace(/;/g, ","),
        r.item.gross_amount?.toString().replace(".", ",") ?? "",
        r.expected_amount?.toString().replace(".", ",") ?? "",
        r.diff?.toString().replace(".", ",") ?? "",
        r.diff_pct?.toFixed(2).replace(".", ",") ?? "",
        (r.matched_rule_name ?? r.leaked_rule?.rule_name ?? "").replace(/;/g, ","),
        r.calculation_type_used ?? "",
        r.leaked_rule ? `regra de outro hospital (${r.leaked_rule.hospital_id?.slice(0,8) ?? "?"})` : "",
        (r.alerts ?? []).join(" | ").replace(/;/g, ","),
      ].join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `simulacao-lote-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3"><FlaskConical className="text-primary" /> Simulador em Lote</h1>
          <p className="text-muted-foreground mt-1">
            Suba uma planilha de teste e veja o que cada regra do hospital produziria — sem persistir nada.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Carregar planilha</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Selecionar XLSX/CSV
            </Button>
            <div className="flex gap-2 items-end">
              <div>
                <Label className="text-xs">Tolerância %</Label>
                <Input type="number" step="0.1" min="0" className="w-24" value={tolPct} onChange={(e) => setTolPct(Number(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Tolerância R$</Label>
                <Input type="number" step="0.5" min="0" className="w-24" value={tolAbs} onChange={(e) => setTolAbs(Number(e.target.value) || 0)} />
              </div>
              <Button onClick={run} disabled={running || items.length === 0}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
                Rodar simulação
              </Button>
            </div>
            {items.length > 0 && <Badge variant="secondary">{items.length} linhas carregadas</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Colunas reconhecidas: atendimento, tuss/código, procedimento, médico, função, empresa, convênio, setor, especialidade, via, data, paciente, valor (pago), valor procedimento, quantidade.
          </p>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader><CardTitle className="text-base">2. Resumo</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(["ok","divergente","sem_regra","hospital_errado"] as Status[]).map((s) => {
                const meta = STATUS_LABEL[s]; const Icon = meta.icon;
                const count = summary[s];
                const active = filter === s;
                return (
                  <button key={s}
                    onClick={() => setFilter(active ? "all" : s)}
                    className={`rounded-lg border p-4 text-left transition hover:bg-muted/50 ${active ? "ring-2 ring-primary" : ""}`}>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="h-4 w-4" /> {meta.label}
                    </div>
                    <div className="text-2xl font-bold mt-1">{count}</div>
                  </button>
                );
              })}
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Regras ativas</div>
                <div className="text-2xl font-bold mt-1">{summary.rules_hospital}</div>
                <div className="text-xs text-muted-foreground">+{summary.rules_other} em outros hospitais</div>
              </div>
            </div>
            <div className="flex justify-between items-center mt-4">
              <Button variant="ghost" size="sm" onClick={() => setFilter("all")} disabled={filter === "all"}>
                Limpar filtro
              </Button>
              <Button variant="outline" size="sm" onClick={downloadCsv}>
                <Download className="h-4 w-4 mr-2" /> Baixar CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">3. Resultados {filter !== "all" && <Badge className="ml-2">{filtered.length}</Badge>}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Atend.</TableHead>
                    <TableHead>TUSS</TableHead>
                    <TableHead>Médico</TableHead>
                    <TableHead>Empresa / Convênio</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead>Regra</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 500).map((r) => {
                    const meta = STATUS_LABEL[r.status]; const Icon = meta.icon;
                    return (
                      <TableRow key={r.idx}>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${meta.cls}`}>
                            <Icon className="h-3 w-3" /> {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.item.attendance_number ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.item.procedure_code ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.item.doctor_name ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <div>{r.item.company_name ?? "—"}</div>
                          <div className="text-muted-foreground">{r.item.agreement_name ?? ""}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{BRL(r.item.gross_amount)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{BRL(r.expected_amount)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs ${r.diff && Math.abs(r.diff) > tolAbs ? "text-rose-600 font-semibold" : ""}`}>
                          {r.diff != null ? `${r.diff > 0 ? "+" : ""}${BRL(r.diff)}` : "—"}
                          {r.diff_pct != null && <div className="text-[10px] text-muted-foreground">{r.diff_pct.toFixed(2)}%</div>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.matched_rule_name ?? (r.leaked_rule
                            ? <span className="text-fuchsia-600">⚠ {r.leaked_rule.rule_name} (outro hospital)</span>
                            : <span className="text-muted-foreground">sem regra</span>)}
                          {r.calculation_type_used && <div className="text-[10px] text-muted-foreground">{r.calculation_type_used}</div>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filtered.length > 500 && (
                <p className="p-3 text-xs text-muted-foreground text-center">
                  Mostrando 500 de {filtered.length}. Baixe o CSV para ver tudo.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
