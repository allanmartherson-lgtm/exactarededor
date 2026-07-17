import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { SafeCard } from "@/components/ui/SafeCard";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { formatCurrency, formatDate, formatCompetence, PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, PAYMENT_TRACK_SHORT_LABELS, type PaymentStatus, type PaymentType, type PaymentKind, type PaymentTrack } from "@/lib/status";
import { Search, X, User, Tag, Clock, Building2, AlertTriangle, UserCheck, RefreshCcw, Sparkles, Archive, Inbox, MessageCircleQuestion, ChevronDown, ChevronsUpDown, Stethoscope, Trash2, SlidersHorizontal, Receipt, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, EyeOff } from "lucide-react";
import { DoctorCombobox } from "@/components/DoctorCombobox";
import { usePaymentRisk } from "@/hooks/usePaymentRisk";
import { useItemTypes } from "@/hooks/useItemTypes";
import { RiskBadge } from "@/components/payment-detail/RiskBadge";
import { PriorityBadge } from "@/components/payment-detail/PriorityBadge";
import { calcPriorityScore } from "@/lib/paymentPriority";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSelectPopover } from "@/components/ui/MultiSelectPopover";
import { evaluateSla, type SlaSetting, type CompanySlaOverride } from "@/lib/sla";
import { TERMINAL_STATUSES } from "@/lib/paymentFlow";
import { toast } from "sonner";
import { BonusPacienteDialog } from "@/components/payments/BonusPacienteDialog";

interface Row {
  id: string;
  reference: string;
  status: PaymentStatus;
  total_amount: number | string;
  bruto_total?: number | string | null;
  liquido_total?: number | string | null;
  items_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  competence_month: string | null;
  competence_months: string[] | null;
  payment_due_date: string | null;
  payment_type: PaymentType | null;
  payment_kind: PaymentKind | null;
  payment_track?: PaymentTrack | null;
  processing_diagnostics?: any;
  processing_timeout_occurred?: boolean;
  priority_score?: number | null;
  import_mode?: string | null;
  origem?: string | null;
}


interface StatusEntry { status: PaymentStatus; changed_at: string }

/**
 * Status que NÃO consomem SLA, mesmo não sendo terminais.
 * Inclui terminais (lancado/pago/rejeitado/cancelado) + nf_conciliada
 * (aguarda apenas o analista marcar como lançado, sem prazo apertado).
 *
 * Conceitos separados de TERMINAL_STATUSES:
 *  - TERMINAL: arquivar / esconder das filas ativas.
 *  - SLA_EXEMPT: não calcular nível de atraso.
 */
const SLA_EXEMPT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  ...TERMINAL_STATUSES,
  "nf_conciliada",
  // Lançamentos históricos / pagamentos concluídos não têm SLA ativo —
  // não fazem sentido como "atrasados" porque já saíram do fluxo operacional.
  "lancado",
  "pago",
]);

// Status considerados "concluídos" (saída natural do fluxo, mas não terminais
// como `arquivado`/`rejeitado`/`cancelado`). Escondidos por padrão para não
// poluir a fila de trabalho.
const CONCLUDED_STATUSES: ReadonlySet<string> = new Set<string>(["pago", "lancado"]);

const formatDuration = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const delayLevel = (status: PaymentStatus, ms: number): "none" | "leve" | "critico" => {
  if (SLA_EXEMPT_STATUSES.has(status)) return "none";
  const days = ms / 86400000;
  if (days >= 7) return "critico";
  if (days >= 3) return "leve";
  return "none";
};

type OwnerGroup = "all" | "analista" | "validador" | "diretor";

// Status "pendentes" para cada papel — define quem precisa agir AGORA.
// O analista é dono do ciclo de NF (do `aprovado` até `lancado`), portanto a
// prioridade dele reaparece automaticamente assim que o lote retorna para
// qualquer status pós-aprovação do diretor.
const STATUSES_BY_OWNER: Record<Exclude<OwnerGroup, "all">, PaymentStatus[]> = {
  analista: [
    "rascunho",
    "em_analise_ia",
    "revisao_analista",
    "devolvido_analista",
    "revisao_pos_aprovacao",
    "aprovado_em_revisao",
    "aprovado",
    "aprovado_com_ressalva",
    "aprovado_parcial",
    "pedido_nf_enviado",
    "nf_recebida",
    "nf_questionada",
    "nf_divergente",
    "nf_conciliada",
    "lancado",
  ],
  validador: ["aguardando_validacao"],
  diretor: ["aguardando_aprovacao"],
};

const OWNER_LABELS: Record<Exclude<OwnerGroup, "all">, string> = {
  analista: "Com analista",
  validador: "Com validador",
  diretor: "Com diretor",
};

/** Componente isolado para calcular e exibir o badge de risco em uma linha de listagem.
 *  Mantido como subcomponente para que cada linha tenha seu próprio hook (Rules of Hooks). */
const PaymentRiskBadgeInline = ({ paymentId, compact = false }: { paymentId: string; compact?: boolean }) => {
  const risk = usePaymentRisk(paymentId);
  if (!risk || risk.score <= 0) return null;
  return (
    <RiskBadge
      level={risk.level}
      score={risk.score}
      financialData={risk}
      showLabel={!compact}
      className={compact ? "scale-75 origin-left" : "scale-90 origin-left"}
    />
  );
};

/** Badge de prioridade por lote — combina risco + SLA + tempo parado + valor. */
const PaymentPriorityBadgeInline = ({
  paymentId,
  slaLevel,
  elapsedDays,
  status,
  totalAmount,
  itemsCount,
}: {
  paymentId: string;
  slaLevel: "ok" | "preventivo" | "vencido" | null;
  elapsedDays: number;
  status: string;
  totalAmount: number;
  itemsCount: number;
}) => {
  const risk = usePaymentRisk(paymentId);
  const priority = calcPriorityScore({
    slaLevel,
    elapsedDays,
    riskScore: risk?.score ?? 0,
    status,
    totalAmount,
    itemsCount,
  });
  return <PriorityBadge score={priority} />;
};


// Persistência de filtros/busca/paginação da lista de pagamentos.
// Mantém estado entre navegações (ex: voltar do detalhe após excluir um lote).
const PAYMENTS_LIST_STATE_KEY = "payments:list:state:v1";
type PersistedPaymentsState = Partial<{
  page: number;
  pageSize: number;
  q: string;
  companyFilter: CompanyOption | null;
  doctorFilter: { id: string; full_name: string; crm: string | null; crm_uf: string | null } | null;
  analystFilter: string[];
  typeFilter: string[];
  itemTypeFilter: string[];
  trackFilter: string[];
  statusFilter: string[];
  competenceFilter: string;
  view: "lista" | "kanban";
  sortBy: "relevance" | "created" | "elapsed" | "status" | "priority";
  colSort: { col: ColSortCol; dir: "asc" | "desc" } | null;
  divergenceFilter: "all" | "with" | "without";
  questionedFilter: "all" | "with" | "without";
  poolFilter: string[];
  importModeFilter: Array<"normal" | "historico">;
  emptyOnly: boolean;
  hasProposedGlosas: boolean;
  hasAppliedDebits: boolean;
  hasAppliedCredits: boolean;
  hasAlerts: boolean;
  archivedView: boolean;
  showConcluded: boolean;
}>;
type ColSortCol = "reference" | "competence" | "elapsed" | "items" | "value" | "status";
const loadPersistedPaymentsState = (): PersistedPaymentsState => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(PAYMENTS_LIST_STATE_KEY);
    return raw ? (JSON.parse(raw) as PersistedPaymentsState) : {};
  } catch {
    return {};
  }
};

