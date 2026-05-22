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
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentReference: string;
  paymentItems: PaymentItemRow[];
}

type Step = "select_base" | "upload" | "mapping" | "result";

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
        setStep("select_base");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Erro ao carregar conciliação", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [paymentId, toast]);

  const loadConcBases = useCallback(async () => {
    setLoadingBases(true);
    const { data } = await (supabase as any)
      .from("conciliation_bases")
      .select("id, reference, competence_month, file_name, total_rows, created_at, raw_data, col_map")
      .eq("status", "ativo")
      .order("created_at", { ascending: false });
    setConcBases(data ?? []);
    setLoadingBases(false);
  }, []);

  useEffect(() => {
    if (open) {
      loadLatestRun();
      loadConcBases();
    }
  }, [open, loadLatestRun, loadConcBases]);

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
  };

  const handleProcessFromBase = () => {
    if (!selectedBase) return;
    const rows: Record<string, unknown>[] = selectedBase.raw_data ?? [];
    const colMap: Record<string, string> = selectedBase.col_map ?? {};

    const sectorCol = Object.keys(rows[0] ?? {}).find(k => {
      const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      return n.includes("setor") || n.includes("centro") || n.includes("custos") || k === "Setor" || k === "M";
    });

    const filteredRows = selectedSectors.length > 0 && sectorCol
      ? rows.filter(r => selectedSectors.includes(String(r[sectorCol] ?? "").trim()))
      : rows;

    const companyCol = colMap["company"] ?? Object.keys(rows[0] ?? {}).find(k => {
      const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      return n.includes("terceiro") || n.includes("empresa") || n.includes("prestador");
    });

    const terceiros = Array.from(new Set(
      filteredRows.map(r => companyCol ? String(r[companyCol] ?? "").trim() : "").filter(Boolean)
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
        // Exige ≥2 identificadores em comum. Termo de especialidade isolado
        // (UROLOGIA, ORTOPEDIA, NEUROLOGIA…) causa falso match quando a PJ
        // real não está no lote — preferimos deixar sem mapeamento.
        const ok = common.length >= 2;
        if (ok && score > (best?.score ?? 0)) best = { company: c, score };
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

    setParsedRows(filteredRows);
    setParsedColMap(colMap);
    setPendingFileName(selectedBase.file_name ?? selectedBase.reference);
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
          const hasLongMatch = common.some(id => id.length >= 6);
          const hasEnough = common.length >= 2 || (common.length >= 1 && hasLongMatch);
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
        const num = parseFloat(String(code));
        if (!isNaN(num) && isFinite(num)) return String(Math.round(num));
        return String(code).replace(/\D/g, '');
      };

      const normAtt = (att: unknown): string => {
        if (att == null || att === '') return '';
        const n = Number(att);
        if (!isNaN(n) && isFinite(n)) return String(Math.round(n));
        return String(att).replace(/\D/g, '');
      };

      const makeKey = (att: unknown, code: unknown): string =>
        `${normAtt(att)}|${normalizeCode(code)}`;

      const medpayByKey = new Map<string, PaymentItemRow[]>();
      for (const it of paymentItems) {
        if (!it.attendance_number || !it.procedure_code) continue;
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

      for (const row of rowsParaCruzamento) {
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
        // Prefere o candidato cujo valor é mais próximo ao valor da planilha
        const available = candidates.filter((m) => !matchedMedpayIds.has(m.id));
        const match = available.length === 0
          ? undefined
          : available.length === 1
          ? available[0]
          : available.reduce((best, curr) => {
              const diffBest = Math.abs(Number((best as any).gross_amount ?? 0) - valHosp);
              const diffCurr = Math.abs(Number((curr as any).gross_amount ?? 0) - valHosp);
              return diffCurr < diffBest ? curr : best;
            });

        const base: Record<string, unknown> = {
          attendance_number: att ? String(Math.round(Number(att)) || att) : null,
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
          agreement_text: null,
          applied_rule_label: null,
          applied_calc_method: null,
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
          if (!base.agreement_text) base.agreement_text = (match as any).agreement_text ?? null;
          base.applied_rule_label = (match as any).applied_rule_label ?? null;
          base.applied_calc_method = (match as any).applied_calc_method ?? null;

          const diff = valHosp - valMed;
          if (Math.abs(diff) < 0.02) {
            base.status = "conciliado";
            conciliado++;
          } else {
            base.status = "valor_divergente";
            valor_divergente++;
            const pct = valMed > 0 ? (diff / valMed) * 100 : 0;
            const ruleContext = (match as any).applied_rule_label
              ? ` Regra aplicada: "${(match as any).applied_rule_label}".`
              : '';
            base.ia_obs = `Hospital: ${formatCurrency(valHosp)} · MedPay: ${formatCurrency(valMed)} · Diferença: ${formatCurrency(Math.abs(diff))} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%).${ruleContext} Revisar se o valor do hospital corresponde ao convênio sem aplicação de acordo.`;
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

    const summaryData: (string | number)[][] = [
      ["Relatório de Conciliação de Produção"],
      [""],
      ["Lote", paymentReference],
      ["Arquivo base", run.file_name ?? ""],
      ["Data da conciliação", formatDateTimeBR(run.created_at)],
      [""],
      ["RESUMO"],
      ["Total de itens", run.total_items],
      ["Conciliados", run.conciliado, `${total ? ((run.conciliado / total) * 100).toFixed(1) : 0}%`],
      ["Valor divergente", run.valor_divergente],
      ["Só no hospital", run.so_hospital],
      ["Só no MedPay", run.so_medpay],
      [""],
      ["IMPACTO FINANCEIRO"],
      ["Risco pagamento a mais", run.risco_mais],
      ["Risco pagamento a menos", run.risco_menos],
      ["Divergência de valores", run.divergencia_valor],
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

    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, pageWidth, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Conciliação de Produção — " + paymentReference, 14, 13);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Gerado em: ${formatDateTimeBR(new Date().toISOString())}`, pageWidth - 14, 13, { align: "right" });

    doc.setTextColor(30, 58, 95);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`Total: ${run.total_items}  ·  Conciliados: ${run.conciliado}  ·  Divergência: ${run.valor_divergente}  ·  Só hospital: ${run.so_hospital}  ·  Só MedPay: ${run.so_medpay}`, 14, 28);

    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Risco +: R$ ${Number(run.risco_mais).toFixed(2)}  ·  Risco -: R$ ${Number(run.risco_menos).toFixed(2)}  ·  Divergência: R$ ${Number(run.divergencia_valor).toFixed(2)}`, 14, 34);

    const tableData = items.map((it) => [
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

    autoTable(doc, {
      startY: 38,
      head: [["Status", "Empresa", "Médico", "Paciente", "TUSS", "Data", "Convênio", "MedPay", "Hospital", "Regra MedPay"]],
      body: tableData,
      styles: { fontSize: 6.5, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold", fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 38 },
        2: { cellWidth: 30 },
        3: { cellWidth: 28 },
        4: { cellWidth: 16 },
        5: { cellWidth: 14 },
        6: { cellWidth: 20 },
        7: { cellWidth: 18, halign: "right" },
        8: { cellWidth: 18, halign: "right" },
        9: { cellWidth: 38 },
      },
      didParseCell: (data) => {
        if (data.section === "body") {
          const status = String(tableData[data.row.index]?.[0] ?? "");
          const fill = STATUS_FILL[status];
          if (fill) data.cell.styles.fillColor = fill;
        }
      },
      margin: { left: 14, right: 14 },
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

  const exactCount = Object.entries(companyMapping).filter(([t, v]) => v && (matchLevels[t] === 'exact' || matchLevels[t] === 'high')).length;
  const confirmCount = Object.entries(companyMapping).filter(([t, v]) => v && matchLevels[t] === 'medium').length;
  const pendingCount = hospitalCompanies.filter((t) => !companyMapping[t]).length;

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

          {!loading && step === "select_base" && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Selecionar base de conciliação</p>
                <p className="text-xs text-muted-foreground">Escolha uma base importada em Glosas e Conciliação. Depois filtre pelo setor que deseja conciliar.</p>
              </div>

              {loadingBases ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando bases…
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
                            ? "border-[#9A6B3A] bg-[#fdf5ec] shadow-sm"
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
                            <div className="shrink-0 w-5 h-5 rounded-full bg-[#9A6B3A] flex items-center justify-center">
                              <CheckCircle2 className="h-3 w-3 text-white" />
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
                            checked ? "border-[#9A6B3A] bg-[#fdf5ec]" : "border-border bg-card hover:bg-muted/40"
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
                      : <span className="text-[10px] font-semibold text-warning-foreground bg-warning/10 border border-warning/30 px-1.5 py-0.5 rounded-full shrink-0">Confirmar</span>
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
                                  <TableHead className="px-3 py-1.5 text-[10px]">Convênio</TableHead>
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
                                          <TableCell colSpan={7} className="bg-info/5 px-4 py-3">
                                            <div className="flex gap-3">
                                              <Lightbulb className="h-4 w-4 text-info shrink-0 mt-0.5" />
                                              <div className="flex-1">
                                                <p className="text-[11px] font-semibold uppercase tracking-wider text-info mb-1">
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
