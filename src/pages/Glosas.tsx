import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/status";
import { toast } from "sonner";
import { Upload, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import * as XLSX from "xlsx";

// ── Primitivos visuais (padrão MedPay) ─────────────────────────────

const SurfaceCard = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, ...style }}>
    {children}
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" as const }}>{children}</span>
    <div style={{ flex: 1, height: 1, background: "hsl(var(--border))" }} />
  </div>
);

const DEFAULT_COLUMN_MAP = {
  attendance_number: "X",
  procedure_code: "AF",
  procedure_name: "AG",
  procedure_date: "AI",
  sector: "AJ",
  doctor_name: "AK",
  doctor_crm: "AL",
  patient_name: "U",
  convenio: "D",
  valor_cobrado: "AU",
  valor_glosa: "AW",
  motivo_glosa: "AY",
  complemento_glosa: "AZ",
};

function colLetterToIndex(letter: string): number {
  letter = letter.toUpperCase();
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result - 1;
}

function parseGlosaFile(
  rows: any[][],
  headerRow: number,
  colMap: typeof DEFAULT_COLUMN_MAP
): { items: any[]; headers: string[] } {
  const headers = rows[headerRow] ?? [];
  const dataRows = rows.slice(headerRow + 1);
  const items = dataRows
    .filter(row => row.some(c => c != null && c !== ""))
    .map(row => {
      const get = (col: string) => {
        const idx = colLetterToIndex(col);
        return idx < row.length ? row[idx] : null;
      };

      const toNum = (v: any): number => {
        if (v === null || v === undefined || v === "") return 0;
        if (typeof v === "number") return v;
        const s = String(v).replace(",", ".").replace(/[^\d.-]/g, "");
        return parseFloat(s) || 0;
      };

      const toDate = (v: any): string | null => {
        if (!v) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "number") {
          const d = new Date(Math.round((v - 25569) * 86400 * 1000));
          return d.toISOString().slice(0, 10);
        }
        return String(v).slice(0, 10) || null;
      };

      const valorGlosa = toNum(get(colMap.valor_glosa));
      if (valorGlosa === 0) return null;
      return {
        attendance_number: String(get(colMap.attendance_number) ?? "").trim() || null,
        procedure_code: String(get(colMap.procedure_code) ?? "").trim() || null,
        procedure_name: String(get(colMap.procedure_name) ?? "").trim() || null,
        procedure_date: toDate(get(colMap.procedure_date)),
        sector: String(get(colMap.sector) ?? "").trim() || null,
        doctor_name: String(get(colMap.doctor_name) ?? "").trim() || null,
        doctor_crm: String(get(colMap.doctor_crm) ?? "").trim() || null,
        patient_name: String(get(colMap.patient_name) ?? "").trim() || null,
        convenio: String(get(colMap.convenio) ?? "").trim() || null,
        valor_cobrado: toNum(get(colMap.valor_cobrado)),
        valor_glosa: valorGlosa,
        motivo_glosa: String(get(colMap.motivo_glosa) ?? "").trim() || null,
        complemento_glosa: String(get(colMap.complemento_glosa) ?? "").trim() || null,
      };
    })
    .filter(Boolean) as any[];
  return { items, headers: headers.map(String) };
}

const FIELD_LABELS: Record<string, string> = {
  attendance_number: "Num. Atendimento *",
  procedure_code: "Código TUSS",
  procedure_name: "Nome do procedimento",
  procedure_date: "Data de realização",
  sector: "Setor / Centro de custo",
  doctor_name: "Médico executante",
  doctor_crm: "CRM do médico",
  patient_name: "Nome do paciente",
  convenio: "Convênio",
  valor_cobrado: "Valor cobrado",
  valor_glosa: "Valor da glosa *",
  motivo_glosa: "Motivo da glosa",
  complemento_glosa: "Complemento",
};

