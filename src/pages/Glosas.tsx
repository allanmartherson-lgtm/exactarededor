import { useEffect, useState, useCallback, useRef } from "react";
import GlosaResolutionPanel from "@/components/glosas/GlosaResolutionPanel";
import PotentialDebtsPanel from "@/components/glosas/PotentialDebtsPanel";
import GlosaDebtAuditLog from "@/components/glosas/GlosaDebtAuditLog";
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

// ── Primitivos visuais (padrão Exacta) ─────────────────────────────

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
          <Button onClick={() => onConfirm(map)}>
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
  const [sourceFilter, setSourceFilter] = useState<"all" | "convenio" | "auditoria">("all");
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<null | {
    batches: number;
    items: number;
    matchedByPayment: number;
    matchedByCadastro: number;
    unmatched: number;
    perBatch: Array<{ id: string; reference: string; matchedByPayment: number; matchedByCadastro: number; unmatched: number }>;
  }>(null);

  const [mappingOpen, setMappingOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState<any[][]>([]);
  const [pendingHeaders, setPendingHeaders] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<{ name: string; sheet: string } | null>(null);


  const loadBatches = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("glosa_batches").select("*").order("created_at", { ascending: false }).limit(20);
    setBatches(data ?? []);
    setLoading(false);
  }, []);

  const loadDebts = useCallback(async () => {
    // Lê da view v_glosa_debts_balance: total_debt é sempre derivado de glosa_debt_items
    // (saldo a pagar), garantindo consistência visual mesmo se o stored estiver atrasado.
    const { data } = await (supabase as any).from("v_glosa_debts_balance").select("*").eq("status", "ativo").order("total_debt", { ascending: false });
    setDebts(data ?? []);
  }, []);


  useEffect(() => {
    document.title = "Glosas | Exacta";
    loadBatches();
    loadDebts();
  }, [loadBatches, loadDebts]);

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

  const reprocessSingleBatch = async (batch: any) => {
    const { data: items } = await supabase
      .from("glosa_items")
      .select("*")
      .eq("batch_id", batch.id);
    if (!items || items.length === 0) {
      return { matched: 0, unmatched: 0, matchedByPayment: 0, matchedByCadastro: 0, total: 0 };
    }
    const res = await crossReferenceGlosa(batch.id, items);
    await supabase.from("glosa_batches").update({
      status: "concluido",
      matched_items: res.matched,
      unmatched_items: res.unmatched,
    }).eq("id", batch.id);
    return { ...res, total: items.length };
  };

  const reprocessBatch = async (batch: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      toast.info("Reprocessando cruzamento…");
      const r = await reprocessSingleBatch(batch);
      toast.success(
        `Reprocessado: ${r.matchedByPayment} via pagamento · ${r.matchedByCadastro} via cadastro · ${r.unmatched} sem match`,
      );
      // Atualiza grid de itens já aberto, se for este lote
      if (expandedBatch === batch.id) {
        setBatchItems(prev => ({ ...prev, [batch.id]: [] }));
        await loadBatchItems(batch.id);
      }
      loadBatches();
      loadDebts();
    } catch (e: any) {
      toast.error("Erro ao reprocessar", { description: e.message });
    }
  };

  const reprocessSelectedBatches = async () => {
    if (selectedBatches.size === 0) return;
    setBulkRunning(true);
    setBulkSummary(null);
    try {
      const targets = batches.filter(b => selectedBatches.has(b.id));
      let totals = { matchedByPayment: 0, matchedByCadastro: 0, unmatched: 0, items: 0 };
      const perBatch: typeof bulkSummary["perBatch"] = [];
      for (const b of targets) {
        const r = await reprocessSingleBatch(b);
        totals.matchedByPayment += r.matchedByPayment;
        totals.matchedByCadastro += r.matchedByCadastro;
        totals.unmatched += r.unmatched;
        totals.items += r.total;
        perBatch.push({
          id: b.id,
          reference: b.reference,
          matchedByPayment: r.matchedByPayment,
          matchedByCadastro: r.matchedByCadastro,
          unmatched: r.unmatched,
        });
      }
      setBulkSummary({
        batches: targets.length,
        items: totals.items,
        matchedByPayment: totals.matchedByPayment,
        matchedByCadastro: totals.matchedByCadastro,
        unmatched: totals.unmatched,
        perBatch,
      });
      // limpa cache de itens abertos para refletir mudança
      setBatchItems({});
      setSelectedBatches(new Set());
      loadBatches();
      loadDebts();
    } catch (e: any) {
      toast.error("Erro no reprocessamento em massa", { description: e.message });
    } finally {
      setBulkRunning(false);
    }
  };



  const crossReferenceGlosa = async (batchId: string, items: any[]) => {
    // (contadores movidos para baixo — breakdown completo: payment_item / doctor_companies / sem_match)

    // 1) Match primário: payment_items pelo número do atendimento
    const attendanceNumbers = items.map(it => it.attendance_number).filter(Boolean);
    const { data: paymentItems } = await supabase
      .from("payment_items")
      .select("id, attendance_number, doctor_name, doctor_document, company_name, company_id, payment_id")
      .in("attendance_number", attendanceNumbers);

    const piMap = new Map<string, any[]>();
    for (const pi of paymentItems ?? []) {
      const key = String(pi.attendance_number ?? "").trim();
      if (!piMap.has(key)) piMap.set(key, []);
      piMap.get(key)!.push(pi);
    }

    // 2) Fallback: doctor (CRM) → doctor_companies → company
    //    Carrega cadastro só dos CRMs distintos da glosa, em lote.
    const normCrm = (v: string) => String(v ?? "").replace(/\D/g, "");
    const normName = (v: string) =>
      String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    const distinctCrms = Array.from(
      new Set(items.map(it => normCrm(it.doctor_crm)).filter(Boolean)),
    );
    const distinctNames = Array.from(
      new Set(items.map(it => normName(it.doctor_name)).filter(Boolean)),
    );

    type DoctorRow = { id: string; full_name: string; crm: string };
    const doctorsByCrm = new Map<string, DoctorRow>();
    const doctorsByName = new Map<string, DoctorRow>();
    if (distinctCrms.length > 0 || distinctNames.length > 0) {
      const { data: doctorRows } = await (supabase as any)
        .from("doctors")
        .select("id, full_name, crm")
        .or([
          distinctCrms.length ? `crm.in.(${distinctCrms.join(",")})` : null,
        ].filter(Boolean).join(","));
      for (const d of (doctorRows ?? []) as DoctorRow[]) {
        if (d.crm) doctorsByCrm.set(normCrm(d.crm), d);
        if (d.full_name) doctorsByName.set(normName(d.full_name), d);
      }
    }

    // Carrega doctor_companies vigentes para os doctor_id encontrados.
    const doctorIds = Array.from(new Set([
      ...Array.from(doctorsByCrm.values()).map(d => d.id),
      ...Array.from(doctorsByName.values()).map(d => d.id),
    ]));
    type Link = { doctor_id: string; company_id: string; company_name: string };
    const linksByDoctor = new Map<string, Link[]>();
    if (doctorIds.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: links } = await (supabase as any)
        .from("doctor_companies")
        .select("doctor_id, company_id, start_date, end_date, companies!inner(id, name)")
        .in("doctor_id", doctorIds);
      for (const raw of (links ?? []) as any[]) {
        // vigência: start_date NULL ou <= hoje; end_date NULL ou >= hoje
        const startOk = !raw.start_date || raw.start_date <= today;
        const endOk = !raw.end_date || raw.end_date >= today;
        if (!startOk || !endOk) continue;
        const link: Link = {
          doctor_id: raw.doctor_id,
          company_id: raw.company_id,
          company_name: raw.companies?.name ?? "",
        };
        if (!linksByDoctor.has(link.doctor_id)) linksByDoctor.set(link.doctor_id, []);
        linksByDoctor.get(link.doctor_id)!.push(link);
      }
    }

    const resolveByDoctor = (item: any): { link: Link | null; reason: string | null } => {
      const crmKey = normCrm(item.doctor_crm);
      const nameKey = normName(item.doctor_name);
      const doctor = (crmKey && doctorsByCrm.get(crmKey)) || (nameKey && doctorsByName.get(nameKey)) || null;
      if (!doctor) {
        return { link: null, reason: "médico não cadastrado" };
      }
      const links = linksByDoctor.get(doctor.id) ?? [];
      if (links.length === 0) return { link: null, reason: "médico sem PJ cadastrada" };
      if (links.length > 1) return { link: null, reason: `${links.length} PJs ativas — escolher manualmente` };
      return { link: links[0], reason: null };
    };

    // glosa_debts é recomputado por médico no final, a partir da fonte da
    // verdade (glosa_items). Evita inflar saldo a cada reprocessamento.
    const affectedDoctors = new Map<string, { crm: string; name: string }>();
    const trackDoctor = (item: any) => {
      const crm = String(item.doctor_crm ?? "").trim();
      const name = String(item.doctor_name ?? "").trim();
      const key = crm || name;
      if (!key) return;
      if (!affectedDoctors.has(key)) affectedDoctors.set(key, { crm, name });
    };

    let matchedByPayment = 0;
    let matchedByCadastro = 0;
    let unmatched = 0;

    for (const item of items) {
      const atend = String(item.attendance_number ?? "").trim();
      const matches = atend ? (piMap.get(atend) ?? []) : [];
      trackDoctor(item);

      if (matches.length > 0) {
        let best = matches[0];
        if (item.doctor_crm) {
          const byCrm = matches.find(m => String(m.doctor_document ?? "").includes(item.doctor_crm));
          if (byCrm) best = byCrm;
        } else if (item.doctor_name) {
          const byName = matches.find(m => normName(m.doctor_name ?? "").includes(normName(item.doctor_name).slice(0, 8)));
          if (byName) best = byName;
        }
        await (supabase as any).from("glosa_items").update({
          status: "vinculado",
          match_source: "payment_item",
          matched_payment_item_id: best.id,
          matched_payment_id: best.payment_id,
          matched_company_id: best.company_id ?? null,
          matched_company_name: best.company_name,
          match_reason: null,
          matched_at: new Date().toISOString(),
        }).eq("batch_id", batchId).eq("attendance_number", atend);
        matchedByPayment++;
        continue;
      }

      const { link, reason } = resolveByDoctor(item);
      if (link) {
        await (supabase as any).from("glosa_items").update({
          status: "vinculado",
          match_source: "doctor_companies",
          matched_payment_item_id: null,
          matched_payment_id: null,
          matched_company_id: link.company_id,
          matched_company_name: link.company_name,
          match_reason: "vinculado via cadastro do médico (sem pagamento correspondente ainda)",
          matched_at: new Date().toISOString(),
        }).eq("batch_id", batchId).eq("attendance_number", atend);
        matchedByCadastro++;
      } else {
        await (supabase as any).from("glosa_items").update({
          status: "sem_match",
          match_source: null,
          matched_company_id: null,
          matched_company_name: null,
          match_reason: reason,
        }).eq("batch_id", batchId).eq("attendance_number", atend);
        unmatched++;
      }
    }

    // Recompute saldo devedor por médico — idempotente, sobre todos os lotes.
    for (const { crm, name } of affectedDoctors.values()) {
      await (supabase as any).rpc("glosa_recompute_debt_for_doctor", {
        p_crm: crm,
        p_name: name,
      });
    }

    return {
      matched: matchedByPayment + matchedByCadastro,
      unmatched,
      matchedByPayment,
      matchedByCadastro,
    };
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

  const filteredBatches = batches.filter(b => {
    if (sourceFilter !== "all" && (b.source ?? "convenio") !== sourceFilter) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return b.reference?.toLowerCase().includes(q) || b.convenio?.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
          <span style={{ fontWeight: 700 }}>Glosas</span>
        </h1>
        <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
          Gestão de glosas do convênio e auditoria
        </p>
      </div>

      <div className="mt-6">
          <div className="flex flex-col gap-8">
            <PotentialDebtsPanel
              reloadKey={debts.length}
              onCreated={() => { void loadDebts(); }}
            />
            <GlosaDebtAuditLog reloadKey={debts.length} />
            <GlosaResolutionPanel />
            <div className="flex items-center justify-end gap-2 flex-wrap">

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
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? <><RefreshCw size={14} className="animate-spin mr-1" />Importando…</>
                  : <><Upload size={14} className="mr-1" />Importar glosa</>}
              </Button>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
                <SectionLabel>Lotes importados</SectionLabel>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "inline-flex", border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
                    {(["all", "convenio", "auditoria"] as const).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setSourceFilter(opt)}
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          background: sourceFilter === opt ? "hsl(var(--muted))" : "transparent",
                          color: sourceFilter === opt ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {opt === "all" ? "Todos" : opt === "convenio" ? "Convênio" : "Auditoria"}
                      </button>
                    ))}
                  </div>
                  {filteredBatches.length > 0 && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "hsl(var(--muted-foreground))", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={filteredBatches.length > 0 && filteredBatches.every(b => selectedBatches.has(b.id))}
                        ref={el => { if (el) el.indeterminate = selectedBatches.size > 0 && !filteredBatches.every(b => selectedBatches.has(b.id)); }}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBatches(new Set(filteredBatches.map(b => b.id)));
                          } else {
                            setSelectedBatches(new Set());
                          }
                        }}
                      />
                      Selecionar todos
                    </label>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedBatches.size === 0 || bulkRunning}
                    onClick={() => reprocessSelectedBatches()}
                  >
                    {bulkRunning
                      ? <><RefreshCw size={12} className="animate-spin mr-1" />Reprocessando…</>
                      : <><RefreshCw size={12} className="mr-1" />Reprocessar selecionados ({selectedBatches.size})</>}
                  </Button>
                </div>
              </div>
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
                      <div style={{ display: "flex", alignItems: "stretch" }}>
                        <label
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "flex", alignItems: "center", padding: "0 0 0 14px", cursor: "pointer" }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedBatches.has(batch.id)}
                            onChange={(e) => {
                              const next = new Set(selectedBatches);
                              if (e.target.checked) next.add(batch.id); else next.delete(batch.id);
                              setSelectedBatches(next);
                            }}
                          />
                        </label>
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
                        style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                      >
                        <div style={{ color: "hsl(var(--muted-foreground))" }}>
                          {expandedBatch === batch.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            {(() => {
                              const src = (batch.source ?? "convenio") as "convenio" | "auditoria";
                              const isAudit = src === "auditoria";
                              return (
                                <span style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: isAudit ? "hsl(var(--bubble-orange-bg, 30 100% 95%))" : "hsl(var(--muted))",
                                  color: isAudit ? "hsl(var(--bubble-orange-fg, 25 80% 40%))" : "hsl(var(--muted-foreground))",
                                  border: isAudit ? "1px solid hsl(var(--bubble-orange-fg, 25 80% 40%) / 0.3)" : "1px solid hsl(var(--border))",
                                  flexShrink: 0,
                                }}>
                                  {isAudit ? "Auditoria" : "Convênio"}
                                </span>
                              );
                            })()}
                            <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {batch.reference}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                            {batch.total_items} itens · {new Date(batch.created_at).toLocaleDateString("pt-BR")}
                            {" · "}
                            {batch.file_name ? batch.file_name : <em>Gerado internamente</em>}
                            {(batch.source === "auditoria") && batch.reconciliation_id && (
                              <>
                                {" · "}
                                <a
                                  href={`/financeiro/conciliacao?tab=retroativa&reconciliation=${batch.reconciliation_id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: "hsl(var(--primary))", textDecoration: "underline" }}
                                >
                                  Originado da apuração →
                                </a>
                              </>
                            )}
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
                      </div>


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
                              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", overflow: "hidden", whiteSpace: "normal" }}>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.matched_company_name || "—"}
                                  {item.match_source === "doctor_companies" && (
                                    <span title="Vinculado via cadastro do médico (sem pagamento correspondente)" style={{ marginLeft: 4, padding: "1px 5px", fontSize: 9, borderRadius: 3, background: "hsl(var(--bubble-yellow) / 0.25)", color: "hsl(var(--bubble-yellow-fg))", fontWeight: 600 }}>
                                      via cadastro
                                    </span>
                                  )}
                                </div>
                                {item.status === "sem_match" && item.match_reason && (
                                  <div style={{ fontSize: 9, color: "hsl(var(--bubble-red-fg))", marginTop: 2 }}>
                                    {item.match_reason}
                                  </div>
                                )}
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
          </div>

          <Dialog open={!!bulkSummary} onOpenChange={(o) => !o && setBulkSummary(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Reprocessamento concluído</DialogTitle>
                <DialogDescription>
                  {bulkSummary?.batches} lote(s) · {bulkSummary?.items} item(ns) reavaliado(s)
                </DialogDescription>
              </DialogHeader>
              {bulkSummary && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground">Via pagamento</div>
                      <div className="text-xl font-light" style={{ color: "hsl(var(--bubble-green-fg))" }}>{bulkSummary.matchedByPayment}</div>
                    </div>
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground">Via cadastro</div>
                      <div className="text-xl font-light" style={{ color: "hsl(var(--bubble-yellow-fg))" }}>{bulkSummary.matchedByCadastro}</div>
                    </div>
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground">Sem match</div>
                      <div className="text-xl font-light" style={{ color: "hsl(var(--bubble-red-fg))" }}>{bulkSummary.unmatched}</div>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1 font-medium text-muted-foreground">Lote</th>
                          <th className="text-right px-2 py-1 font-medium text-muted-foreground">Pag.</th>
                          <th className="text-right px-2 py-1 font-medium text-muted-foreground">Cadastro</th>
                          <th className="text-right px-2 py-1 font-medium text-muted-foreground">Sem match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkSummary.perBatch.map(b => (
                          <tr key={b.id} className="border-t border-border/40">
                            <td className="px-2 py-1 truncate max-w-[260px]">{b.reference}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{b.matchedByPayment}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{b.matchedByCadastro}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{b.unmatched}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button size="sm" onClick={() => setBulkSummary(null)}>Fechar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
      </div>


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
