import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import CancelByReconciliationDialog, { type CancelScope } from "@/components/payment-detail/CancelByReconciliationDialog";
import { confirmDialog } from "@/lib/confirm";
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
  RefreshCw,
  Building2,
  Search,
  Copy,
  Check,
  Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check as CheckIcon, ChevronsUpDown } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/status";
import { formatDateBR, formatDateTimeBR, formatCompetenceBR } from "@/lib/dateUtils";
import { drawReportHeader, REDE_DOR_BRAND_BLUE_RGB } from "@/lib/brandLogo";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";
import { loadDoctorRegistry, resolveDoctor, loadConvenioRegistry, normalize as normalizeRegistry, type DoctorRegistry, type ConvenioRegistry } from "@/lib/registryLookup";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText } from "lucide-react";
import { logCompanyMapping } from "@/lib/companyMappingAudit";
import { CompanyMappingHistory } from "./CompanyMappingHistory";
import { PreReconciliationReport, type HospitalRowLite } from "./PreReconciliationReport";
import { CompanyMappingList } from "@/components/shared/CompanyMappingList";

function CopyAttendanceButton({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const text = String(value);
    let ok = false;
    // 1) Tenta Clipboard API moderna (pode falhar no Safari dentro de iframe sem permissão).
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    // 2) Fallback universal (Safari/Mac, iframes): textarea + execCommand("copy").
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copiado!" : "Copiar nº do atendimento"}
      aria-label="Copiar número do atendimento"
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background transition-colors",
        copied ? "text-success border-success" : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}



type ReconciliationRun = {
  id: string;
  payment_id: string;
  status: "processing" | "done" | "error";
  file_name: string | null;
  total_items: number;
  conciliado: number;
  valor_divergente: number;
  so_hospital: number;
  so_exacta: number;
  empresa_ausente?: number;
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
  valor_exacta: number;
  valor_hospital: number;
  status: "conciliado" | "valor_divergente" | "qtd_divergente" | "so_hospital" | "so_exacta" | "empresa_ausente" | "possivel_pacote";
  ia_obs: string | null;
  company_name: string | null;
  agreement_text: string | null;
  applied_rule_label: string | null;
  applied_calc_method: string | null;
  valor_regra?: number | null;
  valor_pago_exacta?: number | null;
  diferenca_regra?: number | null;
  action_taken?: string | null;
  action_by?: string | null;
  action_at?: string | null;
  doctor_document?: string | null;
  competence_month?: string | null;
  match_diagnostics?: MatchDiagnostics | null;
};

type MatchDiagnosticsField = {
  label: string;
  hospital: string | null;
  exacta: string | null;
  ok: boolean | null; // true=igual, false=diferente, null=um lado vazio
};

type MatchDiagnosticsCandidate = {
  payment_item_id: string;
  doctor_name: string | null;
  doctor_role: string | null;
  access_route: string | null;
  valor_exacta: number;
  score: number;
  docOk: boolean;
  roleOk: boolean;
  routeOk: boolean;
  chosen: boolean;
  rejected_reason: string | null;
};

type MatchDiagnostics = {
  hospital: {
    doctor: string | null;
    role: string | null;
    route: string | null;
    valor: number;
  };
  candidates_total: number;
  candidates: MatchDiagnosticsCandidate[];
  fields: MatchDiagnosticsField[]; // comparação do par aceito
  decision: string; // "match_unico" | "filtrado_por_medico" | "filtrado_por_funcao" | "filtrado_por_via" | "ambiguo" | "sem_candidato"
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentReference: string;
  paymentItems: PaymentItemRow[];
  /** Quando informado, filtra a conciliação para uma única empresa e a expande automaticamente. */
  initialCompany?: string | null;
  /** Disparado quando itens são cancelados/alterados via conciliação,
   *  para que a tela pai recarregue composição financeira (Bruto/Líquido)
   *  sem precisar fechar o modal nem reaplicar regras. */
  onItemsChanged?: () => void;
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
  { key: "valueRepasse", label: "Vl. Repasse (acordo)", required: false, description: "Valor de repasse com acordo já aplicado — coluna 'Vl. Repasse' da planilha hospitalar" },
  { key: "doctor",     label: "Médico executante", required: false, description: "Nome do médico — usado para enriquecer o resultado e filtros futuros" },
  { key: "role",       label: "Função / papel", required: false, description: "Papel do profissional (cirurgião, anestesista…) — diferencia quando o mesmo médico atua em funções distintas" },
  { key: "accessRoute",label: "Via de acesso",  required: false, description: "Via de acesso (única, mesma via, outra via) — diferencia linhas do mesmo código com valores legítimos distintos" },
  { key: "quantity",   label: "Quantidade",     required: false, description: "Quantidade do procedimento — detecta duplicidades (ex: 1 proc × 3 qty)" },
  { key: "company",    label: "Empresa (PJ)",   required: false, description: "Nome da empresa prestadora — usado no vínculo de empresas" },
  { key: "patient",    label: "Paciente",       required: false, description: "Nome do paciente — enriquecimento" },
  { key: "date",       label: "Data proc.",     required: false, description: "Data do procedimento — enriquecimento" },
  { key: "agreement",  label: "Convênio",       required: false, description: "Convênio/plano de saúde — enriquece a análise e o relatório" },
  { key: "crm",        label: "CRM",            required: false, description: "CRM do médico — chave canônica de resolução (cruza com cadastro de médicos)" },
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
    valueRepasse: ["vl. repasse", "vlrepasse", "vl repasse", "repasse", "vl.repasse"],
    company: ["terceiro", "empresa", "prestador"],
    grupo: ["grupo cbhpm", "grupocbhpm", "grupo", "grupoproc"],
    accessRoute: ["via", "viaacesso", "via acesso", "via de acesso", "viadeacesso", "viadeacessoproc"],
    crm: ["crm", "crmmedico", "crm medico", "crmexec", "crmprofissional", "documentomedico", "documento"],
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
  qtd_divergente: "Quantidade divergente",
  so_hospital: "Só no hospital",
  so_exacta: "Só no Exacta",
  empresa_ausente: "Empresa ausente",
  possivel_pacote: "Possível pacote de honorário",
};

const STATUS_TONE: Record<ReconciliationItem["status"], string> = {
  conciliado: "bg-success/10 text-success border-success/30",
  valor_divergente: "bg-warning/10 text-warning-text border-warning/30",
  qtd_divergente: "bg-warning/10 text-warning-text border-warning/30",
  so_hospital: "bg-destructive/10 text-destructive border-destructive/30",
  so_exacta: "bg-primary/10 text-primary border-primary/30",
  empresa_ausente: "bg-muted text-muted-foreground border-border",
  possivel_pacote: "bg-accent/10 text-accent-foreground border-accent/30",
};

/**
 * Combobox com busca textual — substitui o Select nativo para listas longas
 * (médicos, empresas) onde a busca por digitação é essencial. Usa o valor
 * "todos" como sentinel para "sem filtro".
 */
function SearchableCombo({
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  searchPlaceholder,
  emptyText,
  widthClass,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const display = value === "todos" ? placeholder : value;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-8 text-xs justify-between font-normal", widthClass)}
        >
          <span className={cn("truncate", value === "todos" && "text-muted-foreground")}>{display}</span>
          <ChevronsUpDown className="h-3 w-3 ml-2 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-xs" />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__todos__"
                onSelect={() => { onChange("todos"); setOpen(false); }}
                className="text-xs"
              >
                <CheckIcon className={cn("h-3 w-3 mr-2", value === "todos" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => { onChange(opt); setOpen(false); }}
                  className="text-xs"
                >
                  <CheckIcon className={cn("h-3 w-3 mr-2", value === opt ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{opt}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Tipos de cálculo cujo VALOR é fixo por código (tabela diferenciada, pacote,
 * valor fixo, bônus). Para esses itens, divergência de centavos no valor não
 * importa — o que importa é a QUANTIDADE de atendimentos por código.
 * Para tipos proporcionais (% do convênio, complemento, regra de vias) e para
 * itens sem regra (fallback 100% tabela), mantém comparação valor x valor.
 */
const FIXED_CALC_METHODS = new Set([
  "valor_fixo",
  "tabela_diferenciada",
  "pacote",
  "pacote_fechado",
  "pacote_com_extras",
  "pacote_por_atendimento",
  "bonus",
]);
const isFixedCalcMethod = (m: string | null | undefined): boolean => {
  if (!m) return false;
  const norm = String(m).toLowerCase().trim().replace(/\s+/g, "_");
  return FIXED_CALC_METHODS.has(norm);
};

/**
 * Versão da lógica de conciliação. Sempre que migrarmos regras de classificação
 * (ex.: introdução do `qtd_divergente`, mudança no critério de divergência por
 * regra fixa), atualizar esta data. Runs criados antes desta data são
 * automaticamente considerados defasados e o usuário é convidado a reprocessar.
 */
const RECONCILIATION_LOGIC_VERSION_DATE = "2026-06-17T18:30:00Z";
const RECONCILIATION_LOGIC_VERSION_LABEL = "Percentual sobre convênio reconhece 'percentual_convenio' (RAMO 2 valor esperado); componente de pacote é suprimido por atendimento principal pago via pacote, mesmo sem método no código componente";

export function PaymentConciliationModal({
  open,
  onOpenChange,
  paymentId,
  paymentReference,
  paymentItems,
  initialCompany = null,
  onItemsChanged,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { hospital } = useHospital();
  const fileInputRef = useRef<HTMLInputElement>(null);



  const [run, setRun] = useState<ReconciliationRun | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("todos");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rulesLastUpdate, setRulesLastUpdate] = useState<string | null>(null);

  // Busca e filtros adicionais (texto livre, médico, faixa de valor)
  // Filtros de médico e empresa persistem em sessionStorage por paymentId
  // — mesma estratégia do PaymentDetail para o modal em si — para que a
  // troca de aba não derrube a visão de análise.
  const filtersStorageKey = paymentId ? `conciliation:filters:${paymentId}` : null;
  const readPersistedFilters = useCallback(() => {
    if (!filtersStorageKey) return { doctor: "todos", company: "todos" };
    try {
      const raw = sessionStorage.getItem(filtersStorageKey);
      if (!raw) return { doctor: "todos", company: "todos" };
      const parsed = JSON.parse(raw) as { doctor?: string; company?: string };
      return {
        doctor: typeof parsed.doctor === "string" ? parsed.doctor : "todos",
        company: typeof parsed.company === "string" ? parsed.company : "todos",
      };
    } catch {
      return { doctor: "todos", company: "todos" };
    }
  }, [filtersStorageKey]);

  const [searchTerm, setSearchTerm] = useState("");
  const [doctorFilter, _setDoctorFilter] = useState<string>(() => readPersistedFilters().doctor);
  const [companyFilter, _setCompanyFilter] = useState<string>(() => readPersistedFilters().company);
  const [minValue, setMinValue] = useState<string>("");
  const [maxValue, setMaxValue] = useState<string>("");

  const persistFilters = useCallback((next: { doctor?: string; company?: string }) => {
    if (!filtersStorageKey) return;
    try {
      const current = readPersistedFilters();
      const merged = { ...current, ...next };
      if (merged.doctor === "todos" && merged.company === "todos") {
        sessionStorage.removeItem(filtersStorageKey);
      } else {
        sessionStorage.setItem(filtersStorageKey, JSON.stringify(merged));
      }
    } catch {
      // sessionStorage pode estar indisponível — ignore silenciosamente.
    }
  }, [filtersStorageKey, readPersistedFilters]);

  const setDoctorFilter = useCallback((v: string) => {
    _setDoctorFilter(v);
    persistFilters({ doctor: v });
  }, [persistFilters]);
  const setCompanyFilter = useCallback((v: string) => {
    _setCompanyFilter(v);
    persistFilters({ company: v });
  }, [persistFilters]);

  // Paginação por empresa: cada grupo carrega apenas N linhas inicialmente.
  // Listas longas (lotes de 5k+) deixavam o DOM travado; o usuário expande
  // mais via "Carregar mais" ou troca o pageSize para "Todos" quando precisa.
  const [pageSize, setPageSize] = useState<number>(200);
  /** Página atual (0-indexed) por empresa para a paginação dos itens. */
  const [pageByCompany, setPageByCompany] = useState<Record<string, number>>({});

  const [step, setStep] = useState<Step>("upload");
  const [excludeConsultas, setExcludeConsultas] = useState(true);
  // Competência inicial do lote (YYYY-MM-DD). Usada como ponto de corte para
  // remover itens Exacta pagos por REMESSA (data anterior ao lote → já fechado
  // pelo faturamento, sem risco de divergência). Auto-preenchida com a menor
  // competência do payment; o analista pode sobrescrever quando o lote
  // contemplar produção antiga (ex.: lote retroativo de remessa).
  const [periodStartOverride, setPeriodStartOverride] = useState<string>("");
  const [periodStartAuto, setPeriodStartAuto] = useState<string>("");
  // Auditoria: estatísticas do filtro de remessa aplicado no último processamento.
  const [remittanceFilterStats, setRemittanceFilterStats] = useState<{
    lotePeriodStart: string;
    before: number;
    removidos: number;
    restantes: number;
    source: 'override' | 'auto';
  } | null>(null);

  // Carrega a competência do lote uma vez, para pré-preencher o seletor.
  useEffect(() => {
    if (!open || !paymentId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("payments")
          .select("competence_month, competence_months")
          .eq("id", paymentId)
          .single();
        if (cancelled || !data) return;
        const cands: string[] = [];
        if (Array.isArray(data.competence_months)) {
          for (const c of data.competence_months) if (c) cands.push(String(c).slice(0, 10));
        }
        if (data.competence_month) cands.push(String(data.competence_month).slice(0, 10));
        if (cands.length > 0) {
          const earliest = cands.sort()[0];
          const m = earliest.match(/^(\d{4})-(\d{2})/);
          const firstDay = m ? `${m[1]}-${m[2]}-01` : earliest;
          setPeriodStartAuto(firstDay);
          setPeriodStartOverride((prev) => prev || firstDay);
          setPaymentCompetenceMonth(m ? `${m[1]}-${m[2]}` : earliest.slice(0, 7));
        }
      } catch (e) {
        console.warn("[Conciliação] falha ao ler competência do lote", e);
      }
    })();
    return () => { cancelled = true; };
  }, [open, paymentId]);
  const [hospitalCompanies, setHospitalCompanies] = useState<string[]>([]);
  const [companyMapping, setCompanyMapping] = useState<Record<string, string | null>>({});
  const [matchLevels, setMatchLevels] = useState<Record<string, 'exact' | 'high' | 'medium' | null>>({});
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [preReportOpen, setPreReportOpen] = useState(false);
  const [parsedColMap, setParsedColMap] = useState<Record<string, string>>({});
  const [pendingFileName, setPendingFileName] = useState<string>("");

  // Seleção de base(s) importada(s) — Fase 2: multi-select.
  // primaryBaseId define o col_map exibido e é onde `saveColMapping` persiste.
  const [concBases, setConcBases] = useState<any[]>([]);
  const [selectedBases, setSelectedBases] = useState<any[]>([]);
  const [primaryBaseId, setPrimaryBaseId] = useState<string | null>(null);
  const [availableSectors, setAvailableSectors] = useState<string[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [loadingBases, setLoadingBases] = useState(false);
  // Competência do lote — usada como desempate primário no dedup multi-base.
  const [paymentCompetenceMonth, setPaymentCompetenceMonth] = useState<string | null>(null);

  // Base "primária": fonte de col_map/setores exibidos. Compat com código legado
  // que assumia uma única base selecionada.
  const primaryBase = useMemo(() => {
    if (selectedBases.length === 0) return null;
    return selectedBases.find(b => b.id === primaryBaseId) ?? selectedBases[0];
  }, [selectedBases, primaryBaseId]);

  // Mapeamento de colunas: campo interno → coluna real da planilha
  const [colMapping, setColMapping] = useState<Record<string, string>>({});
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [colSamples, setColSamples] = useState<Record<string, string>>({});
  const [saveColMapping, setSaveColMapping] = useState(true);

  // Diálogo de escopo do reprocessamento: substituir tudo ou só estas empresas
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [scopeDialogInfo, setScopeDialogInfo] = useState<{
    newCompanies: string[];
    previousCompanies: string[];
    keepCompanies: string[];
  } | null>(null);

  // Convênios excluídos da análise de conciliação.
  // Uso típico: convênios que operam por pacote/tratativa manual (Sul América,
  // Particular, etc.). Itens desses convênios são removidos das duas bases
  // (Exacta e hospitalar) antes do cruzamento — não geram só_hospital/só_exacta.
  // Convênios excluídos da análise de conciliação.
  // Uso típico: convênios que operam por pacote/tratativa manual (Sul América,
  // Particular, etc.). Itens desses convênios são removidos das duas bases
  // (Exacta e hospitalar) antes do cruzamento — não geram só_hospital/só_exacta.
  //
  // A chave gravada aqui é CANÔNICA:
  //   • `slug:<slug>`  quando o texto do convênio resolveu para um cadastro
  //     (via `convenios` + `convenio_aliases`) — permite excluir "Sul América"
  //     mesmo que o hospital escreva "SUL AMERICA SAUDE S/A", "SulAmerica", etc.
  //   • `raw:<normAgreement>` quando não há match no cadastro — mantém o
  //     comportamento antigo (comparação por normalização direta do texto).
  const [excludedConvenios, setExcludedConvenios] = useState<string[]>([]);
  const [convenioFilterStats, setConvenioFilterStats] = useState<{
    excluded: string[];
    exactaRemoved: number;
    hospitalRemoved: number;
  } | null>(null);
  const [convenioRegistry, setConvenioRegistry] = useState<ConvenioRegistry | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadConvenioRegistry(hospital?.id ?? null)
      .then((reg) => { if (!cancelled) setConvenioRegistry(reg); })
      .catch((e) => console.warn('[Conciliação] falha ao carregar convenioRegistry — filtro cairá em match por texto puro.', e));
    return () => { cancelled = true; };
  }, [hospital?.id]);

  const loteCompanies = useMemo(
    () =>
      Array.from(
        new Set(paymentItems.map((it) => it.company_name ?? "").filter(Boolean)),
      ).sort(),
    [paymentItems],
  );

  // Normalização usada para comparar convênios entre bases: sem acento,
  // minúsculo, só alfanumérico. Ex.: "Sul América" == "SUL AMERICA" == "SulAmerica".
  const normAgreement = (s: unknown): string =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  // Resolve o texto do convênio para uma chave canônica:
  //   1) tenta bater em `convenios` (name) ou `convenio_aliases` via registry;
  //   2) se casar, retorna `slug:<slug>` — casa hospital ↔ Exacta mesmo quando
  //      os nomes diferem;
  //   3) senão, retorna `raw:<normAgreement>` (fallback textual).
  const resolveConvenioKey = useCallback((text: unknown): { key: string; label: string } | null => {
    const raw = String(text ?? "").trim();
    if (!raw) return null;
    if (convenioRegistry) {
      const nk = normalizeRegistry(raw);
      const hit = nk ? convenioRegistry.byAlias.get(nk) : null;
      if (hit) return { key: `slug:${hit.slug}`, label: hit.name };
    }
    const n = normAgreement(raw);
    if (!n) return null;
    return { key: `raw:${n}`, label: raw };
  }, [convenioRegistry]);

  // Convênios distintos presentes na base Exacta deste pagamento, agrupados
  // pela chave canônica (slug quando resolvido no cadastro, texto normalizado
  // como fallback). Uma linha por convênio, mesmo que o texto original varie.
  const availableConvenios = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; variants: Set<string> }>();
    for (const it of paymentItems) {
      const raw = ((it as any).agreement_text ?? "").toString().trim();
      const resolved = resolveConvenioKey(raw);
      if (!resolved) continue;
      const cur = map.get(resolved.key);
      if (cur) {
        cur.count += 1;
        if (raw) cur.variants.add(raw);
      } else {
        map.set(resolved.key, {
          key: resolved.key,
          label: resolved.label,
          count: 1,
          variants: new Set(raw ? [raw] : []),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [paymentItems, resolveConvenioKey]);


  // Resolução nome→id (gravar exacta_company_id no histórico).
  const companyNameToId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of paymentItems) {
      const n = (it as any).company_name;
      const id = (it as any).company_id;
      if (n && id && !m[n]) m[n] = id;
    }
    return m;
  }, [paymentItems]);
  const companyIdToName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [n, id] of Object.entries(companyNameToId)) m[id] = n;
    return m;
  }, [companyNameToId]);

  // Mapa payment_item_id → quantidade Exacta AGREGADA por (empresa+atendimento+TUSS+médico).
  // O motor de conciliação colapsa segmentos do mesmo procedimento/médico em um item
  // virtual com sumQty. Para que a coluna "Qtd Exacta" reflita esse total — e não a
  // qty de uma única linha-rep —, somamos aqui o mesmo group key, atribuindo o total
  // a TODOS os ids do grupo (qualquer um pode ser o rep escolhido pelo motor).
  const exactaQtyById = useMemo(() => {
    const norm = (s: string | null | undefined) =>
      String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const groups = new Map<string, { ids: string[]; sumQty: number; hasQty: boolean }>();
    // Fallback direto por id: garante que a QTD EXACTA reflete a quantidade da
    // própria linha-Exacta (payment_items.quantity) mesmo quando o agrupamento
    // não produz soma — evita o caso em que a coluna ficava espelhando a qty
    // hospitalar (porque o group lookup retornava null e algum render anterior
    // caía no valor de fallback errado).
    const directById = new Map<string, number>();
    for (const it of paymentItems) {
      const att = String((it as any).attendance_number ?? "").trim();
      const code = String((it as any).procedure_code ?? "").trim();
      const comp = norm((it as any).company_name);
      const docId = (it as any).doctor_id ?? null;
      const docDoc = String((it as any).doctor_document ?? "").replace(/\D/g, "");
      const docName = norm((it as any).doctor_name);
      const dk = docId ? `id:${docId}` : docDoc ? `crm:${docDoc}` : docName ? `nm:${docName}` : "_";
      const key = att && code ? `${comp}|${att}|${code}|${dk}` : `__solo:${it.id}`;
      const q = (it as { quantity?: number | null }).quantity;
      const qn = q == null ? null : Number(q);
      let g = groups.get(key);
      if (!g) { g = { ids: [], sumQty: 0, hasQty: false }; groups.set(key, g); }
      g.ids.push(it.id);
      if (qn != null && Number.isFinite(qn)) {
        g.sumQty += qn;
        g.hasQty = true;
        directById.set(it.id, qn);
      }
    }
    const m = new Map<string, number | null>();
    for (const g of groups.values()) {
      const val = g.hasQty ? g.sumQty : null;
      for (const id of g.ids) m.set(id, val);
    }
    // Sobrepõe com o valor direto da própria linha-Exacta quando disponível —
    // assim a coluna nunca confunde "soma do grupo" com "qty da linha mapeada".
    for (const [id, qn] of directById) m.set(id, qn);
    return m;
  }, [paymentItems]);



  // Aliases persistidos das empresas do lote — usados para auto-mapear o "terceiro"
  // da planilha do hospital sem o analista precisar refazer o vínculo a cada rodada.
  // Toda confirmação manual aqui vira alias ao processar a conciliação.
  const [companyAliasMap, setCompanyAliasMap] = useState<
    Record<string, { id: string; name: string; aliases: string[] }>
  >({});

  useEffect(() => {
    if (!open || loteCompanies.length === 0) {
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("companies")
        .select("id, name, aliases")
        .in("name", loteCompanies);
      if (cancelled || !data) return;
      const map: Record<string, { id: string; name: string; aliases: string[] }> = {};
      for (const r of data as Array<{ id: string; name: string; aliases: string[] | null }>) {
        map[r.name] = { id: r.id, name: r.name, aliases: r.aliases ?? [] };
      }
      setCompanyAliasMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loteCompanies]);

  /**
   * Remove de uma lista de reconciliation_items qualquer registro cujo
   * payment_item associado seja bônus, complemento ou lançamento manual —
   * esses itens nunca aparecem na base hospitalar, então não devem entrar
   * em contagens, indicadores nem no PDF/relatório de conciliação.
   */
  const filterOutNonReconcilable = async (rows: ReconciliationItem[]): Promise<ReconciliationItem[]> => {
    const ids = Array.from(new Set(rows.map((r) => r.payment_item_id).filter(Boolean))) as string[];
    if (ids.length === 0) return rows;
    const excluded = new Set<string>();
    const EXCLUDED_TIPO_LINHA = new Set(["complemento_bonus", "complemento", "outros"]);
    const PAGE = 500;
    for (let i = 0; i < ids.length; i += PAGE) {
      const slice = ids.slice(i, i + PAGE);
      const { data, error } = await (supabase as any)
        .from("payment_items")
        .select("id, tipo_linha, source, item_origem")
        .in("id", slice);
      if (error) {
        console.warn("[Conciliação] filterOutNonReconcilable: falha ao consultar payment_items", error);
        continue;
      }
      for (const r of (data ?? []) as Array<{ id: string; tipo_linha: string | null; source: string | null; item_origem: string | null }>) {
        if ((r.tipo_linha && EXCLUDED_TIPO_LINHA.has(r.tipo_linha)) || r.source === "manual" || r.item_origem === "inclusao_manual") {
          excluded.add(r.id);
        }
      }
    }
    if (excluded.size === 0) return rows;
    const before = rows.length;
    const kept = rows.filter((r) => !r.payment_item_id || !excluded.has(r.payment_item_id));
    console.log("[Conciliação] Itens não-conciliáveis excluídos do resumo:", { before, removidos: before - kept.length, restantes: kept.length });
    return kept;
  };

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
        // Exclui retroativamente bônus/complemento/manuais de runs antigos —
        // contagens, indicadores e PDF não devem considerá-los.
        const filtered = await filterOutNonReconcilable(all);
        setItems(filtered);
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
      // Busca timestamp da regra mais recente para detectar conciliação defasada
      (async () => {
        try {
          const { data } = await (supabase as any)
            .from("rules")
            .select("updated_at")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          setRulesLastUpdate(data?.updated_at ?? null);
        } catch {
          setRulesLastUpdate(null);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCompany]);

  // Reconstrói contexto derivado (setores, colunas, col_map) a partir da base
  // primária escolhida. Chamado sempre que a primária muda.
  const rebuildBaseContext = (base: any | null) => {
    if (!base) {
      setAvailableSectors([]);
      setSelectedSectors([]);
      setAvailableColumns([]);
      setColSamples({});
      setColMapping({});
      return;
    }
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

  // Marca/desmarca uma base. Ao marcar a primeira, ela vira primária.
  const handleToggleBase = (base: any) => {
    setSelectedBases(prev => {
      const exists = prev.some(b => b.id === base.id);
      const next = exists ? prev.filter(b => b.id !== base.id) : [...prev, base];
      let nextPrimaryId = primaryBaseId;
      if (exists && primaryBaseId === base.id) {
        nextPrimaryId = next[0]?.id ?? null;
      } else if (!exists && prev.length === 0) {
        nextPrimaryId = base.id;
      }
      setPrimaryBaseId(nextPrimaryId);
      const nextPrimary = nextPrimaryId ? next.find(b => b.id === nextPrimaryId) ?? null : null;
      rebuildBaseContext(nextPrimary);
      return next;
    });
  };

  // Promove uma base já selecionada a primária (redefine col_map/setores exibidos).
  const handleSetPrimaryBase = (base: any) => {
    if (!selectedBases.some(b => b.id === base.id)) return;
    setPrimaryBaseId(base.id);
    rebuildBaseContext(base);
  };

  const handleProcessFromBase = () => {
    if (selectedBases.length === 0 || !primaryBase) return;
    const paymentComp = paymentCompetenceMonth ?? "";

    // Detecta coluna de setor por LINHA — bases distintas podem nomear a coluna
    // de forma levemente diferente, então evitamos travar num único header.
    const findSectorCol = (row: Record<string, unknown>) =>
      Object.keys(row).find(k => {
        const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        return n.includes("setor") || n.includes("centro") || n.includes("custos") || k === "Setor" || k === "M";
      });

    type Stamped = Record<string, unknown> & {
      __baseId: string;
      __baseCompetence: string;
      __baseUploadedAt: string;
    };
    const allRows: Stamped[] = [];
    for (const b of selectedBases) {
      const bComp = String(b.competence_month ?? "").slice(0, 7);
      const bUp = String(b.created_at ?? "");
      const rows: Record<string, unknown>[] = b.raw_data ?? [];
      for (const r of rows) {
        allRows.push({ ...r, __baseId: b.id, __baseCompetence: bComp, __baseUploadedAt: bUp });
      }
    }

    const filteredRows = selectedSectors.length > 0
      ? allRows.filter(r => {
          const col = findSectorCol(r);
          return col ? selectedSectors.includes(String(r[col] ?? "").trim()) : false;
        })
      : allRows;

    // Dedup determinístico só quando há 2+ bases.
    // Chave: atendimento | TUSS(8d) | médico | função — usando col_map da primária.
    // Desempate 1: base cuja competência bate com o lote vence.
    // Desempate 2: base com upload mais recente vence.
    let finalRows: Record<string, unknown>[] = filteredRows;
    if (selectedBases.length > 1) {
      const map = (primaryBase.col_map ?? colMapping ?? {}) as Record<string, string>;
      const attCol = map["attendance"];
      const codeCol = map["tuss"] || map["code"] || map["procedure_code"];
      const docCol = map["doctor"] || map["doctor_name"];
      const funcCol = map["function"] || map["role"];
      const norm = (s: unknown) =>
        String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const normCode = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(0, 8);
      const keyOf = (r: Stamped): string | null => {
        if (!attCol || !codeCol) return null;
        const att = norm(r[attCol]);
        const code = normCode(r[codeCol]);
        if (!att || !code) return null;
        return `${att}|${code}|${docCol ? norm(r[docCol]) : ""}|${funcCol ? norm(r[funcCol]) : ""}`;
      };
      const best = new Map<string, Stamped>();
      const noKey: Stamped[] = [];
      let collisions = 0;
      for (const r of filteredRows as Stamped[]) {
        const k = keyOf(r);
        if (!k) { noKey.push(r); continue; }
        const cur = best.get(k);
        if (!cur) { best.set(k, r); continue; }
        collisions++;
        const rMatch = paymentComp && r.__baseCompetence === paymentComp ? 1 : 0;
        const cMatch = paymentComp && cur.__baseCompetence === paymentComp ? 1 : 0;
        if (rMatch !== cMatch) {
          if (rMatch > cMatch) best.set(k, r);
        } else if (r.__baseUploadedAt > cur.__baseUploadedAt) {
          best.set(k, r);
        }
      }
      finalRows = [...best.values(), ...noKey];
      if (collisions > 0) {
        console.info(`[Conciliação] dedup multi-base: ${collisions} colisões resolvidas (${finalRows.length} linhas finais)`);
      }
    }

    setParsedRows(finalRows);
    const label = selectedBases.length === 1
      ? (primaryBase.file_name ?? primaryBase.reference)
      : `${selectedBases.length} bases · ${primaryBase.file_name ?? primaryBase.reference} +${selectedBases.length - 1}`;
    setPendingFileName(label);
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

    // Persiste col_map apenas na base primária (bases secundárias mantêm o seu).
    if (saveColMapping && primaryBase) {
      await (supabase as any)
        .from("conciliation_bases")
        .update({ col_map: colMapping })
        .eq("id", primaryBase.id);
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
      // 1) Alias persistido — vínculo já confirmado pelo analista em rodada anterior.
      const aliasHit = candidates.find(c =>
        (companyAliasMap[c]?.aliases ?? []).some(a => normFull(a) === normT)
      );
      if (aliasHit) return { company: aliasHit, level: "exact" };
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
      // Quase-match: registra sugestão pendente para o admin revisar (não-bloqueante).
      if (company && (level === "medium" || level === "high")) {
        const matchedId = companyNameToId[company];
        supabase.functions.invoke("engine-suggest-link", {
          body: {
            entity_type: "company",
            detected_value: t,
            candidate_value: company,
            matched_company_id: matchedId ?? null,
            source_field: "payment_items.company_name",
            context_jsonb: { payment_id: paymentId, level },
          },
        }).catch(() => {/* fire-and-forget */});
      }
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

        // 1) Alias persistido — vínculo já confirmado pelo analista em rodada anterior.
        const aliasHit = candidates.find(c =>
          (companyAliasMap[c]?.aliases ?? []).some(a => normFull(a) === normT)
        );
        if (aliasHit) return { company: aliasHit, level: 'exact' };

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

  const handleProcessReconciliation = async (
    mode: "replace" | "merge_keep_others" = "replace",
    overrides?: {
      rows?: Record<string, unknown>[];
      colMap?: Record<string, string>;
      mapping?: Record<string, string>;
      fileName?: string | null;
      excludeConsultas?: boolean;
    },
  ) => {
    // Permite reprocessar a conciliação atual sem upload, reconstruindo
    // rows/colMap/mapping a partir dos itens da última run.
    const srcRows = overrides?.rows ?? parsedRows;
    const srcColMap = overrides?.colMap ?? parsedColMap;
    const rawMapping = overrides?.mapping ?? companyMapping;
    // Regra do analista: sugestões "medium" NÃO contam como vínculo até
    // serem explicitamente confirmadas. No cruzamento elas viram null
    // (terceiro fica sem empresa mapeada → vai para empresa_ausente em vez
    // de cruzar com a empresa errada).
    const srcMapping: Record<string, string | null> = {};
    for (const [t, v] of Object.entries(rawMapping)) {
      const lvl = matchLevels[t];
      srcMapping[t] = v && lvl !== 'medium' ? v : null;
    }
    const srcFileName = overrides?.fileName ?? pendingFileName;
    const srcExcludeConsultas =
      overrides?.excludeConsultas ?? excludeConsultas;
    setProcessing(true);
    try {
      // Empresas que este upload está cobrindo (mapeadas para empresas do lote)
      const currentMappedCompanies = new Set(
        Object.values(srcMapping).filter(Boolean) as string[],
      );

      // Persiste o vínculo terceiro→empresa como alias em `companies.aliases`.
      // Próxima conciliação que receba o mesmo texto de "terceiro" auto-resolve
      // como exact match — analista não precisa refazer o vínculo manual.
      const normForAlias = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const aliasUpdates: Array<{ id: string; aliases: string[]; name: string }> = [];
      for (const [terceiro, companyName] of Object.entries(srcMapping)) {
        if (!companyName || !terceiro) continue;
        const ent = companyAliasMap[companyName];
        if (!ent) continue;
        const t = terceiro.trim();
        if (!t || normForAlias(t) === normForAlias(companyName)) continue;
        const existingNorms = (ent.aliases ?? []).map(normForAlias);
        if (existingNorms.includes(normForAlias(t))) continue;
        const next = [...(ent.aliases ?? []), t];
        aliasUpdates.push({ id: ent.id, aliases: next, name: companyName });
      }
      if (aliasUpdates.length > 0) {
        await Promise.all(
          aliasUpdates.map(u =>
            (supabase as any).from("companies").update({ aliases: u.aliases }).eq("id", u.id)
          )
        );
        setCompanyAliasMap(prev => {
          const next = { ...prev };
          for (const u of aliasUpdates) {
            const cur = next[u.name];
            if (cur) next[u.name] = { ...cur, aliases: u.aliases };
          }
          return next;
        });
      }

      // Carrega o cadastro canônico de médicos (id/CRM/CPF + aliases).
      // Usado para resolver tanto a linha da produção quanto o item Exacta
      // ao mesmo doctor.id — eliminando falsos positivos por variação de nome.
      let doctorReg: DoctorRegistry | null = null;
      try { doctorReg = await loadDoctorRegistry(); }
      catch (e) { console.warn('[Conciliação] falha ao carregar doctorRegistry — matching cairá só por nome.', e); }

      const exactaItemsForRun: PaymentItemRow[] = [];
      const mappedCompanies = Array.from(currentMappedCompanies);
      const PAGE = 1000;
      for (let from = 0; from < 50000; from += PAGE) {
        let q = (supabase as any)
          .from("payment_items")
          .select("*, calc:rule_calculations!applied_calc_id(calculation_type, package_included_codes)")
          .eq("payment_id", paymentId)
          .order("created_at")
          .range(from, from + PAGE - 1);
        if (mappedCompanies.length > 0) q = q.in("company_name", mappedCompanies);
        const { data: page, error: pageErr } = await q;
        if (pageErr) throw pageErr;
        const rows = (page ?? []) as PaymentItemRow[];
        exactaItemsForRun.push(...rows);
        if (rows.length < PAGE) break;
      }
      // === FILTRO — Itens que NÃO entram em conciliação ===
      // Bônus, complemento e lançamentos manuais (qualquer tipo) nunca aparecem
      // na base hospitalar de faturamento. Mantê-los geraria "só no Exacta"
      // permanente. Eles são lançamentos avulsos/automáticos do próprio Exacta.
      {
        const EXCLUDED_TIPO_LINHA = new Set(["complemento_bonus", "complemento", "outros"]);
        const before = exactaItemsForRun.length;
        const kept = exactaItemsForRun.filter((it) => {
          const tl = (it as any).tipo_linha as string | null | undefined;
          const src = (it as any).source as string | null | undefined;
          const origem = (it as any).item_origem as string | null | undefined;
          if (tl && EXCLUDED_TIPO_LINHA.has(tl)) return false;
          if (src === "manual") return false;
          if (origem === "inclusao_manual") return false;
          return true;
        });
        const removed = before - kept.length;
        if (removed > 0) {
          console.log('[Conciliação] Excluídos da análise (bônus/complemento/manual):', { before, removed, restantes: kept.length });
        }
        exactaItemsForRun.length = 0;
        exactaItemsForRun.push(...kept);
      }

      // === FILTRO — Convênios excluídos da análise ===
      // Convênios listados pelo analista (ex.: Sul América/Particular que operam
      // por pacote/tratativa manual). Itens desses convênios são removidos das
      // DUAS bases antes do cruzamento — não geram só_hospital/só_exacta.
      // === FILTRO — Convênios excluídos da análise ===
      // Convênios listados pelo analista (ex.: Sul América/Particular que operam
      // por pacote/tratativa manual). Itens desses convênios são removidos das
      // DUAS bases antes do cruzamento — não geram só_hospital/só_exacta.
      // A chave usada aqui é canônica (slug do cadastro quando disponível),
      // então "Sul América" e "SUL AMERICA SAUDE S/A" batem no mesmo bucket.
      const excludedConvKeys = new Set(excludedConvenios);
      let exactaRemovedByConvenio = 0;
      if (excludedConvKeys.size > 0) {
        const before = exactaItemsForRun.length;
        const kept = exactaItemsForRun.filter((it) => {
          const resolved = resolveConvenioKey((it as any).agreement_text);
          if (!resolved) return true; // sem convênio informado → não descarta
          return !excludedConvKeys.has(resolved.key);
        });
        exactaRemovedByConvenio = before - kept.length;
        if (exactaRemovedByConvenio > 0) {
          console.log('[Conciliação] Convênios excluídos (Exacta):', {
            excluded: Array.from(excludedConvenios),
            before,
            removed: exactaRemovedByConvenio,
            restantes: kept.length,
          });
        }
        exactaItemsForRun.length = 0;
        exactaItemsForRun.push(...kept);
      }

      if (exactaItemsForRun.length === 0) {
        throw new Error("Não encontrei itens Exacta elegíveis para conciliação (após filtros de bônus/complemento/manuais/convênios excluídos).");
      }


      // === FILTRO DE COMPETÊNCIA — Pagamentos por remessa ===
      // Regra de negócio (Rede D'Or):
      //  • ~80% das empresas são pagas por PRODUÇÃO: pagamento no mês seguinte
      //    ao da realização → a data do procedimento na Exacta sempre cai
      //    DENTRO da janela de competência do lote.
      //  • As demais são pagas por REMESSA: só pagamos quando emitimos a conta
      //    ao convênio, o que pode demorar meses. Para essas, a data do
      //    procedimento na Exacta é ANTERIOR à competência do lote — não há
      //    risco de divergência (a esteira do faturamento já fechou; é só
      //    repasse do que foi remetido).
      //  • Conclusão: itens da Exacta com procedure_date < início da
      //    competência saem da análise (não viram conciliado, divergente,
      //    só_exacta nem pacote). Mantemos contagem para o log.
      // Override do analista tem prioridade sobre o auto-derivado da competência.
      // String vazia ou inválida → desativa o filtro (analista quer ver tudo).
      let lotePeriodStart: string | null = null;
      const override = (periodStartOverride || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(override)) {
        lotePeriodStart = override;
      } else {
        try {
          const { data: pay } = await (supabase as any)
            .from("payments")
            .select("competence_month, competence_months, competence_regime")
            .eq("id", paymentId)
            .single();
          // Lotes marcados como "remessa" NÃO devem filtrar itens anteriores —
          // o pagamento é justamente sobre produção remetida agora ao convênio,
          // mesmo que o procedimento tenha sido feito meses antes.
          if (pay?.competence_regime === "remessa") {
            console.log('[Conciliação] Lote por remessa — filtro de competência desativado.');
          } else {
            const candidates: string[] = [];
            if (Array.isArray(pay?.competence_months)) {
              for (const c of pay.competence_months) {
                if (c) candidates.push(String(c).slice(0, 10));
              }
            }
            if (pay?.competence_month) candidates.push(String(pay.competence_month).slice(0, 10));
            if (candidates.length > 0) {
              const earliest = candidates.sort()[0];
              const m = earliest.match(/^(\d{4})-(\d{2})/);
              if (m) lotePeriodStart = `${m[1]}-${m[2]}-01`;
            }
          }
        } catch (e) {
          console.warn('[Conciliação] não foi possível ler competência do lote — filtro de remessa desativado.', e);
        }
      }

      let removidosPorRemessa = 0;
      const remessaBefore = exactaItemsForRun.length;
      if (lotePeriodStart) {
        const before = exactaItemsForRun.length;
        const kept: PaymentItemRow[] = [];
        for (const it of exactaItemsForRun) {
          const d = (it as any).procedure_date as string | null;
          if (d) {
            const dOnly = String(d).slice(0, 10);
            if (dOnly < lotePeriodStart) { removidosPorRemessa++; continue; }
          }
          kept.push(it);
        }
        exactaItemsForRun.length = 0;
        exactaItemsForRun.push(...kept);
        console.log('[Conciliação] Filtro remessa:', { lotePeriodStart, before, removidos: removidosPorRemessa, restantes: exactaItemsForRun.length });
        setRemittanceFilterStats({
          lotePeriodStart,
          before,
          removidos: removidosPorRemessa,
          restantes: exactaItemsForRun.length,
          source: override ? 'override' : 'auto',
        });
      } else {
        setRemittanceFilterStats(null);
      }


      const { data: newRun, error: runErr } = await (supabase as any)
        .from("reconciliation_runs")
        .insert({
          payment_id: paymentId,
          created_by: user?.id ?? null,
          status: "processing",
          file_name: srcFileName,
        })
        .select()
        .single();
      if (runErr) throw runErr;


      const normFull = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

      const getCell = (row: Record<string, unknown>, field: string): unknown => {
        const col = srcColMap[field];
        if (!col) return null;
        const v = row[col];
        return v != null && String(v).trim() !== "" ? v : null;
      };

      // Parser BR/US-aware com suporte a negativos (glosa/estorno).
      // - "(123,45)" e "-123,45" → -123.45
      // - "3.159,88" (BR) → 3159.88 ; "3,159.88" (US) → 3159.88
      // - Decide qual separador é decimal pelo último a aparecer.
      const toVal = (v: unknown): number => {
        if (v == null || v === "") return 0;
        if (typeof v === "number") return Number.isFinite(v) ? v : 0;
        let s = String(v).trim();
        if (!s) return 0;
        let neg = false;
        if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
        s = s.replace(/[R$\s]/g, "");
        if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
        const hasComma = s.includes(",");
        const hasDot = s.includes(".");
        if (hasComma && hasDot) {
          if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
            s = s.replace(/\./g, "").replace(",", ".");
          } else {
            s = s.replace(/,/g, "");
          }
        } else if (hasComma) {
          s = s.replace(/\./g, "").replace(",", ".");
        }
        const n = parseFloat(s);
        if (!Number.isFinite(n)) return 0;
        return neg ? -n : n;
      };

      // Extrai SOMENTE a data (YYYY-MM-DD) — hora é descartada por design
      // (planilhas do hospital podem ter timestamp com hora distinta do
      // mesmo ato no Exacta; comparar hora geraria divergência falsa).
      // Importante: NÃO usar toISOString() em valores com fuso, pois a
      // conversão para UTC pode pular um dia (ex.: 07/04 22:00 BRT → 08/04 UTC).
      const toDateStr = (v: unknown): string | null => {
        if (v == null || v === '') return null;
        // Date object → usa componentes LOCAIS (não UTC)
        if (v instanceof Date) {
          if (isNaN(v.getTime())) return null;
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        const s = String(v).trim();
        // DD/MM/YYYY[ HH:MM:SS] → pega só DD/MM/YYYY
        const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (br) return `${br[3]}-${br[2]}-${br[1]}`;
        // YYYY-MM-DD[Tqualquercoisa] → pega só YYYY-MM-DD (literal, sem fuso)
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[0];
        // Fallback: parseia e usa componentes locais
        const d = new Date(s);
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${y}-${mo}-${da}`;
      };

      console.log('[Conciliação] srcColMap:', srcColMap);
      console.log('[Conciliação] srcRows[0]:', srcRows[0]);
      console.log('[Conciliação] paymentItems sample:', paymentItems.slice(0, 3).map(it => ({
        attendance_number: it.attendance_number,
        procedure_code: it.procedure_code,
        company_name: it.company_name,
        gross_amount: (it as unknown as Record<string, unknown>).gross_amount,
      })));

      // Fallback: se procCode não foi detectado, tentar encontrar manualmente
      if (!srcColMap['procCode'] && srcRows.length > 0) {
        const firstRow = srcRows[0];
        const candidates = Object.keys(firstRow).filter(k => {
          const norm = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
          return norm.includes('tuss') || norm.includes('codigo') || norm.includes('código');
        });
        if (candidates.length > 0) {
          srcColMap['procCode'] = candidates[0];
          console.log('[Conciliação] procCode detectado no fallback:', candidates[0]);
        }
      }





      const dropByTerceiro = new Map<string, number>();
      const filteredRows = srcRows.filter((row) => {
        const col = srcColMap["company"];
        const terceiro = col ? String(row[col] ?? "").trim() : "";
        const ok = !!(terceiro && srcMapping[terceiro]);
        if (!ok) {
          const key = terceiro || '(vazio)';
          dropByTerceiro.set(key, (dropByTerceiro.get(key) ?? 0) + 1);
        }
        return ok;
      });

      if (dropByTerceiro.size > 0) {
        console.warn('[Conciliação] linhas DESCARTADAS por terceiro não mapeado:', Object.fromEntries(dropByTerceiro));
      }

      // Filtro de procedimentos — exclui Consultas/Visitas por padrão
      const GRUPOS_EXCLUIR = new Set(['CONSULTAS', 'VISITAS']);
      const colGrupo = srcColMap['grupo'] ?? null;

      let dropByGrupo = 0;
      const rowsAposGrupo = srcExcludeConsultas && colGrupo
        ? filteredRows.filter(row => {
            const grupo = String(row[colGrupo] ?? '').trim();
            const ok = !GRUPOS_EXCLUIR.has(grupo.toUpperCase());
            if (!ok) {
              dropByGrupo++;
            }

            return ok;
          })
        : filteredRows;
      if (dropByGrupo > 0) console.log('[Conciliação] descartadas por grupo (Consultas/Visitas):', dropByGrupo);

      // PASSO 0 — filtro de competência por procedure_date.
      // Pega o conjunto de meses (YYYY-MM) presentes nos itens do lote Exacta
      // e descarta linhas da produção fora desse intervalo. Resolve o "83 só
      // no Exacta" causado por planilha de produção trazer outros meses.
      // Skip-safe: se Exacta não tem datas OU não há coluna de data mapeada,
      // não filtra (avisa no console).
      const competencyMonths = new Set<string>();
      for (const it of exactaItemsForRun) {
        const d = toDateStr((it as any).procedure_date);
        if (d) competencyMonths.add(d.slice(0, 7));
      }
      const colDate = srcColMap['date'] ?? null;
      let foraCompetencia = 0;
      let rowsParaCruzamento = rowsAposGrupo;
      if (competencyMonths.size > 0 && colDate) {
        rowsParaCruzamento = rowsAposGrupo.filter(row => {
          const d = toDateStr(row[colDate]);
          if (!d) return true; // sem data na linha → não descarta (analista decide)
          const ok = competencyMonths.has(d.slice(0, 7));
          if (!ok) {
            foraCompetencia++;
          }
          return ok;
        });
        console.log('[Conciliação] competência:', Array.from(competencyMonths).join(','), '· descartadas fora de competência:', foraCompetencia);
      } else {
        console.warn('[Conciliação] filtro de competência DESLIGADO — Exacta sem procedure_date ou produção sem coluna de data mapeada.');
      }

      // Aplica exclusão de convênios também na base hospitalar (mesmo conjunto
      // usado para a Exacta acima). Sem coluna de convênio mapeada, avisa e
      // segue sem filtrar o hospital.
      let hospitalRemovedByConvenio = 0;
      if (excludedConvKeys.size > 0) {
        const colAgr = srcColMap['agreement'] ?? null;
        if (colAgr) {
          const before = rowsParaCruzamento.length;
          rowsParaCruzamento = rowsParaCruzamento.filter((row) => {
            const resolved = resolveConvenioKey(row[colAgr]);
            if (!resolved) return true;
            return !excludedConvKeys.has(resolved.key);
          });
          hospitalRemovedByConvenio = before - rowsParaCruzamento.length;
          console.log('[Conciliação] Convênios excluídos (Hospital):', {
            excluded: Array.from(excludedConvenios),
            before,
            removed: hospitalRemovedByConvenio,
            restantes: rowsParaCruzamento.length,
          });
        } else {
          console.warn('[Conciliação] Convênios excluídos: coluna de convênio NÃO mapeada na produção — filtro aplicado só na Exacta.');
        }
      }
      setConvenioFilterStats({
        excluded: Array.from(excludedConvenios),
        exactaRemoved: exactaRemovedByConvenio,
        hospitalRemoved: hospitalRemovedByConvenio,
      });





      const sampleRow = rowsParaCruzamento[0];
      if (sampleRow) {
        console.log('[Conciliação] sample row filtrada:', sampleRow);
        console.log('[Conciliação] att col:', srcColMap['attendance'], '-> valor:', sampleRow[srcColMap['attendance']]);
        console.log('[Conciliação] code col:', srcColMap['procCode'], '-> valor:', sampleRow[srcColMap['procCode']]);
      }

      const normalizeCode = (code: unknown): string => {
        if (code == null || code === '') return '';
        const str = String(code).trim();
        const num = Number(str);
        if (!isNaN(num) && isFinite(num) && num > 0) return String(Math.round(num));
        return str.replace(/\D/g, '');
      };

      // TUSS pode aparecer em 7 dígitos (raiz) ou 8 dígitos (raiz + dígito
      // verificador). A Exacta normalmente grava com 8 dígitos; bases de
      // hospital frequentemente exportam só os 7. Geramos TODAS as variantes
      // razoáveis para que o mesmo código case independente do formato.
      const codeVariants = (code: unknown): string[] => {
        const base = normalizeCode(code);
        if (!base) return [];
        const set = new Set<string>([base]);
        // 8 dígitos → também tenta 7 (remove último dígito verificador)
        if (base.length === 8) set.add(base.slice(0, 7));
        // 7 dígitos → não tem como reconstruir o verificador; deixa só 7.
        return Array.from(set);
      };

      const normAtt = (att: unknown): string => {
        if (att == null || att === '') return '';
        const str = String(att).trim();
        const num = Number(str);
        if (!isNaN(num) && isFinite(num) && num > 0) return String(Math.round(num));
        return str.replace(/\D/g, '');
      };

      // CHAVE PRIMÁRIA: atendimento + código TUSS.
      // O lote já é escopado por grupo (uma empresa), então incluir empresa
      // na chave introduz falso negativo quando o `company_name` da Exacta
      // foi importado com grafia ligeiramente diferente do `terceiro` do
      // hospital. Empresa continua sendo validada via `companyMissing` antes
      // do lookup, e usada no score como desempate.
      const normCompany = (s: unknown): string =>
        String(s ?? "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "")
          .trim();
      const makeKey = (_company: unknown, att: unknown, code: unknown): string =>
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

      // Normaliza via de acesso para um dos 4 buckets canônicos (espelha rulesEngine.normAccessRoute).
      // Vital para conciliar quando o mesmo código aparece em vias distintas com valores legítimos diferentes.
      const normRoute = (s: unknown): string => {
        const n = normName(s);
        if (!n) return "";
        if (n.includes("mesma")) return "mesma_via";
        if (n.includes("outra") || n.includes("diferente") || /\b2a?\b/.test(n) || n.includes("segunda")) return "outra_via";
        if (n.includes("unica") || n.includes("principal") || /\b1a?\b/.test(n) || n.includes("primeira")) return "unica_principal";
        if (n.includes("bonus") || n.includes("complemento") || n === "sem" || n.includes("sem via") || n === "na" || n === "n a") return "sem_via";
        return n;
      };

      const normQty = (q: unknown): number => {
        const n = Number(String(q ?? "").replace(",", "."));
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
      };

      // ===== PASSO 5 — Agregação por chave (Atend + CRM + TUSS) =====
      // Antes de cruzar, colapsamos linhas que pertencem ao MESMO ato (mesmo
      // atendimento, mesmo médico, mesmo TUSS) — comum quando o sistema de
      // faturamento segmenta o procedimento em vários lançamentos (parciais,
      // ajustes, vias). Sem isso, cada segmento virava uma "linha solta" e
      // produzia falsos "Só no hospital" / "Só no Exacta".
      //
      // Chave de médico canônico: doctor_id resolvido > CRM em dígitos >
      // nome normalizado > "_no_doctor_" (linha sem médico).
      const doctorKeyFromItem = (it: PaymentItemRow): string => {
        const did = (it as any).doctor_id;
        if (did) return `id:${did}`;
        const doc = String((it as any).doctor_document ?? '').replace(/\D/g, '');
        if (doc) return `crm:${doc}`;
        const nm = normName((it as any).doctor_name);
        if (nm) return `nm:${nm}`;
        return '_no_doctor_';
      };
      const doctorKeyFromRow = (
        hospDoctorId: string | null,
        crmDigits: string,
        doctorRaw: unknown,
      ): string => {
        if (hospDoctorId) return `id:${hospDoctorId}`;
        if (crmDigits) return `crm:${crmDigits}`;
        const nm = normName(doctorRaw);
        if (nm) return `nm:${nm}`;
        return '_no_doctor_';
      };

      // --- Agregação Exacta ---
      // Indexa por (att+TUSS) e, dentro do bucket, colapsa itens com mesma
      // doctorKey somando procedure_amount/gross_amount/quantity. Segmentos
      // de médicos distintos (principal+auxiliar) permanecem como itens
      // separados no mesmo bucket — o scoreCandidate desempata depois.
      const exactaByKey = new Map<string, PaymentItemRow[]>();
      const exactaCompanySet = new Set<string>();
      type ExactaGroup = { rep: PaymentItemRow; ids: string[]; sumProc: number; sumGross: number; sumQty: number; routes: Set<string> };
      const exactaGroupsByVariant = new Map<string, Map<string, ExactaGroup>>();
      for (const it of exactaItemsForRun) {
        const compNorm = normCompany(it.company_name);
        if (compNorm) exactaCompanySet.add(compNorm);
        if (!it.attendance_number || !it.procedure_code) continue;
        const dk = doctorKeyFromItem(it);
        for (const v of codeVariants(it.procedure_code)) {
          const k = makeKey(it.company_name, it.attendance_number, v);
          let groups = exactaGroupsByVariant.get(k);
          if (!groups) { groups = new Map(); exactaGroupsByVariant.set(k, groups); }
          let g = groups.get(dk);
          if (!g) {
            g = { rep: it, ids: [], sumProc: 0, sumGross: 0, sumQty: 0, routes: new Set() };
            groups.set(dk, g);
          }
          g.ids.push(it.id);
          g.sumProc += Number((it as any).procedure_amount ?? 0) || 0;
          g.sumGross += Number((it as any).gross_amount ?? 0) || 0;
          g.sumQty += Number((it as any).quantity ?? 1) || 0;
          const r = normRoute((it as any).access_route);
          if (r) g.routes.add(r);
        }
      }
      for (const [k, groups] of exactaGroupsByVariant.entries()) {
        const arr: PaymentItemRow[] = [];
        for (const g of groups.values()) {
          if (g.ids.length === 1) { arr.push(g.rep); continue; }
          // Quando colapsamos N segmentos do mesmo médico/ato com VIAS distintas,
          // o virtual perde informação de via — zera access_route para o matcher
          // tratar como "ausente" e não rejeitar por via divergente.
          const mixedRoute = g.routes.size > 1;
          const virtual: PaymentItemRow = Object.assign({}, g.rep, {
            procedure_amount: g.sumProc,
            gross_amount: g.sumGross,
            quantity: g.sumQty,
            access_route: mixedRoute ? null : (g.rep as any).access_route,
            __aggregated_ids: g.ids,
          } as any) as PaymentItemRow;
          arr.push(virtual);
        }
        exactaByKey.set(k, arr);
      }

      // --- Agregação Produção ---
      // Faz uma passada inicial nas linhas filtradas, computa chave canônica
      // de empresa+atendimento+TUSS+médico+função. A função entra como parte
      // da identidade do ato porque médico não resolvido no cadastro pode cair
      // em `_no_doctor_`; sem a função, principal e auxiliares do mesmo
      // atendimento/código podiam colapsar e inflar a quantidade do hospital.
      const hospitalCompanySet = new Set<string>();
      type ProdAgg = { rep: Record<string, unknown>; valSum: number; qtySum: number; routes: Set<string>; repasseSum: number };
      const prodAggMap = new Map<string, ProdAgg>();
      for (const row of rowsParaCruzamento) {
        const colC = srcColMap["company"];
        const terceiro = colC ? String(row[colC] ?? "").trim() : "";
        const mapped = srcMapping[terceiro] ?? terceiro;
        const cn = normCompany(mapped);
        if (cn) hospitalCompanySet.add(cn);
        const att = getCell(row, "attendance");
        const code = getCell(row, "procCode");
        if (!att || !code) {
          // sem chave de agregação → mantém isolada
          prodAggMap.set(`__solo__${prodAggMap.size}`, {
            rep: row,
            valSum: toVal(getCell(row, "value")),
            qtySum: Number(String(getCell(row, "quantity") ?? "1").replace(",", ".")) || 1,
            routes: new Set(),
            repasseSum: toVal(getCell(row, "valueRepasse")),
          });
          continue;
        }
        const crmDigits = String(getCell(row, "crm") ?? '').replace(/\D/g, '');
        const hospDocId = doctorReg
          ? resolveDoctor({ name: String(getCell(row, "doctor") ?? '') || null, crm: crmDigits || null }, doctorReg).doctor?.id ?? null
          : null;
        const dk = doctorKeyFromRow(hospDocId, crmDigits, getCell(row, "doctor"));
        const normCode = normalizeCode(code);
        // Chave inclui doctorKey + roleKey: segmentos do MESMO médico/função
        // colapsam (parciais/ajustes), mas principal e auxiliares permanecem
        // como linhas separadas para casar com suas contrapartidas na Exacta.
        const roleKey = normRole(getCell(row, "role")) || "_no_role_";
        const aggKey = `${normAtt(att)}|${normCode}|${dk}|${roleKey}`;
        const valHosp = toVal(getCell(row, "value"));
        const valHospRepasse = toVal(getCell(row, "valueRepasse"));
        const qtyHosp = Number(String(getCell(row, "quantity") ?? "1").replace(",", ".")) || 1;
        const routeN = normRoute(getCell(row, "accessRoute"));
        const existing = prodAggMap.get(aggKey);
        if (existing) {
          existing.valSum += valHosp;
          existing.qtySum += qtyHosp;
          existing.repasseSum = (existing.repasseSum ?? 0) + valHospRepasse;
          if (routeN) existing.routes.add(routeN);
        } else {
          const routes = new Set<string>();
          if (routeN) routes.add(routeN);
          prodAggMap.set(aggKey, { rep: row, valSum: valHosp, qtySum: qtyHosp, routes, repasseSum: valHospRepasse });
        }
      }
      // Remover itens com qty líquida ≤ 0 — foram incluídos e depois removidos/estornados na base hospitalar.
      // Sem entrada no hospital → o Exacta irá para "só no Exacta" (classificação correta).
      prodAggMap.forEach((agg, key) => {
        if ((agg.qtySum ?? 0) <= 0) {
          prodAggMap.delete(key);
        }
      });
      const aggregatedRows: ProdAgg[] = Array.from(prodAggMap.values());
      console.log('[Conciliação] agregação produção:', rowsParaCruzamento.length, '→', aggregatedRows.length, '· buckets Exacta:', exactaByKey.size);

      console.log('[Cruzamento] Empresas Exacta:', exactaCompanySet.size, 'Empresas Hospital:', hospitalCompanySet.size, 'Chaves Exacta:', exactaByKey.size);

      // ===== DIAGNÓSTICO DETALHADO =====
      // Mede sobreposição real de chaves att+TUSS entre os dois lados, sem
      // considerar empresa nem médico, pra isolar onde está a perda de match.
      {
        const exactaAttCode = new Set<string>();
        let exactaSemAtt = 0, exactaSemCode = 0;
        for (const it of exactaItemsForRun) {
          if (!it.attendance_number) { exactaSemAtt++; continue; }
          if (!it.procedure_code) { exactaSemCode++; continue; }
          exactaAttCode.add(`${normAtt(it.attendance_number)}|${normalizeCode(it.procedure_code)}`);
        }
        const prodAttCode = new Set<string>();
        let prodSemAtt = 0, prodSemCode = 0;
        for (const row of rowsParaCruzamento) {
          const att = getCell(row, "attendance");
          const code = getCell(row, "procCode");
          if (!att) { prodSemAtt++; continue; }
          if (!code) { prodSemCode++; continue; }
          prodAttCode.add(`${normAtt(att)}|${normalizeCode(code)}`);
        }
        const intersec = new Set<string>();
        for (const k of prodAttCode) if (exactaAttCode.has(k)) intersec.add(k);
        const soExacta = new Set<string>();
        for (const k of exactaAttCode) if (!prodAttCode.has(k)) soExacta.add(k);
        const soProd = new Set<string>();
        for (const k of prodAttCode) if (!exactaAttCode.has(k)) soProd.add(k);
        console.log('[DIAG] Exacta total:', exactaItemsForRun.length, '· sem_att:', exactaSemAtt, '· sem_code:', exactaSemCode, '· chaves únicas att+code:', exactaAttCode.size);
        console.log('[DIAG] Produção total:', rowsParaCruzamento.length, '· sem_att:', prodSemAtt, '· sem_code:', prodSemCode, '· chaves únicas att+code:', prodAttCode.size);
        console.log('[DIAG] Intersecção att+code:', intersec.size, '· só Exacta (sem par em produção):', soExacta.size, '· só Produção (sem par em Exacta):', soProd.size);
        // Amostras pra inspecionar grafia/normalização
        console.log('[DIAG] Amostra Exacta (5):', Array.from(exactaAttCode).slice(0, 5));
        console.log('[DIAG] Amostra Produção (5):', Array.from(prodAttCode).slice(0, 5));
        console.log('[DIAG] Amostra só-Exacta (5):', Array.from(soExacta).slice(0, 5));
        console.log('[DIAG] Amostra só-Produção (5):', Array.from(soProd).slice(0, 5));
        // Empresas (normalizadas) de cada lado
        console.log('[DIAG] Empresas Exacta normalizadas:', Array.from(exactaCompanySet).slice(0, 10));
        console.log('[DIAG] Empresas Hospital normalizadas:', Array.from(hospitalCompanySet).slice(0, 10));
      }

      const matchedExactaIds = new Set<string>();
      // Conjunto de atendimentos (normalizados) presentes na base do hospital.
      // Usado para distinguir "só_exacta verdadeiro" (atendimento inexistente
      // no hospital → glosa/erro de cadastro) de "possivel_pacote" (atendimento
      // existe, mas faltam linhas da equipe → faturamento consolidou em pacote
      // pago ao cirurgião principal).
      const hospitalAttendances = new Set<string>();
      for (const row of rowsParaCruzamento) {
        const att = getCell(row, "attendance");
        if (att) hospitalAttendances.add(normAtt(att));
      }

      // === Índice por (empresa + código) — fonte de regras ===
      // Resolve o TIPO de regra a partir dos próprios payment_items, mesmo
      // quando a linha do hospital não casou com nenhuma linha Exacta. Garante
      // que itens de pacote/valor_fixo/tabela_diferenciada/bônus sigam o
      // RAMO 3 (sem comparação de valor) inclusive quando estão sem match.
      const normMethod = (m: unknown): string =>
        String(m ?? "").toLowerCase().trim().replace(/\s+/g, "_");
      const ruleMethodByCompanyCode = new Map<string, string>();
      // Conjunto de chaves (empresa|atendimento) onde já existe linha Exacta
      // paga via PACOTE (cirurgião principal recebeu o consolidado).
      // Componentes do pacote (auxiliares, anestesia, visitas, pareceres) que
      // aparecem só no extrato do hospital são honorários embutidos — não são
      // "só hospital" e não geram impacto financeiro.
      const packageAttendanceKeys = new Set<string>();
      // Map (empresa|code_do_pacote_principal) → Set de TUSS codes que esse
      // pacote embute (rule_calculations.package_included_codes). Permite
      // supressão PRECISA por code, independente de atendimento.
      const packageMembersByKey = new Map<string, Set<string>>();
      let _trueMethodHits = 0;
      let _packageMembersAdded = 0;
      for (const it of exactaItemsForRun) {
        const cn = normCompany(it.company_name);
        const cd = normalizeCode(it.procedure_code);
        // Tipo REAL da regra vem de rule_calculations (via embed calc).
        // applied_calc_method serve só como fallback — está nulo para
        // valor_fixo/pacote (100%) e ~70% dos percentuais.
        const calcType = (it as any).calc?.calculation_type as string | null | undefined;
        const trueMethod = normMethod(calcType ?? (it as any).applied_calc_method);
        if (calcType) _trueMethodHits++;
        if (cd && trueMethod && !ruleMethodByCompanyCode.has(`${cn}|${cd}`)) {
          ruleMethodByCompanyCode.set(`${cn}|${cd}`, trueMethod);
        }
        if (trueMethod.startsWith("pacote") && it.attendance_number) {
          packageAttendanceKeys.add(`${cn}|${normAtt(it.attendance_number)}`);
        }
        // Mapeia componentes declarados do pacote (package_included_codes).
        const included = (it as any).calc?.package_included_codes;
        if (
          trueMethod.startsWith("pacote") &&
          Array.isArray(included) && included.length > 0 && cd
        ) {
          const key = `${cn}|${cd}`;
          const set = packageMembersByKey.get(key) ?? new Set<string>();
          for (const c of included) {
            if (typeof c !== "string" || !c) continue;
            for (const v of codeVariants(c)) set.add(v);
          }
          packageMembersByKey.set(key, set);
          _packageMembersAdded++;
        }
      }
      console.log('[Conciliação] índices regra:', {
        items: exactaItemsForRun.length,
        com_calc_embed: _trueMethodHits,
        rule_method_keys: ruleMethodByCompanyCode.size,
        package_attendance_keys: packageAttendanceKeys.size,
        package_member_keys: packageMembersByKey.size,
        package_members_added: _packageMembersAdded,
      });

      // Soma agregada de expected_amount/gross_amount por chave
      // (empresa|atendimento|médico|código). Exacta pode quebrar a mesma
      // produção em N linhas (qty=1 cada) enquanto a produção do hospital
      // vem agregada (qty=N). Comparar apenas o item matched gera falso
      // divergente — somamos todos os irmãos da mesma chave.
      const expectedByKey = new Map<string, number>();
      const grossByKey = new Map<string, number>();
      const procedureAmountByKey = new Map<string, number>();
      for (const it of exactaItemsForRun) {
        const att = normAtt(it.attendance_number ?? "");
        const med = normName((it as unknown as { doctor_name?: string }).doctor_name ?? "");
        const cd = normalizeCode(it.procedure_code);
        const key = `${att}|${med}|${cd}`;
        expectedByKey.set(key, (expectedByKey.get(key) ?? 0) + (Number((it as unknown as { expected_amount?: number }).expected_amount) || 0));
        grossByKey.set(key, (grossByKey.get(key) ?? 0) + (Number((it as unknown as { gross_amount?: number }).gross_amount) || 0));
        procedureAmountByKey.set(key, (procedureAmountByKey.get(key) ?? 0) + (Number((it as unknown as { procedure_amount?: number }).procedure_amount) || 0));
      }
      const lookupExpected = (_cmpRaw: unknown, attRaw: unknown, medRaw: unknown, codeRaw: unknown): number => {
        const att = normAtt(String(attRaw ?? ""));
        const med = normName(String(medRaw ?? ""));
        for (const v of codeVariants(codeRaw)) {
          const val = expectedByKey.get(`${att}|${med}|${v}`);
          if (val !== undefined) return val;
        }
        return 0;
      };
      const lookupGross = (_cmpRaw: unknown, attRaw: unknown, medRaw: unknown, codeRaw: unknown): number => {
        const att = normAtt(String(attRaw ?? ""));
        const med = normName(String(medRaw ?? ""));
        for (const v of codeVariants(codeRaw)) {
          const val = grossByKey.get(`${att}|${med}|${v}`);
          if (val !== undefined) return val;
        }
        return 0;
      };
      const lookupProcedureAmount = (_cmpRaw: unknown, attRaw: unknown, medRaw: unknown, codeRaw: unknown): number => {
        const att = normAtt(String(attRaw ?? ""));
        const med = normName(String(medRaw ?? ""));
        for (const v of codeVariants(codeRaw)) {
          const val = procedureAmountByKey.get(`${att}|${med}|${v}`);
          if (val !== undefined) return val;
        }
        return 0;
      };


      const lookupCalcMethod = (companyRaw: unknown, codeRaw: unknown): string => {
        const cn = normCompany(companyRaw);
        for (const v of codeVariants(codeRaw)) {
          const m = ruleMethodByCompanyCode.get(`${cn}|${v}`);
          if (m) return m;
        }
        return "";
      };
      const isPackageAttendance = (companyRaw: unknown, attRaw: unknown): boolean => {
        if (!attRaw) return false;
        return packageAttendanceKeys.has(`${normCompany(companyRaw)}|${normAtt(attRaw)}`);
      };
      // Verifica se o code informado está declarado em package_included_codes
      // de ALGUM pacote dessa empresa (independente do atendimento).
      const isPackageMember = (companyRaw: unknown, memberCode: unknown): boolean => {
        const cn = normCompany(companyRaw);
        const prefix = cn + "|";
        const variants = codeVariants(memberCode);
        for (const [key, members] of packageMembersByKey) {
          if (!key.startsWith(prefix)) continue;
          for (const v of variants) {
            if (members.has(v)) return true;
          }
        }
        return false;
      };


      const toInsert: Array<Record<string, unknown>> = [];
      let conciliado = 0,
        valor_divergente = 0,
        qtd_divergente = 0,
        so_hospital = 0,
        so_exacta = 0,
        empresa_ausente = 0,
        possivel_pacote = 0;
      let risco_mais = 0,
        risco_menos = 0,
        divergencia_valor = 0;

      for (const agg of aggregatedRows) {
        const row = agg.rep;
        const att = getCell(row, "attendance");
        const account = getCell(row, "account");
        const code = getCell(row, "procCode");
        // Valor e quantidade AGREGADOS (somatório dos segmentos do mesmo ato).
        const valHosp = agg.valSum;
        const valHospRepasse = (agg as any).repasseSum ?? 0;
        const patient = getCell(row, "patient");
        const doctor = getCell(row, "doctor");
        const crmHospRaw = getCell(row, "crm");
        const hospDoctorResolved = doctorReg
          ? resolveDoctor({ name: doctor ? String(doctor) : null, crm: crmHospRaw ? String(crmHospRaw) : null }, doctorReg).doctor
          : null;
        const hospDoctorId = hospDoctorResolved?.id ?? null;
        const crmHospDigits = String(crmHospRaw ?? '').replace(/\D/g, '');
        const procName = getCell(row, "procName");
        const dateRaw = getCell(row, "date");
        const roleHosp = getCell(row, "role");
        const qtyHosp = agg.qtySum;
        const routeHosp = getCell(row, "accessRoute");
        const col = srcColMap["company"];
        const terceiro = col ? String(row[col] ?? "").trim() : "";
        const mappedCompany = srcMapping[terceiro] ?? terceiro;
        const dateStr = toDateStr(dateRaw);
        // Empresa NÃO é validada aqui: o lote já é escopado por PJ na etapa
        // anterior (mapeamento de "Terceiros" → empresa Exacta no painel de
        // bases). Revalidar por grafia dentro do matcher só produzia falso
        // "só_hospital" quando o nome longo divergia (ex.: "C.O.B - Centro…"
        // vs "COB CENTRO … LTDA") sem alias no srcMapping. Chave canônica
        // continua sendo Atend + TUSS + Médico.
        const companyMissing = false;
        const attMissing = !att || normAtt(att) === "";
        // Tenta TODAS as variantes do código (7d / 8d) — pega o primeiro
        // bucket com candidatos. Itens já matchados são filtrados depois.
        let candidates: PaymentItemRow[] = [];
        if (!companyMissing && !attMissing) {
          const seen = new Set<string>();
          for (const v of codeVariants(code)) {
            const k = makeKey(mappedCompany, att, v);
            const bucket = exactaByKey.get(k);
            if (!bucket) continue;
            for (const cand of bucket) {
              if (seen.has(cand.id)) continue;
              seen.add(cand.id);
              candidates.push(cand);
            }
          }
        }
        const getConvenioValue = (m: PaymentItemRow): number => {
          const proc = (m as any).procedure_amount;
          if (proc != null && proc !== "") return Number(proc) || 0;
          return Number((m as any).gross_amount ?? 0) || 0;
        };

        // Matching disambiguation: além de atendimento+código, exige coerência
        // de médico/função/via/qtd. Sem isso, linhas com mesmo att+code de médicos
        // diferentes (ex.: principal vs auxiliar) ou de vias diferentes (única vs
        // mesma via) cruzavam valor errado e geravam divergência falsa.
        //
        // Resolução de médico é ALIAS-AWARE: `hospDoctorId` e `medDoctorId` são
        // resolvidos por `resolveDoctor()` (registryLookup), que consulta
        // `doctor_aliases`. Logo, "Dr. João S." na produção e "João Silva" na
        // Exacta resolvem ao MESMO doctor_id se houver alias cadastrado.
        //
        // FILTRO DE DATA com TOLERÂNCIA DE ±1 DIA: a chave canônica é
        // atendimento + médico + DATA, mas hospital e Exacta frequentemente
        // registram datas diferentes por 1 dia (hospital = data do faturamento
        // / alta; Exacta = data do procedimento; virada de meia-noite no centro
        // cirúrgico). Igualdade exata gerava falsos "só no hospital" mesmo
        // quando atend+TUSS+médico+empresa batiam. Divergências >1 dia
        // continuam rejeitadas (procedimento realmente em outro dia).
        // Rastreamos o offset por candidato para sinalizar em ia_obs/diagnostics.
        const onlyDate = (v: unknown): string | null => {
          if (!v) return null;
          const s = String(v);
          const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
          return m ? m[1] : toDateStr(v);
        };
        const daysBetween = (a: string, b: string): number => {
          const da = new Date(`${a}T00:00:00Z`).getTime();
          const db = new Date(`${b}T00:00:00Z`).getTime();
          if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY;
          return Math.abs(Math.round((da - db) / 86400000));
        };
        const hospDateOnly = dateStr; // toDateStr já normaliza
        const dateOffsetById = new Map<string, number>(); // 0 = igual, 1 = ±1 dia
        const available = candidates.filter((m) => {
          if (matchedExactaIds.has(m.id)) return false;
          if (hospDateOnly) {
            const medDateOnly = onlyDate((m as any).procedure_date);
            if (medDateOnly) {
              const diff = daysBetween(hospDateOnly, medDateOnly);
              if (diff > 1) return false;
              dateOffsetById.set(m.id, diff);
            }
          }
          return true;
        });
        const docHospN = normName(doctor);
        const roleHospN = normRole(roleHosp);
        // Se a agregação produção juntou segmentos com VIAS distintas, a via do
        // rep é ambígua — descarta como sinal para não rejeitar candidatos válidos.
        const mixedRouteHosp = (agg.routes?.size ?? 0) > 1;
        const routeHospN = mixedRouteHosp ? "" : normRoute(routeHosp);
        const qtyHospN = normQty(qtyHosp);

        const scoreCandidate = (m: PaymentItemRow): { score: number; docOk: boolean; roleOk: boolean; routeOk: boolean; docConflict: boolean; roleConflict: boolean; routeConflict: boolean } => {
          let s = 0;
          const docMedN = normName((m as any).doctor_name);
          const roleMedN = normRole((m as any).doctor_role);
          const routeMedN = normRoute((m as any).access_route);
          const qtyMedN = normQty((m as any).quantity);
          const medDoctorId = (m as any).doctor_id ?? null;
          const crmMedDigits = String((m as any).doctor_document ?? '').replace(/\D/g, '');
          let docOk = false, roleOk = false, routeOk = false;
          let docConflict = false, roleConflict = false, routeConflict = false;

          // Resolução canônica (doctor_id): sinal mais forte que nome.
          // Quando ambos os lados resolvem ao mesmo médico cadastrado, é match
          // certo independente de variação de nome (alias, abreviação, acento).
          if (hospDoctorId && medDoctorId && hospDoctorId === medDoctorId) {
            s += 2000; docOk = true;
          } else if (hospDoctorId && medDoctorId && hospDoctorId !== medDoctorId) {
            s -= 1500; docConflict = true;
          } else if (crmHospDigits && crmMedDigits && crmHospDigits === crmMedDigits) {
            s += 1800; docOk = true;
          } else if (crmHospDigits && crmMedDigits && crmHospDigits !== crmMedDigits) {
            s -= 1200; docConflict = true;
          } else if (docHospN && docMedN && docHospN === docMedN) {
            s += 1000; docOk = true;
          } else if (docHospN && docMedN && (docMedN.includes(docHospN) || docHospN.includes(docMedN))) {
            s += 400; docOk = true;
          } else if (docHospN && docMedN) {
            s -= 200; docConflict = true;
          }

          if (roleHospN && roleMedN && roleHospN === roleMedN) { s += 200; roleOk = true; }
          else if (roleHospN && roleMedN) { s -= 150; roleConflict = true; }
          // Via de acesso: forte sinal quando ambos os lados informam — separa
          // linhas legítimas do mesmo código com valores distintos por via.
          if (routeHospN && routeMedN && routeHospN === routeMedN) { s += 500; routeOk = true; }
          else if (routeHospN && routeMedN) { s -= 400; routeConflict = true; }
          if (qtyHospN === qtyMedN) s += 50;
          // Preferir data exata quando houver múltiplos candidatos com ±1 dia.
          const dOff = dateOffsetById.get(m.id) ?? 0;
          if (dOff === 1) s -= 25;
          const diff = Math.abs(getConvenioValue(m) - valHosp);
          s += Math.max(0, 30 - Math.min(30, (diff / Math.max(1, valHosp)) * 30));
          return { score: s, docOk, roleOk, routeOk, docConflict, roleConflict, routeConflict };
        };

        // Conflito DURO só existe quando AMBOS os lados informam o campo e
        // discordam. Se a Exacta não trouxe médico/função/via (comum em
        // auxiliares e linhas sem via), tratamos como ausência de informação —
        // NÃO como conflito — senão o único candidato é descartado e o item
        // vira falso "Só no Exacta" / "Só no hospital".
        const hasHardConflict = (sc: ReturnType<typeof scoreCandidate>) =>
          sc.docConflict || sc.roleConflict || sc.routeConflict;

        let match: PaymentItemRow | undefined;
        let ambiguous = false;
        let decision = "sem_candidato";
        const evaluated: Array<PaymentItemRow & { __sc: ReturnType<typeof scoreCandidate> }> = [];
        if (available.length === 1) {
          const onlyScore = scoreCandidate(available[0]);
          evaluated.push(Object.assign({}, available[0], { __sc: onlyScore }));
          if (!hasHardConflict(onlyScore)) {
            match = available[0];
            decision = "match_unico";
          } else {
            decision = "descartado_por_conflito";
          }
        } else if (available.length > 1) {
          // Filtros DUROS: se o hospital informa médico e existe candidato com o
          // mesmo médico, descarta os demais — evita casar linha do principal
          // (ex.: Kleber R$ 1.457) com linha do auxiliar (ex.: Laryssa R$ 437).
          // Mesmo princípio para função e via de acesso.
          let pool = available.map((m) => ({ m, ...scoreCandidate(m) }));
          pool.forEach((p) => evaluated.push(Object.assign({}, p.m, { __sc: { score: p.score, docOk: p.docOk, roleOk: p.roleOk, routeOk: p.routeOk, docConflict: p.docConflict, roleConflict: p.roleConflict, routeConflict: p.routeConflict } })));
          const docFiltered = pool.filter((c) => c.docOk);
          if (docHospN && docFiltered.length > 0) { pool = docFiltered; decision = "filtrado_por_medico"; }
          const roleFiltered = pool.filter((c) => c.roleOk);
          if (roleHospN && roleFiltered.length > 0) { pool = roleFiltered; if (decision === "sem_candidato") decision = "filtrado_por_funcao"; }
          const routeFiltered = pool.filter((c) => c.routeOk);
          if (routeHospN && routeFiltered.length > 0) { pool = routeFiltered; if (decision === "sem_candidato") decision = "filtrado_por_via"; }
          const ranked = pool
            .filter((c) => !hasHardConflict(c))
            .sort((a, b) => b.score - a.score);
          match = ranked[0]?.m;
          // Ambíguo: top sem identidade clara (sem doc, role nem via coerentes)
          if (!match) decision = "descartado_por_conflito";
          else if (!ranked[0].docOk && !ranked[0].roleOk && !ranked[0].routeOk) { ambiguous = true; decision = "ambiguo"; }
        }

        // Diagnóstico do match: capturamos para auditoria/explicabilidade.
        const buildDiagnostics = (): MatchDiagnostics | null => {
          if (available.length === 0) return null;
          const candidates: MatchDiagnosticsCandidate[] = (evaluated.length > 0 ? evaluated : available.map((m) => Object.assign({}, m, { __sc: scoreCandidate(m) }))).map((c: any) => {
            const sc = c.__sc;
            const isChosen = match?.id === c.id;
            let reason: string | null = null;
            if (!isChosen) {
              if (docHospN && !sc.docOk) reason = "médico diferente do hospital";
              else if (roleHospN && !sc.roleOk) reason = "função diferente";
              else if (routeHospN && !sc.routeOk) reason = "via de acesso diferente";
              else reason = "score inferior ao escolhido";
            }
            return {
              payment_item_id: c.id,
              doctor_name: c.doctor_name ?? null,
              doctor_role: c.doctor_role ?? null,
              access_route: c.access_route ?? null,
              valor_exacta: Number(c.procedure_amount ?? c.gross_amount ?? 0) || 0,
              score: Math.round(sc.score),
              docOk: sc.docOk,
              roleOk: sc.roleOk,
              routeOk: sc.routeOk,
              chosen: isChosen,
              rejected_reason: reason,
            };
          });
          const fields: MatchDiagnosticsField[] = [];
          if (match) {
            const docMed = (match as any).doctor_name ?? null;
            const roleMed = (match as any).doctor_role ?? null;
            const routeMed = (match as any).access_route ?? null;
            const valMed = getConvenioValue(match);
            const cmp = (na: string, nb: string): boolean | null => {
              if (!na || !nb) return null;
              return na === nb;
            };
            const docHospStr = doctor ? String(doctor) : null;
            const roleHospStr = roleHosp ? String(roleHosp) : null;
            const routeHospStr = routeHosp ? String(routeHosp) : null;
            fields.push({ label: "Médico", hospital: docHospStr, exacta: docMed, ok: cmp(docHospN, normName(docMed)) });
            fields.push({ label: "Função", hospital: roleHospStr, exacta: roleMed, ok: cmp(roleHospN, normRole(roleMed)) });
            fields.push({ label: "Via de acesso", hospital: routeHospStr, exacta: routeMed, ok: cmp(routeHospN, normRoute(routeMed)) });
            // Sinaliza data — ok=true quando igual, false quando diferiu ±1 dia
            // (candidato só é considerado se diff ≤1; >1 é rejeitado antes).
            const medDate = onlyDate((match as any).procedure_date);
            const dateOff = match ? (dateOffsetById.get(match.id) ?? 0) : 0;
            fields.push({ label: "Data", hospital: hospDateOnly ?? null, exacta: medDate, ok: hospDateOnly && medDate ? dateOff === 0 : null });
            fields.push({ label: "Valor (convênio)", hospital: formatCurrency(valHosp), exacta: formatCurrency(valMed), ok: Math.abs(valHosp - valMed) < 0.02 });
          }
          return {
            hospital: { doctor: doctor ? String(doctor) : null, role: roleHosp ? String(roleHosp) : null, route: routeHosp ? String(routeHosp) : null, valor: valHosp },
            candidates_total: available.length,
            candidates,
            fields,
            decision,
          };
        };
        const diagnostics = buildDiagnostics();


        const base: Record<string, unknown> = {
          attendance_number: att ? String(Math.round(Number(att)) || att) : null,
          patient_name: patient ? String(patient) : null,
          procedure_code: code ? String(code) : null,
          procedure_name: procName ? String(procName) : null,
          doctor_name: doctor ? String(doctor) : null,
          role: getCell(row, "role") ? String(getCell(row, "role")) : null,
          quantity: qtyHosp || null,
          procedure_date: dateStr,

          valor_hospital: valHosp,
          valor_repasse_acordo: valHospRepasse,
          valor_exacta: 0,
          payment_item_id: null,
          company_name: mappedCompany,
          ia_obs: null,
          status: "so_hospital",
          agreement_text: getCell(row, "agreement") ? String(getCell(row, "agreement")) : null,
          applied_rule_label: null,
          applied_calc_method: null,
          match_diagnostics: diagnostics,
          valor_regra: null,
        };

        if (match) {
          // Quando o match é um item agregado (vários segmentos colapsados),
          // marca TODOS os ids originais como consumidos para não sobrar como "só no Exacta".
          const aggIds = (match as any).__aggregated_ids as string[] | undefined;
          if (aggIds && aggIds.length > 0) {
            for (const aid of aggIds) matchedExactaIds.add(aid);
          } else {
            matchedExactaIds.add(match.id);
          }
          const valMed = getConvenioValue(match);
          base.payment_item_id = match.id;
          base.valor_exacta = valMed;
          if (!base.patient_name) base.patient_name = match.patient_name ?? null;
          if (!base.doctor_name) base.doctor_name = (match as any).doctor_name ?? null;
          if (!base.procedure_name) base.procedure_name = (match as any).procedure_name ?? null;
          if (!base.procedure_date) base.procedure_date = (match as any).procedure_date ?? null;
          if (!base.company_name) base.company_name = match.company_name ?? null;
          if (!base.agreement_text) base.agreement_text = (match as any).agreement_text ?? null;
          base.applied_rule_label = (match as any).applied_rule_label ?? null;
          base.applied_calc_method = (match as any).applied_calc_method ?? null;
          base.valor_regra = lookupExpected(mappedCompany, att, (match as any).doctor_name, code) || (match as any).expected_amount || null;
          // gross_amount = valor PAGO ao médico pós-acordo (ex: base × 200%);
          // procedure_amount fallback é o valor cru de matching. Coluna informativa.
          base.valor_pago_exacta = lookupGross(mappedCompany, att, (match as any).doctor_name, code) || lookupProcedureAmount(mappedCompany, att, (match as any).doctor_name, code) || 0;
          // Sinaliza divergência de data ±1 dia — match aceito, mas analista
          // vê no card/relatório que houve deslocamento (hosp = alta/fatura,
          // Exacta = procedimento; virada de meia-noite no centro cirúrgico).
          const _dateOff = dateOffsetById.get(match.id) ?? 0;
          if (_dateOff === 1) {
            const _medDate = onlyDate((match as any).procedure_date);
            base.ia_obs = `⚠ Data divergente (±1 dia): hospital ${hospDateOnly ?? '—'} vs Exacta ${_medDate ?? '—'} · match aceito`;
          }

          const calcMethod = (match as any).applied_calc_method as string | null;
          const ruleLabel = String((match as any).applied_rule_label ?? '');
          // Soma de todos os irmãos no Exacta com a mesma chave
          // (empresa|atendimento|médico|código) — evita falso divergente
          // quando o Exacta quebra a produção em N linhas qty=1.
          const _matchGross = Number((match as any).gross_amount ?? 0) || 0;
          const _matchExpected = Number((match as any).expected_amount ?? 0) || 0;
          const valBruto = lookupGross(mappedCompany, att, (match as any).doctor_name, code) || _matchGross;
          const valExpected = lookupExpected(mappedCompany, att, (match as any).doctor_name, code) || _matchExpected;

          // === PASSO 3 — Financeiro em 3 ramos pela Regra ===
          // Regra de negócio (decidida com o usuário):
          //   - percentual_sobre_convenio  → compara VALOR (Ramo 2)
          //   - pacote / valor_fixo / tabela_diferenciada / bonus / complemento
          //     / exclusao / regra_vias / qualquer rótulo "Camada 2", "Sem acordo",
          //     "Pacote", "Tabela" → valor NÃO se aplica; só conta se o item
          //     existe nos dois lados e se a QUANTIDADE bate (Ramo 3 / fixo).
          //   - Sem regra alguma → Repasse 100%: compara valor com o bruto (Ramo 1).
          const TOL_ABS = 0.02;
          const matchCalcMethodNorm = String(calcMethod ?? '').toLowerCase().trim().replace(/\s+/g, '_');
          // Fonte de verdade: regra vinculada a (empresa + código). Só recorre
          // ao applied_calc_method do match se o índice de regras estiver vazio.
          const resolvedMethod = lookupCalcMethod(mappedCompany, code) || matchCalcMethodNorm;
          const isPercentRule = (resolvedMethod === 'percentual_convenio' || resolvedMethod === 'percentual_sobre_convenio') && valExpected > 0;
          const isFixed = !!resolvedMethod && FIXED_CALC_METHODS.has(resolvedMethod);

          if (isFixed) {
            // RAMO 3 — VALOR FIXO / PACOTE / TABELA DIFERENCIADA / BÔNUS.
            // Valor NÃO se aplica: o que importa é presença (empresa + atendimento
            // + médico + código TUSS) e quantidade. Impacto financeiro = 0 SEMPRE.
            const qtyMed = Number((match as any).quantity ?? 1) || 1;
            const qtyHospExplicit = Number(String(qtyHosp ?? "").replace(",", ".")) || 0;
            // Sem inferência de quantidade por divisão (valHosp / valExpected):
            // não faz sentido em pacote/fixo. Se a base não traz quantidade
            // explícita, presença já basta para conciliar.
            const qtyOk = qtyHospExplicit === 0 || qtyHospExplicit === qtyMed;

            if (qtyOk) {
              base.status = "conciliado";
              conciliado++;
            } else {
              base.status = "qtd_divergente";
              qtd_divergente++;
              base.ia_obs = `Regra "${calcMethod ?? resolvedMethod}" — valor não comparado (impacto financeiro = 0). Quantidade esperada: ${qtyMed}; hospital: ${qtyHospExplicit}. Divergência é de quantidade de atendimentos, não de valor.`;
              // NÃO acumular divergencia_valor, risco_mais ou risco_menos:
              // regras estruturais nunca geram divergência financeira.
            }
          } else if (isPercentRule) {
            // RAMO 2 — ACORDO COM % — esperado já calculado pela engine.
            // Comparar o que o Exacta PAGOU (gross_amount, pós-multiplicador)
            // contra o expected_amount. procedure_amount é o valor CRU do
            // convênio (base de matching, igual ao hospital) e gera falso
            // divergente se usado como _pago aqui.
            const _pago = lookupGross(mappedCompany, att, (match as any).doctor_name, code)
              || lookupExpected(mappedCompany, att, (match as any).doctor_name, code)
              || lookupProcedureAmount(mappedCompany, att, (match as any).doctor_name, code)
              || valHosp;
            const diff = _pago - valExpected;
            base.diferenca_regra = diff;
            if (Math.abs(diff) < TOL_ABS) {
              base.status = "conciliado";
              conciliado++;
            } else {
              base.status = "valor_divergente";
              valor_divergente++;
              const pct = Math.abs(valExpected) > TOL_ABS ? (diff / valExpected) * 100 : 0;
              const pctTxt = Math.abs(valExpected) > TOL_ABS ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'n/a (esperado ≈ 0)';
              const ambigPrefix = ambiguous ? `⚠ Match ambíguo — confira manualmente. ` : '';
              base.ia_obs = `${ambigPrefix}Regra com % (${ruleLabel || calcMethod}). Esperado: ${formatCurrency(valExpected)} (bruto ${formatCurrency(valBruto)}). Hospital pagou ${formatCurrency(_pago)}. Diferença: ${formatCurrency(Math.abs(diff))} (${pctTxt}).`;
              divergencia_valor += Math.abs(diff);
              if (diff > 0) risco_mais += diff;
              else risco_menos += Math.abs(diff);
            }
          } else {
            // Pre-check: se Exacta e hospital já concordam no valor pago,
            // não faz sentido comparar contra um bruto de referência
            // inaplicável ("Camada 2 — Sem acordo", tabela_diferenciada/
            // valor_fixo sem expected calculado). Os dois sistemas
            // concordam → conciliado.
            const _pagoRamo1 = lookupProcedureAmount(mappedCompany, att, (match as any).doctor_name, code) || valHosp;
            if (Math.abs(_pagoRamo1 - valHosp) < TOL_ABS) {
              base.status = "conciliado";
              base.ia_obs = `Exacta (${formatCurrency(_pagoRamo1)}) e hospital (${formatCurrency(valHosp)}) iguais — produção e pagamento consistentes.`;
              conciliado++;
            } else {
              // RAMO 1 — REPASSE 100% — esperado = bruto (sem regra ou regra
              // que mantém o bruto). É aqui que o número-chave bate em ~90%
              // dos casos; divergência aqui é REAL — não suavizar.
              const ref = valBruto > 0 ? valBruto : valMed; // fallback para a tabela convênio
              const _pago = _pagoRamo1;
              const diff = _pago - ref;
              if (Math.abs(ref) < TOL_ABS) {
                // Blindagem: bruto ≈ 0 e há valor pago → sinaliza sem calcular %.
                if (Math.abs(_pago) < TOL_ABS) {
                  base.status = "conciliado";
                  conciliado++;
                } else {
                  base.status = "valor_divergente";
                  valor_divergente++;
                  base.ia_obs = `Repasse 100% — bruto ≈ 0 na Exacta mas hospital pagou ${formatCurrency(_pago)}. Conferir item sem cobertura na tabela convênio.`;
                  divergencia_valor += Math.abs(_pago);
                  risco_mais += _pago;
                }
              } else if (Math.abs(diff) < TOL_ABS) {
                base.status = "conciliado";
                conciliado++;
              } else {
                base.status = "valor_divergente";
                valor_divergente++;
                const pct = (diff / ref) * 100;
                const ambigPrefix = ambiguous ? `⚠ Match ambíguo — confira manualmente. ` : '';
                base.ia_obs = `${ambigPrefix}Repasse 100% (sem regra de %) — esperado = bruto ${formatCurrency(ref)}. Hospital pagou ${formatCurrency(_pago)}. Diferença: ${formatCurrency(Math.abs(diff))} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%). Divergência real entre tabelas.`;
                divergencia_valor += Math.abs(diff);
                if (diff > 0) risco_mais += diff;
                else risco_menos += Math.abs(diff);
              }
            }
          }

        } else if (companyMissing) {
          base.status = "empresa_ausente";
          base.ia_obs = `Empresa "${mappedCompany}" não existe no lote Exacta. Verifique vínculo de empresa ou se o lote está completo.`;
          empresa_ausente++;
        } else if (attMissing) {
          base.status = "so_hospital";
          base.ia_obs = `Linha do hospital sem nº de atendimento — não foi possível cruzar com a Exacta.`;
          so_hospital++;
          risco_mais += valHosp;
        } else {
          // Sem match na Exacta para este (empresa+atendimento+código).
          // Antes de classificar como "só hospital" (com risco), consulta a
          // regra vinculada a (empresa+código). Se for PACOTE e o atendimento
          // já tem cirurgião principal pago via pacote, este código é
          // componente embutido (auxiliar, anestesia, visita, parecer) — NÃO
          // é só hospital e NÃO gera risco financeiro. Se for FIXO/TABELA/
          // BÔNUS, trata como qtd_divergente sem impacto financeiro.
          const resolvedMethod = lookupCalcMethod(mappedCompany, code);
          const isFixedNoMatch = !!resolvedMethod && FIXED_CALC_METHODS.has(resolvedMethod);
          const attendanceIsPackage = isPackageAttendance(mappedCompany, att);
          const codeIsPackageMember = isPackageMember(mappedCompany, code);
          if (attendanceIsPackage || codeIsPackageMember) {
            base.status = "conciliado";
            base.applied_calc_method = resolvedMethod || "pacote";
            base.ia_obs = codeIsPackageMember
              ? `Código TUSS ${code} listado em package_included_codes do pacote desta empresa (${mappedCompany}) — componente embutido, sem pagamento separado. Sem impacto financeiro.`
              : `Componente embutido em PACOTE — atendimento ${att} (empresa ${mappedCompany}) consolidado no pagamento do principal via regra de pacote. Sem impacto financeiro.`;
            conciliado++;
          } else if (isFixedNoMatch) {
            base.status = "so_hospital";
            base.applied_calc_method = resolvedMethod;
            base.ia_obs = `Regra "${resolvedMethod}" — TUSS ${code} presente no hospital mas AUSENTE no Exacta para a empresa ${mappedCompany}. Regra estrutural: valor não comparado. Verificar se houve omissão de pagamento.`;
            so_hospital++;
          } else {
            base.status = "so_hospital";
            base.ia_obs = `Item de ${mappedCompany} (atendimento ${att}, TUSS ${code}) presente no extrato hospitalar mas ausente na base Exacta para esta empresa.`;
            so_hospital++;
            risco_mais += valHosp;
          }
        }
        toInsert.push(base);
      }

      // Sobra do Exacta: itens carregados em exactaItemsForRun (já filtrados na
      // query por currentMappedCompanies) que NÃO foram casados em nenhuma
      // linha do hospital. Não aplicamos guarda redundante por company_name
      // aqui — a query já garantiu o escopo, e a guarda extra estava
      // descartando indevidamente itens cujo company_name no payment_items
      // tem alguma diferença sutil em relação ao valor mapeado (acentos,
      // espaços, alias canônico vs alias do contrato), deixando o card
      // "Só Exacta" vazio.
      let leftoverConsidered = 0;
      let leftoverSkipped = 0;
      for (const it of exactaItemsForRun) {
        if (matchedExactaIds.has(it.id)) { leftoverSkipped++; continue; }
        leftoverConsidered++;
        const valMed = Number((it as any).procedure_amount ?? (it as any).gross_amount ?? 0);
        const itCompNorm = normCompany(it.company_name);
        // Se a empresa deste item Exacta nem aparece na base do hospital,
        // classifica como "empresa_ausente" (card próprio) — evita poluir o
        // só_exacta, que é reservado para itens isolados dentro de empresas
        // que existem nos dois lados.
        const isEmpresaAusente = hospitalCompanySet.size > 0 && itCompNorm !== ""
          && !hospitalCompanySet.has(itCompNorm);

        // === INTELIGÊNCIA — Pacote de honorário ===
        // Regra de negócio (Rede D'Or):
        //  • A base de produção é extraída ~30 dias DEPOIS da base de pagamento
        //    (Exacta). Nesse intervalo, o faturamento pode consolidar várias
        //    linhas (cirurgião principal + auxiliares + anestesista, mesmo
        //    atendimento) em um ÚNICO pacote pago ao cirurgião principal.
        //  • Sintoma típico: na Exacta o atendimento tem 4-8 linhas; na produção,
        //    o MESMO atendimento aparece com 1-2 linhas (só o principal).
        //  • Se o atendimento EXISTE na produção mas esta linha Exacta ficou
        //    órfã, NÃO é "só Exacta = possível glosa". É forte indício de
        //    pacote de honorário consolidado. Categoria informacional, sem
        //    impacto em "risco menos" (não foi perdido — foi reagrupado).
        //  • Se o atendimento NÃO existe na produção, aí sim é só_exacta de
        //    verdade (chave inicial atendimento+médico+data não bate → glosa
        //    ou divergência de cadastro real).
        const attNorm = it.attendance_number ? normAtt(it.attendance_number) : "";
        const isPacote = !isEmpresaAusente && attNorm !== "" && hospitalAttendances.has(attNorm);

        let status: ReconciliationItem["status"];
        let obs: string;
        if (isEmpresaAusente) {
          status = "empresa_ausente";
          obs = `Empresa "${it.company_name ?? "?"}" tem itens no Exacta mas não aparece no extrato do hospital — verifique se a empresa foi mapeada na importação.`;
        } else if (isPacote) {
          status = "possivel_pacote";
          obs = `Atendimento ${it.attendance_number} consta na produção (cirurgião principal pago), mas a linha de ${(it as any).doctor_name ?? "este profissional"} (${(it as any).doctor_role ?? "função?"}, TUSS ${it.procedure_code ?? "?"}, ${formatCurrency(valMed)}) não. Forte indício de PACOTE DE HONORÁRIO consolidado pelo faturamento após a extração do pagamento — o honorário desta equipe pode ter sido reagrupado em pagamento único ao principal. Conferir se há risco de pagar a mais.`;
        } else {
          status = "so_exacta";
          obs = `Atendimento ${it.attendance_number ?? "?"} (médico ${(it as any).doctor_name ?? "?"}, TUSS ${it.procedure_code ?? "?"}) presente no Exacta mas NÃO existe no extrato hospitalar — chave inicial (atendimento+médico+data) não bate. Verificar glosa, cancelamento ou divergência de cadastro.`;
        }

        toInsert.push({
          payment_item_id: it.id,
          attendance_number: it.attendance_number ?? null,
          patient_name: it.patient_name ?? null,
          procedure_code: it.procedure_code ?? null,
          procedure_name: (it as any).procedure_name ?? null,
          doctor_name: (it as any).doctor_name ?? null,
          procedure_date: (it as any).procedure_date ?? null,
          valor_exacta: valMed,
          valor_hospital: 0,
          company_name: it.company_name ?? null,
          agreement_text: (it as any).agreement_text ?? null,
          status,
          ia_obs: obs,
          valor_regra: (it as any).expected_amount ?? null,
        });
        if (status === "empresa_ausente") {
          empresa_ausente++;
        } else if (status === "possivel_pacote") {
          possivel_pacote++;
          // NÃO conta em risco_menos: é informacional, não perda confirmada.
        } else {
          so_exacta++;
          risco_menos += valMed;
        }
      }
      console.log('[Cruzamento] Sobra Exacta:', { exactaTotal: exactaItemsForRun.length, matched: matchedExactaIds.size, considered: leftoverConsidered, alreadyMatched: leftoverSkipped, so_exacta, possivel_pacote, empresa_ausente });



      // Modo "merge": preserva itens da última run para empresas que NÃO estão
      // neste arquivo, copiando-os para a nova run. Assim, ao reconciliar
      // apenas uma empresa, as demais não somem do painel geral.
      if (mode === "merge_keep_others" && run?.id) {
        const prevAll: ReconciliationItem[] = [];
        const pageSize = 1000;
        for (let from = 0; from < 50000; from += pageSize) {
          const { data: page, error: pageErr } = await (supabase as any)
            .from("reconciliation_items")
            .select("*")
            .eq("run_id", run.id)
            .range(from, from + pageSize - 1);
          if (pageErr) throw pageErr;
          const rows = (page ?? []) as ReconciliationItem[];
          prevAll.push(...rows);
          if (rows.length < pageSize) break;
        }
        const keep = prevAll.filter(
          (it) => !currentMappedCompanies.has(it.company_name ?? ""),
        );
        for (const it of keep) {
          const { id: _id, run_id: _rid, created_at: _ca, ...rest } = it as any;
          toInsert.push(rest);
          if (it.status === "conciliado") conciliado++;
          else if (it.status === "valor_divergente") valor_divergente++;
          else if (it.status === "qtd_divergente") qtd_divergente++;
          else if (it.status === "so_hospital") {
            so_hospital++;
            risco_mais += Number(it.valor_hospital) || 0;
          } else if (it.status === "so_exacta") {
            so_exacta++;
            risco_menos += Number(it.valor_exacta) || 0;
          } else if (it.status === "empresa_ausente") {
            empresa_ausente++;
          } else if (it.status === "possivel_pacote") {
            possivel_pacote++;
          }
          if (it.status === "valor_divergente") {
            const d = (Number(it.valor_hospital) || 0) - (Number(it.valor_exacta) || 0);
            divergencia_valor += Math.abs(d);
            if (d > 0) risco_mais += d;
            else risco_menos += Math.abs(d);
          }
        }
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
          so_exacta,
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

  /**
   * Reprocessa a conciliação atual sem precisar de novo upload.
   * Reconstrói as "linhas do hospital" a partir dos `reconciliation_items`
   * da última run (que já preservam doctor/role/quantity/valor/via via
   * match_diagnostics.hospital). Útil quando o motor/regras mudaram ou
   * quando vínculos manuais foram salvos como alias e o usuário só quer
   * que a UI volte a rodar o matching estrito.
   */
  /**
   * Reatribui company_name dos payment_items para a PJ ATUAL do médico (doctor_companies.end_date IS NULL).
   * Cenário: médico migrou de SORT para COB, mas a Exacta importada continua marcada com SORT,
   * fazendo o cruzamento jogar tudo como "Só no Exacta". Esta ação corrige o cadastro do item
   * de forma definitiva — após rodar, é necessário "Reprocessar" para refletir na conciliação.
   */
  const handleReassignMigratedDoctors = async () => {
    if (!paymentId) return;
    try {
      setProcessing(true);
      const { data: pis, error: piErr } = await (supabase as any)
        .from("payment_items")
        .select("id, doctor_id, company_name")
        .eq("payment_id", paymentId)
        .not("doctor_id", "is", null);
      if (piErr) throw piErr;
      const rows = (pis ?? []) as Array<{ id: string; doctor_id: string; company_name: string | null }>;
      const doctorIds = Array.from(new Set(rows.map((r) => r.doctor_id).filter(Boolean)));
      if (doctorIds.length === 0) {
        toast({ title: "Sem médicos com cadastro", description: "Nenhum item tem doctor_id resolvido — reatribuição precisa de vínculo canônico." });
        return;
      }
      const { data: dcs, error: dcErr } = await (supabase as any)
        .from("doctor_companies")
        .select("doctor_id, company_id, start_date, end_date")
        .in("doctor_id", doctorIds)
        .is("end_date", null);
      if (dcErr) throw dcErr;
      const activeByDoctor = new Map<string, string>();
      for (const dc of (dcs ?? []) as Array<{ doctor_id: string; company_id: string; start_date: string | null }>) {
        const prev = activeByDoctor.get(dc.doctor_id);
        if (!prev) { activeByDoctor.set(dc.doctor_id, dc.company_id); }
      }
      if (activeByDoctor.size === 0) {
        toast({ title: "Sem vínculos ativos", description: "Nenhum médico tem PJ ativa em doctor_companies.", variant: "destructive" });
        return;
      }
      const companyIds = Array.from(new Set(Array.from(activeByDoctor.values())));
      const { data: comps, error: cErr } = await (supabase as any)
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      if (cErr) throw cErr;
      const compNameById = new Map<string, string>();
      for (const c of (comps ?? []) as Array<{ id: string; name: string }>) compNameById.set(c.id, c.name);

      const normCompany = (s: string | null | undefined) =>
        String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();

      const updates: Array<{ id: string; from: string; to: string }> = [];
      for (const r of rows) {
        const activeCompanyId = activeByDoctor.get(r.doctor_id);
        if (!activeCompanyId) continue;
        const newName = compNameById.get(activeCompanyId);
        if (!newName) continue;
        if (normCompany(r.company_name) === normCompany(newName)) continue;
        updates.push({ id: r.id, from: r.company_name ?? "(vazio)", to: newName });
      }
      if (updates.length === 0) {
        toast({ title: "Nada a reatribuir", description: "Todos os itens já estão na PJ atual do médico." });
        return;
      }
      const preview = new Map<string, number>();
      for (const u of updates) {
        const key = `${u.from} → ${u.to}`;
        preview.set(key, (preview.get(key) ?? 0) + 1);
      }
      const previewText = Array.from(preview.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => `• ${k}: ${v} item(ns)`)
        .join("\n");
      const ok = await confirmDialog({
        tone: "warning",
        title: "Reatribuir PJ com base no cadastro atual",
        description: `${updates.length} item(ns) terão a empresa alterada de forma definitiva conforme a PJ vinculada ao médico hoje (doctor_companies). Após confirmar, clique em "Reprocessar agora" para refletir na conciliação.`,
        details: previewText,
        confirmText: "Reatribuir",
      });
      if (!ok) return;

      const byTarget = new Map<string, string[]>();
      for (const u of updates) {
        const arr = byTarget.get(u.to) ?? [];
        arr.push(u.id);
        byTarget.set(u.to, arr);
      }
      for (const [target, ids] of byTarget) {
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error: uErr } = await (supabase as any)
            .from("payment_items")
            .update({ company_name: target })
            .in("id", chunk);
          if (uErr) throw uErr;
        }
      }
      toast({
        title: "Reatribuição concluída",
        description: `${updates.length} item(ns) atualizado(s). Clique em "Reprocessar agora" para rodar o cruzamento.`,
      });
    } catch (e: any) {
      console.error("[Reatribuição PJ migrada]", e);
      toast({ title: "Erro", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const handleReprocessFromCurrent = async () => {
    if (!run?.id || items.length === 0) {
      toast({
        title: "Nada para reprocessar",
        description: "Não há uma conciliação atual carregada.",
        variant: "destructive",
      });
      return;
    }
    // Só considera linhas que vieram do hospital (ignora "só Exacta" e
    // "possível pacote", que são reinferidas naturalmente no matching).
    // CRÍTICO: itens com valor_hospital <= 0 NÃO representam linha real do
    // hospital — são candidatos derivados do Exacta (so_exacta, possivel_pacote,
    // ou casos onde o hospital não pagou). Reconstruí-los como linhas do
    // hospital infla a quantidade agregada (cada um adiciona +1 ao qtySum do
    // mesmo médico/ato), causando o efeito de qty dobrando a cada reprocesso.
    const hospitalItems = items.filter(
      (it) =>
        it.status !== "so_exacta" &&
        it.status !== "possivel_pacote" &&
        Number(it.valor_hospital ?? 0) > 0,
    );
    const soExactaCount = items.length - hospitalItems.length;
    if (hospitalItems.length === 0) {
      toast({
        title: "Sem linhas do hospital",
        description: "A conciliação atual não tem itens para recruzar.",
        variant: "destructive",
      });
      return;
    }
    // AVISO crítico: o "Reprocessar" reusa apenas linhas que já tiveram match
    // com o hospital — itens "só Exacta" da run anterior são DESCARTADOS.
    // Para revisitar esses casos (ex.: terceiro re-mapeado, alias novo, regra
    // que mudou), o analista precisa rodar uma "Nova conciliação" do zero,
    // que volta a ler a planilha hospital + base Exacta atual.
    if (soExactaCount > 0) {
      const ok = await confirmDialog({
        tone: "warning",
        title: "Reprocessar conciliação atual",
        description: (
          <>
            Esta ação recruza apenas os <b>{hospitalItems.length}</b> itens que já tiveram correspondência com o hospital.
            <br /><br />
            Os <b>{soExactaCount}</b> itens "só no Exacta" serão <b>descartados</b> — eles não voltam a ser testados contra a planilha hospital.
            <br /><br />
            Se você quer revisar itens "só Exacta" (ex.: terceiro re-mapeado, alias novo), cancele e use <b>"Nova conciliação"</b> para recarregar a planilha do hospital do zero.
          </>
        ),
        confirmText: "Reprocessar mesmo assim",
        cancelText: "Cancelar",
      });
      if (!ok) return;
    }


    const colMap: Record<string, string> = {
      company: "__company",
      attendance: "__att",
      procCode: "__code",
      value: "__valor",
      patient: "__patient",
      doctor: "__doctor",
      procName: "__procName",
      date: "__date",
      role: "__role",
      quantity: "__qty",
      accessRoute: "__route",
      agreement: "__agreement",
    };

    const rows: Record<string, unknown>[] = hospitalItems.map((it) => {
      const hospDiag = it.match_diagnostics?.hospital;
      const qExacta = it.payment_item_id ? exactaQtyById.get(it.payment_item_id) : null;
      const qHospitalRaw = (it as any).quantity;
      const qHospital = qHospitalRaw == null ? null : Number(qHospitalRaw);
      const valueMatches = Math.abs(Number(it.valor_hospital ?? 0) - Number(it.valor_exacta ?? 0)) < 0.02;
      const inflatedQty =
        qExacta != null &&
        qHospital != null &&
        Number.isFinite(Number(qExacta)) &&
        Number.isFinite(qHospital) &&
        qHospital > Number(qExacta) &&
        valueMatches;
      return {
        __company: it.company_name ?? "",
        __att: it.attendance_number ?? "",
        __code: it.procedure_code ?? "",
        __valor: it.valor_hospital ?? 0,
        __patient: it.patient_name ?? "",
        __doctor: hospDiag?.doctor ?? it.doctor_name ?? "",
        __procName: it.procedure_name ?? "",
        __date: it.procedure_date ?? "",
        __role: hospDiag?.role ?? (it as any).role ?? "",
        __qty: inflatedQty ? Number(qExacta) : (qHospitalRaw ?? ""),
        __route: hospDiag?.route ?? "",
        __agreement: it.agreement_text ?? "",
      };
    });

    // Mapping de empresa: identidade (já é o nome canônico no lote).
    const mapping: Record<string, string> = {};
    for (const it of hospitalItems) {
      const c = it.company_name ?? "";
      if (c) mapping[c] = c;
    }

    await handleProcessReconciliation("replace", {
      rows,
      colMap,
      mapping,
      fileName: run.file_name ?? "reprocessamento",
      excludeConsultas: false, // linhas já vieram filtradas
    });
  };



  const doctorOptions = useMemo(() => {
    let base = initialCompany
      ? items.filter((it) => (it.company_name ?? "") === initialCompany)
      : items;
    if (companyFilter !== "todos") {
      base = base.filter((it) => (it.company_name ?? "") === companyFilter);
    }
    return Array.from(new Set(base.map((i) => i.doctor_name ?? "").filter(Boolean))).sort();
  }, [items, initialCompany, companyFilter]);

  const companyOptions = useMemo(() => {
    return Array.from(new Set(items.map((i) => i.company_name ?? "").filter(Boolean))).sort();
  }, [items]);

  // Escopo = todos os filtros EXCETO o activeFilter (tabs/KPIs por status).
  // KPIs, totais financeiros, contagens das abas e exportações recalculam
  // sobre este escopo — assim a tela "se comporta conforme filtro".
  const scopedItems = useMemo(() => {
    let base = items;
    if (initialCompany) {
      base = base.filter((it) => (it.company_name ?? "") === initialCompany);
    }
    if (companyFilter !== "todos") {
      base = base.filter((it) => (it.company_name ?? "") === companyFilter);
    }
    if (doctorFilter !== "todos") {
      base = base.filter((it) => (it.doctor_name ?? "") === doctorFilter);
    }
    const min = minValue ? parseFloat(minValue.replace(",", ".")) : null;
    const max = maxValue ? parseFloat(maxValue.replace(",", ".")) : null;
    if (min !== null && !Number.isNaN(min)) {
      base = base.filter((it) => Math.max(Number(it.valor_exacta), Number(it.valor_hospital)) >= min);
    }
    if (max !== null && !Number.isNaN(max)) {
      base = base.filter((it) => Math.max(Number(it.valor_exacta), Number(it.valor_hospital)) <= max);
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
  }, [items, initialCompany, companyFilter, doctorFilter, minValue, maxValue, searchTerm]);

  // ============================================================
  // Bucket derivado (Fase 1, sem migration) — "Outra competência".
  // ------------------------------------------------------------
  // Itens hoje classificados como `so_exacta` mas cuja `procedure_date`
  // cai FORA dos meses cobertos pela base TASY carregada nesta run
  // não são "ausente TASY" reais — são apenas de outra competência.
  //
  //  • baseMonthsCarregada  → meses efetivamente presentes na base cruzada
  //                           (derivados dos itens que TIVERAM linha do
  //                           hospital: so_hospital / conciliado / *divergente).
  //  • baseMonthsAll        → meses com base TASY existente no hospital
  //                           (concBases carregado no open do modal).
  //
  // Sub-rótulo:
  //   - "aguardando"  → a base para aquele mês nunca foi importada.
  //   - "disponivel"  → a base existe, mas não foi carregada nesta run.
  //
  // Se baseMonthsCarregada estiver vazio (run sem lado hospital), NÃO
  // reclassifica nada — falta de sinal para decidir.
  // ============================================================
  const outraCompetenciaBuckets = useMemo(() => {
    const buckets = new Map<string, "aguardando" | "disponivel">();
    const baseMonthsCarregada = new Set<string>();
    for (const it of items) {
      const s = it.status;
      if (s === "so_hospital" || s === "conciliado" || s === "valor_divergente" || s === "qtd_divergente") {
        const d = it.procedure_date ? String(it.procedure_date).slice(0, 7) : "";
        if (d) baseMonthsCarregada.add(d);
      }
    }
    if (baseMonthsCarregada.size === 0) return buckets;
    const baseMonthsAll = new Set<string>(
      (concBases ?? [])
        .map((b) => String(b?.competence_month ?? "").slice(0, 7))
        .filter(Boolean),
    );
    for (const it of items) {
      if (it.status !== "so_exacta") continue;
      const m = it.procedure_date ? String(it.procedure_date).slice(0, 7) : "";
      if (!m || baseMonthsCarregada.has(m)) continue;
      buckets.set(it.id, baseMonthsAll.has(m) ? "disponivel" : "aguardando");
    }
    return buckets;
  }, [items, concBases]);

  const scopedStats = useMemo(() => {
    let conciliado = 0, valor_divergente = 0, qtd_divergente = 0, so_hospital = 0, so_exacta = 0, empresa_ausente = 0, possivel_pacote = 0;
    let outra_competencia = 0, outra_competencia_aguardando = 0, outra_competencia_disponivel = 0;
    let risco_mais = 0, risco_menos = 0, divergencia_valor = 0;
    let diferenca_total = 0;
    let cancelado_conc = 0;
    for (const it of scopedItems) {
      // Item cancelado via conciliação: analista pactou que a cobrança do Exacta
      // não procede. Conta como "conciliado" (Exacta efetivo = 0), zera risco
      // e não entra em nenhuma aba de divergência.
      if ((it as any).action_taken === "cancelado_conciliacao") {
        conciliado++;
        cancelado_conc++;
        continue;
      }
      // Reclassificação virtual (não persistida): so_exacta cuja data cai fora
      // da(s) competência(s) cobertas pela base carregada vira "outra_competencia".
      const bucket = it.status === "so_exacta" ? outraCompetenciaBuckets.get(it.id) : undefined;
      if (bucket) {
        outra_competencia++;
        if (bucket === "aguardando") outra_competencia_aguardando++;
        else outra_competencia_disponivel++;
        continue; // não conta como so_exacta nem soma risco_menos.
      }
      if (it.status === "conciliado") conciliado++;
      else if (it.status === "valor_divergente") valor_divergente++;
      else if (it.status === "qtd_divergente") qtd_divergente++;
      else if (it.status === "so_hospital") so_hospital++;
      else if (it.status === "so_exacta") so_exacta++;
      else if (it.status === "empresa_ausente") empresa_ausente++;
      else if (it.status === "possivel_pacote") possivel_pacote++;
      const vm = Number(it.valor_exacta) || 0;
      const vh = Number(it.valor_hospital) || 0;
      if (it.status === "valor_divergente") {
        const diff = vh - vm;
        divergencia_valor += Math.abs(diff);
        if (diff > 0) risco_mais += diff; else risco_menos += Math.abs(diff);
        const dr = (it as any).diferenca_regra;
        if (typeof dr === "number" && Number.isFinite(dr)) {
          diferenca_total += dr;
        } else {
          const vpe = Number((it as any).valor_pago_exacta);
          const vr = Number(it.valor_regra);
          if (Number.isFinite(vpe) && Number.isFinite(vr)) {
            diferenca_total += vpe - vr;
          }
        }
      } else if (it.status === "qtd_divergente") {
        const vr = Number(it.valor_regra) || 0;
        if (vr > 0) {
          const diff = vh - vr;
          divergencia_valor += Math.abs(diff);
          if (diff > 0) risco_mais += diff; else risco_menos += Math.abs(diff);
        }
      } else if (it.status === "so_hospital") {
        risco_mais += vh;
      } else if (it.status === "so_exacta") {
        risco_menos += vm;
      }
      // possivel_pacote: informacional — não entra em risco_mais nem risco_menos.
    }
    return {
      total: scopedItems.length,
      conciliado, valor_divergente, qtd_divergente, so_hospital, so_exacta, empresa_ausente, possivel_pacote,
      outra_competencia, outra_competencia_aguardando, outra_competencia_disponivel,
      cancelado_conc,
      risco_mais, risco_menos, divergencia_valor, diferenca_total,
    };
  }, [scopedItems, outraCompetenciaBuckets]);


  const filteredItems = useMemo(() => {
    if (activeFilter === "todos") return scopedItems;
    if (activeFilter === "conciliado") {
      return scopedItems.filter(
        (it) => it.status === "conciliado" || (it as any).action_taken === "cancelado_conciliacao",
      );
    }
    // Filtro virtual: itens de outra competência (reclassificados a partir de so_exacta).
    if (activeFilter === "outra_competencia") {
      return scopedItems.filter((it) => outraCompetenciaBuckets.has(it.id));
    }
    // Ao filtrar por "so_exacta" na barra, exclui os itens promovidos para "outra_competencia".
    if (activeFilter === "so_exacta") {
      return scopedItems.filter(
        (it) => it.status === "so_exacta"
          && !outraCompetenciaBuckets.has(it.id)
          && (it as any).action_taken !== "cancelado_conciliacao",
      );
    }
    return scopedItems.filter(
      (it) => it.status === activeFilter && (it as any).action_taken !== "cancelado_conciliacao",
    );
  }, [scopedItems, activeFilter, outraCompetenciaBuckets]);


  // Sempre que mudam filtros/escopo/pageSize, zera o "mostrar mais" por
  // empresa para não acumular DOM com a base anterior.
  useEffect(() => {
    setPageByCompany({});
  }, [searchTerm, doctorFilter, companyFilter, minValue, maxValue, activeFilter, pageSize, initialCompany, items.length]);


  const hasExtraFilters = !!(searchTerm || doctorFilter !== "todos" || companyFilter !== "todos" || minValue || maxValue);
  const isScoped = !!initialCompany || hasExtraFilters;
  const clearExtraFilters = () => {
    setSearchTerm("");
    setDoctorFilter("todos");
    setCompanyFilter("todos");
    setMinValue("");
    setMaxValue("");
  };

  /**
   * Nome de arquivo padronizado para exportações:
   *   conciliacao_<hospital>_<empresa>_<paymentRef>_<idCurto>_<YYYY-MM-DD>.<ext>
   * Quando não houver escopo de empresa, usa "todas-empresas". Slugifica
   * acentos e espaços para evitar problemas de download em qualquer SO.
   */
  const buildExportFileName = (ext: "pdf" | "csv" | "xlsx") => {
    const slug = (s: string | null | undefined) =>
      (s ?? "")
        .toString()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 40) || "na";
    const today = new Date().toISOString().slice(0, 10);
    const hospPart = slug(hospital?.slug || hospital?.name || "rededor");
    const companyPart = slug(initialCompany || (companyFilter !== "todos" ? companyFilter : "todas-empresas"));
    const refPart = slug(paymentReference);
    const idPart = (paymentId || "").slice(0, 8) || "noid";
    return `conciliacao_${hospPart}_${companyPart}_${refPart}_${idPart}_${today}.${ext}`;
  };

  // Helper para formatar quantidade (Exacta vem de exactaQtyById; hospital de it.quantity).
  const fmtQty = (q: number | null | undefined): string => {
    if (q == null || !Number.isFinite(Number(q))) return "";
    const n = Number(q);
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
  };
  const getQtyExacta = (it: ReconciliationItem): number | null => {
    const raw = it.payment_item_id ? exactaQtyById.get(it.payment_item_id) : null;
    return raw == null ? null : Number(raw);
  };
  const getQtyHospital = (it: ReconciliationItem): number | null => {
    const q = (it as { quantity?: number | null }).quantity;
    return q == null ? null : Number(q);
  };

  // Calcula "Diferença Regra" no mesmo critério da UI (DataGrid):
  // prioriza (valor_pago_exacta − valor_regra); fallback para
  // diferenca_regra persistido; nulo quando nada é comparável.
  const computeDiffRegra = (it: ReconciliationItem): number | null => {
    const vr = it.valor_regra != null ? Number(it.valor_regra) : null;
    const vpe = Number((it as unknown as { valor_pago_exacta?: number | null }).valor_pago_exacta) || 0;
    if (vr != null && vpe > 0) return Number((vpe - vr).toFixed(2));
    if (it.diferenca_regra != null) return Number(it.diferenca_regra);
    return null;
  };

  const handleExportXlsx = (itemsToExport: ReconciliationItem[], scopeLabel: string) => {
    if (!run) return;

    const data = itemsToExport.map((it) => {
      const vra = (it as unknown as { valor_repasse_acordo?: number | null }).valor_repasse_acordo;
      const vpe = (it as unknown as { valor_pago_exacta?: number | null }).valor_pago_exacta;
      const dr = computeDiffRegra(it);
      return {
        "Status": STATUS_LABEL[it.status],
        "Empresa": it.company_name ?? "",
        "Médico": it.doctor_name ?? "",
        "Paciente": it.patient_name ?? "",
        "Atendimento": it.attendance_number ?? "",
        "Cód. TUSS": it.procedure_code ?? "",
        "Procedimento": it.procedure_name ?? "",
        "Qtd Exacta": fmtQty(getQtyExacta(it)),
        "Qtd Hospital": fmtQty(getQtyHospital(it)),
        "Data": it.procedure_date ? formatDateBR(it.procedure_date) : "",
        "Convênio": it.agreement_text ?? "",
        "Exacta (R$)": Number(it.valor_exacta),
        "Hospital (R$)": Number(it.valor_hospital),
        "Valor Acordo (R$)": vra != null ? Number(vra) : "",
        "Valor Pago (R$)": vpe != null ? Number(vpe) : "",
        "Valor Regra (R$)": it.valor_regra != null ? Number(it.valor_regra) : "",
        "Diferença Regra (R$)": dr != null ? dr : "",
        "Diferença Bruta (R$)": Number((it.valor_hospital - it.valor_exacta).toFixed(2)),
        "Regra Exacta": it.applied_rule_label ?? "",
        "Método Cálculo": it.applied_calc_method ?? "",
        "Observação IA": it.ia_obs ?? "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);

    ws["!cols"] = [
      { wch: 18 }, { wch: 38 }, { wch: 30 }, { wch: 30 }, { wch: 14 },
      { wch: 14 }, { wch: 48 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
      { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
      { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 36 }, { wch: 20 }, { wch: 60 },
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
      'Quantidade divergente': 'FFFBEB',
      'Só no hospital': 'FEF2F2',
      'Só no Exacta': 'EFF6FF',
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
    else if (companyFilter !== "todos") filterDescParts.push(`Empresa: ${companyFilter}`);
    if (doctorFilter !== "todos") filterDescParts.push(`Médico: ${doctorFilter}`);
    if (activeFilter !== "todos") filterDescParts.push(`Status: ${STATUS_LABEL[activeFilter as ReconciliationItem["status"]] ?? activeFilter}`);
    if (searchTerm) filterDescParts.push(`Busca: "${searchTerm}"`);
    if (minValue) filterDescParts.push(`Valor mín: ${minValue}`);
    if (maxValue) filterDescParts.push(`Valor máx: ${maxValue}`);
    filterDescParts.push(`Recorte exportação: ${scopeLabel}`);
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
      ["Quantidade divergente", scopedStats.qtd_divergente],
      ["Só no hospital", scopedStats.so_hospital],
      ["Só no Exacta", scopedStats.so_exacta],
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

    XLSX.writeFile(wb, buildExportFileName("xlsx"));
    toast({ title: "Relatório exportado", description: "Arquivo XLSX gerado com sucesso." });
  };

  const handleExportCsv = (itemsToExport: ReconciliationItem[], _scopeLabel: string) => {
    if (!run) return;

    const headers = [
      "Status", "Empresa", "Médico", "Paciente", "Atendimento",
      "Cód. TUSS", "Procedimento", "Qtd Exacta", "Qtd Hospital", "Data", "Convênio",
      "Exacta (R$)", "Hospital (R$)",
      "Valor Acordo (R$)", "Valor Pago (R$)", "Valor Regra (R$)",
      "Diferença Regra (R$)", "Diferença Bruta (R$)",
      "Regra Exacta", "Método Cálculo", "Observação IA",
    ];

    // CSV no padrão BR (UTF-8 + BOM, ';' como separador) para abrir
    // direto no Excel pt-BR sem precisar de "importar texto".
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      if (s.includes(";") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const fmtNum = (n: number | null | undefined) =>
      n != null && Number.isFinite(n) ? Number(n).toFixed(2).replace(".", ",") : "";

    const rows = itemsToExport.map((it) => {
      const vra = (it as unknown as { valor_repasse_acordo?: number | null }).valor_repasse_acordo;
      const vpe = (it as unknown as { valor_pago_exacta?: number | null }).valor_pago_exacta;
      const dr = computeDiffRegra(it);
      return [
        STATUS_LABEL[it.status],
        it.company_name ?? "",
        it.doctor_name ?? "",
        it.patient_name ?? "",
        it.attendance_number ?? "",
        it.procedure_code ?? "",
        it.procedure_name ?? "",
        fmtQty(getQtyExacta(it)),
        fmtQty(getQtyHospital(it)),
        it.procedure_date ? formatDateBR(it.procedure_date) : "",
        it.agreement_text ?? "",
        fmtNum(Number(it.valor_exacta)),
        fmtNum(Number(it.valor_hospital)),
        fmtNum(vra != null ? Number(vra) : null),
        fmtNum(vpe != null ? Number(vpe) : null),
        fmtNum(it.valor_regra != null ? Number(it.valor_regra) : null),
        fmtNum(dr),
        fmtNum(Number((it.valor_hospital - it.valor_exacta).toFixed(2))),
        it.applied_rule_label ?? "",
        it.applied_calc_method ?? "",
        it.ia_obs ?? "",
      ];
    });

    const csv = [headers, ...rows]
      .map((r) => r.map(escape).join(";"))
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildExportFileName("csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportado", description: "Arquivo CSV gerado com sucesso." });
  };

  const handleExportPdf = async (itemsToExport: ReconciliationItem[], scopeLabel: string) => {
    if (!run) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    // Margens generosas seguindo o manual da marca (área de proteção).
    const marginX = 12;
    const marginBottom = 14;
    const tableWidth = pageWidth - marginX * 2;

    // Cabeçalho com a logo Rede D'Or (azul institucional sobre branco)
    let cursorY = await drawReportHeader(doc, {
      title: `Conciliação de Produção — ${paymentReference}`,
      subtitle: `Gerado em ${formatDateTimeBR(new Date().toISOString())}${run.file_name ? `  ·  Base: ${run.file_name}` : ""}`,
      marginX,
      logoHeightMm: 11,
    });

    const filterDescParts: string[] = [];
    if (initialCompany) filterDescParts.push(`Empresa: ${initialCompany}`);
    else if (companyFilter !== "todos") filterDescParts.push(`Empresa: ${companyFilter}`);
    if (doctorFilter !== "todos") filterDescParts.push(`Médico: ${doctorFilter}`);
    if (activeFilter !== "todos") filterDescParts.push(`Status: ${STATUS_LABEL[activeFilter as ReconciliationItem["status"]] ?? activeFilter}`);
    if (searchTerm) filterDescParts.push(`Busca: "${searchTerm}"`);
    if (minValue || maxValue) filterDescParts.push(`Valor: ${minValue || "—"} a ${maxValue || "—"}`);
    filterDescParts.push(`Recorte: ${scopeLabel}`);
    if (filterDescParts.length) {
      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      const filterLines = doc.splitTextToSize(`Filtros: ${filterDescParts.join(" · ")}`, tableWidth) as string[];
      doc.text(filterLines, marginX, cursorY);
      cursorY += filterLines.length * 3.8 + 1;
    }

    doc.setTextColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(
      `Itens exportados: ${itemsToExport.length}  ·  Conciliados: ${scopedStats.conciliado}  ·  Valor div.: ${scopedStats.valor_divergente}  ·  Qtd div.: ${scopedStats.qtd_divergente}  ·  Só hospital: ${scopedStats.so_hospital}  ·  Só Exacta: ${scopedStats.so_exacta}`,
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

    const fmtBR = (n: number | null | undefined) =>
      n != null && Number.isFinite(n) ? `R$ ${Number(n).toFixed(2)}` : "—";

    const tableData = itemsToExport.map((it) => {
      const vpe = (it as unknown as { valor_pago_exacta?: number | null }).valor_pago_exacta;
      const dr = computeDiffRegra(it);
      return [
        STATUS_LABEL[it.status],
        it.company_name ?? "",
        it.doctor_name ?? "",
        it.procedure_code ?? "",
        it.procedure_name ?? "",
        it.procedure_date ? formatDateBR(it.procedure_date) : "",
        fmtQty(getQtyExacta(it)),
        fmtQty(getQtyHospital(it)),
        `R$ ${Number(it.valor_exacta).toFixed(2)}`,
        `R$ ${Number(it.valor_hospital).toFixed(2)}`,
        fmtBR(vpe != null ? Number(vpe) : null),
        fmtBR(it.valor_regra != null ? Number(it.valor_regra) : null),
        fmtBR(dr),
        it.applied_rule_label ?? "",
      ];
    });

    const STATUS_FILL: Record<string, [number, number, number]> = {
      "Conciliado": [240, 253, 244],
      "Valor divergente": [255, 251, 235],
      "Quantidade divergente": [255, 251, 235],
      "Só no hospital": [254, 242, 242],
      "Só no Exacta": [239, 246, 255],
    };

    // 14 colunas — Procedimento e Regra são as mais largas; valores monetários estreitos.
    const widthFractions = [0.06, 0.10, 0.09, 0.05, 0.14, 0.05, 0.04, 0.04, 0.06, 0.06, 0.06, 0.06, 0.07, 0.12];
    const colWidths = widthFractions.map((f) => +(tableWidth * f).toFixed(2));

    autoTable(doc, {
      startY: cursorY + 2,
      head: [["Status", "Empresa", "Médico", "TUSS", "Procedimento", "Data", "Qtd Ex.", "Qtd Ho.", "Exacta", "Hospital", "V. Pago", "V. Regra", "Dif. Regra", "Regra Exacta"]],
      body: tableData,
      styles: { fontSize: 6.5, cellPadding: 1.5, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: REDE_DOR_BRAND_BLUE_RGB, textColor: 255, fontStyle: "bold", fontSize: 7, halign: "left" },
      columnStyles: {
        0: { cellWidth: colWidths[0] },
        1: { cellWidth: colWidths[1] },
        2: { cellWidth: colWidths[2] },
        3: { cellWidth: colWidths[3] },
        4: { cellWidth: colWidths[4] },
        5: { cellWidth: colWidths[5] },
        6: { cellWidth: colWidths[6], halign: "center" },
        7: { cellWidth: colWidths[7], halign: "center" },
        8: { cellWidth: colWidths[8], halign: "right" },
        9: { cellWidth: colWidths[9], halign: "right" },
        10: { cellWidth: colWidths[10], halign: "right" },
        11: { cellWidth: colWidths[11], halign: "right" },
        12: { cellWidth: colWidths[12], halign: "right" },
        13: { cellWidth: colWidths[13] },
      },
      didParseCell: (data) => {
        if (data.section === "body") {
          const status = String(tableData[data.row.index]?.[0] ?? "");
          const fill = STATUS_FILL[status];
          if (fill) data.cell.styles.fillColor = fill;
        }
      },
      margin: { left: marginX, right: marginX, top: cursorY + 2, bottom: marginBottom + 6 },
      tableWidth,
      showHead: "everyPage",
      rowPageBreak: "avoid",
      didDrawPage: () => {
        const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
        const current = (doc as unknown as { internal: { getCurrentPageInfo: () => { pageNumber: number } } }).internal.getCurrentPageInfo().pageNumber;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(120, 120, 120);
        doc.text("MedPay · Rede D'Or", marginX, pageHeight - 6);
        doc.text(`Página ${current} de ${pageCount}`, pageWidth - marginX, pageHeight - 6, { align: "right" });
      },
    });

    doc.save(buildExportFileName("pdf"));
    toast({ title: "PDF exportado", description: "Arquivo PDF gerado com sucesso." });
  };

  // ============== Modal de exportação ==============
  type ExportFormat = "xlsx" | "csv" | "pdf";
  type ExportStatusKey = ReconciliationItem["status"];
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const ALL_STATUS_KEYS: ExportStatusKey[] = ["conciliado", "valor_divergente", "qtd_divergente", "so_hospital", "so_exacta", "empresa_ausente"];
  const [exportStatuses, setExportStatuses] = useState<Set<ExportStatusKey>>(new Set(ALL_STATUS_KEYS));

  const toggleExportStatus = (k: ExportStatusKey) => {
    setExportStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const setAllExportStatuses = (on: boolean) => {
    setExportStatuses(on ? new Set(ALL_STATUS_KEYS) : new Set());
  };

  // Contagens e exportação usam `scopedItems` (todos os filtros EXCETO o
  // activeFilter de status). Caso contrário, ao estar com uma aba/KPI ativo
  // (ex.: "valor_divergente"), marcar "Só Exacta" no modal resultaria em
  // zero itens, pois `filteredItems` já está restrito ao status da aba.
  const exportCounts: Record<ExportStatusKey, number> = useMemo(() => {
    const acc: Record<ExportStatusKey, number> = {
      conciliado: 0, valor_divergente: 0, qtd_divergente: 0, so_hospital: 0, so_exacta: 0, empresa_ausente: 0, possivel_pacote: 0,
    };
    for (const it of scopedItems) acc[it.status] = (acc[it.status] ?? 0) + 1;
    return acc;
  }, [scopedItems]);

  const runExport = () => {
    if (exportStatuses.size === 0) {
      toast({ title: "Selecione ao menos um tipo", description: "Marque pelo menos um status para exportar.", variant: "destructive" });
      return;
    }
    const subset = scopedItems.filter((it) => exportStatuses.has(it.status));
    if (subset.length === 0) {
      toast({ title: "Nada para exportar", description: "Nenhum item nos status selecionados (considerando filtros atuais).", variant: "destructive" });
      return;
    }
    const isAll = exportStatuses.size === ALL_STATUS_KEYS.length;
    const scopeLabel = isAll
      ? "Todos os status"
      : Array.from(exportStatuses).map((s) => STATUS_LABEL[s]).join(" + ");

    if (exportFormat === "xlsx") handleExportXlsx(subset, scopeLabel);
    else if (exportFormat === "csv") handleExportCsv(subset, scopeLabel);
    else handleExportPdf(subset, scopeLabel);
    setExportOpen(false);
  };



  const triggerNew = () => {
    setStep("select_base");
    setRun(null);
    setItems([]);
    setParsedRows([]);
    setCompanyMapping({});
    setHospitalCompanies([]);
    setPendingFileName("");
    setSelectedBases([]);
    setPrimaryBaseId(null);
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
    { key: "qtd_divergente", label: "Qtd divergente", count: scopedStats.qtd_divergente },
    { key: "so_hospital", label: "Só no hospital", count: scopedStats.so_hospital },
    { key: "so_exacta", label: "Só no Exacta", count: scopedStats.so_exacta },
    { key: "outra_competencia", label: "Outra competência", count: scopedStats.outra_competencia },
    { key: "empresa_ausente", label: "Empresa ausente", count: scopedStats.empresa_ausente },
    { key: "possivel_pacote", label: "Possível pacote", count: scopedStats.possivel_pacote },
  ];

  const total = scopedStats.total;
  const pendentes =
    scopedStats.valor_divergente + scopedStats.qtd_divergente + scopedStats.so_hospital + scopedStats.so_exacta + scopedStats.empresa_ausente;

  const exactCount = Object.entries(companyMapping).filter(([t, v]) => v && (matchLevels[t] === 'exact' || matchLevels[t] === 'high')).length;
  const confirmCount = Object.entries(companyMapping).filter(([t, v]) => v && matchLevels[t] === 'medium').length;
  const pendingCount = hospitalCompanies.filter((t) => !companyMapping[t] || matchLevels[t] === 'medium').length;

  // Estado do diálogo de cancelamento via conciliação
  const [cancelScope, setCancelScope] = useState<CancelScope | null>(null);

  const openCancelForItem = useCallback((item: ReconciliationItem) => {
    if (!item.payment_item_id) {
      toast({ title: "Item sem vínculo de pagamento", description: "Não é possível cancelar — este item não está mais ligado ao pagamento atual.", variant: "destructive" });
      return;
    }
    setCancelScope({
      type: "items",
      item_ids: [item.payment_item_id],
      label: `${item.doctor_name ?? "—"} · ${item.procedure_code ?? "—"} (atend. ${item.attendance_number ?? "—"})`,
    });
  }, []);

  const openCancelForAttendance = useCallback((item: ReconciliationItem) => {
    if (!item.attendance_number || !item.company_name) {
      toast({ title: "Atendimento incompleto", description: "Item sem atendimento ou empresa.", variant: "destructive" });
      return;
    }
    setCancelScope({
      type: "attendance",
      attendance_number: item.attendance_number,
      company_name: item.company_name,
      label: `Todos os itens do atendimento ${item.attendance_number} — ${item.company_name}`,
    });
  }, []);


  const handleAction = async (
    item: ReconciliationItem,
    action: 'incorporar_credito' | 'incorporar_debito' | 'marcar_glosa' | 'revisar_manual' | 'ignorar' | 'rolar_debito_residual',
    note?: string,
    opts?: { silent?: boolean },
  ) => {
    const silent = !!opts?.silent;
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
        const valorExacta = Number(item.valor_exacta ?? 0);
        const diferenca = Math.abs(valorConvenio - valorExacta);
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

        if (!silent) {
          toast({
            title: `Item ${isCredito ? 'creditado' : 'debitado'} no lote "${targetRef}"`,
            description: `${formatCurrency(valorAjuste)} adicionado como ajuste de conciliação`,
          });
        }
      }

      // ============ Rolar saldo residual para próxima produção da médica ============
      // Cria/soma glosa_debts (origem='conciliacao_residual') escopado ao hospital
      // do lote — a cobrança recai em qualquer PJ vinculada à médica no mesmo hospital.
      let carryGlosaDebtId: string | null = null;
      if (action === 'rolar_debito_residual') {
        const diff = Number(item.diferenca_regra ?? 0);
        if (!(diff > 0)) {
          toast({ title: 'Nada a rolar', description: 'Este item não tem saldo residual positivo (a recuperar).', variant: 'destructive' });
          return;
        }
        if (!item.payment_item_id) {
          toast({ title: 'Item sem vínculo de pagamento', description: 'Não é possível rolar — item sem ligação com payment_items.', variant: 'destructive' });
          return;
        }

        // Resolve doctor_id + hospital_id via payment_items (ReconciliationItem não os expõe)
        const { data: piRow, error: piErr } = await supabase
          .from('payment_items')
          .select('doctor_id, company_id, hospital_id')
          .eq('id', item.payment_item_id)
          .maybeSingle();
        if (piErr || !piRow?.hospital_id) {
          toast({ title: 'Não foi possível resolver hospital', description: piErr?.message ?? 'Dados incompletos no payment_item.', variant: 'destructive' });
          return;
        }

        // Fallback: quando o payment_item não tem doctor_id vinculado (comum em bases
        // antigas), resolve pelo nome exato do médico da linha de conciliação. A busca
        // é escopada por hospital (isolamento) e só aceita match único — caso contrário
        // exige que o analista vincule o médico manualmente no cadastro antes de rolar.
        let resolvedDoctorId: string | null = piRow.doctor_id ?? null;
        if (!resolvedDoctorId && item.doctor_name) {
          const { data: docMatches } = await supabase
            .from('doctors')
            .select('id')
            .ilike('full_name', item.doctor_name.trim())
            .limit(2);
          if ((docMatches?.length ?? 0) === 1) {
            resolvedDoctorId = docMatches![0].id as string;
          } else {
            toast({
              title: 'Médica não vinculada ao item',
              description: (docMatches?.length ?? 0) > 1
                ? `Múltiplos médicos com o nome "${item.doctor_name}" — vincule manualmente antes de rolar.`
                : `Não achei "${item.doctor_name}" no cadastro deste hospital — vincule antes de rolar.`,
              variant: 'destructive',
            });
            return;
          }
        }
        if (!resolvedDoctorId) {
          toast({ title: 'Item sem médica identificada', description: 'Sem nome nem vínculo — impossível rolar.', variant: 'destructive' });
          return;
        }


        // Upsert semântico: uma única dívida residual ativa por médica+hospital.
        // Se existir, soma; se não, cria.
        const { data: existingDebt } = await supabase
          .from('glosa_debts')
          .select('id, total_debt')
          .eq('doctor_id', resolvedDoctorId)
          .eq('hospital_id', piRow.hospital_id)
          .eq('status', 'ativo')
          .eq('origem', 'conciliacao_residual')
          .maybeSingle();

        if (existingDebt?.id) {
          const newTotal = Number(existingDebt.total_debt ?? 0) + diff;
          const { error: updErr } = await supabase
            .from('glosa_debts')
            .update({ total_debt: newTotal, updated_at: new Date().toISOString() })
            .eq('id', existingDebt.id);
          if (updErr) throw new Error(updErr.message);
          carryGlosaDebtId = existingDebt.id;

          // Auditoria: registra que este item acresceu à dívida existente
          await supabase.from('audit_log').insert({
            entity_type: 'glosa_debt',
            entity_id: existingDebt.id,
            action: 'append_residual',
            actor_id: user.id,
            company_id: piRow.company_id ?? null,
            diff: {
              added: diff,
              new_total: newTotal,
              source_reconciliation_item_id: item.id,
              source_payment_id: paymentId,
            },
          } as never);
        } else {
          const { data: newDebt, error: insErr } = await supabase
            .from('glosa_debts')
            .insert({
              doctor_id: resolvedDoctorId,
              doctor_name: item.doctor_name ?? '—',
              hospital_id: piRow.hospital_id,
              company_id: piRow.company_id ?? null,
              total_debt: diff,
              parcelas_default: 12,
              status: 'ativo',
              resolution_status: 'vinculada',
              origem: 'conciliacao_residual',
              origem_reconciliation_item_id: item.id,
              origem_payment_id: paymentId,
              confirmed_at: new Date().toISOString(),
              confirmed_by: user.id,
            } as never)
            .select('id')
            .single();
          if (insErr || !newDebt) throw new Error(insErr?.message ?? 'Erro ao criar dívida residual.');
          carryGlosaDebtId = newDebt.id;
        }

        toast({
          title: 'Saldo residual rolado para próximo repasse',
          description: `R$ ${diff.toFixed(2)} em 12 parcelas — cobra na próxima produção da médica em qualquer PJ vinculada neste hospital.`,
        });
      }

      const { error: actionErr } = await supabase
        .from('reconciliation_items')
        .update({
          action_taken: action,
          action_by: user.id,
          action_at: new Date().toISOString(),
          action_note: note ?? (action === 'rolar_debito_residual' ? `Rolado como débito residual — glosa_debts ${carryGlosaDebtId}` : null),
          applied_payment_id: appliedPaymentId,
          applied_payment_item_id: appliedPaymentItemId,
          ...(carryGlosaDebtId ? { carry_glosa_debt_id: carryGlosaDebtId } : {}),
        } as never)
        .eq('id', item.id);

      if (actionErr) throw new Error(actionErr.message);

      if (action === 'incorporar_credito' || action === 'incorporar_debito') {
        // Marca TODAS as bases envolvidas na run como "tem itens aplicados"
        // — não só a primária, porque o item pode ter vindo de qualquer uma.
        const baseIds = selectedBases.map(b => b.id).filter(Boolean);
        if (baseIds.length > 0) {
          await supabase
            .from('conciliation_bases')
            .update({ tem_itens_aplicados: true } as any)
            .in('id', baseIds);
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
                : "Cruzamento entre base Exacta e extrato hospitalar"}
            </p>
          </div>
          <div className="flex gap-2">
            {step === "result" && run && (
              <Button variant="outline" size="sm" onClick={triggerNew} disabled={processing}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Nova conciliação
              </Button>
            )}
            {step === "result" && run && (
              <Button variant="default" size="sm" onClick={() => setExportOpen(true)}>
                <FileDown className="h-4 w-4 mr-1.5" />
                Exportar
              </Button>
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
                  {selectedBases.length > 1 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-md bg-accent/40 border border-border text-xs">
                      <span className="font-medium text-foreground">
                        {selectedBases.length} bases selecionadas · {selectedBases.reduce((s, b) => s + (b.total_rows ?? 0), 0)} linhas totais
                      </span>
                      <span className="text-muted-foreground">
                        Primária: <strong className="text-foreground">{primaryBase?.reference}</strong>
                      </span>
                    </div>
                  )}
                  {concBases.map(base => {
                    const isSelected = selectedBases.some(b => b.id === base.id);
                    const isPrimary = isSelected && primaryBase?.id === base.id;
                    return (
                      <div
                        key={base.id}
                        className={cn(
                          "w-full p-4 rounded-lg border transition-all",
                          isSelected
                            ? "border-primary/60 bg-accent/60 shadow-sm"
                            : "border-border bg-card hover:bg-muted/40"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleBase(base)}
                            className="h-4 w-4 rounded shrink-0"
                            style={{ accentColor: "hsl(var(--primary))" }}
                            aria-label={`Selecionar base ${base.reference}`}
                          />
                          <button
                            type="button"
                            onClick={() => handleToggleBase(base)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground truncate">{base.reference}</p>
                              {isPrimary && selectedBases.length > 1 && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary text-primary-foreground shrink-0">
                                  primária
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {base.total_rows} linhas · {base.file_name} · {new Date(base.created_at).toLocaleDateString("pt-BR")}
                              {base.competence_month && ` · competência ${formatCompetenceBR(base.competence_month)}`}
                            </p>
                          </button>
                          {isSelected && !isPrimary && selectedBases.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleSetPrimaryBase(base)}
                              className="text-[10px] font-medium px-2 py-1 rounded border border-border hover:bg-muted shrink-0"
                            >
                              tornar primária
                            </button>
                          )}
                          {isSelected && (
                            <div className="shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                              <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {primaryBase && availableSectors.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Filtrar por setor</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Setores exibidos referem-se à base primária. O filtro é aplicado em todas as bases selecionadas. Deixe todos desmarcados para incluir as bases completas (não recomendado — pode gerar ruído entre tipos de atendimento).
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {availableSectors.map(sector => {
                      const checked = selectedSectors.includes(sector);
                      const count = (primaryBase.raw_data ?? []).filter((r: any) => {
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
                        (primaryBase.raw_data ?? []).filter((r: any) => {
                          const sectorCol = Object.keys(r).find(k => {
                            const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                            return n.includes("setor") || n.includes("centro") || n.includes("custos");
                          });
                          return sectorCol && selectedSectors.includes(String(r[sectorCol] ?? "").trim());
                        }).length
                      } linhas da base primária serão analisadas
                    </p>
                  )}
                </div>
              )}

              {primaryBase && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-muted/40 border border-border rounded-lg text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-foreground">Lógica de cruzamento:</strong> chave = <strong className="text-foreground">Nº de atendimento + código TUSS</strong>. A comparação financeira é <strong className="text-foreground">tabela do convênio × tabela do convênio</strong> (valor antes da aplicação de qualquer regra/acordo). Divergências aqui indicam diferenças na tabela do convênio entre as duas bases — não erro do motor de regras.
                    {selectedBases.length > 1 && (
                      <> Com múltiplas bases selecionadas, itens duplicados (mesmo atendimento + TUSS + médico + função) são resolvidos pelo desempate: <strong className="text-foreground">competência do lote vence</strong>, depois <strong className="text-foreground">upload mais recente</strong>.</>
                    )}
                  </span>
                </div>
              )}

              {primaryBase && (
                <div className="flex justify-end pt-2 border-t border-border">
                  <Button
                    disabled={selectedBases.length === 0}
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
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campo Exacta</span>
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

              {/* Histórico de versões dos vínculos para este pagamento */}
              {paymentId && (
                <CompanyMappingHistory
                  paymentId={paymentId}
                  companyIdToName={companyIdToName}
                />
              )}

              {/* Rótulos das colunas: esquerda=base de conciliação (hospital), direita=base do pagamento (Exacta) */}
              <TooltipProvider>
                <div className="flex items-center justify-between px-3 py-2 bg-card border border-border rounded-lg">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 cursor-help">
                        <div className="w-3 h-3 rounded bg-muted-foreground/30 border border-border" />
                        <div>
                          <p className="text-xs font-semibold">Base de conciliação (hospital)</p>
                          <p className="text-[10px] text-muted-foreground">
                            {hospitalCompanies.length} empresa(s) do extrato hospitalar
                          </p>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[320px]">
                      Empresas como aparecem no extrato/planilha hospitalar enviada. São a base do
                      cruzamento — para cada uma, escolha a empresa equivalente do lote Exacta.
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-xs text-muted-foreground font-mono">hospital → Exacta</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 cursor-help">
                        <div>
                          <p className="text-xs font-semibold text-right">Base do pagamento (lote Exacta)</p>
                          <p className="text-[10px] text-muted-foreground text-right">
                            {loteCompanies.length} empresa(s) cadastradas neste lote
                          </p>
                        </div>
                        <div className="w-3 h-3 rounded bg-success/40 border border-success/60" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[320px]">
                      Empresas cadastradas neste pagamento/lote do Exacta. É o universo permitido
                      para vinculação. "Ignorar" exclui a linha da conciliação.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>

              {/* Legenda agora vive dentro do CompanyMappingList abaixo. */}


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

              <div className="flex items-start gap-3 p-3 bg-muted/40 border border-border rounded-lg">
                <div className="flex-1">
                  <label htmlFor="periodStart" className="text-xs text-muted-foreground block">
                    <span className="font-medium text-foreground">Competência inicial do lote</span>
                    {' '}— itens da Exacta com data <strong>anterior</strong> a esta serão removidos da conciliação (pagamentos por remessa: o faturamento já fechou, sem risco de divergência).
                    {periodStartAuto && (
                      <span className="block text-[11px] text-muted-foreground/80 mt-0.5">
                        Sugerido pelo lote: <code className="font-mono">{periodStartAuto}</code>
                      </span>
                    )}
                  </label>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DateInput
                    id="periodStart"
                    value={periodStartOverride}
                    onChange={(v) => setPeriodStartOverride(v)}
                    className="h-8 text-xs w-[130px]"
                  />
                  {periodStartOverride && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-muted-foreground"
                      onClick={() => setPeriodStartOverride("")}
                      title="Desativa o filtro — todos os itens da Exacta entram na conciliação, independente da data."
                    >
                      Limpar
                    </Button>
                  )}
                </div>
              </div>

              <CompanyMappingList
                rows={hospitalCompanies.map((t) => ({
                  key: t,
                  rawLabel: t,
                  level: matchLevels[t] ?? null,
                }))}
                options={loteCompanies.map((lc) => ({ id: lc, label: lc }))}
                value={companyMapping}
                onChange={(terceiro, newName) => {
                  const prevName = companyMapping[terceiro] ?? null;
                  setCompanyMapping((prev) => ({ ...prev, [terceiro]: newName }));
                  setMatchLevels((prev) => ({
                    ...prev,
                    [terceiro]: newName == null ? null : "exact",
                  }));
                  if (paymentId && newName !== prevName) {
                    void logCompanyMapping({
                      paymentId,
                      reconciliationRunId: run?.id ?? null,
                      hospitalCompanyRaw: terceiro,
                      exactaCompanyId: newName ? companyNameToId[newName] ?? null : null,
                      decision: newName == null ? "ignored" : "manual",
                      changedBy: user?.id ?? null,
                    });
                  }
                }}
                onConfirm={(terceiro) =>
                  setMatchLevels((prev) => ({ ...prev, [terceiro]: "exact" }))
                }
              />


              <div className="flex items-center justify-between pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <span className="text-success font-semibold">{exactCount}</span> confirmadas ·{" "}
                  <span className="text-warning-text font-semibold">{confirmCount}</span> sugestões pendentes (não entram no cruzamento) ·{" "}
                  <span className="text-muted-foreground">{pendingCount - confirmCount}</span> sem match
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
                    variant="outline"
                    size="sm"
                    onClick={() => setPreReportOpen(true)}
                    disabled={hospitalCompanies.length === 0}
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Ver relatório
                  </Button>
                  <Button
                    size="sm"
                    disabled={processing || exactCount === 0}
                    onClick={() => {
                      const mapped = Array.from(
                        new Set(
                          Object.values(companyMapping).filter(Boolean) as string[],
                        ),
                      );
                      const prevCompanies = Array.from(
                        new Set(
                          items.map((it) => it.company_name ?? "").filter(Boolean),
                        ),
                      );
                      const keep = prevCompanies.filter((c) => !mapped.includes(c));
                      if (run?.id && keep.length > 0) {
                        setScopeDialogInfo({
                          newCompanies: mapped,
                          previousCompanies: prevCompanies,
                          keepCompanies: keep,
                        });
                        setScopeDialogOpen(true);
                      } else {
                        handleProcessReconciliation("replace");
                      }
                    }}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        Processando...
                      </>
                    ) : (
                      `Conciliar ${exactCount} empresa(s) →`
                    )}
                  </Button>
                </div>
              </div>

              {/* Relatório pré-conciliação */}
              {paymentId && (
                <PreReconciliationReport
                  open={preReportOpen}
                  onOpenChange={setPreReportOpen}
                  hospitalCompanies={hospitalCompanies}
                  companyMapping={companyMapping}
                  matchLevels={matchLevels}
                  hospitalRows={(() => {
                    const companyCol = parsedColMap["company"] || "";
                    const attCol = parsedColMap["attendance"] || "";
                    const codeCol = parsedColMap["procedure_code"] || "";
                    const docCol = parsedColMap["doctor"] || "";
                    const out: HospitalRowLite[] = [];
                    for (const r of parsedRows) {
                      out.push({
                        company: companyCol ? String(r[companyCol] ?? "").trim() : "",
                        attendance: attCol ? String(r[attCol] ?? "").trim() : "",
                        code: codeCol ? String(r[codeCol] ?? "").trim() : "",
                        doctor: docCol ? String(r[docCol] ?? "").trim() : "",
                        qty: 1,
                      });
                    }
                    return out;
                  })()}
                  onConfirm={() => {
                    handleProcessReconciliation("replace");
                  }}
                />
              )}
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
                <span className="flex-1">
                  <strong>{run.file_name}</strong> · {run.total_items} itens processados
                  {excludeConsultas && ' · consultas e visitas excluídas'}
                  · conciliação em {formatDateTimeBR(run.created_at)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-7 text-xs"
                  disabled={processing}
                  onClick={handleReassignMigratedDoctors}
                  title="Para médicos que migraram de PJ (ex.: SORT→COB) mas cuja base Exacta ainda traz a empresa antiga, atualiza company_name dos itens usando a PJ ativa em doctor_companies. Depois rode Reprocessar."
                >
                  <Building2 className="h-3.5 w-3.5 mr-1.5" />
                  Reatribuir PJ migrada
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-7 text-xs"
                  disabled={processing}
                  onClick={handleReprocessFromCurrent}
                  title="Recruza esta conciliação sem precisar subir a planilha de novo. Usa os mesmos vínculos de empresa já confirmados e aplica as regras atualizadas."
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${processing ? "animate-spin" : ""}`} />
                  Reprocessar agora
                </Button>
              </div>

              {/* Auditoria: filtro de remessa */}
              {remittanceFilterStats && (
                <div className={`flex items-start gap-3 px-4 py-2.5 border rounded-lg text-xs ${
                  remittanceFilterStats.removidos > 0
                    ? 'bg-info/10 border-info/30 text-info-text'
                    : 'bg-muted/40 border-border text-muted-foreground'
                }`}>
                  <Filter className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>
                      <strong>Filtro de remessa:</strong>{' '}
                      {remittanceFilterStats.removidos > 0 ? (
                        <>
                          <strong>{remittanceFilterStats.removidos}</strong> item(ns) da Exacta removido(s) da conciliação
                          {' '}({((remittanceFilterStats.removidos / Math.max(1, remittanceFilterStats.before)) * 100).toFixed(1)}% de {remittanceFilterStats.before}) — datas anteriores a{' '}
                          <strong>{remittanceFilterStats.lotePeriodStart}</strong>. Restantes na análise: <strong>{remittanceFilterStats.restantes}</strong>.
                        </>
                      ) : (
                        <>Nenhum item removido. Competência inicial <strong>{remittanceFilterStats.lotePeriodStart}</strong> aplicada sobre {remittanceFilterStats.before} item(ns) da Exacta.</>
                      )}
                      {' '}
                      <span className="opacity-75">
                        (competência {remittanceFilterStats.source === 'override' ? 'definida pelo analista' : 'sugerida pelo lote'})
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {/* Filtro: convênios excluídos da análise */}
              <details className="border border-border rounded-lg text-xs bg-card">
                <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-2 select-none">
                  <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-foreground">Excluir convênios da análise</span>
                  {excludedConvenios.length > 0 ? (
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                      {excludedConvenios.length} convênio(s) excluído(s)
                    </span>
                  ) : (
                    <span className="ml-auto text-muted-foreground text-[11px]">nenhum</span>
                  )}
                </summary>
                <div className="px-4 py-3 space-y-3 border-t border-border">
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    Selecione convênios que operam por <strong>pacote / tratativa manual</strong> (ex.: Sul América, Particular).
                    Itens desses convênios são <strong>removidos das duas bases</strong> antes do cruzamento — não geram
                    "só no hospital" nem "só no Exacta". Após alterar, clique em <strong>Reprocessar agora</strong>.
                  </p>
                  {availableConvenios.length === 0 ? (
                    <p className="text-muted-foreground italic">Nenhum convênio identificado na base Exacta.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                      {availableConvenios.map((conv) => {
                        const checked = excludedConvenios.includes(conv.key);
                        const variantCount = conv.variants.size;
                        const resolvedToSlug = conv.key.startsWith("slug:");
                        const title = variantCount > 1
                          ? `${variantCount} variações na base Exacta: ${Array.from(conv.variants).join(" · ")}`
                          : Array.from(conv.variants)[0] ?? conv.label;
                        return (
                          <label
                            key={conv.key}
                            title={title}
                            className={cn(
                              "flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer transition-colors",
                              checked ? "border-primary/60 bg-accent/60" : "border-border bg-card hover:bg-muted/40",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setExcludedConvenios((prev) =>
                                  checked ? prev.filter((c) => c !== conv.key) : [...prev, conv.key],
                                )
                              }
                              className="h-3.5 w-3.5 rounded"
                              style={{ accentColor: "hsl(var(--primary))" }}
                            />
                            <span className="flex-1 truncate text-[11px]">
                              {conv.label}
                              {resolvedToSlug && variantCount > 1 ? (
                                <span className="ml-1 text-[9px] text-muted-foreground">· {variantCount} variações</span>
                              ) : null}
                              {!resolvedToSlug ? (
                                <span className="ml-1 text-[9px] text-amber-600" title="Sem cadastro em convenios — filtro cai em match textual">·  sem cadastro</span>
                              ) : null}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{conv.count}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {excludedConvenios.length > 0 && (
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground underline"
                        onClick={() => setExcludedConvenios([])}
                      >
                        Limpar seleção
                      </button>
                      {convenioFilterStats && convenioFilterStats.excluded.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          Último processamento: <strong className="text-foreground">{convenioFilterStats.exactaRemoved}</strong> item(ns) Exacta e{' '}
                          <strong className="text-foreground">{convenioFilterStats.hospitalRemoved}</strong> item(ns) hospital removido(s).
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </details>





              {/* Aviso de defasagem: detecta reanálise do lote, atualização de regras
                  ou nova versão da lógica de conciliação desde o último run. */}
              {(() => {
                if (!run.created_at) return null;
                const runTs = new Date(run.created_at).getTime();
                const reasons: { key: string; label: React.ReactNode }[] = [];

                const lastAnalyzed = paymentItems
                  .map((it) => (it as any).applied_at as string | null)
                  .filter(Boolean)
                  .sort()
                  .pop();
                if (lastAnalyzed && new Date(lastAnalyzed).getTime() > runTs) {
                  reasons.push({
                    key: "reanalise",
                    label: (
                      <>Lote reanalisado em <strong>{formatDateTimeBR(lastAnalyzed)}</strong> — exclusões/inclusões pelo motor podem ter mudado.</>
                    ),
                  });
                }

                if (rulesLastUpdate && new Date(rulesLastUpdate).getTime() > runTs) {
                  reasons.push({
                    key: "regras",
                    label: (
                      <>Regras de pagamento atualizadas em <strong>{formatDateTimeBR(rulesLastUpdate)}</strong> — o valor esperado por item pode ter mudado.</>
                    ),
                  });
                }

                if (runTs < new Date(RECONCILIATION_LOGIC_VERSION_DATE).getTime()) {
                  reasons.push({
                    key: "logica",
                    label: (
                      <>Nova lógica de classificação disponível (<strong>{RECONCILIATION_LOGIC_VERSION_LABEL}</strong>) — separa divergência de valor (acordo proporcional) de divergência de quantidade (acordo fixo).</>
                    ),
                  });
                }

                if (reasons.length === 0) return null;

                return (
                  <div className="flex items-start gap-3 px-4 py-3 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning-text">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1.5">
                      <p className="font-semibold">
                        Conciliação desatualizada ({reasons.length} {reasons.length === 1 ? "motivo" : "motivos"})
                      </p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {reasons.map((r) => (
                          <li key={r.key}>{r.label}</li>
                        ))}
                      </ul>
                      <p className="text-[11px] opacity-80">
                        Conciliação atual: {formatDateTimeBR(run.created_at)}.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      className="shrink-0"
                      onClick={() => setStep("select_base")}
                      disabled={processing}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${processing ? "animate-spin" : ""}`} />
                      Reprocessar
                    </Button>
                  </div>
                );
              })()}

              {/* KPI cards */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                  hint="acordo proporcional"
                  active={activeFilter === "valor_divergente"}
                  onClick={() =>
                    setActiveFilter(
                      activeFilter === "valor_divergente" ? "todos" : "valor_divergente",
                    )
                  }
                />
                <KpiCard
                  icon={AlertTriangle}
                  tone="warning"
                  label="Qtd divergente"
                  value={`${scopedStats.qtd_divergente} itens`}
                  hint="acordo valor fixo"
                  active={activeFilter === "qtd_divergente"}
                  onClick={() =>
                    setActiveFilter(
                      activeFilter === "qtd_divergente" ? "todos" : "qtd_divergente",
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
                  label="Só no Exacta"
                  value={`${scopedStats.so_exacta} itens`}
                  hint="possível glosa"
                  active={activeFilter === "so_exacta"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "so_exacta" ? "todos" : "so_exacta")
                  }
                />
                <KpiCard
                  icon={AlertTriangle}
                  tone="warning"
                  label="Outra competência"
                  value={`${scopedStats.outra_competencia} itens`}
                  hint={
                    scopedStats.outra_competencia === 0
                      ? "data fora do mês da base"
                      : `${scopedStats.outra_competencia_aguardando} aguardando base · ${scopedStats.outra_competencia_disponivel} base disponível`
                  }
                  active={activeFilter === "outra_competencia"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "outra_competencia" ? "todos" : "outra_competencia")
                  }
                />
                <KpiCard
                  icon={AlertTriangle}
                  tone="info"
                  label="Empresa ausente"
                  value={`${scopedStats.empresa_ausente} itens`}
                  hint="empresa não está no outro lado"
                  active={activeFilter === "empresa_ausente"}
                  onClick={() =>
                    setActiveFilter(activeFilter === "empresa_ausente" ? "todos" : "empresa_ausente")
                  }
                />
              </div>

              {/* Impacto financeiro */}
              <Card>
                <CardContent className="p-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Diferença total{isScoped && <span className="ml-1 text-[9px] normal-case text-muted-foreground/70">(filtrado)</span>}
                    </p>
                    {(() => {
                      const dt = scopedStats.diferenca_total;
                      const isZero = Math.abs(dt) < 0.005;
                      const colorClass = isZero
                        ? "text-success"
                        : dt > 0
                          ? "text-destructive"
                          : "text-warning";
                      const label = isZero
                        ? "Tudo correto"
                        : dt > 0
                          ? "Pago a mais"
                          : "Pago a menos";
                      const sign = isZero ? "" : dt > 0 ? "+" : "-";
                      return (
                        <>
                          <p className={`text-lg font-bold mt-1 ${colorClass}`}>
                            {sign}{formatCurrency(Math.abs(dt))}
                          </p>
                          <p className={`text-[10px] mt-0.5 ${colorClass}`}>{label}</p>
                        </>
                      );
                    })()}
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
                {!initialCompany && (
                  <SearchableCombo
                    value={companyFilter}
                    onChange={setCompanyFilter}
                    options={companyOptions}
                    allLabel="Todas as empresas"
                    placeholder="Empresa"
                    searchPlaceholder="Buscar empresa…"
                    emptyText="Nenhuma empresa encontrada"
                    widthClass="min-w-[200px]"
                  />
                )}
                <SearchableCombo
                  value={doctorFilter}
                  onChange={setDoctorFilter}
                  options={doctorOptions}
                  allLabel="Todos os médicos"
                  placeholder="Médico"
                  searchPlaceholder="Buscar médico…"
                  emptyText="Nenhum médico encontrado"
                  widthClass="min-w-[200px]"
                />

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
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[11px] text-muted-foreground">Por página:</span>
                  <Select
                    value={pageSize === Infinity ? "all" : String(pageSize)}
                    onValueChange={(v) => setPageSize(v === "all" ? Infinity : Number(v))}
                  >
                    <SelectTrigger className="h-8 w-[88px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                      <SelectItem value="1000">1000</SelectItem>
                      <SelectItem value="all">Todos</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground ml-2">
                    {filteredItems.length} resultado{filteredItems.length === 1 ? "" : "s"}
                  </span>
                </div>
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
                      qtd_divergente: companyItems.filter((i) => i.status === "qtd_divergente").length,
                      so_hospital: companyItems.filter((i) => i.status === "so_hospital").length,
                      so_exacta: companyItems.filter((i) => i.status === "so_exacta").length,
                    };
                    const totalHosp = companyItems.reduce((s, i) => s + Number(i.valor_hospital), 0);
                    const totalMed = companyItems.reduce((s, i) => s + Number(i.valor_exacta), 0);
                    const hasPendencias =
                      counts.valor_divergente + counts.qtd_divergente + counts.so_hospital + counts.so_exacta > 0;

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
                                <span className="text-warning-text ml-2">
                                  · {counts.valor_divergente} valor divergente
                                </span>
                              )}
                              {counts.qtd_divergente > 0 && (
                                <span className="text-warning-text ml-2">
                                  · {counts.qtd_divergente} qtd divergente
                                </span>
                              )}
                              {counts.so_hospital > 0 && (
                                <span className="text-destructive ml-2">
                                  · {counts.so_hospital} só no hospital
                                </span>
                              )}
                              {counts.so_exacta > 0 && (
                                <span className="text-primary ml-2">
                                  · {counts.so_exacta} só no Exacta
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
                            <p className="text-xs text-muted-foreground">Exacta</p>
                            <p className="text-sm font-semibold tabular-nums">
                              {formatCurrency(totalMed)}
                            </p>
                          </div>
                        </button>

                        {isOpen && (() => {
                          const total = companyItems.length;
                          // Modo "Todos": sem paginação. Caso contrário, paginação
                          // clássica por página inteira (pageSize) — com scroll
                          // lateral envolvendo a tabela para telas estreitas.
                          const isAll = pageSize === Infinity;
                          const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
                          const currentPage = isAll
                            ? 0
                            : Math.min(pageByCompany[company] ?? 0, totalPages - 1);
                          const startIdx = isAll ? 0 : currentPage * pageSize;
                          const endIdx = isAll ? total : Math.min(startIdx + pageSize, total);
                          const visibleItems = isAll ? companyItems : companyItems.slice(startIdx, endIdx);
                          const goToPage = (p: number) =>
                            setPageByCompany((prev) => ({ ...prev, [company]: Math.max(0, Math.min(p, totalPages - 1)) }));
                          return (
                          <div className="border-t border-border">
                            <div className="overflow-x-auto">
                            <Table className="min-w-[1180px]">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Atendimento</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Médico</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">
                                    Paciente / Procedimento
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Data</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px]">Convênio</TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    Exacta (R$)
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right">
                                    Hospital (R$)
                                  </TableHead>
                                  <TableHead className="px-2 py-1.5 text-[10px] text-center" title="Quantidade do procedimento na base Exacta (planilha do lote)">
                                    Qtd Exacta
                                  </TableHead>
                                  <TableHead className="px-2 py-1.5 text-[10px] text-center" title="Quantidade do procedimento na planilha do hospital">
                                    Qtd Hosp.
                                  </TableHead>

                                  <TableHead className="px-3 py-1.5 text-[10px] text-right text-muted-foreground" title="Vl. Repasse — valor pós-acordo informado pelo hospital (base × % do acordo)">
                                    Valor Acordo
                                  </TableHead>
                                  <TableHead className="px-3 py-1.5 text-[10px] text-right text-muted-foreground" title="Valor efetivamente pago pelo Exacta ao médico — gross_amount pós-acordo">
                                    VALOR PAGO
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
                                {visibleItems.map((it) => {
                                  const isRowOpen = expanded === it.id;
                                  return (
                                    <>
                                      <TableRow
                                        key={it.id}
                                        className="cursor-pointer"
                                        onClick={() => setExpanded(isRowOpen ? null : it.id)}
                                      >
                                        <TableCell className="px-3 py-2 text-[12px] font-mono tabular-nums" title="Nº do atendimento (chave Tasy)">
                                          <span className="inline-flex items-center gap-1.5">
                                            <span>{it.attendance_number ?? "—"}</span>
                                            <CopyAttendanceButton value={it.attendance_number} />
                                          </span>
                                        </TableCell>
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
                                          {it.valor_exacta
                                            ? formatCurrency(Number(it.valor_exacta))
                                            : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums">
                                          {it.valor_hospital
                                            ? formatCurrency(Number(it.valor_hospital))
                                            : "—"}
                                        </TableCell>
                                        {(() => {
                                          const qHo = (it as { quantity?: number | null }).quantity;
                                          const qExRaw = it.payment_item_id ? exactaQtyById.get(it.payment_item_id) : null;
                                          const qEx = qExRaw == null ? null : Number(qExRaw);
                                          const qHoN = qHo == null ? null : Number(qHo);
                                          const diverge = qEx != null && qHoN != null && Math.abs(qEx - qHoN) >= 0.01;
                                          const fmtQ = (q: number | null) =>
                                            q == null ? "—" : Number.isInteger(q) ? String(q) : q.toFixed(2).replace(".", ",");
                                          return (
                                            <>
                                              <TableCell
                                                className="px-2 py-2 text-[12px] text-center tabular-nums"
                                                style={{ color: diverge ? 'hsl(var(--warning-text))' : undefined, fontWeight: diverge ? 600 : undefined }}
                                                title="Quantidade da base Exacta (planilha do lote)"
                                              >
                                                {fmtQ(qEx)}
                                              </TableCell>
                                              <TableCell
                                                className="px-2 py-2 text-[12px] text-center tabular-nums"
                                                style={{ color: diverge ? 'hsl(var(--warning-text))' : undefined, fontWeight: diverge ? 600 : undefined }}
                                                title="Quantidade da planilha do hospital"
                                              >
                                                {fmtQ(qHoN)}
                                              </TableCell>
                                            </>
                                          );
                                        })()}

                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums text-muted-foreground" title="Vl. Repasse — valor pós-acordo informado pelo hospital">
                                          {(() => {
                                            const vra = Number((it as any).valor_repasse_acordo) || 0;
                                            return vra > 0 ? formatCurrency(vra) : "—";
                                          })()}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums text-muted-foreground" title="Valor efetivamente pago pelo Exacta ao médico — gross_amount pós-acordo">
                                          {(() => {
                                            const vpe = Number((it as any).valor_pago_exacta) || 0;
                                            return vpe > 0 ? formatCurrency(vpe) : "—";
                                          })()}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[12px] text-right tabular-nums" style={{ color: it.valor_regra ? undefined : 'hsl(var(--muted-foreground))' }}>
                                          {it.valor_regra
                                            ? formatCurrency(Number(it.valor_regra))
                                            : "—"}
                                        </TableCell>
                                        {(() => {
                                          // DIFERENÇA REGRA = quanto o Exacta pagou a mais/menos vs o esperado pela regra.
                                          // Prioriza valor_pago_exacta − valor_regra (o que efetivamente importa para o médico).
                                          // Fallback: diferenca_regra armazenado; depois valor_regra − valor_hospital (legado).
                                          const vr = it.valor_regra != null ? Number(it.valor_regra) : null;
                                          const vpe = Number((it as any).valor_pago_exacta) || 0;
                                          const vh = Number(it.valor_hospital) || 0;
                                          const ve = Number(it.valor_exacta) || 0;
                                          let diff: number | null = null;
                                          let tooltip = "";
                                          if (vpe > 0 && vr != null) {
                                            diff = vpe - vr;
                                            tooltip = "Valor Pago Exacta − Valor Regra";
                                          } else if (it.diferenca_regra != null) {
                                            diff = Number(it.diferenca_regra);
                                            tooltip = "Diferença calculada pela engine";
                                          } else if (vr != null) {
                                            const base = vh > 0 ? vh : ve;
                                            if (base > 0) { diff = vr - base; tooltip = vh > 0 ? "Valor Regra − Valor Hospital" : "Hospital ausente/estorno — comparado vs Valor Exacta"; }
                                          }
                                          return (
                                            <TableCell
                                              className="px-3 py-2 text-[12px] text-right tabular-nums font-semibold"
                                              style={{
                                                color: diff == null
                                                  ? 'hsl(var(--muted-foreground))'
                                                  : (diff > 0.02 ? 'hsl(var(--destructive))' : 'hsl(var(--success))'),
                                              }}
                                              title={tooltip}
                                            >
                                              {diff == null ? "—" : formatCurrency(diff)}
                                            </TableCell>
                                          );
                                        })()}
                                        <TableCell className="px-3 py-2">
                                          {(() => {
                                            const oc = outraCompetenciaBuckets.get(it.id);
                                            if (oc) {
                                              return (
                                                <div className="flex flex-col gap-1">
                                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border border-warning/40 bg-warning/10 text-warning">
                                                    Outra competência
                                                  </span>
                                                  <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                                                    {oc === "aguardando" ? "aguardando base" : "base disponível"}
                                                  </span>
                                                </div>
                                              );
                                            }
                                            return (
                                              <span
                                                className={cn(
                                                  "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                                                  STATUS_TONE[it.status],
                                                )}
                                              >
                                                {STATUS_LABEL[it.status]}
                                              </span>
                                            );
                                          })()}
                                        </TableCell>
                                      </TableRow>
                                      {isRowOpen && (it.ia_obs || it.match_diagnostics) && (
                                        <TableRow key={`${it.id}-exp`}>
                                          <TableCell colSpan={14} className="bg-muted/30 px-4 py-3">
                                            <div className="flex gap-3">
                                              <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                              <div className="flex-1">
                                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                                  Observação da análise
                                                </p>
                                                <p className="text-[12px]">{it.ia_obs ?? <span className="text-muted-foreground italic">Sem observação automática.</span>}</p>
                                                {it.match_diagnostics && (
                                                  <div className="mt-3 rounded-md border border-border bg-background p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Diagnóstico do match</p>
                                                      <span className="text-[10px] text-muted-foreground">
                                                        Decisão: <span className="font-mono">{it.match_diagnostics.decision}</span> · {it.match_diagnostics.candidates_total} candidato(s) Exacta
                                                      </span>
                                                    </div>
                                                    {it.match_diagnostics.fields.length > 0 && (
                                                      <div className="mb-3">
                                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Campos comparados (par aceito)</p>
                                                        <table className="w-full text-[11px]">
                                                          <thead>
                                                            <tr className="text-muted-foreground">
                                                              <th className="text-left font-medium py-0.5">Campo</th>
                                                              <th className="text-left font-medium py-0.5">Hospital</th>
                                                              <th className="text-left font-medium py-0.5">Exacta</th>
                                                              <th className="text-center font-medium py-0.5 w-20">Resultado</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody>
                                                            {it.match_diagnostics.fields.map((f, idx) => (
                                                              <tr key={idx} className="border-t border-border/50">
                                                                <td className="py-1 font-medium">{f.label}</td>
                                                                <td className="py-1">{f.hospital ?? <span className="text-muted-foreground">—</span>}</td>
                                                                <td className="py-1">{f.exacta ?? <span className="text-muted-foreground">—</span>}</td>
                                                                <td className="py-1 text-center">
                                                                  {f.ok === true && <span className="text-emerald-600 dark:text-emerald-400">✓ igual</span>}
                                                                  {f.ok === false && <span className="text-destructive">✗ diferente</span>}
                                                                  {f.ok === null && <span className="text-muted-foreground">— sem dado</span>}
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    )}
                                                    {it.match_diagnostics.candidates.length > 1 && (
                                                      <div>
                                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                                          Candidatos avaliados ({it.match_diagnostics.candidates.length})
                                                        </p>
                                                        <table className="w-full text-[11px]">
                                                          <thead>
                                                            <tr className="text-muted-foreground">
                                                              <th className="text-left font-medium py-0.5">Médico</th>
                                                              <th className="text-left font-medium py-0.5">Função</th>
                                                              <th className="text-left font-medium py-0.5">Via</th>
                                                              <th className="text-right font-medium py-0.5">Valor</th>
                                                              <th className="text-right font-medium py-0.5">Score</th>
                                                              <th className="text-left font-medium py-0.5">Resultado</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody>
                                                            {it.match_diagnostics.candidates.map((c, idx) => (
                                                              <tr key={idx} className={cn("border-t border-border/50", c.chosen && "bg-primary/5")}>
                                                                <td className="py-1">{c.doctor_name ?? "—"}</td>
                                                                <td className="py-1">{c.doctor_role ?? "—"}</td>
                                                                <td className="py-1">{c.access_route ?? "—"}</td>
                                                                <td className="py-1 text-right tabular-nums">{formatCurrency(c.valor_exacta)}</td>
                                                                <td className="py-1 text-right tabular-nums text-muted-foreground">{c.score}</td>
                                                                <td className="py-1">
                                                                  {c.chosen ? (
                                                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ escolhido</span>
                                                                  ) : (
                                                                    <span className="text-muted-foreground">descartado — {c.rejected_reason}</span>
                                                                  )}
                                                                </td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                                {(it.status === "valor_divergente" || it.status === "qtd_divergente") && it.applied_rule_label && (
                                                  <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Regra Exacta:</span>
                                                    <span className="text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                                                      {it.applied_rule_label}
                                                    </span>
                                                    {it.applied_calc_method && (
                                                      <span className="text-[10px] text-muted-foreground">· {it.applied_calc_method}</span>
                                                    )}
                                                  </div>
                                                )}
                                                {!it.action_taken ? (
                                                  <div className="flex gap-2 mt-2 flex-wrap">
                                                    {/* Crédito: hospital pagou A MENOS do que o esperado pela regra
                                                        (so_exacta = nada foi pago; valor_divergente com exacta > hospital).
                                                        Médico/PJ tem a receber → vira crédito no próximo lote. */}
                                                    {(it.status === 'so_exacta' ||
                                                      (it.status === 'valor_divergente' && Number(it.valor_exacta) > Number(it.valor_hospital))) && (
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={actionLoading === it.id}
                                                        onClick={(e) => { e.stopPropagation(); handleAction(it, 'incorporar_credito'); }}
                                                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                                                      >
                                                        {actionLoading === it.id ? '…' : '+ Incorporar como crédito'}
                                                      </Button>
                                                    )}
                                                    {/* Débito: hospital pagou A MAIS do que o esperado (ou pagou algo que
                                                        nem deveria existir — so_hospital). Médico/PJ deve devolver → débito. */}
                                                    {(it.status === 'so_hospital' ||
                                                      (it.status === 'valor_divergente' && Number(it.valor_hospital) > Number(it.valor_exacta))) && (
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={actionLoading === it.id}
                                                        onClick={(e) => { e.stopPropagation(); handleAction(it, 'incorporar_debito'); }}
                                                        className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
                                                      >
                                                        {actionLoading === it.id ? '…' : '− Incorporar como débito'}
                                                      </Button>
                                                    )}
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      disabled={actionLoading === it.id}
                                                      onClick={(e) => { e.stopPropagation(); handleAction(it, 'ignorar'); }}
                                                    >
                                                      Ignorar
                                                    </Button>
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      disabled={actionLoading === it.id}
                                                      onClick={(e) => { e.stopPropagation(); handleAction(it, 'revisar_manual'); }}
                                                      className="border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                                                    >
                                                      Revisar manualmente
                                                    </Button>
                                                    {/* Rolar débito residual: quando há valor "a recuperar" (diferenca_regra > 0)
                                                        e a produção do lote não cobre. Vira glosa_debts parcelada e cobra
                                                        na próxima produção da médica em qualquer PJ vinculada neste hospital. */}
                                                    {Number(it.diferenca_regra ?? 0) > 0 && it.payment_item_id && (
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={actionLoading === it.id}
                                                        onClick={(e) => { e.stopPropagation(); handleAction(it, 'rolar_debito_residual'); }}
                                                        className="border-orange-500/30 bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300"
                                                        title="Cria débito parcelado (12x) cobrado na próxima produção da médica em qualquer PJ vinculada neste hospital"
                                                      >
                                                        ↻ Rolar para próximo repasse
                                                      </Button>
                                                    )}
                                                    {it.status === 'so_exacta' && (
                                                      <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={actionLoading === it.id}
                                                        onClick={(e) => { e.stopPropagation(); handleAction(it, 'marcar_glosa'); }}
                                                        className="border-yellow-500/30 bg-yellow-500/10 text-yellow-800 hover:bg-yellow-500/20 dark:text-yellow-300"
                                                      >
                                                        Marcar como glosa
                                                      </Button>
                                                    )}
                                                    {(it.status === 'so_exacta' || it.status === 'empresa_ausente' || it.status === 'possivel_pacote') && it.payment_item_id && (
                                                      <>
                                                        <Button
                                                          size="sm"
                                                          variant="outline"
                                                          disabled={actionLoading === it.id}
                                                          onClick={(e) => { e.stopPropagation(); openCancelForItem(it); }}
                                                          className="border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
                                                        >
                                                          Cancelar item deste pagamento
                                                        </Button>
                                                        {it.attendance_number && it.company_name && (
                                                          <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            disabled={actionLoading === it.id}
                                                            onClick={(e) => { e.stopPropagation(); openCancelForAttendance(it); }}
                                                            className="text-destructive hover:bg-destructive/10"
                                                            title="Cancela todos os itens deste atendimento + empresa"
                                                          >
                                                            Cancelar atendimento inteiro
                                                          </Button>
                                                        )}
                                                      </>
                                                    )}
                                                  </div>

                                                ) : (
                                                  <div className={cn(
                                                    "inline-flex items-center gap-2 mt-2 px-3 py-1 rounded-md text-[11px] font-semibold border",
                                                    it.action_taken === 'incorporar_credito' && 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
                                                    it.action_taken === 'incorporar_debito' && 'bg-destructive/10 text-destructive border-destructive/30',
                                                    it.action_taken === 'ignorar' && 'bg-muted text-muted-foreground border-border',
                                                    it.action_taken === 'revisar_manual' && 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
                                                    it.action_taken === 'marcar_glosa' && 'bg-yellow-500/10 text-yellow-800 border-yellow-500/30 dark:text-yellow-300',
                                                    it.action_taken === 'cancelado_conciliacao' && 'bg-destructive/10 text-destructive border-destructive/30',
                                                    it.action_taken === 'rolar_debito_residual' && 'bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-300',
                                                  )}>
                                                    {({
                                                      incorporar_credito: '✓ Crédito incorporado ao próximo lote',
                                                      incorporar_debito: '✓ Débito incorporado ao próximo lote',
                                                      ignorar: '— Ignorado',
                                                      revisar_manual: '⚠ Revisão manual pendente',
                                                      marcar_glosa: '⚠ Marcado como glosa',
                                                      cancelado_conciliacao: '✓ Cancelado via conciliação',
                                                      rolar_debito_residual: '↻ Débito residual rolado — próxima produção',
                                                    } as Record<string, string>)[it.action_taken!] ?? it.action_taken}
                                                  </div>
                                                )}
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
                            </div>
                            {!isAll && totalPages > 1 && (() => {
                              // Janela compacta de páginas (máx. 7 botões), com
                              // elipse para grandes volumes.
                              const window = 2;
                              const pages: (number | "…")[] = [];
                              const push = (p: number | "…") => pages.push(p);
                              push(0);
                              const from = Math.max(1, currentPage - window);
                              const to = Math.min(totalPages - 2, currentPage + window);
                              if (from > 1) push("…");
                              for (let p = from; p <= to; p++) push(p);
                              if (to < totalPages - 2) push("…");
                              if (totalPages > 1) push(totalPages - 1);
                              return (
                                <div className="px-4 py-2 border-t border-border bg-background flex items-center justify-between gap-3 text-xs flex-wrap">
                                  <span className="text-muted-foreground">
                                    Mostrando{" "}
                                    <strong className="text-foreground tabular-nums">{startIdx + 1}</strong>–
                                    <strong className="text-foreground tabular-nums">{endIdx}</strong> de{" "}
                                    <strong className="text-foreground tabular-nums">{total}</strong> itens
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="outline" size="sm" className="h-7 px-2 text-xs"
                                      disabled={currentPage === 0}
                                      onClick={() => goToPage(currentPage - 1)}
                                      aria-label="Página anterior"
                                    >
                                      ‹ Anterior
                                    </Button>
                                    {pages.map((p, i) => (
                                      p === "…" ? (
                                        <span key={`e-${i}`} className="px-1 text-muted-foreground">…</span>
                                      ) : (
                                        <Button
                                          key={p}
                                          variant={p === currentPage ? "default" : "outline"}
                                          size="sm"
                                          className="h-7 min-w-7 px-2 text-xs tabular-nums"
                                          onClick={() => goToPage(p)}
                                          aria-current={p === currentPage ? "page" : undefined}
                                        >
                                          {p + 1}
                                        </Button>
                                      )
                                    ))}
                                    <Button
                                      variant="outline" size="sm" className="h-7 px-2 text-xs"
                                      disabled={currentPage >= totalPages - 1}
                                      onClick={() => goToPage(currentPage + 1)}
                                      aria-label="Próxima página"
                                    >
                                      Próxima ›
                                    </Button>
                                  </div>
                                </div>
                              );
                            })()}
                            <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                              <span>{companyItems.length} itens</span>
                              <div className="flex gap-6">
                                <span>
                                  Exacta:{" "}
                                  <strong className="tabular-nums">{formatCurrency(totalMed)}</strong>
                                </span>
                                <span>
                                  Hospital:{" "}
                                  <strong className="tabular-nums">{formatCurrency(totalHosp)}</strong>
                                </span>
                                {(() => {
                                  // Se houver itens com valor_pago_exacta, totalizar a diferença real (pago − regra).
                                  // Caso contrário, cai no Δ tradicional (hospital − exacta).
                                  const itemsWithVpe = companyItems.filter((i: any) => Number(i.valor_pago_exacta) > 0 && i.valor_regra != null);
                                  const useRuleDiff = itemsWithVpe.length > 0;
                                  const ruleDiff = itemsWithVpe.reduce((s: number, i: any) => s + (Number(i.valor_pago_exacta) - Number(i.valor_regra)), 0);
                                  const delta = useRuleDiff ? ruleDiff : (totalHosp - totalMed);
                                  return (
                                    <span
                                      className={cn(
                                        "font-semibold tabular-nums",
                                        delta > 0
                                          ? "text-destructive"
                                          : delta < 0
                                            ? "text-success"
                                            : "text-muted-foreground",
                                      )}
                                      title={useRuleDiff ? "Σ (Valor Pago Exacta − Valor Regra) dos itens com regra" : "Hospital − Exacta"}
                                    >
                                      Δ {formatCurrency(Math.abs(delta))}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                          );
                        })()}
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
      <AlertDialog open={scopeDialogOpen} onOpenChange={setScopeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Escopo do reprocessamento</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Este arquivo cobre{" "}
                  <strong>
                    {scopeDialogInfo?.newCompanies.length ?? 0} empresa(s)
                  </strong>
                  : {scopeDialogInfo?.newCompanies.join(", ") || "—"}.
                </p>
                <p>
                  A conciliação anterior também tem{" "}
                  <strong>
                    {scopeDialogInfo?.keepCompanies.length ?? 0} empresa(s)
                  </strong>{" "}
                  que NÃO estão neste arquivo:{" "}
                  {scopeDialogInfo?.keepCompanies.join(", ") || "—"}.
                </p>
                <p>Como deseja prosseguir?</p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>
                    <strong>Somente estas empresas</strong>: reprocessa apenas as
                    empresas do arquivo e <em>mantém</em> os resultados das demais.
                  </li>
                  <li>
                    <strong>Reprocessar tudo</strong>: descarta os dados das demais
                    empresas e usa apenas este arquivo.
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setScopeDialogOpen(false);
                handleProcessReconciliation("replace");
              }}
            >
              Reprocessar tudo
            </Button>
            <AlertDialogAction
              onClick={() => {
                setScopeDialogOpen(false);
                handleProcessReconciliation("merge_keep_others");
              }}
            >
              Somente estas empresas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar conciliação</DialogTitle>
            <DialogDescription>
              Escolha o formato e quais tipos de itens incluir. A exportação respeita os
              filtros de empresa, médico e busca já aplicados na tela.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Formato
              </Label>
              <RadioGroup
                value={exportFormat}
                onValueChange={(v) => setExportFormat(v as ExportFormat)}
                className="grid grid-cols-3 gap-2"
              >
                {([
                  { v: "xlsx", l: "Excel" },
                  { v: "csv", l: "CSV" },
                  { v: "pdf", l: "PDF" },
                ] as const).map((opt) => (
                  <Label
                    key={opt.v}
                    htmlFor={`exp-fmt-${opt.v}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                      exportFormat === opt.v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem id={`exp-fmt-${opt.v}`} value={opt.v} />
                    <span>{opt.l}</span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tipos de itens
                </Label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setAllExportStatuses(true)}
                  >
                    Marcar todos
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setAllExportStatuses(false)}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 rounded-md border p-2">
                {ALL_STATUS_KEYS.map((k) => {
                  const checked = exportStatuses.has(k);
                  const count = exportCounts[k] ?? 0;
                  return (
                    <Label
                      key={k}
                      htmlFor={`exp-st-${k}`}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`exp-st-${k}`}
                          checked={checked}
                          onCheckedChange={() => toggleExportStatus(k)}
                        />
                        <span className="text-sm">{STATUS_LABEL[k]}</span>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                    </Label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Total a exportar:{" "}
                <strong className="text-foreground">
                  {filteredItems.filter((it) => exportStatuses.has(it.status)).length}
                </strong>{" "}
                de {filteredItems.length} itens visíveis
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={runExport} disabled={exportStatuses.size === 0}>
              <FileDown className="h-4 w-4 mr-1.5" />
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {cancelScope && run?.id && paymentId && (
        <CancelByReconciliationDialog
          open={!!cancelScope}
          onOpenChange={(v) => { if (!v) setCancelScope(null); }}
          runId={run.id}
          paymentId={paymentId}
          scope={cancelScope}
          onCancelled={() => {
            setCancelScope(null);
            // Recarrega lista de itens da conciliação para refletir action_taken
            void loadLatestRun();
            // Notifica a tela pai para recomputar Bruto/Líquido em tempo real,
            // sem exigir fechar o modal ou usar "Reaplicar regras".
            onItemsChanged?.();
          }}
        />
      )}
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