function ColumnMappingModal({ open, onClose, headers, colMap, onConfirm }: {
  open: boolean; onClose: () => void;
  headers: string[];
  colMap: typeof DEFAULT_COLUMN_MAP;
  onConfirm: (map: typeof DEFAULT_COLUMN_MAP) => void;
}) {
  const [map, setMap] = useState(colMap);
  const opts = headers.map((h, i) => {
    const letter = i < 26
      ? String.fromCharCode(65 + i)
      : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    return { value: letter, label: `${letter} — ${h || "(vazio)"}` };
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent style={{ maxWidth: 560, maxHeight: "80vh", overflowY: "auto" }}>
        <DialogHeader>
          <DialogTitle>Mapeamento de colunas</DialogTitle>
          <DialogDescription>
            O sistema não reconheceu automaticamente todas as colunas. Confirme ou ajuste o mapeamento abaixo.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
          {Object.entries(FIELD_LABELS).map(([field, label]) => (
            <div key={field} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
              <Label style={{ fontSize: 12, fontWeight: field.includes("*") ? 700 : 500 }}>{label}</Label>
              <Select value={(map as any)[field] ?? ""} onValueChange={v => setMap(prev => ({ ...prev, [field]: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar coluna…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Não usar —</SelectItem>
                  {opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="copper" type="button" onClick={() => onConfirm(map)}>
            Confirmar mapeamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Glosas() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<Record<string, any[]>>({});
  const [debts, setDebts] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const [mappingOpen, setMappingOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState<any[][]>([]);
  const [pendingHeaders, setPendingHeaders] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<{ name: string; sheet: string } | null>(null);

  const [concBases, setConcBases] = useState<any[]>([]);
  const [uploadingConc, setUploadingConc] = useState(false);
  const concFileRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("glosa_batches").select("*").order("created_at", { ascending: false }).limit(20);
    setBatches(data ?? []);
    setLoading(false);
  }, []);

  const loadDebts = useCallback(async () => {
    const { data } = await (supabase as any).from("glosa_debts").select("*").eq("status", "ativo").order("total_debt", { ascending: false });
    setDebts(data ?? []);
  }, []);

  const loadConcBases = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("conciliation_bases")
      .select("id, reference, competence_month, file_name, total_rows, status, created_at")
      .eq("status", "ativo")
      .order("created_at", { ascending: false });
    setConcBases(data ?? []);
  }, []);

  const uploadConcBase = async (file: File) => {
    setUploadingConc(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames.includes("Cirurgias e Procedimentos")
        ? "Cirurgias e Procedimentos"
        : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

      if (rows.length === 0) { toast.error("Planilha vazia."); return; }

      const aliases: Record<string, string[]> = {
        attendance: ["atendimento", "nr atendimento", "num. atendimento"],
        procCode: ["código tuss (8d)", "codigo tuss (8d)", "tuss"],
        procName: ["procedimento/mat-med", "procedimento"],
        doctor: ["médico exec.", "medico exec."],
        date: ["dt. proced.", "data"],
        value: ["valor", "j"],
        company: ["terceiro"],
        patient: ["nome"],
        agreement: ["convênio", "convenio"],
      };
      const normKey = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const colMap: Record<string, string> = {};
      for (const col of Object.keys(rows[0])) {
        const normCol = normKey(col);
        for (const [field, aliasList] of Object.entries(aliases)) {
          if (!colMap[field] && aliasList.some(a => normKey(a) === normCol)) {
            colMap[field] = col;
            break;
          }
        }
      }

      let competenceMonth = "";
      const dateCol = colMap["date"];
      if (dateCol && rows[0]) {
        const v = rows[0][dateCol];
        if (v instanceof Date) competenceMonth = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
      }

      const { error } = await (supabase as any).from("conciliation_bases").insert({
        reference: `Conciliação ${new Date().toLocaleDateString("pt-BR")} — ${file.name.replace(/\.[^.]+$/, "")}`,
        competence_month: competenceMonth || null,
        file_name: file.name,
        sheet_name: sheetName,
        uploaded_by: user?.id,
        total_rows: rows.length,
        raw_data: rows as any,
        col_map: colMap,
        status: "ativo",
      });

      if (error) throw new Error(error.message);
      toast.success(`Base importada: ${rows.length} linhas`);
      loadConcBases();
    } catch (e: any) {
      toast.error("Erro ao importar base", { description: e.message });
    } finally {
      setUploadingConc(false);
    }
  };

  useEffect(() => {
    document.title = "Glosas e Conciliação | MedPay";
    loadBatches();
    loadDebts();
    loadConcBases();
  }, [loadBatches, loadDebts, loadConcBases]);

  const processFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames.includes("Analitica") ? "Analitica" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, defval: null });

    let headerRow = 5;
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const row = rows[i] ?? [];
      const rowStr = row.map(c => String(c ?? "").toLowerCase()).join("|");
      if (rowStr.includes("atendimento") || rowStr.includes("executante") || rowStr.includes("num. atend")) {
        headerRow = i;
        break;
      }
    }

    const headers = (rows[headerRow] ?? []).map(String);
    const hasAttendance = headers.some(h => h.toLowerCase().includes("atend"));
    const hasGlosa = headers.some(h => h.toLowerCase().includes("glosa") || h.toLowerCase().includes("difer") || h.toLowerCase().includes("debito"));

    if (!hasAttendance || !hasGlosa) {
      setPendingRows(rows);
      setPendingHeaders(headers);
      setPendingFile({ name: file.name, sheet: sheetName });
      setMappingOpen(true);
      return;
    }

    await uploadGlosa(file.name, rows, DEFAULT_COLUMN_MAP, headerRow);
  };

  const uploadGlosa = async (
    fileName: string,
    rows: any[][],
    colMap: typeof DEFAULT_COLUMN_MAP,
    headerRow = 5
  ) => {
    setUploading(true);
    setMappingOpen(false);
    try {
      const { items } = parseGlosaFile(rows, headerRow, colMap);
      if (items.length === 0) {
        toast.error("Nenhum item com valor de glosa encontrado no arquivo.");
        return;
      }

      const convenio = items[0]?.convenio ?? "Desconhecido";
      const totalGlosa = items.reduce((a, it) => a + (it.valor_glosa ?? 0), 0);

      const { data: batch, error: batchErr } = await (supabase as any)
        .from("glosa_batches")
        .insert({
          reference: `Glosa ${convenio} — ${new Date().toLocaleDateString("pt-BR")}`,
          convenio,
          file_name: fileName,
          uploaded_by: user?.id,
          total_items: items.length,
          total_glosa_amount: totalGlosa,
          status: "processando",
        })
        .select()
        .single();

      if (batchErr || !batch) throw new Error(batchErr?.message ?? "Erro ao criar lote");

      for (let i = 0; i < items.length; i += 100) {
        const chunk = items.slice(i, i + 100).map(it => ({ ...it, batch_id: batch.id }));
        const { error } = await (supabase as any).from("glosa_items").insert(chunk);
        if (error) throw new Error(error.message);
      }

      const { matched, unmatched } = await crossReferenceGlosa(batch.id, items);

      await (supabase as any).from("glosa_batches").update({
        status: "concluido",
        matched_items: matched,
        unmatched_items: unmatched,
      }).eq("id", batch.id);

      toast.success(`${items.length} glosas importadas`, {
        description: `${matched} vinculadas · ${unmatched} sem match`,
      });

      loadBatches();
      loadDebts();
    } catch (e: any) {
      toast.error("Erro ao importar glosa", { description: e.message });
    } finally {
      setUploading(false);
    }
  };

  const reprocessBatch = async (batch: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      toast.info("Reprocessando cruzamento…");
      const { data: items } = await supabase
        .from("glosa_items")
        .select("*")
        .eq("batch_id", batch.id);
      if (!items || items.length === 0) {
        toast.error("Nenhum item encontrado no lote.");
        return;
      }
      const { matched, unmatched } = await crossReferenceGlosa(batch.id, items);
      await supabase.from("glosa_batches").update({
        status: "concluido",
        matched_items: matched,
        unmatched_items: unmatched,
      }).eq("id", batch.id);
      toast.success(`Reprocessado: ${matched} vinculados · ${unmatched} sem match`);
      loadBatches();
      loadDebts();
    } catch (e: any) {
      toast.error("Erro ao reprocessar", { description: e.message });
    }
  };



  const crossReferenceGlosa = async (batchId: string, items: any[]) => {
    let matched = 0;
    let unmatched = 0;

    const attendanceNumbers = items.map(it => it.attendance_number).filter(Boolean);
    const { data: paymentItems } = await supabase
      .from("payment_items")
      .select("id, attendance_number, doctor_name, doctor_document, company_name, payment_id")
      .in("attendance_number", attendanceNumbers);

    const piMap = new Map<string, any[]>();
    for (const pi of paymentItems ?? []) {
      const key = String(pi.attendance_number ?? "").trim();
      if (!piMap.has(key)) piMap.set(key, []);
      piMap.get(key)!.push(pi);
    }

    for (const item of items) {
      const atend = String(item.attendance_number ?? "").trim();
      const matches = piMap.get(atend) ?? [];

      if (matches.length === 0) {
        // Sem match no payment_items mas registra saldo devedor do médico
        await supabase.from("glosa_items").update({
          status: "sem_match",
        }).eq("batch_id", batchId).eq("attendance_number", atend);

        if (item.doctor_name && item.valor_glosa > 0) {
          const crmKey = item.doctor_crm || item.doctor_name;
          const { data: existing } = await supabase
            .from("glosa_debts")
            .select("id, total_debt")
            .eq("doctor_crm", crmKey)
            .maybeSingle();

          if (existing) {
            await supabase.from("glosa_debts").update({
              total_debt: (existing.total_debt ?? 0) + item.valor_glosa,
              updated_at: new Date().toISOString(),
              status: "ativo",
            }).eq("id", existing.id);
          } else {
            await supabase.from("glosa_debts").insert({
              doctor_crm: crmKey,
              doctor_name: item.doctor_name,
              total_debt: item.valor_glosa,
              status: "ativo",
            });
          }
        }

        unmatched++;
        continue;
      }

      let best = matches[0];
      if (item.doctor_crm) {
        const byCrm = matches.find(m => String(m.doctor_document ?? "").includes(item.doctor_crm));
        if (byCrm) best = byCrm;
      } else if (item.doctor_name) {
        const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        const byName = matches.find(m => norm(m.doctor_name ?? "").includes(norm(item.doctor_name ?? "").slice(0, 8)));
        if (byName) best = byName;
      }

      await (supabase as any).from("glosa_items").update({
        status: "vinculado",
        matched_payment_item_id: best.id,
        matched_payment_id: best.payment_id,
        matched_company_name: best.company_name,
        matched_at: new Date().toISOString(),
      }).eq("batch_id", batchId).eq("attendance_number", atend);

      if (item.doctor_name && item.valor_glosa > 0) {
        const crmKey = item.doctor_crm || item.doctor_name;
        const { data: existing } = await (supabase as any)
          .from("glosa_debts")
          .select("id, total_debt")
          .eq("doctor_crm", crmKey)
          .maybeSingle();

        if (existing) {
          await (supabase as any).from("glosa_debts").update({
            total_debt: (existing.total_debt ?? 0) + item.valor_glosa,
            updated_at: new Date().toISOString(),
            status: "ativo",
          }).eq("id", existing.id);
        } else {
          await (supabase as any).from("glosa_debts").insert({
            doctor_crm: crmKey,
            doctor_name: item.doctor_name,
            total_debt: item.valor_glosa,
            status: "ativo",
          });
        }
      }

      matched++;
    }

    return { matched, unmatched };
  };

  const loadBatchItems = async (batchId: string) => {
    if (batchItems[batchId]) return;
    const { data } = await (supabase as any)
      .from("glosa_items")
      .select("*")
      .eq("batch_id", batchId)
      .order("status", { ascending: true })
      .order("valor_glosa", { ascending: false })
      .limit(200);
    setBatchItems(prev => ({ ...prev, [batchId]: data ?? [] }));
  };

  const statusIcon = (status: string) => {
    if (status === "vinculado") return <CheckCircle2 size={13} style={{ color: "hsl(var(--bubble-green-fg))" }} />;
    if (status === "sem_match") return <XCircle size={13} style={{ color: "hsl(var(--bubble-red-fg))" }} />;
    if (status === "aplicado") return <CheckCircle2 size={13} style={{ color: "#9A6B3A" }} />;
    return <AlertTriangle size={13} style={{ color: "hsl(var(--bubble-yellow-fg))" }} />;
  };

  const statusLabel = (status: string) => ({
    pendente: "Pendente", vinculado: "Vinculado", sem_match: "Sem match",
    aplicado: "Aplicado", quitado: "Quitado", ignorado: "Ignorado",
  } as Record<string, string>)[status] ?? status;

  const filteredBatches = batches.filter(b =>
    !searchTerm || b.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.convenio?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
            Gestão de <span style={{ fontWeight: 700 }}>Glosas</span>
          </h1>
          <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Upload, cruzamento e controle de saldo devedor por médico
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar convênio ou médico…"
            style={{ width: 220 }}
          />
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              await processFile(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="copper"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <><RefreshCw size={14} className="animate-spin mr-1" />Importando…</>
              : <><Upload size={14} className="mr-1" />Importar glosa</>}
          </Button>
        </div>
      </div>

      {debts.length > 0 && (
        <section>
          <SectionLabel>Saldo devedor ativo</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {debts.slice(0, 6).map(d => (
              <SurfaceCard key={d.id} style={{ padding: "16px", borderLeft: "3px solid hsl(var(--bubble-red-fg))" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Saldo devedor
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.doctor_name}
                </div>
                {d.doctor_crm && <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>CRM {d.doctor_crm}</div>}
                <div style={{ fontSize: 20, fontWeight: 300, color: "hsl(var(--bubble-red-fg))", fontVariantNumeric: "tabular-nums" }}>
                  {formatCurrency(d.total_debt)}
                </div>
              </SurfaceCard>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Lotes importados</SectionLabel>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 60, background: "hsl(var(--muted))", borderRadius: 8, opacity: 0.3 }} />)}
          </div>
        ) : filteredBatches.length === 0 ? (
          <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
            <FileText size={32} style={{ color: "hsl(var(--muted-foreground))", margin: "0 auto 12px" }} />
            <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>Nenhum lote de glosa importado ainda.</p>
            <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>Clique em "Importar glosa" para começar.</p>
          </SurfaceCard>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredBatches.map(batch => (
              <SurfaceCard key={batch.id}>
                <button
                  type="button"
                  onClick={async () => {
                    if (expandedBatch === batch.id) {
                      setExpandedBatch(null);
                    } else {
                      setExpandedBatch(batch.id);
                      await loadBatchItems(batch.id);
                    }
                  }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                >
                  <div style={{ color: "hsl(var(--muted-foreground))" }}>
                    {expandedBatch === batch.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {batch.reference}
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                      {batch.total_items} itens · {new Date(batch.created_at).toLocaleDateString("pt-BR")}
                      {batch.file_name && ` · ${batch.file_name}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                    {batch.matched_items > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "hsl(var(--bubble-green-fg))" }}>
                        <CheckCircle2 size={12} /> {batch.matched_items} vinculados
                      </div>
                    )}
                    {batch.unmatched_items > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "hsl(var(--bubble-red-fg))" }}>
                        <XCircle size={12} /> {batch.unmatched_items} sem match
                      </div>
                    )}
                    <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--bubble-red-fg))", fontVariantNumeric: "tabular-nums" }}>
                      {formatCurrency(batch.total_glosa_amount)}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => reprocessBatch(batch, e)}
                      title="Reprocessar cruzamento"
                      style={{
                        background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))",
                        borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 600,
                        color: "hsl(var(--muted-foreground))", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                      }}
                    >
                      <RefreshCw size={11} /> Reprocessar
                    </button>

                  </div>
                </button>

                {expandedBatch === batch.id && (
                  <div style={{ borderTop: "1px solid hsl(var(--border))" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 120px 120px 80px 100px 90px", gap: 8, padding: "8px 18px", background: "hsl(var(--muted) / 0.4)", fontSize: 9, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      <div />
                      <div>Procedimento / Médico</div>
                      <div>Atendimento</div>
                      <div>Empresa match</div>
                      <div>Data</div>
                      <div style={{ textAlign: "right" }}>Valor glosa</div>
                      <div>Status</div>
                    </div>
                    {(batchItems[batch.id] ?? []).map((item, i) => (
                      <div key={item.id} style={{
                        display: "grid", gridTemplateColumns: "24px 1fr 120px 120px 80px 100px 90px", gap: 8,
                        padding: "10px 18px", alignItems: "center",
                        borderTop: i > 0 ? "1px solid hsl(var(--border) / 0.5)" : "none",
                      }}>
                        <div>{statusIcon(item.status)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.procedure_name || item.procedure_code || "—"}
                          </div>
                          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.doctor_name || "—"} {item.doctor_crm ? `· CRM ${item.doctor_crm}` : ""}
                          </div>
                          {item.motivo_glosa && (
                            <div style={{ fontSize: 10, color: "hsl(var(--bubble-yellow-fg))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.motivo_glosa}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: "monospace", color: "hsl(var(--muted-foreground))" }}>
                          {item.attendance_number || "—"}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.matched_company_name || "—"}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                          {item.procedure_date ? new Date(item.procedure_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—"}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--bubble-red-fg))", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatCurrency(item.valor_glosa)}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: item.status === "vinculado" ? "hsl(var(--bubble-green-fg))" : item.status === "sem_match" ? "hsl(var(--bubble-red-fg))" : "hsl(var(--muted-foreground))" }}>
                          {statusLabel(item.status)}
                        </div>
                      </div>
                    ))}
                    {(batchItems[batch.id] ?? []).length === 0 && (
                      <div style={{ padding: "20px", textAlign: "center", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                        Carregando itens…
                      </div>
                    )}
                  </div>
                )}
              </SurfaceCard>
            ))}
          </div>
        )}
      </section>

      <ColumnMappingModal
        open={mappingOpen}
        onClose={() => { setMappingOpen(false); setPendingRows([]); }}
        headers={pendingHeaders}
        colMap={DEFAULT_COLUMN_MAP}
        onConfirm={async (map) => {
          let headerRow = 5;
          for (let i = 0; i < Math.min(15, pendingRows.length); i++) {
            const row = pendingRows[i] ?? [];
            if (row.some(c => c != null && c !== "")) { headerRow = i; }
          }
          await uploadGlosa(pendingFile?.name ?? "glosa.xlsx", pendingRows, map, headerRow);
          setPendingRows([]);
          setPendingHeaders([]);
          setPendingFile(null);
        }}
      />
    </div>
  );
}
