import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/status";
import { formatDateBR, formatDateTimeBR } from "@/lib/dateUtils";
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
  agreement_text: string | null;
  applied_rule_label: string | null;
  applied_calc_method: string | null;
  valor_regra?: number | null;
  action_taken?: string | null;
  action_by?: string | null;
  action_at?: string | null;
  doctor_document?: string | null;
  competence_month?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentReference: string;
  paymentItems: PaymentItemRow[];
  /** Quando informado, filtra a conciliação para uma única empresa e a expande automaticamente. */
  initialCompany?: string | null;
}

type Step = "select_base" | "col_mapping" | "upload" | "mapping" | "result";

const COL_FIELDS: Array<{
  key: string;
  label: string;
  required: boolean;
  description: string;
}> = [
  { key: "attendance", label: "Nº atendimento", required: true, description: "Número do atendimento hospitalar — chave principal de cruzamento" },
  { key: "procCode",   label: "Código TUSS",    required: true, description: "Código TUSS/CBHPM do procedimento — chave secundária de cruzamento" },
  { key: "value",      label: "Valor repasse",  required: true, description: "Valor cobrado pelo hospital — base da comparação financeira" },
  { key: "doctor",     label: "Médico executante", required: false, description: "Nome do médico — usado para enriquecer o resultado e filtros futuros" },
  { key: "role",       label: "Função / papel", required: false, description: "Papel do profissional (cirurgião, anestesista…) — diferencia quando o mesmo médico atua em funções distintas" },
  { key: "quantity",   label: "Quantidade",     required: false, description: "Quantidade do procedimento — detecta duplicidades (ex: 1 proc × 3 qty)" },
  { key: "company",    label: "Empresa (PJ)",   required: false, description: "Nome da empresa prestadora — usado no vínculo de empresas" },
  { key: "patient",    label: "Paciente",       required: false, description: "Nome do paciente — enriquecimento" },
  { key: "date",       label: "Data proc.",     required: false, description: "Data do procedimento — enriquecimento" },
  { key: "agreement",  label: "Convênio",       required: false, description: "Convênio/plano de saúde — enriquece a análise e o relatório" },
];

const detectColumns = (rows: Record<string, unknown>[]): Record<string, string> => {
  if (rows.length === 0) return {};
  const aliases: Record<string, string[]> = {
    attendance: ["atendimento", "nr atendimento", "nratendimento"],
    account: ["conta", "nrconta", "numeroconta"],
    patient: ["nome", "paciente", "nomepaciente"],
    procCode: ["codigotuss8d", "codigo tuss (8d)", "código tuss (8d)", "tuss8d", "codigo", "código", "codprocedimento", "codigoprocedimento", "codtuss"],
    procName: ["procedimento/mat-med", "procedimento", "descricao", "nomeprocedimento"],
    doctor: ["médico exec.", "medico exec.", "medicoexec", "medico", "profissional"],
    date: ["dt. proced.", "dt proced", "data", "dataatendimento", "dtproced"],
    value: ["vl. rep. calc.", "vl rep calc", "vlrepcalc", "valor", "valorbruto"],
    company: ["terceiro", "empresa", "prestador"],
    grupo: ["grupo cbhpm", "grupocbhpm", "grupo", "grupoproc"],
  };
  const normKey = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
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
  valor_divergente: "bg-warning/10 text-warning-text border-warning/30",
  so_hospital: "bg-destructive/10 text-destructive border-destructive/30",
  so_medpay: "bg-primary/10 text-primary border-primary/30",
};