const Payments = () => {
  const { roles, user } = useAuth();
  // Hospital ativo — CRÍTICO no multi-tenant: sem depender daqui, a listagem
  // continuava exibindo dados do hospital anterior após a troca no header,
  // porque a RPC `list_payments` filtra por `current_active_hospital()` mas o
  // load() não era re-disparado. Sintoma: usuário troca de DF Star para Santa
  // Helena/Luzia e continua vendo os lotes do DF Star (grave — analista pode
  // agir em lote da unidade errada).
  const { hospital, switching: hospitalSwitching } = useHospital();
  const activeHospitalId = hospital?.id ?? null;
  const isAnalista = roles.includes("analista") || roles.includes("admin");
  const isDiretor = roles.includes("diretor") || roles.includes("admin");
  const isAdmin = roles.includes("admin");
  const [searchParams, setSearchParams] = useSearchParams();
  const persisted = useMemo<PersistedPaymentsState>(() => loadPersistedPaymentsState(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [bonusOpen, setBonusOpen] = useState(false);
  // Paginação server-side via RPC list_payments. `totalRows` é o total filtrado
  // no banco (não só desta página); `rows` contém apenas a página atual.
  const [totalRows, setTotalRows] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(persisted.page ?? 0);
  const [pageSize, setPageSize] = useState(persisted.pageSize ?? 100);
  const [q, setQ] = useState(persisted.q ?? "");
  // Termo de busca com debounce — evita refetch a cada tecla.
  const [debouncedQ, setDebouncedQ] = useState(persisted.q ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<CompanyOption | null>(persisted.companyFilter ?? null);
  const [doctorFilter, setDoctorFilter] = useState<{ id: string; full_name: string; crm: string | null; crm_uf: string | null } | null>(persisted.doctorFilter ?? null);
  const [searching, setSearching] = useState(false);
  const [analysts, setAnalysts] = useState<Record<string, string>>({});
  const [companiesPerPayment, setCompaniesPerPayment] = useState<Record<string, number>>({});
  const [statusEnteredAt, setStatusEnteredAt] = useState<Record<string, string>>({});
  const [analystFilter, setAnalystFilter] = useState<string[]>(persisted.analystFilter ?? []);
  const [typeFilter, setTypeFilter] = useState<string[]>(persisted.typeFilter ?? []);
  const [itemTypeFilter, setItemTypeFilter] = useState<string[]>(persisted.itemTypeFilter ?? []);
  const { list: itemTypesList } = useItemTypes({ onlyActive: true });
  const [trackFilter, setTrackFilter] = useState<string[]>(persisted.trackFilter ?? []);
  const [statusFilter, setStatusFilter] = useState<string[]>(() => {
    const raw: any = persisted.statusFilter;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw && raw !== "all") return [raw];
    return [];
  });
  const [competenceFilter, setCompetenceFilter] = useState<string>(persisted.competenceFilter ?? "all");
  const [delayedOnly, setDelayedOnly] = useState(searchParams.get("delayed") === "1");
  // Filtros vindos do Dashboard ("seus pagamentos por papel"). Quando ativos
  // restringem por grupo de status + (opcional) só os meus.
  const [ownerGroup, setOwnerGroup] = useState<OwnerGroup>(() => {
    const s = searchParams.get("status");
    return s === "analista" || s === "validador" || s === "diretor" ? s : "all";
  });
  const [onlyMine, setOnlyMine] = useState(() => searchParams.get("owner") === "me");

  // Filtro automático na primeira abertura: aplica ownerGroup conforme papel
  // se não houver ?status= na querystring. Admin não recebe auto-filtro.
  // Prioridade: diretor > validador > analista.
  useEffect(() => {
    const st = searchParams.get("status");
    if (st) return;
    if (roles.includes("admin")) return;
    let auto: OwnerGroup | null = null;
    if (roles.includes("diretor")) auto = "diretor";
    else if (roles.includes("validador")) auto = "validador";
    if (!auto) return;
    setOwnerGroup(auto);
    const next = new URLSearchParams(searchParams);
    next.set("status", auto);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza filtros simples vindos de outras telas (ex: Dashboard)
  useEffect(() => {
    setDelayedOnly(searchParams.get("delayed") === "1");
    setOpenQuestionOnly(searchParams.get("open_questions") === "1");
    const st = searchParams.get("status");
    if (st === "analista" || st === "validador" || st === "diretor") {
      setOwnerGroup(st);
    } else if (st) {
      setStatusFilter([st]);
    }
    setOnlyMine(searchParams.get("owner") === "me");
  }, [searchParams]);

  const [view, setView] = useState<"lista" | "kanban">(persisted.view ?? "lista");
  const [sortBy, setSortBy] = useState<"relevance" | "created" | "elapsed" | "status" | "priority">(persisted.sortBy ?? "relevance");
  // Ordenação por clique no cabeçalho da tabela — sobrescreve `sortBy` quando ativa.
  // Default: competência DESC (mais recente primeiro) para combater "perdi a competência atual".
  const [colSort, setColSort] = useState<{ col: ColSortCol; dir: "asc" | "desc" } | null>(
    persisted.colSort ?? { col: "competence", dir: "desc" },
  );
  // Arquivados: lotes em estado terminal (lancado/pago/rejeitado/cancelado).
  // Default = "ativos" — esconde finalizados das filas de trabalho diárias.
  // Pode ser ligado via querystring (?archived=1) ou pelo toggle na UI.
  const [archivedView, setArchivedView] = useState<boolean>(
    searchParams.get("archived") === "1" || persisted.archivedView === true,
  );
  // Concluídos (pago/lançado): saem do fluxo operacional mas não são "arquivados".
  // Escondidos por padrão; podem ser exibidos via ?concluded=1 ou pelo toggle.
  const [showConcluded, setShowConcluded] = useState<boolean>(
    searchParams.get("concluded") === "1" || persisted.showConcluded === true,
  );
  const [slaSettings, setSlaSettings] = useState<Record<string, SlaSetting>>({});
  const [companyOverrides, setCompanyOverrides] = useState<Record<string, CompanySlaOverride>>({});
  const [companyByPayment, setCompanyByPayment] = useState<Record<string, string | null>>({});
  // Filtros avançados (não dependem de "criado por")
  const [divergenceFilter, setDivergenceFilter] = useState<"all" | "with" | "without">(persisted.divergenceFilter ?? "all");
  const [questionedFilter, setQuestionedFilter] = useState<"all" | "with" | "without">(persisted.questionedFilter ?? "all");
  const [poolFilter, setPoolFilter] = useState<string[]>(persisted.poolFilter ?? []);
  const [importModeFilter, setImportModeFilter] = useState<Array<"normal" | "historico">>(persisted.importModeFilter ?? []);
  const [emptyOnly, setEmptyOnly] = useState<boolean>(persisted.emptyOnly ?? false);
  const [hasProposedGlosas, setHasProposedGlosas] = useState<boolean>(persisted.hasProposedGlosas ?? false);
  const [hasAppliedDebits, setHasAppliedDebits] = useState<boolean>(persisted.hasAppliedDebits ?? false);
  const [hasAppliedCredits, setHasAppliedCredits] = useState<boolean>(persisted.hasAppliedCredits ?? false);
  const [hasAlerts, setHasAlerts] = useState<boolean>(persisted.hasAlerts ?? false);
  const [poolOptions, setPoolOptions] = useState<Array<{ id: string; nome: string }>>([]);
  // Contagem de perguntas internas abertas por lote (badge nas listagens).
  const [openQuestionCount, setOpenQuestionCount] = useState<Record<string, number>>({});
  const [openQuestionOnly, setOpenQuestionOnly] = useState(() => searchParams.get("open_questions") === "1");
  // Fila de reprocessamento: ids selecionados + estado de execução em lote.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState<{ done: number; total: number } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Stats globais (independentes da página atual) — alimentam o toggle de
  // arquivados, o filtro de competência e o filtro de analista.
  const [globalArchivedCount, setGlobalArchivedCount] = useState<number>(0);
  const [globalCompetences, setGlobalCompetences] = useState<string[]>([]);
  const [globalAnalysts, setGlobalAnalysts] = useState<Record<string, string>>({});

  // Persiste filtros/busca/paginação em sessionStorage para preservar contexto
  // ao voltar do detalhe (ex.: depois de excluir um lote, navegar back, etc.).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const snapshot: PersistedPaymentsState = {
      page, pageSize, q,
      companyFilter, doctorFilter,
      analystFilter, typeFilter, itemTypeFilter, trackFilter, statusFilter, competenceFilter,
      view, sortBy, colSort,
      divergenceFilter, questionedFilter,
      poolFilter, importModeFilter, emptyOnly,
      hasProposedGlosas, hasAppliedDebits, hasAppliedCredits, hasAlerts,
      archivedView,
      showConcluded,
    };
    try {
      window.sessionStorage.setItem(PAYMENTS_LIST_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore quota errors
    }
  }, [
    page, pageSize, q,
    companyFilter, doctorFilter,
    analystFilter, typeFilter, itemTypeFilter, trackFilter, statusFilter, competenceFilter,
    view, sortBy, colSort,
    divergenceFilter, questionedFilter,
    poolFilter, importModeFilter, emptyOnly,
    hasProposedGlosas, hasAppliedDebits, hasAppliedCredits, hasAlerts,
    archivedView,
    showConcluded,
  ]);


  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [reanalysisConfirm, setReanalysisConfirm] = useState<{
    ids: string[];
    aiCount: number | null;
    totalCount: number | null;
    loading: boolean;
  } | null>(null);
  // IA opt-in: analista precisa marcar explicitamente para consumir créditos.
  const [reanalysisRunAi, setReanalysisRunAi] = useState(false);

  const openReanalysisConfirm = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setReanalysisRunAi(false);
    setReanalysisConfirm({ ids, aiCount: null, totalCount: null, loading: true });
    try {
      // Estima o custo: quantos itens IRÃO para IA (needs_ai_review) vs total analisado.
      const [{ count: aiCount }, { count: totalCount }] = await Promise.all([
        supabase
          .from("payment_items")
          .select("id", { count: "exact", head: true })
          .in("payment_id", ids)
          .eq("ai_status", "needs_ai_review" as any),
        supabase
          .from("payment_items")
          .select("id", { count: "exact", head: true })
          .in("payment_id", ids),
      ]);
      setReanalysisConfirm({
        ids,
        aiCount: aiCount ?? 0,
        totalCount: totalCount ?? 0,
        loading: false,
      });
    } catch (e) {
      console.warn("[Payments] falha ao estimar custo de reanálise", e);
      setReanalysisConfirm({ ids, aiCount: null, totalCount: null, loading: false });
    }
  };

  const runReanalysis = async () => {
    const ids = reanalysisConfirm?.ids ?? Array.from(selected);
    const runAi = reanalysisRunAi;
    setReanalysisConfirm(null);
    if (ids.length === 0) return;
    setReprocessing(true);
    setReprocessProgress({ done: 0, total: ids.length });
    let ok = 0; let fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const { error } = await supabase.functions.invoke("dispatch-payment-analysis", {
          body: { payment_id: ids[i], ...(runAi ? { run_ai: true } : {}) },
        });
        if (error) throw error;
        ok++;
      } catch (e) {
        console.error("reanalyze failed", ids[i], e);
        fail++;
      }
      setReprocessProgress({ done: i + 1, total: ids.length });
    }
    setReprocessing(false);
    setReprocessProgress(null);
    setSelected(new Set());
    setReanalysisRunAi(false);
    toast.success(`Reanálise concluída: ${ok} ok${fail ? `, ${fail} com falha` : ""}`);
  };


  const deletePayment = async (id: string) => {
    try {
      setDeletingIds(prev => new Set(prev).add(id));
      console.log(`Iniciando exclusão atômica do lote ${id}...`);
      
      // Chamada via RPC para garantir execução atômica no lado do servidor
      // e ignorar qualquer cache de cliente ou restrição de trigger
      const { data, error } = await supabase.rpc("delete_payment_batch", {
        p_payment_id: id
      });

      const result = data as { ok: boolean; error?: string } | null;

      if (error || !result?.ok) {
        const message = result?.error ?? error?.message ?? "Erro desconhecido ao excluir lote";
        throw new Error(message);
      }
      
      toast.success("Lote excluído permanentemente.");
      
      toast.success("Lote excluído permanentemente.");
      
      // Atualiza o estado local e remove da seleção
      setRows(prev => prev.filter(r => r.id !== id));
      setSelected(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    } catch (e: any) {
      console.error("Falha crítica na exclusão:", e);
      toast.error("Erro ao excluir lote: " + e.message);
    } finally {
      setDeletingIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  // Debounce do termo de busca (espera 300ms antes de disparar refetch).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    setSearching(q.trim().length > 0 && q.trim() !== debouncedQ);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Reset de página sempre que qualquer filtro muda.
  useEffect(() => {
    setPage(0);
  }, [
    debouncedQ, companyFilter?.id, doctorFilter?.id, analystFilter, typeFilter, itemTypeFilter, trackFilter,
    statusFilter, competenceFilter, delayedOnly, ownerGroup, onlyMine,
    divergenceFilter, questionedFilter, openQuestionOnly, archivedView, pageSize, sortBy,
    poolFilter, importModeFilter, emptyOnly,
  ]);

  // Mapeia ordenação da UI para o parâmetro _sort da RPC list_payments.
  const rpcSort = useMemo(() => {
    if (sortBy === "created") return "created";
    if (sortBy === "status") return "status";
    // "relevance", "priority" e "elapsed" caem em priority_score (que já
    // incorpora SLA + tempo parado + valor + erros).
    return "priority";
  }, [sortBy]);

  // Statuses que serão enviados ao servidor. ownerGroup, statusFilter e archivedView
  // se combinam aqui — toda a filtragem por status acontece server-side.
  const ALL_STATUSES = useMemo(() => Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[], []);
  const serverStatuses = useMemo<string[] | undefined>(() => {
    const terminal = Array.from(TERMINAL_STATUSES) as string[];
    const nonTerminal = ALL_STATUSES.filter((s) => !TERMINAL_STATUSES.has(s));
    let base: string[] = archivedView ? terminal : nonTerminal;
    // Concluídos (pago/lançado) só aparecem se: (a) a visão de arquivados estiver
    // ativa, (b) o usuário ligou explicitamente "ver concluídos", ou (c) o filtro
    // de status pediu um desses status diretamente.
    if (!archivedView && !showConcluded && statusFilter.length === 0) {
      base = base.filter((s) => !CONCLUDED_STATUSES.has(s));
    }
    if (statusFilter.length > 0) {
      base = statusFilter;
    }
    if (ownerGroup !== "all") {
      const allowed = STATUSES_BY_OWNER[ownerGroup] as readonly string[];
      base = base.filter((s) => allowed.includes(s));
      if (base.length === 0) base = [...allowed];
    }
    if (onlyMine) {
      const mine = new Set<string>();
      if (roles.includes("analista") || roles.includes("admin")) STATUSES_BY_OWNER.analista.forEach((s) => mine.add(s));
      if (roles.includes("validador") || roles.includes("admin")) STATUSES_BY_OWNER.validador.forEach((s) => mine.add(s));
      if (roles.includes("diretor") || roles.includes("admin")) STATUSES_BY_OWNER.diretor.forEach((s) => mine.add(s));
      if (mine.size) base = base.filter((s) => mine.has(s));
    }
    return base.length ? base : undefined;
  }, [archivedView, showConcluded, statusFilter, ownerGroup, onlyMine, roles, ALL_STATUSES]);

  // Monta o objeto de filtros que será enviado para a RPC.
  const rpcFilters = useMemo(() => {
    const f: Record<string, any> = {};
    if (serverStatuses) f.statuses = serverStatuses;
    if (typeFilter.length > 0) f.payment_types = typeFilter;
    if (itemTypeFilter.length > 0) f.item_type_ids = itemTypeFilter;
    if (trackFilter.length > 0) f.payment_tracks = trackFilter;
    if (analystFilter.length > 0) f.created_by_ids = analystFilter;
    if (companyFilter?.id) f.company_ids = [companyFilter.id];
    if (doctorFilter?.id) f.doctor_ids = [doctorFilter.id];
    if (competenceFilter !== "all") {
      // YYYY-MM → primeiro/último dia do mês
      const [y, m] = competenceFilter.split("-").map(Number);
      const from = new Date(Date.UTC(y, m - 1, 1));
      const to = new Date(Date.UTC(y, m, 0));
      f.competence_from = from.toISOString().slice(0, 10);
      f.competence_to = to.toISOString().slice(0, 10);
    }
    if (debouncedQ.length >= 2) f.search = debouncedQ;
    if (delayedOnly) f.only_overdue = true;
    if (openQuestionOnly) f.only_open_questions = true;
    if (divergenceFilter === "with") f.only_divergence = true;
    if (questionedFilter !== "all") f.with_questions = questionedFilter;
    if (poolFilter.length > 0) f.pool_ids = poolFilter;
    if (importModeFilter.length > 0) f.import_modes = importModeFilter;
    if (emptyOnly) f.only_empty = true;
    if (hasProposedGlosas) f.has_proposed_glosas = true;
    if (hasAppliedDebits) f.has_applied_debits = true;
    if (hasAppliedCredits) f.has_applied_credits = true;
    if (hasAlerts) f.has_alerts = true;
    return f;
  }, [serverStatuses, typeFilter, itemTypeFilter, trackFilter, analystFilter, companyFilter, doctorFilter,
      competenceFilter, debouncedQ, delayedOnly, openQuestionOnly,
      divergenceFilter, questionedFilter, poolFilter, importModeFilter, emptyOnly,
      hasProposedGlosas, hasAppliedDebits, hasAppliedCredits, hasAlerts]);

  const load = useCallback(async () => {
    // Enquanto o header ainda está sincronizando a troca de hospital, evita
    // fazer fetch — a RPC leria `current_active_hospital()` do valor antigo e
    // renderizaria os lotes da unidade anterior por alguns ms/segundos.
    if (hospitalSwitching) return;
    if (!activeHospitalId) { setRows([]); setTotalRows(0); setLoading(false); return; }
    setLoading(true);
    try {
      // Em modo Kanban carregamos um lote maior para que todas as colunas
      // tenham conteúdo. Em lista, respeita a paginação.
      const effectiveLimit = view === "kanban" ? 1000 : pageSize;
      const effectiveOffset = view === "kanban" ? 0 : page * pageSize;
      const { data, error } = await supabase.rpc("list_payments", {
        _filters: rpcFilters,
        _limit: effectiveLimit,
        _offset: effectiveOffset,
        _sort: rpcSort,
      });
      if (error) throw error;
      const payload = (data ?? {}) as { rows?: any[]; total?: number };
      const list = (payload.rows ?? []) as Row[];
      setRows(list);
      setTotalRows(Number(payload.total ?? 0));

      // Flags de divergência/questionamento já vêm por linha na RPC (has_divergence/has_open_question)
      // e são consumidas direto pelos badges; não precisamos manter sets locais.

      const ids = list.map((r) => r.id);
      const userIds = Array.from(new Set(list.map((r) => r.created_by).filter(Boolean))) as string[];

      // Dados companion escopados aos IDs visíveis — mantém renderização rica
      // (analistas, empresas/PJ, SLAs, histórico de status) sem custo de tabela inteira.
      const [profsRes, groupsRes, jobsRes, histRes, slasRes, openQsRes, modesRes] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("id,full_name,email").in("id", userIds)
          : Promise.resolve({ data: [] as any[] } as any),
        ids.length
          ? supabase.from("payment_company_groups").select("payment_id,company_name,company_id,status").in("payment_id", ids)
          : Promise.resolve({ data: [] as any[] } as any),
        ids.length
          ? supabase.from("payment_processing_jobs").select("payment_id,total_companies,started_at").in("payment_id", ids).order("started_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] } as any),
        ids.length
          ? supabase.from("payment_status_history").select("payment_id,status_to,changed_at").in("payment_id", ids).order("changed_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] } as any),
        supabase.from("sla_settings").select("*").eq("active", true),
        ids.length
          ? supabase.from("payment_observations").select("payment_id").in("payment_id", ids).eq("is_question", true).is("resolved_at", null)
          : Promise.resolve({ data: [] as any[] } as any),
        ids.length
          ? supabase.from("payments").select("id,import_mode,origem").in("id", ids)
          : Promise.resolve({ data: [] as any[] } as any),
      ]);

      const profs = profsRes.data ?? [];
      const groups = groupsRes.data ?? [];
      const jobs = jobsRes.data ?? [];
      const hist = histRes.data ?? [];
      const slas = slasRes.data ?? [];
      const openQs = openQsRes.data ?? [];
      const modes = (modesRes.data ?? []) as Array<{ id: string; import_mode?: string | null; origem?: string | null }>;
      const modeMap = new Map(modes.map((m) => [m.id, m]));
      list.forEach((r) => {
        const m = modeMap.get(r.id);
        if (m) {
          (r as any).import_mode = m.import_mode ?? null;
          (r as any).origem = m.origem ?? null;
        }
      });


      const profMap: Record<string, string> = {};
      profs.forEach((p: any) => { profMap[p.id] = p.full_name || p.email || "—"; });
      setAnalysts(profMap);

      // Empresas distintas por lote
      const cmap: Record<string, Set<string>> = {};
      groups.forEach((g: any) => {
        cmap[g.payment_id] = cmap[g.payment_id] ?? new Set();
        cmap[g.payment_id].add(g.company_name || "");
      });
      const counts: Record<string, number> = {};
      Object.entries(cmap).forEach(([k, v]) => { counts[k] = v.size; });
      const jobMax: Record<string, number> = {};
      jobs.forEach((j: any) => {
        const cur = jobMax[j.payment_id] ?? 0;
        if ((j.total_companies ?? 0) > cur) jobMax[j.payment_id] = j.total_companies;
      });
      Object.entries(jobMax).forEach(([k, v]) => {
        if ((counts[k] ?? 0) < v) counts[k] = v;
      });
      setCompaniesPerPayment(counts);

      const seen: Record<string, string> = {};
      hist.forEach((h: any) => { if (!seen[h.payment_id]) seen[h.payment_id] = h.changed_at; });
      setStatusEnteredAt(seen);

      const cByP: Record<string, string | null> = {};
      groups.forEach((g: any) => {
        if (!(g.payment_id in cByP)) cByP[g.payment_id] = null;
        if (g.company_id && !cByP[g.payment_id]) cByP[g.payment_id] = g.company_id;
      });
      setCompanyByPayment(cByP);

      const compIds = Array.from(new Set(Object.values(cByP).filter(Boolean))) as string[];
      const { data: ovs } = compIds.length
        ? await supabase.from("company_sla_overrides").select("*").in("company_id", compIds)
        : ({ data: [] as any[] } as any);
      const sMap: Record<string, SlaSetting> = {};
      slas.forEach((s: any) => { sMap[s.status] = s; });
      setSlaSettings(sMap);
      const oMap: Record<string, CompanySlaOverride> = {};
      (ovs ?? []).forEach((o: any) => { oMap[o.company_id] = o; });
      setCompanyOverrides(oMap);

      const ocnt: Record<string, number> = {};
      openQs.forEach((r: any) => {
        if (!r.payment_id) return;
        ocnt[r.payment_id] = (ocnt[r.payment_id] ?? 0) + 1;
      });
      setOpenQuestionCount(ocnt);
    } catch (e: any) {
      console.error("Falha ao listar pagamentos:", e);
      toast.error("Erro ao carregar pagamentos: " + (e?.message ?? "desconhecido"));
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [rpcFilters, rpcSort, page, pageSize, view, activeHospitalId, hospitalSwitching]);

  // Carrega stats globais (não dependem da página atual nem dos filtros locais).
  // Depende de activeHospitalId: a RPC lê current_active_hospital() do banco;
  // sem redisparar aqui, o "ver arquivados (N)" e competências seguem do hospital
  // anterior mesmo após a troca no header.
  const loadGlobalStats = useCallback(async () => {
    if (hospitalSwitching || !activeHospitalId) return;
    try {
      const { data, error } = await supabase.rpc("payments_global_stats");
      if (error) throw error;
      const payload = (data ?? {}) as { archived_count?: number; competences?: string[]; analysts?: Record<string, string> };
      setGlobalArchivedCount(Number(payload.archived_count ?? 0));
      setGlobalCompetences(Array.isArray(payload.competences) ? payload.competences : []);
      setGlobalAnalysts(payload.analysts ?? {});
    } catch (e) {
      console.warn("payments_global_stats falhou", e);
    }
  }, [activeHospitalId, hospitalSwitching]);

  // Pools (rateios) ativos do hospital — alimenta o filtro de Pool.
  // Mesma razão: RLS de `pools` já escopa por hospital, mas sem redisparar o
  // fetch o combobox continuaria mostrando pools do hospital anterior.
  const loadPoolOptions = useCallback(async () => {
    if (hospitalSwitching || !activeHospitalId) { setPoolOptions([]); return; }
    try {
      const { data, error } = await supabase
        .from("pools")
        .select("id,nome,ativo")
        .order("nome", { ascending: true });
      if (error) throw error;
      setPoolOptions(((data ?? []) as any[]).filter((p) => p.ativo !== false).map((p) => ({ id: p.id, nome: p.nome })));
    } catch (e) {
      console.warn("load pools falhou", e);
    }
  }, [activeHospitalId, hospitalSwitching]);

  useEffect(() => { loadPoolOptions(); }, [loadPoolOptions]);

  useEffect(() => {
    document.title = "Pagamentos | Exacta Approval";
    load();
  }, [load]);

  useEffect(() => { loadGlobalStats(); }, [loadGlobalStats]);

  // Realtime com invalidação segmentada:
  //  • heavy  → recarrega lista + KPIs + stats globais (mudanças em payments:
  //             insert/delete, ou update que afete status/totais/competência/criador)
  //  • light  → só recarrega a lista (badges/flags: observations, questions,
  //             company_groups, jobs concluídos)
  // Cada bucket tem seu próprio debounce — eventos leves não disparam reloads pesados.
  useEffect(() => {
    let heavyTimer: ReturnType<typeof setTimeout> | null = null;
    let lightTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleHeavy = () => {
      if (heavyTimer) clearTimeout(heavyTimer);
      heavyTimer = setTimeout(() => { load(); loadGlobalStats(); }, 800);
    };
    const scheduleLight = () => {
      if (lightTimer) clearTimeout(lightTimer);
      lightTimer = setTimeout(() => { load(); }, 600);
    };
    // Campos da tabela payments que justificam reload pesado quando mudam.
    const HEAVY_FIELDS = ["status", "total_amount", "competence_month", "competence_months", "created_by", "payment_type", "payment_kind"];
    const isHeavyPaymentChange = (payload: any) => {
      if (payload.eventType === "INSERT" || payload.eventType === "DELETE") return true;
      const oldR = payload.old ?? {};
      const newR = payload.new ?? {};
      return HEAVY_FIELDS.some((f) => JSON.stringify(oldR?.[f]) !== JSON.stringify(newR?.[f]));
    };
    const channel = supabase
      .channel("payments-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, (payload) => {
        if (isHeavyPaymentChange(payload)) scheduleHeavy(); else scheduleLight();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_company_groups" }, scheduleLight)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_observations" }, scheduleLight)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_questions" }, scheduleLight)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payment_processing_jobs", filter: "status=in.(concluido,parcial,cancelado)" },
        scheduleLight,
      )
      .subscribe();
    return () => {
      if (heavyTimer) clearTimeout(heavyTimer);
      if (lightTimer) clearTimeout(lightTimer);
      supabase.removeChannel(channel);
    };
  }, [load, loadGlobalStats]);



  // Competências vêm do banco (todos os lotes), não só da página atual.
  const competenceOptions = useMemo(() => globalCompetences, [globalCompetences]);

  const now = Date.now();

  // Total real de arquivados (terminais) — calculado server-side, independente
  // da página atual.
  const archivedCount = globalArchivedCount;
  // Ativos = totalRows quando a aba "arquivados" está desligada (RPC já filtra).
  const activeCount = archivedView ? Math.max(0, totalRows - archivedCount) : totalRows;

  // KPIs server-side — agregam o universo filtrado inteiro (não só a página).
  const [serverKpis, setServerKpis] = useState<{ totalOpen: number; waitingValidation: number; waitingApproval: number; postApproval: number; delayed: number; activeTotal: number; competence: string | null }>(
    { totalOpen: 0, waitingValidation: 0, waitingApproval: 0, postApproval: 0, delayed: 0, activeTotal: 0, competence: null },
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("payments_kpis", { _filters: rpcFilters });
        if (error) throw error;
        if (cancelled) return;
        const p = (data ?? {}) as any;
        setServerKpis({
          totalOpen: Number(p.totalOpen ?? 0),
          waitingValidation: Number(p.waitingValidation ?? 0),
          waitingApproval: Number(p.waitingApproval ?? 0),
          postApproval: Number(p.postApproval ?? 0),
          delayed: Number(p.delayed ?? 0),
          activeTotal: Number(p.activeTotal ?? 0),
          competence: p.competence ?? null,
        });
      } catch (e) {
        console.warn("payments_kpis falhou", e);
      }
    })();
    return () => { cancelled = true; };
  }, [rpcFilters]);
  const kpis = serverKpis;

  // Toda a filtragem acontece server-side via list_payments. Aqui só removemos
  // linhas em exclusão otimista para feedback imediato.
  const filtered = useMemo(
    () => rows.filter((r) => !deletingIds.has(r.id)),
    [rows, deletingIds],
  );

  // Analistas vêm do banco (todos os criadores de lotes), não só da página atual.
  const analystOptions = useMemo(() => {
    return Object.entries(globalAnalysts)
      .map(([id, name]) => ({ id, name: name || "—" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [globalAnalysts]);

  const elapsedFor = (p: Row) => now - new Date(statusEnteredAt[p.id] ?? p.updated_at ?? p.created_at).getTime();

  const slaFor = (p: Row) => {
    // Concluídos/terminais não têm SLA — evita exibir "perto do prazo" / "vencido"
    // em lotes que já saíram do fluxo (ex.: pagos, lançados, arquivados).
    if (SLA_EXEMPT_STATUSES.has(p.status)) return null;
    const enteredAt = new Date(statusEnteredAt[p.id] ?? p.updated_at ?? p.created_at);
    const compId = companyByPayment[p.id] ?? null;
    const ov = compId ? companyOverrides[compId] ?? null : null;
    const setting = slaSettings[p.status] ?? null;
    return evaluateSla({
      status: p.status,
      enteredAt,
      override: ov,
      defaultSettings: setting,
      competenceMonth: p.competence_month ?? p.competence_months?.[0] ?? null,
      now: new Date(now),
    });
  };

  // Ordem por relevância: prioriza status sob responsabilidade do usuário logado
  // (analista/validador/diretor), e dentro de cada bucket ordena por valor total desc.
  const myOwnerStatuses = useMemo(() => {
    const set = new Set<string>();
    if (roles.includes("analista") || roles.includes("admin")) STATUSES_BY_OWNER.analista.forEach((s) => set.add(s));
    if (roles.includes("validador") || roles.includes("admin")) STATUSES_BY_OWNER.validador.forEach((s) => set.add(s));
    if (roles.includes("diretor") || roles.includes("admin")) STATUSES_BY_OWNER.diretor.forEach((s) => set.add(s));
    return set;
  }, [roles]);

  const relevanceBucket = (p: Row): number => {
    // 0 = sua vez (status do seu papel)
    if (myOwnerStatuses.has(p.status)) return 0;
    // 1 = fluxo ativo (não terminal e não pós-NF concluído)
    if (["lancado", "pago", "arquivado", "rejeitado", "cancelado"].includes(p.status)) return 3;
    if (["nf_conciliada"].includes(p.status)) return 2;
    return 1;
  };

  // Competência da row → "YYYY-MM" string (usa o mais recente do array).
  const competenceKey = (p: Row): string => {
    const arr = p.competence_months?.length ? p.competence_months : (p.competence_month ? [p.competence_month] : []);
    if (!arr.length) return "";
    // Cada item pode vir como "YYYY-MM" ou "YYYY-MM-DD" — pega o maior.
    return arr.map((s) => String(s).slice(0, 7)).sort().reverse()[0] ?? "";
  };

  const sortedList = useMemo(() => {
    const arr = [...filtered];
    // Tiebreaker padrão: competência DESC (sempre respeita competência).
    const byCompetenceDesc = (a: Row, b: Row) => competenceKey(b).localeCompare(competenceKey(a));

    if (colSort) {
      const dir = colSort.dir === "asc" ? 1 : -1;
      arr.sort((a, b) => {
        let cmp = 0;
        switch (colSort.col) {
          case "reference": cmp = a.reference.localeCompare(b.reference, "pt-BR"); break;
          case "competence": cmp = competenceKey(a).localeCompare(competenceKey(b)); break;
          case "elapsed": cmp = elapsedFor(a) - elapsedFor(b); break;
          case "items": cmp = (a.items_count || 0) - (b.items_count || 0); break;
          case "value": cmp = (Number(a.liquido_total ?? a.total_amount) || 0) - (Number(b.liquido_total ?? b.total_amount) || 0); break;
          case "status": cmp = a.status.localeCompare(b.status); break;
        }
        if (cmp !== 0) return cmp * dir;
        // Tiebreaker: competência DESC, depois criado DESC
        const c = byCompetenceDesc(a, b);
        if (c !== 0) return c;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return arr;
    }

    if (sortBy === "elapsed") arr.sort((a, b) => elapsedFor(b) - elapsedFor(a) || byCompetenceDesc(a, b));
    else if (sortBy === "status") arr.sort((a, b) => a.status.localeCompare(b.status) || byCompetenceDesc(a, b));
    else if (sortBy === "priority") {
      arr.sort((a, b) => ((Number(b.priority_score) || 0) - (Number(a.priority_score) || 0)) || byCompetenceDesc(a, b));
    }
    else if (sortBy === "created") arr.sort((a, b) => (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || byCompetenceDesc(a, b));
    else {
      // relevance (default)
      arr.sort((a, b) => {
        const ba = relevanceBucket(a);
        const bb = relevanceBucket(b);
        if (ba !== bb) return ba - bb;
        const va = Number(a.total_amount) || 0;
        const vb = Number(b.total_amount) || 0;
        if (vb !== va) return vb - va;
        const c = byCompetenceDesc(a, b);
        if (c !== 0) return c;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    return arr;
  }, [filtered, sortBy, colSort, statusEnteredAt, now, myOwnerStatuses]);

  const toggleColSort = (col: ColSortCol) => {
    setColSort((cur) => {
      if (!cur || cur.col !== col) {
        // Default direction: numéricos/data → DESC (mais recente/maior); texto → ASC
        const desc = col === "competence" || col === "elapsed" || col === "items" || col === "value";
        return { col, dir: desc ? "desc" : "asc" };
      }
      if (cur.dir === "desc") return { col, dir: "asc" };
      return null; // terceiro clique: volta para ordenação padrão
    });
  };

  const SortIcon = ({ col }: { col: ColSortCol }) => {
    if (!colSort || colSort.col !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return colSort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Ordem das colunas do kanban (segue fluxo lógico)
  const KANBAN_ORDER: PaymentStatus[] = [
    "rascunho", "em_analise_ia", "revisao_analista", "aguardando_validacao",
    "devolvido_analista", "aguardando_aprovacao", "aprovado_em_revisao",
    "aprovado", "aprovado_com_ressalva", "pedido_nf_enviado", "nf_questionada",
    "nf_recebida", "nf_conciliada", "nf_divergente", "lancado", "pago", "arquivado", "rejeitado", "cancelado",
  ];

  const kanbanGroups = useMemo(() => {
    const groups: Record<string, Row[]> = {};
    for (const p of filtered) {
      (groups[p.status] = groups[p.status] ?? []).push(p);
    }
    Object.values(groups).forEach((g) => g.sort((a, b) => elapsedFor(b) - elapsedFor(a)));
    return KANBAN_ORDER.filter((s) => groups[s]?.length).map((s) => ({ status: s, items: groups[s] }));
  }, [filtered, statusEnteredAt, now]);

  const renderCard = (p: Row, compact = false) => {
    const elapsedMs = elapsedFor(p);
    const lvl = delayLevel(p.status, elapsedMs);
    const sla = slaFor(p);
    const slaLvl = sla?.level ?? "ok";
    // Combina: vencido > critico > preventivo > leve
    const finalLvl: "none" | "leve" | "critico" =
      slaLvl === "vencido" ? "critico" : slaLvl === "preventivo" ? "leve" : lvl;
    const companies = companiesPerPayment[p.id] ?? 0;
    const analystName = p.created_by ? analysts[p.created_by] ?? "—" : "—";
    
    if (compact) {
      const slaBadge = (
        <span className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
          finalLvl === "critico" && "bg-destructive-soft text-destructive",
          finalLvl === "leve" && "bg-warning-soft text-warning-text",
          finalLvl === "none" && "text-muted-foreground",
        )}>
          <Clock className="h-2.5 w-2.5 shrink-0" />{" "}
          <span className="truncate">
            {sla?.level === "vencido" ? "vencido" : sla?.level === "preventivo" ? "perto do prazo" : formatDuration(elapsedMs)}
          </span>
        </span>
      );

      return (
        <Link
          key={p.id}
          to={`/pagamentos/${p.id}`}
          className="block min-w-0"
        >
          <SafeCard
            headerColor={
              finalLvl === "critico" ? "hsl(var(--destructive))" : 
              finalLvl === "leve" ? "hsl(var(--warning))" : 
              undefined
            }
            badge={openQuestionCount[p.id] > 0 ? (
              <span
                title={`${openQuestionCount[p.id]} questionamento(s) aguardando resposta`}
                className="inline-flex items-center gap-0.5 rounded-bl-md border-l border-b border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[9px] font-semibold text-warning-text shrink-0 shadow-sm"
              >
                <AlertTriangle className="h-2 w-2" />
              </span>
            ) : undefined}
            className={cn(
              "hover:bg-muted/40 transition-colors space-y-2 p-0", // p-0 because SafeCard has padding 3
              finalLvl === "critico" && "border-destructive/40 ring-1 ring-destructive/20",
            )}
          >
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-col gap-1 min-w-0">
                <p className="font-semibold text-xs break-words">{p.reference}</p>
                <PaymentRiskBadgeInline paymentId={p.id} compact />
              </div>
              
              <div className="flex items-center justify-between text-[10px] text-muted-foreground gap-2">
                <span className="truncate flex-1">{analystName}</span>
                <span className="tabular-nums font-medium text-foreground shrink-0" title={Math.abs(Number(p.liquido_total ?? p.total_amount) - Number(p.bruto_total ?? p.total_amount)) > 0.01 ? `Bruto ${formatCurrency(p.bruto_total ?? p.total_amount)}` : undefined}>{formatCurrency(p.liquido_total ?? p.total_amount)}</span>
              </div>
              
              <div className="flex items-center justify-between text-[10px] gap-2 pt-1 border-t border-border/40">
                <span className="text-muted-foreground shrink-0">{p.items_count} itens · {companies || "—"} PJ</span>
                {slaBadge}
              </div>
            </div>
          </SafeCard>
        </Link>
      );
    }
    const isSelected = selected.has(p.id);
    return (
      <div key={p.id} className={cn("flex items-start gap-3 px-6 py-4 hover:bg-muted/40 transition-colors", isSelected && "bg-primary/5")}>
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleSelect(p.id)}
            aria-label={`Selecionar ${p.reference} para reprocessamento`}
          />
        </div>
        <div className="flex items-start justify-between gap-4 flex-1 min-w-0">
          <Link to={`/pagamentos/${p.id}`} className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-medium text-sm truncate">{p.reference}</p>
              {(p.import_mode === "historico" || p.origem === "historico") && (
                <Badge variant="outline" className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 text-[10px] uppercase tracking-wide">
                  Histórico
                </Badge>
              )}
              <PaymentRiskBadgeInline paymentId={p.id} />

              <PaymentPriorityBadgeInline
                paymentId={p.id}
                slaLevel={sla?.level ?? null}
                elapsedDays={elapsedMs / 86400000}
                status={p.status}
                totalAmount={Number(p.total_amount)}
                itemsCount={p.items_count}
              />

              {openQuestionCount[p.id] > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning-text"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertTriangle className="h-3 w-3" /> Questionamento ({openQuestionCount[p.id]})
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{openQuestionCount[p.id]} questionamento{openQuestionCount[p.id] > 1 ? "s" : ""} aguardando resposta</TooltipContent>
                </Tooltip>
              )}

              {p.processing_timeout_occurred && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold border border-destructive/20 cursor-help">
                      <Clock className="h-3 w-3" />
                      Limite IA
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[280px] space-y-2 text-xs">
                    <p className="font-bold flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-destructive" /> Diagnóstico de Performance
                    </p>
                    <p>O lote original excedeu o tempo limite de análise da IA.</p>
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/20 mt-1">
                      <div>
                        <p className="text-muted-foreground">Itens IA:</p>
                        <p className="font-medium text-foreground">{p.processing_diagnostics?.ai_processed_items || "—"} / {p.processing_diagnostics?.total_items || p.items_count}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Chunk Size:</p>
                        <p className="font-medium text-foreground">{p.processing_diagnostics?.chunk_size || 50} itens</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Tempo Total:</p>
                        <p className="font-medium text-foreground">{( (p.processing_diagnostics?.execution_time_ms || 0) / 1000 ).toFixed(1)}s</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Status:</p>
                        <p className="font-medium text-destructive">Timeout</p>
                      </div>
                    </div>
                    <p className="italic text-[10px] pt-1">O motor determinístico concluiu 100% dos cálculos; apenas as justificativas de IA foram limitadas aos itens mais críticos.</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <User className="h-3 w-3" /> {analystName}
              </Badge>
              {p.payment_type && (
                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                  <Tag className="h-3 w-3" /> {PAYMENT_TYPE_LABELS[p.payment_type]}
                </Badge>
              )}
              {companies > 0 && (
                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                  <Building2 className="h-3 w-3" /> {companies} empresa{companies > 1 ? "s" : ""}
                </Badge>
              )}
              {p.payment_track && (
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 font-normal",
                    p.payment_track === "prioritario"
                      ? "bg-warning-soft text-warning-text border-warning/30"
                      : "text-muted-foreground",
                  )}
                  title={p.payment_track === "prioritario" ? "Trilha prioritária (pagamento antecipado)" : "Trilha habitual"}
                >
                  {PAYMENT_TRACK_SHORT_LABELS[p.payment_track]}
                </Badge>
              )}
              {!SLA_EXEMPT_STATUSES.has(p.status) && (
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 font-normal",
                    finalLvl === "critico" && "bg-destructive-soft text-destructive border-destructive/30",
                    finalLvl === "leve" && "bg-warning-soft text-warning-text border-warning/30",
                    finalLvl === "none" && "text-muted-foreground",
                  )}
                >
                  <Clock className="h-3 w-3" /> {formatDuration(elapsedMs)} no status
                </Badge>
              )}
              {sla && (
                <Badge
                  variant="outline"
                  title={`${sla.reason} · vence ${sla.dueAt.toLocaleDateString("pt-BR")} · ${sla.source === "empresa" ? "regra da empresa" : "SLA padrão"}`}
                  className={cn(
                    "gap-1 font-normal",
                    sla.level === "vencido" && "bg-destructive-soft text-destructive border-destructive/30",
                    sla.level === "preventivo" && "bg-warning-soft text-warning-text border-warning/30",
                    sla.level === "ok" && "text-muted-foreground",
                  )}
                >
                  {sla.level === "vencido" ? "Vencido" : sla.level === "preventivo" ? "Perto do prazo" : `Vence ${sla.dueAt.toLocaleDateString("pt-BR")}`}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Competência <span className="font-medium text-foreground capitalize">{formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}</span>
              {" · "}{p.items_count} itens · {formatCurrency(p.liquido_total ?? p.total_amount)}{Math.abs(Number(p.liquido_total ?? p.total_amount) - Number(p.bruto_total ?? p.total_amount)) > 0.01 ? ` (bruto ${formatCurrency(p.bruto_total ?? p.total_amount)})` : ""}
              {p.payment_kind && ` · ${PAYMENT_KIND_LABELS[p.payment_kind]}`}
              {" · criado em "}{formatDate(p.created_at)}
            </p>
          </Link>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <StatusBadge status={p.status} analysisMode={(p as any).analysis_mode} confeccaoStatus={(p as any).confeccao_status} className={cn(finalLvl === "critico" && "ring-2 ring-destructive/40")} />
            {(isAnalista || isDiretor || isAdmin) && ["rascunho", "em_analise_ia", "revisao_analista", "devolvido_analista"].includes(p.status) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Excluir lote"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir este lote?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação remove o lote <strong>{p.reference}</strong>, todos os seus itens e histórico permanentemente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => deletePayment(p.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Excluir definitivamente
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full max-w-[100vw] overflow-x-hidden">
      <PageHeader
        title="Pagamentos"
        description="Todos os lotes de pagamento e seu status no fluxo."
        actions={
          <Button size="sm" variant="outline" onClick={() => setBonusOpen(true)}>
            <Sparkles className="h-4 w-4 mr-1" /> Bônus por paciente
          </Button>
        }
      />
      <BonusPacienteDialog
        open={bonusOpen}
        onOpenChange={setBonusOpen}
        onSaved={() => load()}
      />
      <div className="p-4 md:px-6 md:py-6 w-full mx-auto space-y-4">
        {/* KPI Cards — Padrão BI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total em aberto"
            value={formatCurrency(kpis.totalOpen)}
            hint={`${kpis.activeTotal} lote${kpis.activeTotal === 1 ? "" : "s"} ativo${kpis.activeTotal === 1 ? "" : "s"}`}
            tone="primary"
          />
          <KpiCard
            label="Pós-aprovação (NF)"
            value={String(kpis.postApproval)}
            hint="Aprovados aguardando ciclo de NF"
          />
          <KpiCard
            label="Aguardando validação"
            value={String(kpis.waitingValidation)}
            hint="Analista, supervisor ou devolvido"
          />
          <KpiCard
            label="Aguardando aprovação"
            value={String(kpis.waitingApproval)}
            hint={
              kpis.competence
                ? `Diretor · comp. ${formatCompetence(`${kpis.competence}-01`)}`
                : "Fila do diretor"
            }
          />
        </div>


        {(() => {
          const activeFilterCount = [
            delayedOnly,
            ownerGroup !== "all",
            divergenceFilter !== "all",
            questionedFilter !== "all",
            openQuestionOnly,
          ].filter(Boolean).length;
          const searchInput = (
            <div className="relative flex-1 min-w-0 md:max-w-sm md:min-w-[220px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar referência, PJ, médico…"
                className="pl-9"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  buscando…
                </span>
              )}
            </div>
          );
          // Conta filtros secundários ativos (mostrados dentro do popover)
          const advancedCount = [
            analystFilter.length > 0,
            typeFilter.length > 0,
            itemTypeFilter.length > 0,
            trackFilter.length > 0,
            competenceFilter !== "all",
            ownerGroup !== "all",
            divergenceFilter !== "all",
            questionedFilter !== "all",
            poolFilter.length > 0,
            importModeFilter.length > 0,
            emptyOnly,
            hasProposedGlosas,
            hasAppliedDebits,
            hasAppliedCredits,
            hasAlerts,
          ].filter(Boolean).length;

          const advancedFilters = (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Analista</label>
                <MultiSelectPopover
                  width="w-full"
                  className="w-full"
                  placeholder="Todos analistas"
                  allLabel="Todos analistas"
                  values={analystFilter}
                  onChange={setAnalystFilter}
                  options={analystOptions.map((a) => ({ value: a.id, label: a.name }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Tipo (lote)</label>
                <MultiSelectPopover
                  width="w-full"
                  className="w-full"
                  placeholder="Todos tipos"
                  allLabel="Todos tipos"
                  values={typeFilter}
                  onChange={setTypeFilter}
                  options={Object.entries(PAYMENT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v as string }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Tipo de item</label>
                <MultiSelectPopover
                  width="w-full"
                  className="w-full"
                  placeholder="Todos os itens"
                  allLabel="Todos os itens"
                  values={itemTypeFilter}
                  onChange={setItemTypeFilter}
                  options={itemTypesList.map((t) => ({ value: t.id, label: t.label }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Trilha</label>
                <MultiSelectPopover
                  width="w-full"
                  className="w-full"
                  placeholder="Todas as trilhas"
                  allLabel="Todas as trilhas"
                  values={trackFilter}
                  onChange={setTrackFilter}
                  options={[
                    { value: "habitual", label: PAYMENT_TRACK_SHORT_LABELS.habitual },
                    { value: "prioritario", label: PAYMENT_TRACK_SHORT_LABELS.prioritario },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Competência</label>
                <Select value={competenceFilter} onValueChange={setCompetenceFilter}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Competência" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas competências</SelectItem>
                    {competenceOptions.map((c) => <SelectItem key={c} value={c}>{formatCompetence(`${c}-01`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Papel / fila</label>
                <Select value={ownerGroup} onValueChange={(v) => {
                  const ov = v as OwnerGroup;
                  setOwnerGroup(ov);
                  const next = new URLSearchParams(searchParams);
                  if (ov === "all") next.delete("status"); else next.set("status", ov);
                  setSearchParams(next, { replace: true });
                }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Papel/fila" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Qualquer fila</SelectItem>
                    <SelectItem value="analista">Com analista</SelectItem>
                    <SelectItem value="validador">Com validador</SelectItem>
                    <SelectItem value="diretor">Com diretor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Divergência IA × regra</label>
                <Select value={divergenceFilter} onValueChange={(v) => setDivergenceFilter(v as typeof divergenceFilter)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Divergência" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Divergência: todas</SelectItem>
                    <SelectItem value="with">Com divergência</SelectItem>
                    <SelectItem value="without">Sem divergência</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">NF questionada</label>
                <Select value={questionedFilter} onValueChange={(v) => setQuestionedFilter(v as typeof questionedFilter)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="NF questionada" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">NF: todas</SelectItem>
                    <SelectItem value="with">NF questionada</SelectItem>
                    <SelectItem value="without">Sem questionamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Pool (rateio)</label>
                <MultiSelectPopover
                  width="w-full"
                  className="w-full"
                  placeholder="Todos os pools"
                  allLabel="Todos os pools"
                  values={poolFilter}
                  onChange={setPoolFilter}
                  options={poolOptions.map((p) => ({ value: p.id, label: p.nome }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Modo de importação</label>
                <MultiSelectPopover
                  width="w-full"
                  className="w-full"
                  placeholder="Todos os modos"
                  allLabel="Todos os modos"
                  values={importModeFilter}
                  onChange={(v) => setImportModeFilter(v as Array<"normal" | "historico">)}
                  options={[
                    { value: "normal", label: "Normal (corrente)" },
                    { value: "historico", label: "Histórico (retroativo)" },
                  ]}
                />
              </div>
              <div className="space-y-1 flex items-end">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={emptyOnly}
                    onChange={(e) => setEmptyOnly(e.target.checked)}
                  />
                  Apenas lotes vazios (sem itens)
                </label>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Financeiro do lote</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1.5 rounded hover:bg-accent">
                    <input type="checkbox" className="h-4 w-4 rounded border-border accent-primary"
                      checked={hasProposedGlosas} onChange={(e) => setHasProposedGlosas(e.target.checked)} />
                    Com glosas propostas
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1.5 rounded hover:bg-accent">
                    <input type="checkbox" className="h-4 w-4 rounded border-border accent-primary"
                      checked={hasAppliedDebits} onChange={(e) => setHasAppliedDebits(e.target.checked)} />
                    Com débitos aplicados
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1.5 rounded hover:bg-accent">
                    <input type="checkbox" className="h-4 w-4 rounded border-border accent-primary"
                      checked={hasAppliedCredits} onChange={(e) => setHasAppliedCredits(e.target.checked)} />
                    Com créditos aplicados
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1.5 rounded hover:bg-accent">
                    <input type="checkbox" className="h-4 w-4 rounded border-border accent-primary"
                      checked={hasAlerts} onChange={(e) => setHasAlerts(e.target.checked)} />
                    Com alertas (divergência/erro)
                  </label>
                </div>
              </div>
            </div>
          );

          const filterControls = (
            <>
              {/* Primários — sempre visíveis */}
              <CompanyCombobox
                value={companyFilter}
                onChange={setCompanyFilter}
                placeholder="Filtrar por empresa (CNPJ)…"
                prominent
                className="min-w-0 md:min-w-[260px] w-full md:w-auto"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full md:w-[200px] justify-between font-normal">
                    <span className="truncate">
                      {statusFilter.length === 0
                        ? "Todos status"
                        : statusFilter.length === 1
                          ? (PAYMENT_STATUS_LABELS as any)[statusFilter[0]] ?? statusFilter[0]
                          : `${statusFilter.length} status selecionados`}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 opacity-50 ml-2 flex-shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[260px] p-2">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase">Status</span>
                    {statusFilter.length > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        onClick={() => setStatusFilter([])}
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => {
                      const checked = statusFilter.includes(k);
                      return (
                        <label
                          key={k}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border accent-primary"
                            checked={checked}
                            onChange={(e) => {
                              setStatusFilter((prev) =>
                                e.target.checked ? [...prev, k] : prev.filter((s) => s !== k),
                              );
                            }}
                          />
                          <span className="truncate">{v}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant={delayedOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setDelayedOnly((v) => !v)}
              >
                <AlertTriangle className="h-4 w-4 mr-1" /> Atrasados
              </Button>
              <Button
                variant={openQuestionOnly ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  const next = !openQuestionOnly;
                  setOpenQuestionOnly(next);
                  const sp = new URLSearchParams(searchParams);
                  if (next) sp.set("open_questions", "1"); else sp.delete("open_questions");
                  setSearchParams(sp, { replace: true });
                }}
                title="Mostrar apenas lotes com perguntas internas aguardando resposta"
              >
                <MessageCircleQuestion className="h-4 w-4 mr-1" /> Questionamento aberto
              </Button>

              {/* Secundários — dentro de popover "Mais filtros" */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="relative">
                    <SlidersHorizontal className="h-4 w-4 mr-1" /> Mais filtros
                    {advancedCount > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1">
                        {advancedCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[480px] max-w-[90vw] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">Filtros avançados</h4>
                    {advancedCount > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        onClick={() => {
                          setAnalystFilter([]);
                          setTypeFilter([]);
                          setItemTypeFilter([]);
                          setTrackFilter([]);
                          setCompetenceFilter("all");
                          setOwnerGroup("all");
                          setDivergenceFilter("all");
                          setQuestionedFilter("all");
                          setPoolFilter([]);
                          setImportModeFilter([]);
                          setEmptyOnly(false);
                          setHasProposedGlosas(false); setHasAppliedDebits(false); setHasAppliedCredits(false); setHasAlerts(false);
                          const next = new URLSearchParams(searchParams);
                          next.delete("status");
                          setSearchParams(next, { replace: true });
                        }}
                      >
                        Limpar avançados
                      </button>
                    )}
                  </div>
                  {advancedFilters}
                </PopoverContent>
              </Popover>
              {(() => {
                const anyActive =
                  !!q ||
                  !!companyFilter ||
                  statusFilter.length > 0 ||
                  delayedOnly ||
                  openQuestionOnly ||
                  onlyMine ||
                  ownerGroup !== "all" ||
                  advancedCount > 0;
                if (!anyActive) return null;
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setCompanyFilter(null);
                      setStatusFilter([]);
                      setDelayedOnly(false);
                      setOpenQuestionOnly(false);
                      setOnlyMine(false);
                      setOwnerGroup("all");
                      setAnalystFilter([]);
                      setTypeFilter([]);
                      setItemTypeFilter([]);
                      setTrackFilter([]);
                      setCompetenceFilter("all");
                      setDivergenceFilter("all");
                      setQuestionedFilter("all");
                      setPoolFilter([]);
                      setImportModeFilter([]);
                      setEmptyOnly(false);
                      setHasProposedGlosas(false); setHasAppliedDebits(false); setHasAppliedCredits(false); setHasAlerts(false);
                      const next = new URLSearchParams(searchParams);
                      next.delete("status");
                      next.delete("delayed");
                      next.delete("open_questions");
                      next.delete("owner");
                      setSearchParams(next, { replace: true });
                    }}
                    title="Limpar todos os filtros"
                  >
                    <X className="h-4 w-4 mr-1" /> Limpar filtros
                  </Button>
                );
              })()}
              {ownerGroup !== "all" && (
                <Badge variant="outline" className="gap-1 h-8 px-2 bg-primary/10 border-primary/30 text-primary">
                  <UserCheck className="h-3.5 w-3.5" /> {OWNER_LABELS[ownerGroup]}
                  <button
                    type="button"
                    aria-label="Remover filtro de papel"
                    className="ml-1 hover:opacity-70"
                    onClick={() => {
                      setOwnerGroup("all");
                      const next = new URLSearchParams(searchParams);
                      next.delete("status");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {onlyMine && (
                <Badge variant="outline" className="gap-1 h-8 px-2 bg-primary/10 border-primary/30 text-primary">
                  <User className="h-3.5 w-3.5" /> Apenas meus
                  <button
                    type="button"
                    aria-label="Remover filtro apenas meus"
                    className="ml-1 hover:opacity-70"
                    onClick={() => {
                      setOnlyMine(false);
                      const next = new URLSearchParams(searchParams);
                      next.delete("owner");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {(companyFilter || analystFilter.length > 0 || typeFilter.length > 0 || itemTypeFilter.length > 0 || trackFilter.length > 0 || statusFilter.length > 0 || competenceFilter !== "all" || delayedOnly || ownerGroup !== "all" || onlyMine || divergenceFilter !== "all" || questionedFilter !== "all" || poolFilter.length > 0 || importModeFilter.length > 0 || emptyOnly || hasProposedGlosas || hasAppliedDebits || hasAppliedCredits || hasAlerts) && (
                <Button variant="ghost" size="sm" onClick={() => {
                  setCompanyFilter(null);
                  setAnalystFilter([]); setTypeFilter([]); setItemTypeFilter([]); setTrackFilter([]); setStatusFilter([]); setCompetenceFilter("all"); setDelayedOnly(false);
                  setOwnerGroup("all"); setOnlyMine(false);
                  setDivergenceFilter("all"); setQuestionedFilter("all");
                  setPoolFilter([]); setImportModeFilter([]); setEmptyOnly(false);
                  setHasProposedGlosas(false); setHasAppliedDebits(false); setHasAppliedCredits(false); setHasAlerts(false);
                  setSearchParams(new URLSearchParams(), { replace: true });
                }}>
                  <X className="h-4 w-4 mr-1" /> Limpar
                </Button>
              )}
              <div className="md:ml-auto flex items-center gap-2 flex-wrap">
                <Button
                  variant={archivedView ? "default" : "outline"}
                  size="sm"
                  className={archivedView ? undefined : "text-muted-foreground"}
                  onClick={() => {
                    const next = !archivedView;
                    setArchivedView(next);
                    const sp = new URLSearchParams(searchParams);
                    if (next) sp.set("archived", "1"); else sp.delete("archived");
                    setSearchParams(sp, { replace: true });
                  }}
                  title={archivedView ? "Voltar para pagamentos ativos" : "Ver pagamentos arquivados (terminais)"}
                >
                  {archivedView ? <Inbox className="h-4 w-4 mr-1" /> : <Archive className="h-4 w-4 mr-1" />}
                  {archivedView ? "Ver ativos" : `Ver arquivados${archivedCount ? ` (${archivedCount})` : ""}`}
                </Button>
                {!archivedView && (
                  <Button
                    variant={showConcluded ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const next = !showConcluded;
                      setShowConcluded(next);
                      const sp = new URLSearchParams(searchParams);
                      if (next) sp.set("concluded", "1"); else sp.delete("concluded");
                      setSearchParams(sp, { replace: true });
                    }}
                    title={showConcluded ? "Esconder pagos/lançados da lista (padrão)" : "Mostrar também lotes pagos/lançados"}
                  >
                    {showConcluded ? <EyeOff className="h-4 w-4 mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    {showConcluded ? "Esconder concluídos" : "Ver concluídos"}
                  </Button>
                )}
                {view === "lista" && (
                  <Select value={colSort ? "__col" : sortBy} onValueChange={(v) => { if (v === "__col") return; setColSort(null); setSortBy(v as typeof sortBy); }}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Ordenar">{colSort ? `Coluna: ${({reference:"Lote",competence:"Competência",elapsed:"Tempo",items:"Volumetria",value:"Valor",status:"Status"} as const)[colSort.col]} ${colSort.dir === "asc" ? "↑" : "↓"}` : undefined}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relevance">Sua vez + maior valor</SelectItem>
                      <SelectItem value="created">Mais recentes</SelectItem>
                      <SelectItem value="elapsed">Tempo parado</SelectItem>
                      <SelectItem value="status">Status</SelectItem>
                      <SelectItem value="priority">Por prioridade</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "lista" | "kanban")} variant="outline" size="sm">
                  <ToggleGroupItem value="lista" className="data-[state=on]:bg-muted data-[state=on]:text-foreground hover:bg-muted hover:text-foreground">Lista</ToggleGroupItem>
                  <ToggleGroupItem value="kanban" className="data-[state=on]:bg-muted data-[state=on]:text-foreground hover:bg-muted hover:text-foreground">Kanban</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </>
          );
          return (
            <>
              {/* MOBILE: barra compacta */}
              <div className="flex md:hidden items-center gap-2">
                {searchInput}
                <Button
                  variant={filtersOpen ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFiltersOpen((v) => !v)}
                  className="shrink-0 relative"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {activeFilterCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </div>
              {/* DESKTOP: linha completa de filtros */}
              <div className="hidden md:flex flex-wrap items-center gap-2">
                {searchInput}
                {filterControls}
              </div>
              {/* MOBILE: painel colapsável */}
              {filtersOpen && (
                <div className="flex md:hidden flex-wrap gap-2 pt-2 border-t border-border/40">
                  {filterControls}
                </div>
              )}
            </>
          );
        })()}
        {/* Barra de seleção em massa para reprocessamento de regras/mapeamentos */}
        {view === "lista" && sortedList.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2">
            <div className="flex items-center gap-3 text-xs">
              <Checkbox
                checked={
                  selected.size > 0 && sortedList.every((p) => selected.has(p.id))
                    ? true
                    : selected.size > 0
                    ? "indeterminate"
                    : false
                }
                onCheckedChange={(v) => {
                  if (v) setSelected(new Set(sortedList.map((p) => p.id)));
                  else setSelected(new Set());
                }}
                aria-label="Selecionar todos os pagamentos visíveis"
              />
              <span className="text-muted-foreground">
                {selected.size > 0
                  ? `${selected.size} selecionado${selected.size > 1 ? "s" : ""}`
                  : "Selecione pagamentos para reprocessar regras/mapeamentos"}
              </span>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  limpar
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {reprocessProgress && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {reprocessProgress.done}/{reprocessProgress.total}
                </span>
              )}
              <Button
                size="sm"
                disabled={selected.size === 0 || reprocessing}
                onClick={openReanalysisConfirm}
              >
                {reprocessing ? (
                  <RefreshCcw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {reprocessing ? "Reprocessando..." : "Reanalisar selecionados"}
              </Button>

            </div>
          </div>
        )}
        {/* Observabilidade: sinaliza claramente o modo arquivados ou se há
            arquivados escondidos no modo ativos (evita "sumiu meu lote!"). */}
        {archivedView ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-xs">
            <div className="flex items-center gap-2 text-primary">
              <Archive className="h-3.5 w-3.5" />
              <span>
                Mostrando <strong>{archivedCount}</strong> lote{archivedCount === 1 ? "" : "s"} arquivado{archivedCount === 1 ? "" : "s"} (arquivado, rejeitado, cancelado).
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setArchivedView(false);
                const sp = new URLSearchParams(searchParams);
                sp.delete("archived");
                setSearchParams(sp, { replace: true });
              }}
              className="text-primary font-medium hover:underline underline-offset-2"
            >
              Voltar para ativos
            </button>
          </div>
        ) : archivedCount > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Archive className="h-3.5 w-3.5" />
              <span>
                <strong>{archivedCount}</strong> lote{archivedCount === 1 ? "" : "s"} arquivado{archivedCount === 1 ? "" : "s"} fora desta lista · {activeCount} ativo{activeCount === 1 ? "" : "s"}.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setArchivedView(true);
                const sp = new URLSearchParams(searchParams);
                sp.set("archived", "1");
                setSearchParams(sp, { replace: true });
              }}
              className="font-medium hover:text-foreground hover:underline underline-offset-2"
            >
              Ver arquivados
            </button>
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="p-0">
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Nenhum pagamento encontrado.</div>
            </CardContent>
          </Card>
        ) : view === "lista" ? (
          <>
            {/* MOBILE: card list — no horizontal scroll, tap-friendly. */}
            <div className="md:hidden space-y-2">
              {sortedList.map((p) => {
                const elapsedMs = elapsedFor(p);
                const lvl = delayLevel(p.status, elapsedMs);
                const sla = slaFor(p);
                const slaLvl = sla?.level ?? "ok";
                const finalLvl: "none" | "leve" | "critico" =
                  slaLvl === "vencido" ? "critico" : slaLvl === "preventivo" ? "leve" : lvl;
                const companies = companiesPerPayment[p.id] ?? 0;
                const analystName = p.created_by ? analysts[p.created_by] ?? "—" : "—";
                const isSelected = selected.has(p.id);
                const liquido = Number(p.liquido_total ?? p.total_amount);
                const bruto = Number(p.bruto_total ?? p.total_amount);
                const hasDiff = Math.abs(liquido - bruto) > 0.01;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-lg border bg-card p-3 shadow-sm transition-colors",
                      isSelected && "border-primary/60 bg-primary/5",
                      finalLvl === "critico" && !isSelected && "border-destructive/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(p.id)}
                          aria-label={`Selecionar ${p.reference}`}
                        />
                      </div>
                      <Link to={`/pagamentos/${p.id}`} className="flex-1 min-w-0 space-y-2 block">
                        <p className="font-semibold text-sm text-foreground leading-snug break-words">
                          {p.reference}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusBadge
                            status={p.status}
                            analysisMode={(p as any).analysis_mode}
                            confeccaoStatus={(p as any).confeccao_status}
                          />
                          <PaymentRiskBadgeInline paymentId={p.id} compact />
                          {openQuestionCount[p.id] > 0 && (
                            <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning-text">
                              <MessageCircleQuestion className="h-2.5 w-2.5" /> {openQuestionCount[p.id]}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <div className="min-w-0">
                            <div className="text-[9px] uppercase tracking-wide opacity-70">Valor</div>
                            <div className="font-bold text-sm text-foreground tabular-nums break-words">
                              {formatCurrency(liquido)}
                            </div>
                            {hasDiff && (
                              <div className="text-[10px] opacity-80 break-words">
                                bruto {formatCurrency(bruto)}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[9px] uppercase tracking-wide opacity-70">Tempo</div>
                            <div
                              className={cn(
                                "font-semibold text-xs",
                                finalLvl === "critico" && "text-destructive",
                                finalLvl === "leve" && "text-warning-text",
                              )}
                            >
                              {SLA_EXEMPT_STATUSES.has(p.status)
                                ? "—"
                                : sla?.level === "vencido"
                                ? "vencido"
                                : formatDuration(elapsedMs)}
                            </div>
                            <div className="text-[10px] opacity-80 capitalize break-words">
                              {formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}
                            </div>
                          </div>
                          <div className="col-span-2 min-w-0 flex flex-wrap gap-x-2 gap-y-0.5 pt-1 border-t border-border/40 text-[10px]">
                            <span className="break-words">
                              {p.items_count.toLocaleString("pt-BR")} itens
                              {companies > 0 && ` · ${companies} PJ`}
                            </span>
                            <span className="opacity-70 break-words">{analystName}</span>
                          </div>
                        </div>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* DESKTOP/tablet: tabela completa. */}
            <div className="hidden md:block overflow-hidden border border-border bg-card shadow-sm rounded-md">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="border-b border-border px-3 py-2.5 w-[40px]"></th>
                      <th className="border-b border-border px-3 py-2.5">
                        <button type="button" onClick={() => toggleColSort("reference")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase tracking-wider">
                          Lote / Risco <SortIcon col="reference" />
                        </button>
                      </th>
                      <th className="border-b border-border px-3 py-2.5 hidden 2xl:table-cell">Responsável / Info</th>
                      <th className="border-b border-border px-3 py-2.5 hidden md:table-cell">
                        <span className="inline-flex items-center gap-2">
                          <button type="button" onClick={() => toggleColSort("elapsed")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase tracking-wider">
                            Tempo <SortIcon col="elapsed" />
                          </button>
                          <span className="opacity-40">/</span>
                          <button type="button" onClick={() => toggleColSort("competence")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase tracking-wider">
                            Competência <SortIcon col="competence" />
                          </button>
                        </span>
                      </th>
                      <th className="border-b border-border px-3 py-2.5 text-right hidden md:table-cell">
                        <button type="button" onClick={() => toggleColSort("items")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase tracking-wider ml-auto">
                          Volumetria <SortIcon col="items" />
                        </button>
                      </th>
                      <th className="border-b border-border px-3 py-2.5 text-right">
                        <button type="button" onClick={() => toggleColSort("value")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase tracking-wider ml-auto">
                          Valor Total <SortIcon col="value" />
                        </button>
                      </th>
                      <th className="border-b border-border px-3 py-2.5">
                        <button type="button" onClick={() => toggleColSort("status")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors uppercase tracking-wider">
                          Status <SortIcon col="status" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px] tabular-nums">
                    {sortedList.map((p) => {
                      const elapsedMs = elapsedFor(p);
                      const lvl = delayLevel(p.status, elapsedMs);
                      const sla = slaFor(p);
                      const slaLvl = sla?.level ?? "ok";
                      const finalLvl: "none" | "leve" | "critico" =
                        slaLvl === "vencido" ? "critico" : slaLvl === "preventivo" ? "leve" : lvl;
                      const companies = companiesPerPayment[p.id] ?? 0;
                      const analystName = p.created_by ? analysts[p.created_by] ?? "—" : "—";
                      const isSelected = selected.has(p.id);
                      const canDelete = (isAnalista || isDiretor || isAdmin) && ["rascunho", "em_analise_ia", "revisao_analista", "devolvido_analista"].includes(p.status);
                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            "group border-b border-border/60 hover:bg-muted/40 transition-colors",
                            isSelected && "bg-primary/5",
                            finalLvl === "critico" && "bg-destructive/5",
                          )}
                        >
                          <td className="px-3 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(p.id)}
                              aria-label={`Selecionar ${p.reference}`}
                            />
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <Link to={`/pagamentos/${p.id}`} className="block group/link">
                              <div className="flex flex-col gap-1 min-w-0">
                                <span className="font-semibold text-sm text-foreground group-hover/link:text-primary transition-colors break-words whitespace-normal">{p.reference}</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <PaymentRiskBadgeInline paymentId={p.id} compact />
                                  {openQuestionCount[p.id] > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning-text">
                                      <MessageCircleQuestion className="h-2.5 w-2.5" /> {openQuestionCount[p.id]}
                                    </span>
                                  )}
                                  {p.processing_timeout_occurred && (
                                    <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-destructive">
                                      <Clock className="h-2.5 w-2.5" /> Limite IA
                                    </span>
                                  )}
                                </div>
                              </div>
                            </Link>
                          </td>
                          <td className="px-3 py-3 align-middle hidden 2xl:table-cell">
                            <div className="flex flex-col text-[11px]">
                              <span className="font-medium text-foreground truncate max-w-[180px]">{analystName}</span>
                              <span className="text-muted-foreground">
                                {p.payment_type ? PAYMENT_TYPE_LABELS[p.payment_type] : "—"}
                                {companies > 0 && ` · ${companies} empresa${companies > 1 ? "s" : ""}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle hidden md:table-cell">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-semibold text-foreground capitalize leading-tight">
                                {formatCompetence(p.competence_months?.length ? p.competence_months : p.competence_month)}
                              </span>
                              {SLA_EXEMPT_STATUSES.has(p.status) ? (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              ) : (
                                <span
                                  className={cn(
                                    "text-[11px]",
                                    finalLvl === "critico" && "text-destructive font-medium",
                                    finalLvl === "leve" && "text-warning-text font-medium",
                                    finalLvl === "none" && "text-muted-foreground",
                                  )}
                                >
                                  {formatDuration(elapsedMs)} no status
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-middle text-right hidden md:table-cell">
                            <span className="text-muted-foreground">
                              {p.items_count.toLocaleString("pt-BR")} <span className="text-[10px]">itens</span>
                            </span>
                          </td>
                          <td className="px-3 py-3 align-middle text-right">
                            <span className="font-bold text-foreground" title={Math.abs(Number(p.liquido_total ?? p.total_amount) - Number(p.bruto_total ?? p.total_amount)) > 0.01 ? `Bruto ${formatCurrency(p.bruto_total ?? p.total_amount)}` : undefined}>{formatCurrency(p.liquido_total ?? p.total_amount)}</span>
                            {Math.abs(Number(p.liquido_total ?? p.total_amount) - Number(p.bruto_total ?? p.total_amount)) > 0.01 && (
                              <div className="text-[10px] text-muted-foreground">bruto {formatCurrency(p.bruto_total ?? p.total_amount)}</div>
                            )}
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <div className="flex items-center justify-between gap-2">
                              <StatusBadge status={p.status} analysisMode={(p as any).analysis_mode} confeccaoStatus={(p as any).confeccao_status} />
                              {canDelete && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                                      title="Excluir lote"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Excluir este lote?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Esta ação remove o lote <strong>{p.reference}</strong>, todos os seus itens e histórico permanentemente.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deletePayment(p.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Excluir definitivamente
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Paginação server-side */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-medium text-muted-foreground px-1">
              <div className="flex items-center gap-3">
                <span>
                  Exibindo <span className="text-foreground font-bold tabular-nums">{rows.length === 0 ? 0 : page * pageSize + 1}</span>
                  {"–"}
                  <span className="text-foreground font-bold tabular-nums">{page * pageSize + rows.length}</span>
                  {" de "}
                  <span className="text-foreground font-bold tabular-nums">{totalRows.toLocaleString("pt-BR")}</span>
                  {" lote"}{totalRows === 1 ? "" : "s"}
                  {archivedView ? " arquivado(s)" : " ativo(s)"}
                </span>
                {loading && <span className="text-muted-foreground">carregando…</span>}
                {selected.size > 0 && (
                  <span className="text-primary font-bold">
                    {selected.size} selecionado{selected.size > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[50, 100, 200, 500].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} / página</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Anterior
                </Button>
                <span className="tabular-nums px-1">
                  pág. {page + 1} / {Math.max(1, Math.ceil(totalRows / pageSize))}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || (page + 1) * pageSize >= totalRows}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>

          </>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {kanbanGroups.map((g) => (
              <div key={g.status} className="rounded-lg border bg-muted/20 flex flex-col min-h-[120px]">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-background/40 rounded-t-lg">
                  <StatusBadge status={g.status} />
                  <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{g.items.length}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                  {g.items.map((p) => renderCard(p, true))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!reanalysisConfirm}
        onOpenChange={(o) => { if (!o) { setReanalysisConfirm(null); setReanalysisRunAi(false); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar reanálise</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Você está prestes a reanalisar{" "}
                  <strong>{reanalysisConfirm?.ids.length ?? 0}</strong> lote(s).
                </p>
                {reanalysisConfirm?.loading ? (
                  <p className="text-muted-foreground">Estimando custo…</p>
                ) : reanalysisConfirm?.aiCount !== null && reanalysisConfirm ? (
                  <p>
                    Esta reanálise processará aproximadamente{" "}
                    <strong>{reanalysisConfirm.aiCount}</strong> item(ns) por IA
                    {typeof reanalysisConfirm.totalCount === "number" && (
                      <> (de {reanalysisConfirm.totalCount} itens no total)</>
                    )}
                    . Itens já em cache não consomem créditos.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Não foi possível estimar o custo — a reanálise será executada normalmente.
                  </p>
                )}
                <label className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/40">
                  <Checkbox
                    checked={reanalysisRunAi}
                    onCheckedChange={(c) => setReanalysisRunAi(c === true)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <strong>Incluir justificativas IA</strong>
                    <span className="block text-muted-foreground">
                      Quando desmarcado, roda apenas o motor de regras (sem consumo de créditos de IA).
                    </span>
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={runReanalysis}
              disabled={reanalysisConfirm?.loading}
            >
              Confirmar reanálise
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

};

export default Payments;