export function PaymentConciliationModal({
  open,
  onOpenChange,
  paymentId,
  paymentReference,
  paymentItems,
  initialCompany = null,
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Busca e filtros adicionais (texto livre, médico, faixa de valor)
  const [searchTerm, setSearchTerm] = useState("");
  const [doctorFilter, setDoctorFilter] = useState<string>("todos");
  const [minValue, setMinValue] = useState<string>("");
  const [maxValue, setMaxValue] = useState<string>("");

  const [step, setStep] = useState<Step>("upload");
  const [excludeConsultas, setExcludeConsultas] = useState(true);
  const [hospitalCompanies, setHospitalCompanies] = useState<string[]>([]);
  const [companyMapping, setCompanyMapping] = useState<Record<string, string | null>>({});
  const [matchLevels, setMatchLevels] = useState<Record<string, 'exact' | 'high' | 'medium' | null>>({});
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [parsedColMap, setParsedColMap] = useState<Record<string, string>>({});
  const [pendingFileName, setPendingFileName] = useState<string>("");

  // Seleção de base importada
  const [concBases, setConcBases] = useState<any[]>([]);
  const [selectedBase, setSelectedBase] = useState<any | null>(null);
  const [availableSectors, setAvailableSectors] = useState<string[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);

  // Mapeamento de colunas: campo interno → coluna real da planilha
  const [colMapping, setColMapping] = useState<Record<string, string>>({});
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [colSamples, setColSamples] = useState<Record<string, string>>({});
  const [saveColMapping, setSaveColMapping] = useState(true);

  const loteCompanies = useMemo(
    () =>
      Array.from(
        new Set(paymentItems.map((it) => it.company_name ?? "").filter(Boolean)),
      ).sort(),
    [paymentItems],
  );

  const loadLatestRun = async () => {
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
        // Paginação: PostgREST tem cap de 1000 por request, então buscamos em lotes
        const all: ReconciliationItem[] = [];
        const pageSize = 1000;
        for (let from = 0; from < 20000; from += pageSize) {
          const { data: page, error: pageErr } = await (supabase as any)
            .from("reconciliation_items")
            .select("*")
            .eq("run_id", data.id)
            .order("created_at")
            .range(from, from + pageSize - 1);
          if (pageErr) throw pageErr;
          const rows = (page ?? []) as ReconciliationItem[];
          all.push(...rows);
          if (rows.length < pageSize) break;
        }
        setItems(all);
        setStep("result");
      } else {
        setRun(null);
        setItems([]);
        setStep("select_base");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Erro ao carregar conciliação", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadConcBases = async () => {
    setLoadingBases(true);
    const { data } = await (supabase as any)
      .from("conciliation_bases")
      .select("id, reference, competence_month, file_name, total_rows, created_at, raw_data, col_map")
      .eq("status", "ativo")
      .order("created_at", { ascending: false });
    setConcBases(data ?? []);
    setLoadingBases(false);
  };

  useEffect(() => {
    if (open) {
      loadLatestRun();
      loadConcBases();
      setActiveFilter("todos");
      setExpandedCompany(initialCompany ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCompany]);

  const handleSelectBase = (base: any) => {
    setSelectedBase(base);
    const rows: Record<string, unknown>[] = base.raw_data ?? [];
    const sectorCol = Object.keys(rows[0] ?? {}).find(k => {
      const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      return n.includes("setor") || n.includes("centro") || n.includes("custos") || k === "Setor" || k === "M";
    });
    const sectors = Array.from(new Set(
      rows.map(r => sectorCol ? String(r[sectorCol] ?? "").trim() : "").filter(Boolean)
    )).sort();
    setAvailableSectors(sectors);
    setSelectedSectors([]);

    const cols = Object.keys(rows[0] ?? {});
    setAvailableColumns(cols);

    const samples: Record<string, string> = {};
    for (const col of cols) {
      for (const row of rows.slice(0, 10)) {
        const v = String(row[col] ?? "").trim();
        if (v) { samples[col] = v.slice(0, 30); break; }
      }
    }
    setColSamples(samples);

    const saved: Record<string, string> = base.col_map ?? {};
    const autoDetected = detectColumns(rows);
    const initial: Record<string, string> = {};
    for (const field of COL_FIELDS) {
      initial[field.key] = saved[field.key] || autoDetected[field.key] || "";
    }
    for (const [k, v] of Object.entries(saved)) {
      if (!(k in initial)) initial[k] = v;
    }
    for (const [k, v] of Object.entries(autoDetected)) {
      if (!(k in initial) || !initial[k]) initial[k] = v;
    }
    setColMapping(initial);
  };

  const handleProcessFromBase = () => {
    if (!selectedBase) return;
    const rows: Record<string, unknown>[] = selectedBase.raw_data ?? [];

    const sectorCol = Object.keys(rows[0] ?? {}).find(k => {
      const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      return n.includes("setor") || n.includes("centro") || n.includes("custos") || k === "Setor" || k === "M";
    });

    const filteredRows = selectedSectors.length > 0 && sectorCol
      ? rows.filter(r => selectedSectors.includes(String(r[sectorCol] ?? "").trim()))
      : rows;

    setParsedRows(filteredRows);
    setPendingFileName(selectedBase.file_name ?? selectedBase.reference);
    setStep("col_mapping");
  };

  const handleConfirmColMapping = async () => {
    const missing = COL_FIELDS.filter(f => f.required && !colMapping[f.key]);
    if (missing.length > 0) {
      toast({
        title: "Campos obrigatórios não mapeados",
        description: `Configure: ${missing.map(f => f.label).join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    if (saveColMapping && selectedBase) {
      await (supabase as any)
        .from("conciliation_bases")
        .update({ col_map: colMapping })
        .eq("id", selectedBase.id);
    }

    const companyCol = colMapping["company"] || "";
    const terceiros = Array.from(new Set(
      parsedRows.map(r => companyCol ? String(r[companyCol] ?? "").trim() : "").filter(Boolean)
    )).sort();

    const normFull = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

    const STOPWORDS = new Set(['servicos','medicos','medica','ltda','eireli','ss','me','sa','clinica','instituto','centro','cirurgia','cirurgica','saude','hospitalares','hospitalar','associados','associadas','brasilia','brasil','cuidados','servico','especialidades','geral']);
    const getIdentifiers = (name: string) => {
      const norm = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
      return norm.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
    };
    type MatchLevel = "exact" | "high" | "medium" | null;
    const findMatch = (t: string, candidates: string[]): { company: string | null; level: MatchLevel } => {
      const normT = normFull(t);
      const idsT = getIdentifiers(t);
      const exact = candidates.find(c => normFull(c) === normT);
      if (exact) return { company: exact, level: "exact" };
      const sub = candidates.find(c => { const n = normFull(c); return normT.includes(n) || n.includes(normT); });
      if (sub) return { company: sub, level: "high" };
      let best: { company: string; score: number } | null = null;
      for (const c of candidates) {
        const idsC = getIdentifiers(c);
        const common = idsT.filter(id => idsC.includes(id));
        const score = common.reduce((s, id) => s + id.length, 0);
        if (common.length >= 2 && score > (best?.score ?? 0)) best = { company: c, score };
      }
      if (best) return { company: best.company, level: "medium" };
      return { company: null, level: null };
    };

    const autoMapping: Record<string, string | null> = {};
    const newMatchLevels: Record<string, MatchLevel> = {};
    for (const t of terceiros) {
      const { company, level } = findMatch(t, loteCompanies);
      autoMapping[t] = company;
      newMatchLevels[t] = level;
    }

    setParsedColMap(colMapping);
    setHospitalCompanies(terceiros);
    setCompanyMapping(autoMapping);
    setMatchLevels(newMatchLevels);
    setStep("mapping");
  };

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

      const STOPWORDS = new Set([
        'servicos', 'medicos', 'medica', 'ltda', 'eireli', 'ss', 'me', 'sa',
        'clinica', 'instituto', 'centro', 'cirurgia', 'cirurgica', 'saude',
        'hospitalares', 'hospitalar', 'associados', 'associadas', 'brasilia',
        'brasil', 'cuidados', 'servico', 'especialidades', 'geral',
      ]);

      const getIdentifiers = (name: string): string[] => {
        const norm = name.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ');
        return norm.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
      };

      type MatchLevel = 'exact' | 'high' | 'medium' | null;

      const findMatch = (terceiro: string, candidates: string[]): { company: string | null; level: MatchLevel } => {
        const normT = normFull(terceiro);
        const idsT = getIdentifiers(terceiro);

        const exact = candidates.find(c => normFull(c) === normT);
        if (exact) return { company: exact, level: 'exact' };

        const substring = candidates.find(c => {
          const normC = normFull(c);
          return normT.includes(normC) || normC.includes(normT);
        });
        if (substring) return { company: substring, level: 'high' };

        let bestMatch: { company: string; score: number } | null = null;
        for (const c of candidates) {
          const idsC = getIdentifiers(c);
          const common = idsT.filter(id => idsC.includes(id));
          const score = common.reduce((s, id) => s + id.length, 0);
          // Exige ≥2 identificadores em comum. Termo de especialidade isolado
          // (UROLOGIA, ORTOPEDIA, NEUROLOGIA…) causa falso match quando a PJ
          // real não está no lote — preferimos deixar sem mapeamento.
          const hasEnough = common.length >= 2;
          if (hasEnough && score > (bestMatch?.score ?? 0)) {
            bestMatch = { company: c, score };
          }
        }
        if (bestMatch) return { company: bestMatch.company, level: 'medium' };


        return { company: null, level: null };
      };

      const autoMapping: Record<string, string | null> = {};
      const newMatchLevels: Record<string, MatchLevel> = {};
      for (const terceiro of terceiros) {
        const { company, level } = findMatch(terceiro, loteCompanies);
        autoMapping[terceiro] = company;
        newMatchLevels[terceiro] = level;
      }

      setParsedRows(rows);
      setParsedColMap(colMap);
      setPendingFileName(file.name);
      setHospitalCompanies(terceiros);
      setCompanyMapping(autoMapping);
      setMatchLevels(newMatchLevels);
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

      console.log('[Conciliação] parsedColMap:', parsedColMap);
      console.log('[Conciliação] parsedRows[0]:', parsedRows[0]);
      console.log('[Conciliação] paymentItems sample:', paymentItems.slice(0, 3).map(it => ({
        attendance_number: it.attendance_number,
        procedure_code: it.procedure_code,
        company_name: it.company_name,
        gross_amount: (it as unknown as Record<string, unknown>).gross_amount,
      })));

      // Fallback: se procCode não foi detectado, tentar encontrar manualmente
      if (!parsedColMap['procCode'] && parsedRows.length > 0) {
        const firstRow = parsedRows[0];
        const candidates = Object.keys(firstRow).filter(k => {
          const norm = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
          return norm.includes('tuss') || norm.includes('codigo') || norm.includes('código');
        });
        if (candidates.length > 0) {
          parsedColMap['procCode'] = candidates[0];
          console.log('[Conciliação] procCode detectado no fallback:', candidates[0]);
        }
      }

      const filteredRows = parsedRows.filter((row) => {
        const col = parsedColMap["company"];
        const terceiro = col ? String(row[col] ?? "").trim() : "";
        return terceiro && companyMapping[terceiro];
      });

      // Filtro de procedimentos — exclui Consultas/Visitas por padrão
      const GRUPOS_EXCLUIR = new Set(['CONSULTAS', 'VISITAS']);
      const colGrupo = parsedColMap['grupo'] ?? null;

      const rowsParaCruzamento = excludeConsultas && colGrupo
        ? filteredRows.filter(row => {
            const grupo = String(row[colGrupo] ?? '').trim();
            return !GRUPOS_EXCLUIR.has(grupo.toUpperCase());
          })
        : filteredRows;

      const sampleRow = rowsParaCruzamento[0];
      if (sampleRow) {
        console.log('[Conciliação] sample row filtrada:', sampleRow);
        console.log('[Conciliação] att col:', parsedColMap['attendance'], '-> valor:', sampleRow[parsedColMap['attendance']]);
        console.log('[Conciliação] code col:', parsedColMap['procCode'], '-> valor:', sampleRow[parsedColMap['procCode']]);
      }

      const normalizeCode = (code: unknown): string => {
        if (code == null || code === '') return '';
        const str = String(code).trim();
        const num = Number(str);
        if (!isNaN(num) && isFinite(num) && num > 0) return String(Math.round(num));
        return str.replace(/\D/g, '');
      };

      const normAtt = (att: unknown): string => {
        if (att == null || att === '') return '';
        const str = String(att).trim();
        const num = Number(str);
        if (!isNaN(num) && isFinite(num) && num > 0) return String(Math.round(num));
        return str.replace(/\D/g, '');
      };

      const makeKey = (att: unknown, code: unknown): string =>
        `${normAtt(att)}|${normalizeCode(code)}`;

      const normName = (s: unknown): string =>
        String(s ?? "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();

      const normRole = (s: unknown): string => {
        const n = normName(s);
        if (!n) return "";
        if (n.includes("anest")) return "anestesia";
        if (n.includes("instrument")) return "instrumentador";
        if (n.includes("aux") && n.includes("2")) return "aux2";
        if (n.includes("aux") && n.includes("1")) return "aux1";
        if (n.includes("aux")) return "aux";
        if (n.includes("princ") || n.includes("cirurg")) return "principal";
        return n;
      };

      const normQty = (q: unknown): number => {
        const n = Number(String(q ?? "").replace(",", "."));
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
      };

      const medpayByKey = new Map<string, PaymentItemRow[]>();
      for (const it of paymentItems) {
        if (!it.attendance_number || !it.procedure_code) continue;
        const k = makeKey(it.attendance_number, it.procedure_code);
        if (!medpayByKey.has(k)) medpayByKey.set(k, []);
        medpayByKey.get(k)!.push(it);
      }

      // Debug: mostrar primeiros 3 pares de chaves de cada base
      const sampleHospKeys = rowsParaCruzamento.slice(0, 3).map(row => {
        const att = getCell(row, "attendance");
        const code = getCell(row, "procCode");
        return `hosp:${normAtt(att)}|${normalizeCode(code)}`;
      });
      const sampleMedKeys = Array.from(medpayByKey.keys()).slice(0, 3);
      console.log('[Cruzamento] Chaves hospital (amostra):', sampleHospKeys);
      console.log('[Cruzamento] Chaves MedPay (amostra):', sampleMedKeys);
      console.log('[Cruzamento] Total chaves MedPay:', medpayByKey.size);


      const matchedMedpayIds = new Set<string>();
      const toInsert: Array<Record<string, unknown>> = [];
      let conciliado = 0,
        valor_divergente = 0,
        so_hospital = 0,
        so_medpay = 0;
      let risco_mais = 0,
        risco_menos = 0,
        divergencia_valor = 0;

      for (const row of rowsParaCruzamento) {
        const att = getCell(row, "attendance");
        const account = getCell(row, "account");
        const code = getCell(row, "procCode");
        const valHosp = toVal(getCell(row, "value"));
        const patient = getCell(row, "patient");
        const doctor = getCell(row, "doctor");
        const procName = getCell(row, "procName");
        const dateRaw = getCell(row, "date");
        const roleHosp = getCell(row, "role");
        const qtyHosp = getCell(row, "quantity");
        const col = parsedColMap["company"];
        const terceiro = col ? String(row[col] ?? "").trim() : "";
        const mappedCompany = companyMapping[terceiro] ?? terceiro;
        const dateStr = toDateStr(dateRaw);
        const k = makeKey(att, code);
        const candidates = medpayByKey.get(k) ?? [];
        const getConvenioValue = (m: PaymentItemRow): number => {
          const proc = (m as any).procedure_amount;
          if (proc != null && proc !== "") return Number(proc) || 0;
          return Number((m as any).gross_amount ?? 0) || 0;
        };

        // Matching disambiguation: além de atendimento+código, exige coerência
        // de médico/função/qtd. Sem isso, linhas com mesmo att+code de médicos
        // diferentes (ex.: principal vs auxiliar) cruzavam valor errado.
        const available = candidates.filter((m) => !matchedMedpayIds.has(m.id));
        const docHospN = normName(doctor);
        const roleHospN = normRole(roleHosp);
        const qtyHospN = normQty(qtyHosp);

        const scoreCandidate = (m: PaymentItemRow): { score: number; docOk: boolean; roleOk: boolean } => {
          let s = 0;
          const docMedN = normName((m as any).doctor_name);
          const roleMedN = normRole((m as any).doctor_role);
          const qtyMedN = normQty((m as any).quantity);
          let docOk = false, roleOk = false;
          if (docHospN && docMedN && docHospN === docMedN) { s += 1000; docOk = true; }
          else if (docHospN && docMedN && (docMedN.includes(docHospN) || docHospN.includes(docMedN))) { s += 400; docOk = true; }
          if (roleHospN && roleMedN && roleHospN === roleMedN) { s += 200; roleOk = true; }
          else if (roleHospN && roleMedN) s -= 150;
          if (qtyHospN === qtyMedN) s += 50;
          const diff = Math.abs(getConvenioValue(m) - valHosp);
          s += Math.max(0, 30 - Math.min(30, (diff / Math.max(1, valHosp)) * 30));
          return { score: s, docOk, roleOk };
        };

        let match: PaymentItemRow | undefined;
        let ambiguous = false;
        if (available.length === 1) {
          match = available[0];
        } else if (available.length > 1) {
          const ranked = available
            .map((m) => ({ m, ...scoreCandidate(m) }))
            .sort((a, b) => b.score - a.score);
          match = ranked[0].m;
          // Ambíguo: top sem identidade clara (sem doc nem role coerentes)
          if (!ranked[0].docOk && !ranked[0].roleOk) ambiguous = true;
        }

        const base: Record<string, unknown> = {
          attendance_number: att ? String(Math.round(Number(att)) || att) : null,
          patient_name: patient ? String(patient) : null,
          procedure_code: code ? String(code) : null,
          procedure_name: procName ? String(procName) : null,
          doctor_name: doctor ? String(doctor) : null,
          role: getCell(row, "role") ? String(getCell(row, "role")) : null,
          quantity: getCell(row, "quantity") ? Number(String(getCell(row, "quantity")).replace(",", ".")) || null : null,
          procedure_date: dateStr,

          valor_hospital: valHosp,
          valor_medpay: 0,
          payment_item_id: null,
          company_name: mappedCompany,
          ia_obs: null,
          status: "so_hospital",
          agreement_text: getCell(row, "agreement") ? String(getCell(row, "agreement")) : null,
          applied_rule_label: null,
          applied_calc_method: null,
          valor_regra: null,
        };

        if (match) {
          matchedMedpayIds.add(match.id);
          const valMed = getConvenioValue(match);
          base.payment_item_id = match.id;
          base.valor_medpay = valMed;
          if (!base.patient_name) base.patient_name = match.patient_name ?? null;
          if (!base.doctor_name) base.doctor_name = (match as any).doctor_name ?? null;
          if (!base.procedure_name) base.procedure_name = (match as any).procedure_name ?? null;
          if (!base.procedure_date) base.procedure_date = (match as any).procedure_date ?? null;
          if (!base.company_name) base.company_name = match.company_name ?? null;
          if (!base.agreement_text) base.agreement_text = (match as any).agreement_text ?? null;
          // Mantém o rótulo da regra apenas como CONTEXTO informativo — não entra no cálculo da divergência
          base.applied_rule_label = (match as any).applied_rule_label ?? null;
          base.applied_calc_method = (match as any).applied_calc_method ?? null;
          base.valor_regra = (match as any).expected_amount ?? null;

          const diff = valHosp - valMed;
          if (Math.abs(diff) < 0.02) {
            base.status = "conciliado";
            conciliado++;
          } else {
            base.status = "valor_divergente";
            valor_divergente++;
            const pct = valMed > 0 ? (diff / valMed) * 100 : 0;
            const ambigPrefix = ambiguous
              ? `⚠ Match ambíguo (mesmo atendimento+código com médicos/funções diferentes — confira manualmente). `
              : "";
            base.ia_obs = `${ambigPrefix}Tabela convênio — Hospital: ${formatCurrency(valHosp)} · MedPay: ${formatCurrency(valMed)} · Diferença: ${formatCurrency(Math.abs(diff))} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%). Comparação feita ANTES da aplicação de regras/acordo: divergência aqui indica diferença na tabela do convênio entre as duas bases, não erro de regra.`;
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
        const valMed = Number((it as any).procedure_amount ?? (it as any).gross_amount ?? 0);
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
          valor_regra: (it as any).expected_amount ?? null,
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
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
      toast({ title: "Falha na conciliação", description: msg, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const doctorOptions = useMemo(() => {
    const base = initialCompany
      ? items.filter((it) => (it.company_name ?? "") === initialCompany)
      : items;
    return Array.from(new Set(base.map((i) => i.doctor_name ?? "").filter(Boolean))).sort();
  }, [items, initialCompany]);

  // Escopo = todos os filtros EXCETO o activeFilter (tabs/KPIs por status).
  // KPIs, totais financeiros, contagens das abas e exportações recalculam
  // sobre este escopo — assim a tela "se comporta conforme filtro".
  const scopedItems = useMemo(() => {
    let base = items;
    if (initialCompany) {
      base = base.filter((it) => (it.company_name ?? "") === initialCompany);
    }
    if (doctorFilter !== "todos") {
      base = base.filter((it) => (it.doctor_name ?? "") === doctorFilter);
    }
    const min = minValue ? parseFloat(minValue.replace(",", ".")) : null;
    const max = maxValue ? parseFloat(maxValue.replace(",", ".")) : null;
    if (min !== null && !Number.isNaN(min)) {
      base = base.filter((it) => Math.max(Number(it.valor_medpay), Number(it.valor_hospital)) >= min);
    }
    if (max !== null && !Number.isNaN(max)) {
      base = base.filter((it) => Math.max(Number(it.valor_medpay), Number(it.valor_hospital)) <= max);
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      base = base.filter((it) =>
        [
          it.patient_name,
          it.doctor_name,
          it.attendance_number,
          it.procedure_code,
          it.procedure_name,
          it.company_name,
          it.ia_obs,
        ]
          .map((v) => (v ?? "").toString().toLowerCase())
          .some((s) => s.includes(term)),
      );
    }
    return base;
  }, [items, initialCompany, doctorFilter, minValue, maxValue, searchTerm]);

  const scopedStats = useMemo(() => {
    let conciliado = 0, valor_divergente = 0, so_hospital = 0, so_medpay = 0;
    let risco_mais = 0, risco_menos = 0, divergencia_valor = 0;
    for (const it of scopedItems) {
      if (it.status === "conciliado") conciliado++;
      else if (it.status === "valor_divergente") valor_divergente++;
      else if (it.status === "so_hospital") so_hospital++;
      else if (it.status === "so_medpay") so_medpay++;
      const vm = Number(it.valor_medpay) || 0;
      const vh = Number(it.valor_hospital) || 0;
      if (it.status === "valor_divergente") {
        const diff = vh - vm;
        divergencia_valor += Math.abs(diff);
        if (diff > 0) risco_mais += diff; else risco_menos += Math.abs(diff);
      } else if (it.status === "so_hospital") {
        risco_mais += vh;
      } else if (it.status === "so_medpay") {
        risco_menos += vm;
      }
    }
    return {
      total: scopedItems.length,
      conciliado, valor_divergente, so_hospital, so_medpay,
      risco_mais, risco_menos, divergencia_valor,
    };
  }, [scopedItems]);

  const filteredItems = useMemo(() => {
    if (activeFilter === "todos") return scopedItems;
    return scopedItems.filter((it) => it.status === activeFilter);
  }, [scopedItems, activeFilter]);

  const hasExtraFilters = !!(searchTerm || doctorFilter !== "todos" || minValue || maxValue);
  const isScoped = !!initialCompany || hasExtraFilters;
  const clearExtraFilters = () => {
    setSearchTerm("");
    setDoctorFilter("todos");
    setMinValue("");
    setMaxValue("");
  };

  const handleExport = () => {
    if (!run) return;

    const data = filteredItems.map((it) => ({
      "Status": STATUS_LABEL[it.status],
      "Empresa": it.company_name ?? "",
      "Médico": it.doctor_name ?? "",
      "Paciente": it.patient_name ?? "",
      "Atendimento": it.attendance_number ?? "",
      "Cód. TUSS": it.procedure_code ?? "",
      "Procedimento": it.procedure_name ?? "",
      "Data": it.procedure_date ? formatDateBR(it.procedure_date) : "",
      "Convênio": it.agreement_text ?? "",
      "MedPay (R$)": Number(it.valor_medpay),
      "Hospital (R$)": Number(it.valor_hospital),
      "Diferença (R$)": Number((it.valor_hospital - it.valor_medpay).toFixed(2)),
      "Regra MedPay": it.applied_rule_label ?? "",
      "Método Cálculo": it.applied_calc_method ?? "",
      "Observação IA": it.ia_obs ?? "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    ws["!cols"] = [
      { wch: 18 }, { wch: 38 }, { wch: 30 }, { wch: 30 }, { wch: 14 },
      { wch: 14 }, { wch: 48 }, { wch: 12 }, { wch: 22 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 36 }, { wch: 20 }, { wch: 60 },
    ];

    const headerRange = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    for (let C = headerRange.s.c; C <= headerRange.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1E3A5F' } },
          alignment: { horizontal: 'center' },
        };
      }
    }

    const STATUS_COLOR: Record<string, string> = {
      'Conciliado': 'F0FDF4',
      'Valor divergente': 'FFFBEB',
      'Só no hospital': 'FEF2F2',
      'Só no MedPay': 'EFF6FF',
    };
    for (let R = 1; R <= headerRange.e.r; R++) {
      const statusCell = ws[XLSX.utils.encode_cell({ r: R, c: 0 })];
      const color = STATUS_COLOR[statusCell?.v ?? ''];
      if (color) {
        for (let C = 0; C <= headerRange.e.c; C++) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell) cell.s = { fill: { fgColor: { rgb: color } } };
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conciliação");

    const filterDescParts: string[] = [];
    if (initialCompany) filterDescParts.push(`Empresa: ${initialCompany}`);
    if (doctorFilter !== "todos") filterDescParts.push(`Médico: ${doctorFilter}`);
    if (activeFilter !== "todos") filterDescParts.push(`Status: ${STATUS_LABEL[activeFilter as ReconciliationItem["status"]] ?? activeFilter}`);
    if (searchTerm) filterDescParts.push(`Busca: "${searchTerm}"`);
    if (minValue) filterDescParts.push(`Valor mín: ${minValue}`);
    if (maxValue) filterDescParts.push(`Valor máx: ${maxValue}`);
    const filterDesc = filterDescParts.length ? filterDescParts.join(" · ") : "Sem filtros";

    const summaryData: (string | number)[][] = [
      ["Relatório de Conciliação de Produção"],
      [""],
      ["Lote", paymentReference],
      ["Arquivo base", run.file_name ?? ""],
      ["Data da conciliação", formatDateTimeBR(run.created_at)],
      ["Filtros aplicados", filterDesc],
      [""],
      ["RESUMO (escopo filtrado)"],
      ["Total de itens", scopedStats.total],
      ["Conciliados", scopedStats.conciliado, `${scopedStats.total ? ((scopedStats.conciliado / scopedStats.total) * 100).toFixed(1) : 0}%`],
      ["Valor divergente", scopedStats.valor_divergente],
      ["Só no hospital", scopedStats.so_hospital],
      ["Só no MedPay", scopedStats.so_medpay],
      [""],
      ["IMPACTO FINANCEIRO (escopo filtrado)"],
      ["Risco pagamento a mais", Number(scopedStats.risco_mais.toFixed(2))],
      ["Risco pagamento a menos", Number(scopedStats.risco_menos.toFixed(2))],
      ["Divergência de valores", Number(scopedStats.divergencia_valor.toFixed(2))],
      [""],
      ["TOTAIS DO LOTE (sem filtro)"],
      ["Total de itens (lote)", run.total_items],
      ["Risco a mais (lote)", run.risco_mais],
      ["Risco a menos (lote)", run.risco_menos],
      ["Divergência (lote)", run.divergencia_valor],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 30 }, { wch: 40 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Resumo");

    XLSX.writeFile(wb, `conciliacao_${paymentReference.replace(/[^a-z0-9]/gi, "_")}.xlsx`);
    toast({ title: "Relatório exportado", description: "Arquivo XLSX gerado com sucesso." });
  };

  const handleExportPdf = async () => {
    if (!run) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 10;
    const tableWidth = pageWidth - marginX * 2; // 277mm em A4 paisagem

    // Faixa do cabeçalho
    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, pageWidth, 22, "F");

    // "Gerado em" à direita primeiro, para reservar espaço do título
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const generatedLabel = `Gerado em: ${formatDateTimeBR(new Date().toISOString())}`;
    const generatedWidth = doc.getTextWidth(generatedLabel);
    doc.text(generatedLabel, pageWidth - marginX, 13, { align: "right" });

    // Título com largura limitada para não colidir com a data
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    const titleMaxWidth = pageWidth - marginX * 2 - generatedWidth - 8;
    const titleLines = doc.splitTextToSize(
      `Conciliação de Produção — ${paymentReference}`,
      titleMaxWidth,
    ) as string[];
    doc.text(titleLines[0] ?? "", marginX, 13);
    // Se o título tiver 2ª linha, renderiza em fonte menor logo abaixo
    if (titleLines[1]) {
      doc.setFontSize(9);
      doc.text(titleLines.slice(1).join(" "), marginX, 19);
    }

    let cursorY = 28;
    const filterDescParts: string[] = [];
    if (initialCompany) filterDescParts.push(`Empresa: ${initialCompany}`);
    if (doctorFilter !== "todos") filterDescParts.push(`Médico: ${doctorFilter}`);
    if (activeFilter !== "todos") filterDescParts.push(`Status: ${STATUS_LABEL[activeFilter as ReconciliationItem["status"]] ?? activeFilter}`);
    if (searchTerm) filterDescParts.push(`Busca: "${searchTerm}"`);
    if (minValue || maxValue) filterDescParts.push(`Valor: ${minValue || "—"} a ${maxValue || "—"}`);
    if (filterDescParts.length) {
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      const filterLines = doc.splitTextToSize(`Filtros: ${filterDescParts.join(" · ")}`, tableWidth) as string[];
      doc.text(filterLines, marginX, cursorY);
      cursorY += filterLines.length * 3.5 + 1;
    }

    doc.setTextColor(30, 58, 95);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(
      `Total: ${scopedStats.total}  ·  Conciliados: ${scopedStats.conciliado}  ·  Divergência: ${scopedStats.valor_divergente}  ·  Só hospital: ${scopedStats.so_hospital}  ·  Só MedPay: ${scopedStats.so_medpay}${isScoped ? "  (escopo filtrado)" : ""}`,
      marginX,
      cursorY,
    );
    cursorY += 5;

    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `Risco +: R$ ${scopedStats.risco_mais.toFixed(2)}  ·  Risco -: R$ ${scopedStats.risco_menos.toFixed(2)}  ·  Divergência: R$ ${scopedStats.divergencia_valor.toFixed(2)}`,
      marginX,
      cursorY,
    );
    cursorY += 4;

    const tableData = filteredItems.map((it) => [
      STATUS_LABEL[it.status],
      it.company_name ?? "",
      it.doctor_name ?? "",
      it.patient_name ?? "",
      it.procedure_code ?? "",
      it.procedure_date ? formatDateBR(it.procedure_date) : "",
      it.agreement_text ?? "",
      `R$ ${Number(it.valor_medpay).toFixed(2)}`,
      `R$ ${Number(it.valor_hospital).toFixed(2)}`,
      it.applied_rule_label ?? "",
    ]);

    const STATUS_FILL: Record<string, [number, number, number]> = {
      "Conciliado": [240, 253, 244],
      "Valor divergente": [255, 251, 235],
      "Só no hospital": [254, 242, 242],
      "Só no MedPay": [239, 246, 255],
    };

    // Larguras proporcionais que somam exatamente tableWidth (277mm)
    // proporções: 8,14,11,11,6,6,8,7,7,15 = 100 (em fração de tableWidth)
    const widthFractions = [0.08, 0.14, 0.11, 0.11, 0.06, 0.06, 0.08, 0.07, 0.07, 0.15];
    const colWidths = widthFractions.map((f) => +(tableWidth * f).toFixed(2));

    autoTable(doc, {
      startY: cursorY + 2,
      head: [["Status", "Empresa", "Médico", "Paciente", "TUSS", "Data", "Convênio", "MedPay", "Hospital", "Regra MedPay"]],
      body: tableData,
      styles: { fontSize: 7, cellPadding: 1.6, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold", fontSize: 7.5, halign: "left" },
      columnStyles: {
        0: { cellWidth: colWidths[0] },
        1: { cellWidth: colWidths[1] },
        2: { cellWidth: colWidths[2] },
        3: { cellWidth: colWidths[3] },
        4: { cellWidth: colWidths[4] },
        5: { cellWidth: colWidths[5] },
        6: { cellWidth: colWidths[6] },
        7: { cellWidth: colWidths[7], halign: "right" },
        8: { cellWidth: colWidths[8], halign: "right" },
        9: { cellWidth: colWidths[9] },
      },
      didParseCell: (data) => {
        if (data.section === "body") {
          const status = String(tableData[data.row.index]?.[0] ?? "");
          const fill = STATUS_FILL[status];
          if (fill) data.cell.styles.fillColor = fill;
        }
      },
      margin: { left: marginX, right: marginX },
      tableWidth,
    });


    doc.save(`conciliacao_${paymentReference.replace(/[^a-z0-9]/gi, "_")}.pdf`);
    toast({ title: "PDF exportado", description: "Arquivo PDF gerado com sucesso." });
  };

  const triggerNew = () => {
    setStep("select_base");
    setRun(null);
    setItems([]);
    setParsedRows([]);
    setCompanyMapping({});
    setHospitalCompanies([]);
    setPendingFileName("");
    setSelectedBase(null);
    setAvailableSectors([]);
    setSelectedSectors([]);
    setColMapping({});
    setAvailableColumns([]);
    setColSamples({});
    setSaveColMapping(true);
  };

  const filters: Array<{ key: string; label: string; count: number }> = [
    { key: "todos", label: "Todos", count: scopedStats.total },
    { key: "conciliado", label: "Conciliados", count: scopedStats.conciliado },
    { key: "valor_divergente", label: "Valor divergente", count: scopedStats.valor_divergente },
    { key: "so_hospital", label: "Só no hospital", count: scopedStats.so_hospital },
    { key: "so_medpay", label: "Só no MedPay", count: scopedStats.so_medpay },
  ];

  const total = scopedStats.total;
  const pendentes =
    scopedStats.valor_divergente + scopedStats.so_hospital + scopedStats.so_medpay;

  const exactCount = Object.entries(companyMapping).filter(([t, v]) => v && (matchLevels[t] === 'exact' || matchLevels[t] === 'high')).length;
  const confirmCount = Object.entries(companyMapping).filter(([t, v]) => v && matchLevels[t] === 'medium').length;
  const pendingCount = hospitalCompanies.filter((t) => !companyMapping[t]).length;

  const handleAction = async (
    item: ReconciliationItem,
    action: 'incorporar_credito' | 'incorporar_debito' | 'marcar_glosa' | 'revisar_manual' | 'ignorar',
    note?: string,
  ) => {
    if (!user) return;
    setActionLoading(item.id);
    try {
      let appliedPaymentId: string | null = null;
      let appliedPaymentItemId: string | null = null;

      if (action === 'incorporar_credito' || action === 'incorporar_debito') {
        const { data: groups } = await supabase
          .from('payment_company_groups')
          .select('payment_id, payments!inner(id, status, reference, created_at)')
          .eq('company_name', item.company_name ?? '')
          .in('payments.status', ['revisao_analista', 'concluida_analista', 'devolvido_analista'])
          .order('payments(created_at)', { ascending: false })
          .limit(1);

        if (!groups || groups.length === 0) {
          toast({
            title: 'Nenhum lote ativo encontrado para esta empresa',
            description: 'Crie ou abra um lote em andamento para esta empresa antes de incorporar itens.',
            variant: 'destructive',
          });
          return;
        }

        const targetPaymentId = (groups[0].payments as any).id;
        const targetRef = (groups[0].payments as any).reference;

        const valorConvenio = Number(item.valor_hospital ?? 0);
        const valorMedpay = Number(item.valor_medpay ?? 0);
        const diferenca = Math.abs(valorConvenio - valorMedpay);
        const isCredito = action === 'incorporar_credito';
        const valorAjuste = isCredito
          ? (item.status === 'so_hospital' ? (item.valor_regra ?? valorConvenio) : diferenca)
          : diferenca;

        const { data: newItem, error: itemErr } = await supabase
          .from('payment_items')
          .insert({
            payment_id: targetPaymentId,
            doctor_name: item.doctor_name ?? '—',
            doctor_document: item.doctor_document ?? null,
            company_name: item.company_name ?? null,
            procedure_code: item.procedure_code ?? null,
            procedure_name: item.procedure_name ?? null,
            procedure_date: item.procedure_date ?? null,
            patient_name: item.patient_name ?? null,
            agreement_text: item.agreement_text ?? null,
            gross_amount: isCredito ? valorAjuste : -valorAjuste,
            expected_amount: isCredito ? valorAjuste : -valorAjuste,
            ai_status: 'aprovado',
            item_origem: isCredito ? 'conciliacao_credito' : 'conciliacao_debito',
            origem_referencia: `Conciliação ${item.competence_month ?? (run as any)?.competence_month ?? ''}`.trim(),
            origem_reconciliation_item_id: item.id,
          } as any)
          .select('id')
          .single();

        if (itemErr || !newItem) throw new Error(itemErr?.message ?? 'Erro ao criar item de ajuste');
        appliedPaymentId = targetPaymentId;
        appliedPaymentItemId = newItem.id;

        toast({
          title: `Item ${isCredito ? 'creditado' : 'debitado'} no lote "${targetRef}"`,
          description: `${formatCurrency(valorAjuste)} adicionado como ajuste de conciliação`,
        });
      }

      await supabase
        .from('reconciliation_items')
        .update({
          action_taken: action,
          action_by: user.id,
          action_at: new Date().toISOString(),
          action_note: note ?? null,
          applied_payment_id: appliedPaymentId,
          applied_payment_item_id: appliedPaymentItemId,
        } as any)
        .eq('id', item.id);

      if (action === 'incorporar_credito' || action === 'incorporar_debito') {
        if (selectedBase?.id) {
          await supabase
            .from('conciliation_bases')
            .update({ tem_itens_aplicados: true } as any)
            .eq('id', selectedBase.id);
        }
      }

      setItems(prev =>
        prev.map(ri => ri.id === item.id
          ? { ...ri, action_taken: action, action_by: user.id, action_at: new Date().toISOString() }
          : ri,
        ),
      );

      if (action === 'ignorar') toast({ title: 'Item marcado como ignorado' });
      if (action === 'revisar_manual') toast({ title: 'Item marcado para revisão manual' });
      if (action === 'marcar_glosa') toast({ title: 'Item marcado como glosa', description: 'Será processado no fluxo de glosas.' });
    } catch (e: any) {
      toast({ title: 'Erro ao processar ação', description: e.message, variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

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
              {initialCompany && <span className="text-muted-foreground"> · {initialCompany}</span>}
            </SheetTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {initialCompany
                ? `Cruzamento filtrado: apenas itens de ${initialCompany}`
                : "Cruzamento entre base MedPay e extrato hospitalar"}
            </p>
          </div>
          <div className="flex gap-2">
            {step === "result" && run && (
              <Button variant="outline" size="sm" onClick={triggerNew} disabled={processing}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Nova conciliação
              </Button>
            )}
            {step === "result" && run && run.status === "done" && (
              <>
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <FileDown className="h-4 w-4 mr-1.5" />
                  XLSX
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportPdf}>
                  <FileDown className="h-4 w-4 mr-1.5" />
                  PDF
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Fechar conciliação">
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
            <div className="space-y-6" aria-busy="true" aria-label="Carregando conciliação">
              {/* Banner da base */}
              <Skeleton className="h-12 w-full rounded-lg" />
              {/* KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[88px] rounded-xl" />
                ))}
              </div>
              {/* Impacto financeiro */}
              <Card>
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-6 w-28" />
                    </div>
                  ))}
                </CardContent>
              </Card>
              {/* Tabs filtro */}
              <div className="flex flex-wrap gap-2 border-b border-border pb-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-28 rounded-full" />
                ))}
              </div>
              {/* Linhas da tabela */}
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
              <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando itens da conciliação…
              </p>
            </div>
          )}

          {!loading && step === "select_base" && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Selecionar base de conciliação</p>
                <p className="text-xs text-muted-foreground">Escolha uma base importada em Glosas e Conciliação. Depois filtre pelo setor que deseja conciliar.</p>
              </div>

              {loadingBases ? (
                <div className="space-y-2" aria-busy="true" aria-label="Carregando bases">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : concBases.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium">Nenhuma base disponível</p>
                    <p className="text-xs text-muted-foreground mt-1">Importe uma base em <strong>Financeiro → Glosas e Conciliação → Bases de Conciliação</strong>.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {concBases.map(base => {
                    const isSelected = selectedBase?.id === base.id;
                    return (
                      <button
                        key={base.id}
                        type="button"
                        onClick={() => handleSelectBase(base)}
                        className={cn(
                          "w-full text-left p-4 rounded-lg border transition-all",
                          isSelected
                            ? "border-primary/60 bg-accent/60 shadow-sm"
                            : "border-border bg-card hover:bg-muted/40"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{base.reference}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {base.total_rows} linhas · {base.file_name} · {new Date(base.created_at).toLocaleDateString("pt-BR")}
                              {base.competence_month && ` · competência ${base.competence_month}`}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                              <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedBase && availableSectors.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Filtrar por setor</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Selecione apenas os setores pertinentes a este lote. Deixe todos desmarcados para incluir a base completa (não recomendado — pode gerar ruído entre tipos de atendimento).
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {availableSectors.map(sector => {
                      const checked = selectedSectors.includes(sector);
                      const count = (selectedBase.raw_data ?? []).filter((r: any) => {
                        const sectorCol = Object.keys(r).find(k => {
                          const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                          return n.includes("setor") || n.includes("centro") || n.includes("custos");
                        });
                        return sectorCol && String(r[sectorCol] ?? "").trim() === sector;
                      }).length;
                      return (
                        <label
                          key={sector}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                            checked ? "border-primary/60 bg-accent/60" : "border-border bg-card hover:bg-muted/40"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedSectors(prev =>
                              checked ? prev.filter(s => s !== sector) : [...prev, sector]
                            )}
                            className="h-4 w-4 rounded"
                            style={{ accentColor: "hsl(var(--primary))" }}
                          />
                          <span className="text-xs font-medium flex-1 truncate">{sector}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{count} linhas</span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedSectors.length > 0 && (
                    <p className="text-xs text-primary font-medium">
                      {selectedSectors.length} setor(es) selecionado(s) · {
                        (selectedBase.raw_data ?? []).filter((r: any) => {
                          const sectorCol = Object.keys(r).find(k => {
                            const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                            return n.includes("setor") || n.includes("centro") || n.includes("custos");
                          });
                          return sectorCol && selectedSectors.includes(String(r[sectorCol] ?? "").trim());
                        }).length
                      } linhas serão analisadas
                    </p>
                  )}
                </div>
              )}

              {selectedBase && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-muted/40 border border-border rounded-lg text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground">Lógica de cruzamento:</strong> chave = <strong className="text-foreground">Nº de atendimento + código TUSS</strong>. A comparação financeira é <strong className="text-foreground">tabela do convênio × tabela do convênio</strong> (valor antes da aplicação de qualquer regra/acordo). Divergências aqui indicam diferenças na tabela do convênio entre as duas bases — não erro do motor de regras.
                  </span>
                </div>
              )}

              {selectedBase && (
                <div className="flex justify-end pt-2 border-t border-border">
                  <Button
                    disabled={!selectedBase}
                    onClick={handleProcessFromBase}
                  >
                    Continuar → Vincular empresas
                  </Button>
                </div>
              )}
            </div>
          )}

          {!loading && step === "col_mapping" && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Mapear colunas da planilha</p>
                <p className="text-xs text-muted-foreground">
                  O sistema detectou automaticamente as colunas abaixo. Confirme ou corrija cada vínculo antes de continuar.
                  Campos marcados com <span className="text-destructive font-medium">*</span> são obrigatórios para o cruzamento.
                </p>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="grid grid-cols-[200px_1fr_160px_32px] gap-3 px-4 py-2 bg-muted/60 border-b border-border">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campo MedPay</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coluna na planilha</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Amostra</span>
                  <span />
                </div>

                {COL_FIELDS.map((field) => {
                  const mapped = colMapping[field.key] || "";
                  const sample = mapped ? (colSamples[mapped] ?? "—") : "—";
                  const isMissing = field.required && !mapped;
                  const isDetected = !!mapped;

                  return (
                    <div
                      key={field.key}
                      className={cn(
                        "grid grid-cols-[200px_1fr_160px_32px] gap-3 px-4 py-3 border-b border-border last:border-b-0 items-center",
                        isMissing ? "bg-destructive/5" : "bg-card"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground flex items-center gap-1">
                          {field.required && <span className="text-destructive">*</span>}
                          {field.label}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{field.description}</p>
                      </div>

                      <select
                        value={mapped}
                        onChange={(e) => setColMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className={cn(
                          "h-8 text-xs border rounded-md px-2 w-full bg-background",
                          isMissing ? "border-destructive text-destructive" : "border-border text-foreground"
                        )}
                      >
                        <option value="">— não mapeado —</option>
                        {availableColumns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>

                      <span className="text-[11px] text-muted-foreground truncate" title={sample}>{sample}</span>

                      <div className="flex items-center justify-center">
                        {isMissing ? (
                          <span className="w-5 h-5 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center text-[10px] text-destructive font-bold">!</span>
                        ) : isDetected ? (
                          <span className="w-5 h-5 rounded-full bg-success/10 border border-success/30 flex items-center justify-center text-[10px] text-success">✓</span>
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-muted border border-border" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <label className="flex items-center gap-3 px-3 py-2.5 bg-muted/40 border border-border rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveColMapping}
                  onChange={(e) => setSaveColMapping(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <div>
                  <span className="text-xs font-medium text-foreground">Lembrar este mapeamento</span>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Salva o vínculo de colunas nesta base. Na próxima conciliação com este arquivo, os campos já virão preenchidos.
                  </p>
                </div>
              </label>

              {COL_FIELDS.filter(f => !f.required && !colMapping[f.key]).length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-muted/40 border border-border rounded-lg text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Campos opcionais não mapeados serão ignorados no resultado. Médico e quantidade enriquecem a análise mas não afetam o cruzamento.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStep("select_base")}
                >
                  ← Voltar
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmColMapping}
                  disabled={COL_FIELDS.some(f => f.required && !colMapping[f.key])}
                >
                  Confirmar e vincular empresas →
                </Button>
              </div>
            </div>
          )}

          {!loading && step === "mapping" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-4 bg-muted/40 border border-border rounded-lg">
                <div className="p-2 rounded-full bg-primary/10 text-primary shrink-0">
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
                  <div className="w-2 h-2 rounded-full bg-warning" /> Confirmar sugestão
                </span>
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Não encontrado
                </span>
              </div>

              <div className="flex items-center gap-3 p-3 bg-muted/40 border border-border rounded-lg">
                <input
                  type="checkbox"
                  id="excludeConsultas"
                  checked={excludeConsultas}
                  onChange={(e) => setExcludeConsultas(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <label htmlFor="excludeConsultas" className="text-xs text-muted-foreground cursor-pointer">
                  <span className="font-medium text-foreground">Excluir Consultas e Visitas</span>
                  {' '}— remove procedimentos do Grupo CBHPM "CONSULTAS" da análise (visitas hospitalares, pareceres, consultas ambulatoriais)
                </label>
              </div>

              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {hospitalCompanies.map((terceiro) => {
                  const mapped = companyMapping[terceiro];
                  const level = matchLevels[terceiro];

                  const cardStyle = mapped
                    ? level === 'exact' || level === 'high'
                      ? 'border-success/30 bg-success/5'
                      : 'border-warning/30 bg-warning/5'
                    : 'border-border bg-muted/30';

                  const dotColor = mapped
                    ? level === 'exact' || level === 'high'
                      ? 'bg-success'
                      : 'bg-warning'
                    : 'bg-muted-foreground/40';

                  const badge = mapped
                    ? level === 'exact'
                      ? <span className="text-[10px] font-semibold text-success bg-success/10 border border-success/30 px-1.5 py-0.5 rounded-full shrink-0">Auto ✓</span>
                      : level === 'high'
                      ? <span className="text-[10px] font-semibold text-success bg-success/10 border border-success/30 px-1.5 py-0.5 rounded-full shrink-0">Match ✓</span>
                      : <span className="text-[10px] font-semibold text-warning-text bg-warning/10 border border-warning/30 px-1.5 py-0.5 rounded-full shrink-0">Confirmar</span>
                    : <span className="text-[10px] font-semibold text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded-full shrink-0">Ignorar</span>;

                  return (
                    <div
                      key={terceiro}
                      className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg border", cardStyle)}
                    >
                      <div className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
                      <p
                        className="text-xs flex-1 min-w-0 truncate font-medium"
                        title={terceiro}
                      >
                        {terceiro}
                      </p>
                      {badge}
                      <select
                        value={mapped ?? "__ignore__"}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCompanyMapping((prev) => ({
                            ...prev,
                            [terceiro]: val === "__ignore__" ? null : val,
                          }));
                          setMatchLevels((prev) => ({
                            ...prev,
                            [terceiro]: val === "__ignore__" ? null : 'exact',
                          }));
                        }}
                        className="h-8 text-xs border border-border rounded-md bg-background px-2 shrink-0 w-[260px]"
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
                  <span className="text-success font-semibold">{exactCount}</span> auto-vinculadas ·{" "}
                  <span className="text-warning-foreground font-semibold">{confirmCount}</span> aguardando confirmação ·{" "}
                  <span className="text-muted-foreground">{pendingCount}</span> não encontradas
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStep("select_base");
                      setParsedRows([]);
                    }}
                  >
                    ← Voltar
                  </Button>
                  <Button
                    size="sm"
                    disabled={processing || (exactCount + confirmCount) === 0}
                    onClick={handleProcessReconciliation}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        Processando...
                      </>
                    ) : (
                      `Conciliar ${exactCount + confirmCount} empresa(s) →`
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
                  <strong>{run.file_name}</strong> · {run.total_items} itens processados
                  {excludeConsultas && ' · consultas e visitas excluídas'}
                  · conciliação em {formatDateTimeBR(run.created_at)}
                </span>
              </div>

              {/* Aviso de defasagem: lote foi reanalisado após a conciliação */}
              {(() => {
                const lastAnalyzed = paymentItems
                  .map((it) => (it as any).applied_at as string | null)
                  .filter(Boolean)
                  .sort()
                  .pop();
                if (!lastAnalyzed || !run.created_at) return null;
                const stale = new Date(lastAnalyzed).getTime() > new Date(run.created_at).getTime();
                if (!stale) return null;
                return (
                  <div className="flex items-start gap-2 px-4 py-2.5 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning-text">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Snapshot defasado:</strong> o lote foi reanalisado em {formatDateTimeBR(lastAnalyzed)}, depois desta conciliação. Clique em <strong>Nova conciliação</strong> para refazer o cruzamento com os dados atuais. (A comparação financeira usa a tabela do convênio e não depende das regras, mas inclusões/exclusões de itens pelo motor podem ter mudado.)
                    </span>
                  </div>
                );
              })()}

              {/* KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KpiCard
                  icon={CheckCircle2}
                  tone="success"
                  label="Conciliados"
                  value={`${scopedStats.conciliado} itens`}
                  hint={total ? `${((scopedStats.conciliado / total) * 100).toFixed(1)}% do total${isScoped ? " (filtrado)" : ""}` : ""}
                  active={activeFilter === "conciliado"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "conciliado" ? "todos" : "conciliado")
                  }
                />
                <KpiCard
                  icon={AlertTriangle}
                  tone="warning"
                  label="Valor divergente"
                  value={`${scopedStats.valor_divergente} itens`}
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
                  value={`${scopedStats.so_hospital} itens`}
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
                  value={`${scopedStats.so_medpay} itens`}
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
                      Risco pagamento a mais{isScoped && <span className="ml-1 text-[9px] normal-case text-muted-foreground/70">(filtrado)</span>}
                    </p>
                    <p className="text-lg font-bold text-destructive mt-1">
                      {formatCurrency(scopedStats.risco_mais)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Risco pagamento a menos{isScoped && <span className="ml-1 text-[9px] normal-case text-muted-foreground/70">(filtrado)</span>}
                    </p>
                    <p className="text-lg font-bold text-success mt-1">
                      {formatCurrency(scopedStats.risco_menos)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Divergência de valores{isScoped && <span className="ml-1 text-[9px] normal-case text-muted-foreground/70">(filtrado)</span>}
                    </p>
                    <p className="text-lg font-bold text-warning mt-1">
                      {formatCurrency(scopedStats.divergencia_valor)}
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

              {/* Busca e filtros adicionais */}
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar paciente, médico, atendimento, TUSS, procedimento…"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <div className="min-w-[180px]">
                  <Select value={doctorFilter} onValueChange={setDoctorFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Médico" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="todos">Todos os médicos</SelectItem>
                      {doctorOptions.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    value={minValue}
                    onChange={(e) => setMinValue(e.target.value)}
                    placeholder="Valor mín."
                    inputMode="decimal"
                    className="h-8 w-24 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    value={maxValue}
                    onChange={(e) => setMaxValue(e.target.value)}
                    placeholder="Valor máx."
                    inputMode="decimal"
                    className="h-8 w-24 text-xs"
                  />
                </div>
                {hasExtraFilters && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearExtraFilters}>
                    <X className="h-3 w-3 mr-1" /> Limpar
                  </Button>
                )}
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {filteredItems.length} resultado{filteredItems.length === 1 ? "" : "s"}
                </span>
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
                                <span className="text-primary ml-2">
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
                                  <TableHead className="px-3 py-1.5 text-[10px]">Convênio</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    MedPay (R$)
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    Hospital (R$)
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    Valor Regra
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    Diferença Regra
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
                                            ? formatDateBR(it.procedure_date)
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[11px] text-muted-foreground">
                                          {it.agreement_text ?? "—"}
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
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums" style={{ color: it.valor_regra ? undefined : 'hsl(var(--muted-foreground))' }}>
                                          {it.valor_regra
                                            ? formatCurrency(Number(it.valor_regra))
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums font-semibold" style={{
                                          color: it.valor_regra && it.valor_hospital
                                            ? (Number(it.valor_regra) > Number(it.valor_hospital) ? 'hsl(var(--success))' : 'hsl(var(--destructive))')
                                            : 'hsl(var(--muted-foreground))',
                                        }}>
                                          {it.valor_regra && it.valor_hospital
                                            ? formatCurrency(Number(it.valor_regra) - Number(it.valor_hospital))
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
                                          <TableCell colSpan={7} className="bg-muted/30 px-4 py-3">
                                            <div className="flex gap-3">
                                              <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                              <div className="flex-1">
                                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                                  Análise IA
                                                </p>
                                                <p className="text-[12px]">{it.ia_obs}</p>
                                                {it.status === "valor_divergente" && it.applied_rule_label && (
                                                  <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Regra MedPay:</span>
                                                    <span className="text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                                                      {it.applied_rule_label}
                                                    </span>
                                                    {it.applied_calc_method && (
                                                      <span className="text-[10px] text-muted-foreground">· {it.applied_calc_method}</span>
                                                    )}
                                                  </div>
                                                )}
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
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone: "success" | "warning" | "destructive" | "info";
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClasses: Record<string, string> = {
    success: "border-success/40 bg-success/10 text-success",
    warning: "border-warning/40 bg-warning/10 text-warning",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
    info: "border-primary/40 bg-primary/10 text-primary",
  };
  const iconBgClasses: Record<string, string> = {
    success: "bg-success/20",
    warning: "bg-warning/20",
    destructive: "bg-destructive/20",
    info: "bg-primary/20",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border bg-card shadow-sm transition-all p-4 flex items-center gap-3 hover:shadow-md",
        toneClasses[tone],
        active && "ring-2 ring-offset-1 ring-current",
      )}
    >
      <div className={cn("p-2 rounded-full shrink-0", iconBgClasses[tone])}>
        <Icon className="h-5 w-5" style={{ color: "currentColor" }} />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </button>
  );
}
