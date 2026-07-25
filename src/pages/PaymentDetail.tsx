import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { generatePaymentReportPdf } from "@/lib/paymentReportPdf";
import { invokeDispatchAnalysis } from "@/lib/dispatchAnalysis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { humanizeCompanyGroupStatus } from "@/lib/companyGroupGuards";
import { StatusBadge } from "@/components/StatusBadge";
import { InvoiceQuestionsThread, type InvoiceQuestion } from "@/components/InvoiceQuestionsThread";
import { PaymentTimeline } from "@/components/payment-detail/PaymentTimeline";
import { PaymentSourceFilesList } from "@/components/payment-detail/PaymentSourceFilesList";
import { ParecerReportCard } from "@/components/payment-detail/ParecerReportCard";
import RemessaCompetenceBuckets from "@/components/payment-detail/RemessaCompetenceBuckets";
import { ProducaoDescompassoBanner } from "@/components/payment-detail/ProducaoDescompassoBanner";
import { PaymentInternalQuestionsPanel } from "@/components/payment-detail/PaymentInternalQuestionsPanel";
import { PaymentReportModal } from "@/components/payment-detail/PaymentReportModal";
import { PaymentConciliationModal } from "@/components/payment-detail/PaymentConciliationModal";
import { ReimportDiffDialog } from "@/components/ReimportDiffDialog";
import { computeReimportDiff, type ReimportDiff, type ExistingItemRow } from "@/lib/reimportDiff";
import { sha256Hex } from "@/lib/fileHash";
import { AssistanceAlertsDetailModal } from "@/components/payment-detail/AssistanceAlertsDetailModal";
import { PaymentBatchExportDialog } from "@/components/payment-detail/PaymentBatchExportDialog";
import { BonusPacienteDialog } from "@/components/payments/BonusPacienteDialog";
import { BatchConciliationReportDialog } from "@/components/payment-detail/BatchConciliationReportDialog";

import { ExportColumnPickerDialog } from "@/components/payment-detail/ExportColumnPickerDialog";
import ColumnMappingDialog from "@/components/payment/ColumnMappingDialog";
import { usePaymentTypeMeta } from "@/hooks/usePaymentTypeMeta";
// RuleTestModal foi promovido para /regras?tab=teste-motor

import { PaymentGroupCard } from "@/components/payment-detail/PaymentGroupCard";
import { ReleaseInvoiceRequestDialog } from "@/components/payment-detail/ReleaseInvoiceRequestDialog";
import { BatchReconciliationBlockDialog } from "@/components/payment-detail/BatchReconciliationBlockDialog";
import { parseReconciliationBlock, type ReconciliationBlockPayload } from "@/lib/parseReconciliationBlock";
import { BulkReleaseInvoiceRequestDialog } from "@/components/payment-detail/BulkReleaseInvoiceRequestDialog";
import { GroupReconciliationGate } from "@/components/payment-detail/GroupReconciliationGate";
import { CompanyListLegend } from "@/components/payment-detail/CompanyListLegend";
import { AnalysisProgressBar } from "@/components/payment-detail/AnalysisProgressBar";
import { BatchAIFailureReport } from "@/components/payment-detail/BatchAIFailureReport";
import { UnregisteredCompaniesPanel } from "@/components/payment-detail/UnregisteredCompaniesPanel";
import { ConfeccaoAuditPanel } from "@/components/payment-detail/ConfeccaoAuditPanel";
import { UnmatchedItemsPanel } from "@/components/payment-detail/UnmatchedItemsPanel";
import { PaymentPivotSection, type PivotVariant } from "@/components/payment-detail/PaymentPivotSection";
import { PreAnalysisScoreCard } from "@/components/payment-detail/PreAnalysisScoreCard";
import { DoctorAnomalyAlerts } from "@/components/payment-detail/DoctorAnomalyAlerts";
import { EmailApprovalCard } from "@/components/payment-detail/EmailApprovalCard";
import { ExecutiveSummaryCard } from "@/components/payment-detail/ExecutiveSummaryCard";
import { PaymentStatusFunnel } from "@/components/payment-detail/PaymentStatusFunnel";
import { PoolCalculationCard } from "@/components/payment-detail/PoolCalculationCard";
import { EngineSourcesCard } from "@/components/payment-detail/EngineSourcesCard";

import { DirectorBriefingCard } from "@/components/payment-detail/DirectorBriefingCard";

import { PhaseSummary, resolvePhase } from "@/components/payment-detail/PhaseSummary";
import { PaymentBatchActionsFooter } from "@/components/payment-detail/PaymentBatchActionsFooter";
import { RegisterExternalApprovalDialog } from "@/components/payment-detail/RegisterExternalApprovalDialog";
import { SpecialCaseRetroactiveBanner } from "@/components/payment-detail/SpecialCaseRetroactiveBanner";
import { MarkSpecialCaseDialog } from "@/components/payment-detail/MarkSpecialCaseDialog";
import { useHasSpecialCaseRules } from "@/components/payment-detail/useHasSpecialCaseRules";
import { scoreAttendance, calculateFinancialRisk } from "@/lib/riskScore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { recordObservation, type ObservationType } from "@/lib/observations";
import { claimPayment } from "@/lib/assignments";
import { AssignmentCard } from "@/components/payment-detail/AssignmentCard";


import { ConversationsSheet } from "@/components/payment-detail/conversations/ConversationsSheet";
import { ZeevBulkManualDialog } from "@/components/copilot/ZeevBulkManualDialog";
import { findItemsNeedingManualReason } from "@/lib/manualReasonGate";

import { QuestionsFab } from "@/components/payment-detail/QuestionsFab";
import { ExceptionPatternSuggest } from "@/components/payment-detail/ExceptionPatternSuggest";
import { ProductionValidationButton } from "@/components/payment-detail/ProductionValidationButton";
import { ProductionValidationPanel } from "@/components/payment-detail/ProductionValidationPanel";
import { usePaymentDetailData } from "@/hooks/usePaymentDetailData";
import { useUserCompanyNotes } from "@/hooks/useUserCompanyNotes";
import { PrivateCompanyNote } from "@/components/payment-detail/PrivateCompanyNote";
import { TussPrincipalAuditPanel, useTussAuditOpenCount } from "@/components/payment-detail/TussPrincipalAuditPanel";
import { PayoutBreakdownCard } from "@/components/PayoutBreakdownCard";
import type {
  PaymentItemRow as PaymentItemRowType,
  GroupRow,
  AiVersionRow,
} from "@/hooks/usePaymentDetailData";
import type { Database } from "@/integrations/supabase/types";

type PaymentUpdate = Database["public"]["Tables"]["payments"]["Update"];
type GroupUpdate = Database["public"]["Tables"]["payment_company_groups"]["Update"];
import { formatCurrency, formatDate, formatCompetence, formatDateOnly, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, PAYMENT_TRACK_LABELS, PAYMENT_TRACK_SHORT_LABELS, type PaymentStatus, type ItemAiStatus, type PaymentTrack, TONE_CLASSES } from "@/lib/status";
import {
  ANALYST_DONE_STATUSES,
  canTransition,
  canEditBatch,
  canReimportBatch,
  canAssumeBatch,
  canActAsValidatorOrDirector,
  resolveResendTarget,
  type ActorRole,
} from "@/lib/paymentFlow";
import { AlertTriangle, ArrowLeft, Ban, CalendarDays, Calculator, ChevronDown, ChevronRight, ClipboardList, Download, FileDown, Filter, GitCompare, History, Layers, Mail, MailCheck, MessageCircleQuestion, MessageSquarePlus, MoreHorizontal, RefreshCw, Search, Send, Settings2, Sparkles, Trash2, Upload, UserCheck, X, Info, ShieldAlert, ShieldCheck, Pencil, BarChart3, TestTube2, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import * as XLSX from "xlsx-js-style";
import { confirmDialog } from "@/lib/confirm";
import { DateInput } from "@/components/ui/date-input";
import { CostCenterCombobox } from "@/components/CostCenterCombobox";
import { HospitalScopedGuard } from "@/components/HospitalScopedGuard";


const ObservationTypeSelector = ({
  value,
  onChange,
  disabled
}: {
  value: ObservationType;
  onChange: (v: ObservationType) => void;
  disabled?: boolean;
}) => {
  return (
    <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-full border w-fit">
      <Button
        variant={value === "informativo" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2 text-[11px] gap-1.5"
        onClick={() => onChange("informativo")}
        disabled={disabled}
        type="button"
      >
        <Info className="h-3 w-3" />
        Informativo
      </Button>
      <Button
        variant={value === "impacta_aprovacao" ? "default" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-2 text-[11px] gap-1.5",
          value === "impacta_aprovacao" ? "bg-amber-500 hover:bg-amber-600 text-white" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
        )}
        onClick={() => onChange("impacta_aprovacao")}
        disabled={disabled}
        type="button"
      >
        <ShieldAlert className="h-3 w-3" />
        Impacta aprovação
      </Button>
      <Button
        variant={value === "justificativa_override" ? "default" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-2 text-[11px] gap-1.5",
          value === "justificativa_override" ? "bg-success hover:bg-success/90 text-white" : "text-success hover:text-success/90 hover:bg-success/10"
        )}
        onClick={() => onChange("justificativa_override")}
        disabled={disabled}
        type="button"
      >
        <Pencil className="h-3 w-3" />
        Justificativa
      </Button>
    </div>
  );
};


// Status que representam "handoff" — quem acabou de agir passou a bola adiante.
// Após qualquer transição para um destes, devolvemos o usuário para a lista geral
// de pagamentos: a próxima etapa não é dele.
const HANDOFF_FORWARD_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "aguardando_validacao",
  "aguardando_aprovacao",
  "aprovado",
  "aprovado_em_revisao",
]);

const EMPTY_POOL_INITIAL_IMPORT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "rascunho",
  "revisao_analista",
  "devolvido_analista",
  "aguardando_validacao",
  "aguardando_aprovacao",
]);


const itemToneMap: Record<ItemAiStatus, keyof typeof TONE_CLASSES> = {
  pendente: "muted", aprovado: "success", alerta: "warning", reprovado: "destructive",
  erro_duplicidade_pagamento: "destructive",
  erro_duplicidade_calculo: "primary",
  acatado: "success",
};

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole, roles } = useAuth();
  const location = useLocation();
  const hasSpecialCaseRules = useHasSpecialCaseRules(id ?? null);

  // Quando o usuário chega via "?highlight=<itemId>" (link a partir de outro
  // lote por duplicidade), pisca a linha alvo assim que ela aparece no DOM.
  // Lazy-import para evitar ciclo de imports no topo.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get("highlight");
    if (!target) return;
    import("@/lib/uiSignals").then(({ flashRowById }) => {
      flashRowById(target, 4000);
    });
  }, [location.search, id]);

  const {
    payment,
    paymentMissing,
    items,
    itemsLoading,
    itemsLoadIssue,
    obs,
    profiles,
    aiVersions,
    groups,
    invoices,
    questions,
    assignments,
    rulesIndex,
    rulesByName,
    expandedGroups,
    setExpandedGroups,
    setItems,
    load,
  } = usePaymentDetailData(id);
  const paymentTypeMeta = usePaymentTypeMeta((payment as any)?.payment_model_id ?? null);
  const {
    byGroup: privateNotes,
    attachmentsByGroup: privateAttachments,
    saveStatus: privateSaveStatus,
    setNote: setPrivateNote,
    setMarker: setPrivateMarker,
    setWaitingInfo: setPrivateWaitingInfo,
    uploadAttachment: uploadPrivateAttachment,
    deleteAttachment: deletePrivateAttachment,
    downloadAttachment: downloadPrivateAttachment,
  } = useUserCompanyNotes(id);
  const [markerFilter, setMarkerFilter] = useState<"all" | "pinned" | "waiting" | "reviewed">("all");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconBlock, setReconBlock] = useState<ReconciliationBlockPayload | null>(null);
  const [reconTargets, setReconTargets] = useState<string[]>([]);
  const [poolInfo, setPoolInfo] = useState<{ id: string; nome: string; deducao?: string | null } | null>(null);
  const [reconRetry, setReconRetry] = useState<(() => Promise<void>) | null>(null);
  const [historyItemFilter, setHistoryItemFilter] = useState<string>("all");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [obsType, setObsType] = useState<ObservationType>("informativo");
  const [itemCommentDraft, setItemCommentDraft] = useState<Record<string, string>>({});
  const [itemCommentIsQuestion, setItemCommentIsQuestion] = useState<Record<string, boolean>>({});
  const [itemCommentType, setItemCommentType] = useState<Record<string, ObservationType>>({});
  const [suggestingFor, setSuggestingFor] = useState<string | null>(null);
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [groupComment, setGroupComment] = useState<Record<string, string>>({});
  const [groupCommentType, setGroupCommentType] = useState<Record<string, ObservationType>>({});
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [metaDraft, setMetaDraft] = useState<{
    reference: string;
    description: string;
    payment_due_date: string;
    competence_month: string;
    analysis_mode: string;
    pool_id: string; // "" = nenhum
    rateio_source: string;
    cost_center_code: string;
  }>({ reference: "", description: "", payment_due_date: "", competence_month: "", analysis_mode: "padrao", pool_id: "", rateio_source: "", cost_center_code: "" });
  const [savingMeta, setSavingMeta] = useState(false);
  const [poolsForEdit, setPoolsForEdit] = useState<Array<{ id: string; nome: string }>>([]);
  const [externalRegistrationOpen, setExternalRegistrationOpen] = useState<"validation" | "approval" | null>(null);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);
  const [reimporting, setReimporting] = useState(false);
  const [reimportConfirm, setReimportConfirm] = useState<File[] | null>(null);
  // Progresso do reimport/addCompany por fase — evita a percepção de "nada
  // aconteceu" quando o loop está lendo/enviando dezenas de arquivos.
  const [importProgress, setImportProgress] = useState<{ stage: "parse" | "persist"; current: number; total: number } | null>(null);
  // Preview do diff antes de gravar a reimportação. Resolver na ref para
  // encadear await dentro de doReimport sem restruturar o fluxo assíncrono.
  const [reimportDiffState, setReimportDiffState] = useState<{ diff: ReimportDiff; sha256Matched: boolean } | null>(null);
  const reimportDiffResolverRef = useRef<((v: "confirm" | "cancel" | "skip") => void) | null>(null);
  const addCompanyInputRef = useRef<HTMLInputElement | null>(null);
  const [addingCompany, setAddingCompany] = useState(false);
  const [addCompanyConfirm, setAddCompanyConfirm] = useState<File[] | null>(null);
  // Diálogo de mapeamento de colunas quando a planilha (reimport ou adicionar
  // empresa) não tem todas as colunas obrigatórias detectadas automaticamente
  // ou tem cabeçalho fora do padrão. O usuário ajusta e reaplicamos o fluxo.
  const [columnMappingDialog, setColumnMappingDialog] = useState<{
    open: boolean;
    source: "reimport" | "addCompany";
    file: File;
    pendingFiles: File[];
    headers: string[];
    sampleRow: Record<string, unknown> | null;
    initialMapping: Record<string, string>;
    overrides: Record<string, Record<string, string>>;
    sig: string;
    compatibleFileNames: string[];
  } | null>(null);
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  // Gate de motivo de intervenção: itens com valor zerado pagos sem justificativa
  // bloqueiam o envio para validação/aprovação. Quando bloqueado, abrimos o
  // ZeevBulkManualDialog com a lista pré-carregada.
  const [manualReasonGate, setManualReasonGate] = useState<{
    open: boolean;
    items: Array<{
      id: string;
      doctor_name: string | null;
      procedure_code: string | null;
      procedure_description: string | null;
      procedure_amount: number | null;
      attendance_number: string | null;
    }>;
    companyName: string | null;
  }>({ open: false, items: [], companyName: null });


  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [groupAiOpen, setGroupAiOpen] = useState<Set<string>>(new Set());
  const [reanalyzingGroupId, setReanalyzingGroupId] = useState<string | null>(null);
  const [reprocessingAi, setReprocessingAi] = useState(false);
  const [skippedCompanies, setSkippedCompanies] = useState<Array<{ company_name: string; status: string }>>([]);
  const [validatingRules, setValidatingRules] = useState(false);
  useEffect(() => {
    if (payment?.analysis_mode === "confeccao") setSkippedCompanies([]);
  }, [payment?.analysis_mode]);

  // Carrega info do pool/dedução vinculados ao pagamento (para badge no header).
  useEffect(() => {
    const pid = (payment as any)?.pool_id as string | null | undefined;
    const did = (payment as any)?.pool_deduction_id as string | null | undefined;
    if (!pid) { setPoolInfo(null); return; }
    let alive = true;
    (async () => {
      const [pRes, dRes] = await Promise.all([
        supabase.from("pools").select("id, nome").eq("id", pid).maybeSingle(),
        did ? supabase.from("pool_deductions").select("descricao, tipo").eq("id", did).maybeSingle() : Promise.resolve({ data: null } as any),
      ]);
      if (!alive || !pRes.data) return;
      setPoolInfo({
        id: pRes.data.id,
        nome: (pRes.data as any).nome,
        deducao: dRes?.data ? ((dRes.data as any).descricao || (dRes.data as any).tipo) : null,
      });
    })();
    return () => { alive = false; };
  }, [(payment as any)?.pool_id, (payment as any)?.pool_deduction_id]);

  // Pool soberano: quando o lote tem pool_id, a tela canônica é /pool
  // (mostra rateio por PJ via payment_company_financials). A tela padrão
  // agrupa por company_name e mostra "Sem empresa · R$ 0,00" — confunde.
  useEffect(() => {
    const pid = (payment as any)?.pool_id as string | null | undefined;
    const mode = (payment as any)?.analysis_mode as string | null | undefined;
    const shouldStayOnLot = new URLSearchParams(location.search).get("voltarDoPool") === "1";
    // Em confecção, a tela do lote (PaymentDetail) é válida para pool — não redirecionar.
    if (pid && id && mode !== "confeccao" && !shouldStayOnLot) navigate(`/pagamentos/${id}/pool`, { replace: true });
  }, [(payment as any)?.pool_id, (payment as any)?.analysis_mode, id, location.search, navigate]);

  // Diálogo de "Fazer questionamento" — escopo lote ou empresa específica.
  const [askQuestion, setAskQuestion] = useState<
    null | { groupId?: string | null; companyName?: string | null }
  >(null);
  // Painel lateral com todas as conversas (threads) do lote.
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("conversas") === "1") setThreadsOpen(true);
    const tid = params.get("thread");
    if (tid) setInitialThreadId(tid);
  }, [location.search]);

  const [reprocessConfirmOpen, setReprocessConfirmOpen] = useState(false);
  const [pendingSendState, setPendingSendState] = useState<{ prontos: GroupRow[]; pendentes: GroupRow[] } | null>(null);
  const [bulkConcludeOpen, setBulkConcludeOpen] = useState(false);
  const [adjustmentItems, setAdjustmentItems] = useState<Array<{
    id: string;
    doctor_name: string;
    procedure_code: string | null;
    gross_amount: number;
    item_origem: string;
    origem_referencia: string | null;
    company_name: string | null;
  }>>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payment_items")
        .select("id, doctor_name, procedure_code, gross_amount, item_origem, origem_referencia, company_name")
        .eq("payment_id", id)
        .in("item_origem", ["conciliacao_credito", "conciliacao_debito", "glosa_debito"])
        .order("created_at", { ascending: false });
      if (!cancelled) setAdjustmentItems((data ?? []) as any);
    })();
    return () => { cancelled = true; };
  }, [id, items.length]);
  const [bulkConcludeSelected, setBulkConcludeSelected] = useState<Set<string>>(new Set());
  const [bulkConcluding, setBulkConcluding] = useState(false);
  const [reprocessFilter, setReprocessFilter] = useState<string[]>([]);
  // IA opt-in: analista precisa marcar explicitamente para consumir créditos.
  const [reprocessRunAi, setReprocessRunAi] = useState(false);
  const [openQuestionInvoiceId, setOpenQuestionInvoiceId] = useState<string | null>(null);
  const [isQuestionsPanelOpen, setIsQuestionsPanelOpen] = useState(false);
  const [isBatchReconReportOpen, setIsBatchReconReportOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isAssistanceAlertsOpen, setIsAssistanceAlertsOpen] = useState(false);
  const [conflictGrossForCard, setConflictGrossForCard] = useState<Record<string, number>>({});
  const [isBatchExportOpen, setIsBatchExportOpen] = useState(false);
  // isTestModalOpen removido — teste de regras foi para /regras?tab=teste-motor
  // O modal de conciliação só abre por ação explícita do usuário (botão/menu).
  // Não persistimos o estado para evitar reabertura automática ao entrar no lote.
  const [isConciliationOpen, setIsConciliationOpenState] = useState<boolean>(false);
  const [productionValidationOpen, setProductionValidationOpen] = useState(false);
  const [conciliationCompany, setConciliationCompanyState] = useState<string | null>(null);
  const setIsConciliationOpen = useCallback((o: boolean) => {
    setIsConciliationOpenState(o);
  }, []);
  const setConciliationCompany = useCallback((c: string | null) => {
    setConciliationCompanyState(c);
  }, []);
  const [hasReconciliationRun, setHasReconciliationRun] = useState<boolean>(false);
  // Busca dentro do detalhe (filtra grupos/itens por PJ, médico, atendimento, CC,
  // especialidade e descrição). Não esconde grupos cujo nome casa com a busca.
  const [itemSearch, setItemSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [criticalFilter, setCriticalFilter] = useState<"all" | "no_rule" | "divergent" | "validation" | "approved" | "approved_strict">("all");
  const [financialFilters, setFinancialFilters] = useState({
    proposedGlosas: false,
    appliedDebits: false,
    appliedCredits: false,
  });
  type FinancialFlags = {
    proposedGlosas: boolean;
    appliedDebits: boolean;
    appliedCredits: boolean;
  };
  const [financialFlagsByCompany, setFinancialFlagsByCompany] = useState<Record<string, {
    proposedGlosas: boolean;
    appliedDebits: boolean;
    appliedCredits: boolean;
  }>>({});
  const [onlyRegIssues, setOnlyRegIssues] = useState(false);
  const [regIssueItemIds, setRegIssueItemIds] = useState<Set<string>>(new Set());
  const tussAuditOpenCount = useTussAuditOpenCount(id);
  // Busca gross_amount de itens conflitantes (possivelmente em outros lotes)
  // para exibir "valor total em risco" no card de Alertas Assistenciais.
  // Mesmo padrão do AssistanceAlertsDetailModal.
  useEffect(() => {
    const ids = new Set<string>();
    for (const it of items) {
      const findings = (it as unknown as { validation_findings?: unknown }).validation_findings;
      if (!Array.isArray(findings)) continue;
      for (const f of findings as Array<{ conflicting_item_id?: string }>) {
        const cid = f?.conflicting_item_id;
        if (cid) ids.add(cid);
      }
    }
    const missing = Array.from(ids).filter((cid) => !(cid in conflictGrossForCard));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const chunkSize = 200;
      const acc: Record<string, number> = {};
      for (let i = 0; i < missing.length; i += chunkSize) {
        const slice = missing.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("payment_items")
          .select("id, gross_amount")
          .in("id", slice);
        if (error) continue;
        for (const r of data ?? []) acc[r.id as string] = Number(r.gross_amount ?? 0);
      }
      if (!cancelled) setConflictGrossForCard((prev) => ({ ...prev, ...acc }));
    })();
    return () => { cancelled = true; };
  }, [items, conflictGrossForCard]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const emptyFinancialFlags = (): FinancialFlags => ({ proposedGlosas: false, appliedDebits: false, appliedCredits: false });
    const loadFinancialFlags = async () => {
      const { data: applications } = await (supabase as any)
        .from("company_adjustment_applications")
        .select("company_id,status,reverted_at,company_financial_adjustments(company_id,tipo)")
        .eq("payment_id", id)
        .is("reverted_at", null);
      const { data: glosaDebts } = await (supabase as any)
        .from("glosa_debts")
        .select("company_id,status,resolution_status,ignored_at,origem_payment_id,target_payment_id,last_payment_id")
        .or(`origem_payment_id.eq.${id},target_payment_id.eq.${id},last_payment_id.eq.${id}`)
        .is("ignored_at", null);
      const { data: glosaApplications } = await (supabase as any)
        .from("glosa_payment_applications")
        .select("company_id,status,valor_aplicado,reverted_at")
        .eq("payment_id", id)
        .is("reverted_at", null);
      if (cancelled) return;
      const next: Record<string, FinancialFlags> = {};
      ((applications ?? []) as Array<{
        company_id: string | null;
        status: string | null;
        company_financial_adjustments?: { company_id?: string | null; tipo?: string | null } | null;
      }>).forEach((row) => {
        const companyId = row.company_id ?? row.company_financial_adjustments?.company_id ?? null;
        if (!companyId) return;
        const flags = next[companyId] ?? emptyFinancialFlags();
        const status = String(row.status ?? "");
        const tipo = String(row.company_financial_adjustments?.tipo ?? "");
        if (status === "proposto" && ["debito", "glosa_parcelada", "complemento_retroativo", "acordo"].includes(tipo)) flags.proposedGlosas = true;
        if (["proposto", "confirmado", "partial"].includes(status) && ["debito", "glosa_parcelada", "complemento_retroativo", "acordo"].includes(tipo)) flags.appliedDebits = true;
        if (["proposto", "confirmado", "partial"].includes(status) && tipo === "credito") flags.appliedCredits = true;
        next[companyId] = flags;
      });
      ((glosaApplications ?? []) as Array<{
        company_id: string | null;
        status: string | null;
        valor_aplicado: number | string | null;
      }>).forEach((row) => {
        if (!row.company_id) return;
        const status = String(row.status ?? "");
        const valor = Number(row.valor_aplicado ?? 0);
        if (!["proposto", "confirmado", "partial"].includes(status) || valor <= 0) return;
        const flags = next[row.company_id] ?? emptyFinancialFlags();
        flags.appliedDebits = true;
        flags.proposedGlosas = true;
        next[row.company_id] = flags;
      });
      ((glosaDebts ?? []) as Array<{
        company_id: string | null;
        status: string | null;
        resolution_status: string | null;
        origem_payment_id: string | null;
        target_payment_id: string | null;
        last_payment_id: string | null;
      }>).forEach((row) => {
        if (!row.company_id) return;
        const status = String(row.status ?? "");
        const resolution = String(row.resolution_status ?? "");
        if (status !== "ativo" && status !== "proposto") return;
        if (["quitada", "cancelada", "ignorada"].includes(resolution)) return;
        const flags = next[row.company_id] ?? emptyFinancialFlags();
        flags.proposedGlosas = true;
        // Débito vinculado a este lote como destino conta como "aplicado"
        const linkedHere = row.target_payment_id === id || row.last_payment_id === id;
        if (linkedHere && resolution === "vinculada") {
          flags.appliedDebits = true;
        }
        next[row.company_id] = flags;
      });

      setFinancialFlagsByCompany(next);
    };
    loadFinancialFlags();
    const ch = supabase
      .channel(`payment-financial-flags-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_adjustment_applications", filter: `payment_id=eq.${id}` },
        () => loadFinancialFlags(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "glosa_debts", filter: `origem_payment_id=eq.${id}` },
        () => loadFinancialFlags(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "glosa_debts", filter: `target_payment_id=eq.${id}` },
        () => loadFinancialFlags(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "glosa_debts", filter: `last_payment_id=eq.${id}` },
        () => loadFinancialFlags(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "glosa_payment_applications", filter: `payment_id=eq.${id}` },
        () => loadFinancialFlags(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { or: (f: string) => Promise<{ data: Array<{ item_id: string }> | null }> } } } })
        .from("v_payment_items_registration_issues")
        .select("item_id")
        .eq("payment_id", id)
        .or("doctor_unregistered.eq.true,pj_not_linked_to_doctor.eq.true");
      if (cancelled) return;
      setRegIssueItemIds(new Set((data ?? []).map((r) => r.item_id)));
    })();
    return () => { cancelled = true; };
  }, [id, items.length]);
  const [toleranceValue, setToleranceValue] = useState<number>(0.01);
  const [assignmentsHistoryOpen, setAssignmentsHistoryOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<{ status: "em_andamento" | "concluido" | "parcial" | "cancelado" } | null>(null);
  // Contagem de questionamentos abertos por empresa (payment_questions agrupado por company_group_id).
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [openThreadsCount, setOpenThreadsCount] = useState(0);
  const [releaseGroup, setReleaseGroup] = useState<GroupRow | null>(null);
  const [bulkReleaseOpen, setBulkReleaseOpen] = useState(false);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("payment_questions")
        .select("company_group_id,parent_id,status")
        .eq("payment_id", id);
      if (cancelled) return;
      const counts: Record<string, number> = {};
      let open = 0;
      (data ?? []).forEach((r: { company_group_id: string | null; parent_id: string | null; status: string }) => {
        if (r.company_group_id) counts[r.company_group_id] = (counts[r.company_group_id] ?? 0) + 1;
        if (!r.parent_id && r.status !== "encerrada") open += 1;
      });
      setQuestionCounts(counts);
      setOpenThreadsCount(open);
    };
    load();
    const ch = supabase
      .channel(`pq-counts-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_questions", filter: `payment_id=eq.${id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  // Detecta se já existe alguma conciliação para o lote — controla o botão por empresa.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await (supabase as any)
        .from("reconciliation_runs")
        .select("id")
        .eq("payment_id", id)
        .limit(1)
        .maybeSingle();
      if (!cancelled) setHasReconciliationRun(!!data);
    };
    check();
    const ch = supabase
      .channel(`recon-runs-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reconciliation_runs", filter: `payment_id=eq.${id}` },
        () => check(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  const openCompanyConciliation = (companyName: string) => {
    if (!hasReconciliationRun) {
      toast({
        title: "Lote sem conciliação",
        description: "Realize a conciliação do lote para visualizar o cruzamento desta empresa.",
      });
      return;
    }
    setConciliationCompany(companyName);
    setIsConciliationOpen(true);
  };

  // Toggle de visão por papel (Detalhe/Compacto/Executivo). Persiste por payment_id.
  const [viewMode, setViewMode] = useState<PivotVariant>(() => {
    if (!id) return "detalhe";
    const saved = typeof window !== "undefined" ? localStorage.getItem(`exacta:payment-view:${id}`) : null;
    if (saved === "detalhe" || saved === "compacto" || saved === "executivo") return saved;
    if (hasRole("validador") && !hasRole("analista")) return "compacto";
    if (hasRole("diretor") && !hasRole("analista")) return "executivo";
    return "detalhe";
  });
  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(`exacta:payment-view:${id}`, viewMode);
    } catch {
      /* ignore quota errors */
    }
  }, [id, viewMode]);
  const [aiCardsOpen, setAiCardsOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);


  useEffect(() => {
    document.title = "Pagamento | Exacta";
  }, []);

  // Retorno rápido da página dedicada: se a URL trouxer #group-<id>, garante
  // que o card desse grupo esteja expandido e faz scroll até ele assim que
  // os grupos forem carregados. Mantém continuidade de contexto entre lote
  // e análise dedicada (ex.: usuário clica "Voltar ao lote" e cai exatamente
  // onde estava).
  useEffect(() => {
    const hash = location.hash;
    if (!hash || !hash.startsWith("#group-")) return;
    if (groups.length === 0) return;
    const targetId = hash.slice("#group-".length);
    if (!groups.some((g) => g.id === targetId)) return;
    setExpandedGroups((prev) => {
      if (prev.has(targetId)) return prev;
      const n = new Set(prev);
      n.add(targetId);
      return n;
    });
    // Scroll após o paint para o card já estar montado/expandido.
    requestAnimationFrame(() => {
      const el = document.getElementById(`group-${targetId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.hash, groups, setExpandedGroups]);

  // Auto-claim: ao executar a 1ª ação como analista, registra automaticamente
  // que ele assumiu (ou transferiu para si) o lote. No-op se ele já é o
  // último responsável registrado.
  const autoClaim = async () => {
    if (!id || !user) return;
    if (!(hasRole("analista") || hasRole("admin"))) return;
    await claimPayment(id, user.id, "auto");
  };

  // Botão explícito "Assumir / Transferir para mim" no card do topo.
  const handleManualAssume = async () => {
    if (!id || !user) return;
    const res = await claimPayment(id, user.id, "manual");
    if (!res.ok) {
      toast({ title: "Falha ao assumir lote", description: (res as { error: string }).error, variant: "destructive" });
      return;
    }
    if ((res as { created?: boolean }).created) {
      toast({ title: "Lote atribuído a você", description: "Registrado no histórico de atribuições." });
      await load();
    }
  };

  const notifyDirectorsIfPending = async (pid: string) => {
    // Disparo fire-and-forget: a edge function é idempotente por payment_id
    // e revalida o status atual antes de enviar.
    try {
      await supabase.functions.invoke("notify-director-approval", { body: { paymentId: pid } });
    } catch (err) {
      console.warn("notify-director-approval falhou (silencioso):", err);
    }
  };

  const transition = async (newStatus: PaymentStatus, authorType: "validador" | "diretor" | "analista", message: string) => {
    if (!id || !payment) return;
    // Segregação de funções: quem criou o lote não pode validá-lo nem aprová-lo.
    if ((authorType === "validador" || authorType === "diretor") && !canActAsValidatorOrDirector(payment.created_by, user?.id)) {
      toast({
        title: "Ação bloqueada",
        description: "Quem cria o lote não pode validar nem aprovar. Outro usuário precisa concluir esta etapa.",
        variant: "destructive",
      });
      return;
    }
    // Gate: itens com valor zerado pagos sem motivo de intervenção bloqueiam
    // a transição para validação (aguardando_aprovacao) ou aprovação (aprovado).
    if (newStatus === "aguardando_aprovacao" || newStatus === "aprovado") {
      try {
        const pending = await findItemsNeedingManualReason(id);
        if (pending.length > 0) {
          toast({
            title: `${pending.length} ${pending.length === 1 ? "item exige" : "itens exigem"} motivo de intervenção`,
            description:
              "Valor zerado/ausente sem justificativa. Zeev pode sugerir um motivo em lote.",
            variant: "destructive",
          });
          setManualReasonGate({
            open: true,
            items: pending.map((p) => ({
              id: p.id,
              doctor_name: p.doctor_name,
              procedure_code: p.procedure_code,
              procedure_description: p.procedure_name,
              procedure_amount: p.procedure_amount,
              attendance_number: p.attendance_number,
            })),
            companyName: null,
          });
          return;
        }
      } catch (e) {
        console.warn("[manualReasonGate] falhou (não bloqueante):", e);
      }
    }
    setBusy(true);

    const updates: PaymentUpdate = { status: newStatus };
    if (authorType === "validador" && newStatus === "aguardando_aprovacao") {
      updates.validated_by = user!.id; updates.validated_at = new Date().toISOString();
    }
    if (authorType === "diretor" && newStatus === "aprovado") {
      updates.approved_by = user!.id; updates.approved_at = new Date().toISOString();
    }
    await supabase.from("payments").update(updates).eq("id", id);
    const obsRes = await recordObservation({
      payment_id: id, author_type: authorType, author_id: user!.id, message,
      status_from: payment.status, status_to: newStatus,
    });
    if (!obsRes.ok) {
      toast({ title: "Status atualizado, mas falha no histórico", description: obsRes.error, variant: "destructive" });
    }
    await load();
    setComment("");
    setBusy(false);
    if (newStatus === "aguardando_aprovacao") await notifyDirectorsIfPending(id);
    if (obsRes.ok) toast({ title: "Status atualizado", description: message });
    // Encaminhamento adiante: devolve o usuário para a lista de pagamentos —
    // a próxima etapa não é responsabilidade dele.
    if (HANDOFF_FORWARD_STATUSES.has(newStatus)) {
      navigate("/pagamentos");
    }
  };

  const requireComment = (cb: () => void) => {
    if (!comment.trim()) { toast({ title: "Adicione uma observação", variant: "destructive" }); return; }
    cb();
  };

  // ===== Ações por grupo (empresa) =====
  const transitionGroup = async (
    groupId: string,
    newStatus: PaymentStatus,
    authorType: ActorRole,
    messagePrefix: string,
    requireMsg = true,
  ) => {
    if (!id || !payment) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    // Segregação de funções: criador não valida nem aprova.
    if ((authorType === "validador" || authorType === "diretor") && !canActAsValidatorOrDirector(payment.created_by, user?.id)) {
      toast({
        title: "Ação bloqueada",
        description: "Quem cria o lote não pode validar nem aprovar. Outro usuário precisa concluir esta etapa.",
        variant: "destructive",
      });
      return;
    }
    // Guarda autoritativa: bloqueia transições inválidas no cliente.
    if (!canTransition(authorType, g.status as PaymentStatus, newStatus)) {
      toast({
        title: "Transição não permitida",
        description: `${authorType} não pode mover ${g.status} → ${newStatus}.`,
        variant: "destructive",
      });
      return;
    }
    const text = (groupComment[groupId] ?? "").trim();
    if (requireMsg && !text) {
      toast({ title: "Adicione um motivo para esta empresa", variant: "destructive" });
      return;
    }
    // Gate: por empresa, mesma checagem que no transition global.
    if (newStatus === "aguardando_aprovacao" || newStatus === "aprovado") {
      try {
        const pending = await findItemsNeedingManualReason(id, g.company_id ?? null);
        if (pending.length > 0) {
          toast({
            title: `${pending.length} ${pending.length === 1 ? "item exige" : "itens exigem"} motivo de intervenção`,
            description: `Empresa ${g.company_name}: valor zerado/ausente sem justificativa.`,
            variant: "destructive",
          });
          setManualReasonGate({
            open: true,
            items: pending.map((p) => ({
              id: p.id,
              doctor_name: p.doctor_name,
              procedure_code: p.procedure_code,
              procedure_description: p.procedure_name,
              procedure_amount: p.procedure_amount,
              attendance_number: p.attendance_number,
            })),
            companyName: g.company_name,
          });
          return;
        }
      } catch (e) {
        console.warn("[manualReasonGate group] falhou (não bloqueante):", e);
      }
    }
    setBusy(true);

    if (authorType === "analista") await autoClaim();
    const updates: GroupUpdate = { status: newStatus };
    if (authorType === "validador" && newStatus === "aguardando_aprovacao") {
      updates.validated_by = user!.id; updates.validated_at = new Date().toISOString();
    }
    if (authorType === "diretor" && newStatus === "aprovado") {
      updates.approved_by = user!.id; updates.approved_at = new Date().toISOString();
    }
    if (authorType === "diretor" && newStatus === "rejeitado") {
      updates.rejected_by = user!.id; updates.rejected_at = new Date().toISOString();
      updates.rejection_reason = text || null;
    }
    const { error } = await supabase.from("payment_company_groups").update(updates).eq("id", groupId);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); setBusy(false); return; }
    const obsRes = await recordObservation({
      payment_id: id, author_type: authorType, author_id: user!.id,
      message: `[${g.company_name}] ${messagePrefix}${text ? `: ${text}` : ""}`,
      status_from: g.status, status_to: newStatus,
    });
    if (!obsRes.ok) {
      toast({ title: "Histórico não registrado", description: obsRes.error, variant: "destructive" });
    }
    setGroupComment((m) => ({ ...m, [groupId]: "" }));
    await load();
    setBusy(false);
    // Após o trigger recomputar payments.status a partir dos grupos, dispara
    // a notificação aos diretores se o pagamento agregado virou aguardando_aprovacao.
    // A edge function valida o status atual e é idempotente por payment_id.
    await notifyDirectorsIfPending(id);
    toast({ title: `Empresa ${g.company_name}`, description: messagePrefix });
    if (HANDOFF_FORWARD_STATUSES.has(newStatus)) {
      navigate("/pagamentos");
    }
  };

  // Reencaminhar grupo do analista direto para quem devolveu (diretor → aprovação; validador → validação).
  const resendGroup = async (groupId: string) => {
    if (!id) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const target = resolveResendTarget(obs, g.company_name);
    if (!target) {
      // sem histórico de devolução → fallback: enviar para validação
      return sendForValidation(groupId);
    }
    if (!canTransition("analista", g.status as PaymentStatus, target.nextStatus)) {
      toast({ title: "Transição não permitida", variant: "destructive" });
      return;
    }
    const text = (groupComment[groupId] ?? "").trim();
    setBusy(true);
    await autoClaim();
    const { error: upErr } = await supabase.from("payment_company_groups")
      .update({ status: target.nextStatus }).eq("id", groupId);
    if (upErr) {
      setBusy(false);
      toast({ title: "Falha ao reencaminhar", description: upErr.message, variant: "destructive" });
      return;
    }
    const obsRes = await recordObservation({
      payment_id: id,
      author_type: "analista",
      author_id: user!.id,
      message: `[${g.company_name}] Reencaminhado ao ${target.role} pelo analista${text ? `: ${text}` : ""}.`,
      status_from: g.status,
      status_to: target.nextStatus,
    });
    if (!obsRes.ok) {
      toast({ title: "Histórico não registrado", description: obsRes.error, variant: "destructive" });
    }
    setGroupComment((m) => ({ ...m, [groupId]: "" }));
    await load();
    setBusy(false);
    toast({ title: `Empresa ${g.company_name}`, description: `Reencaminhada ao ${target.role}.` });
    navigate("/pagamentos");
  };

  // Analista reaplica as regras (reanálise da IA) APENAS para os itens da empresa devolvida,
  // antes de reencaminhar. Isso recalcula expected_amount, alerts e matched_rules.
  const reanalyzeGroup = async (g: GroupRow) => {
    if (!id) return;
    setReanalyzingGroupId(g.id);
    await autoClaim();
    try {
      const dispatchRes = await invokeDispatchAnalysis({ payment_id: id, only_companies: [g.company_name], force_fresh_rules: true, skip_ai: true });
      if (!dispatchRes.ok) {
        if (dispatchRes.blocked) return;
        throw dispatchRes.error;
      }
      const obsRes = await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user!.id,
        message: `[${g.company_name}] Regras reaplicadas pelo analista (reanálise da IA).`,
        status_from: g.status,
        status_to: g.status,
      });
      if (!obsRes.ok) {
        toast({ title: "Histórico não registrado", description: obsRes.error, variant: "destructive" });
      }
      toast({ title: "Reanálise iniciada", description: `Processando itens de ${g.company_name}…` });
      // Não chama load() aqui — o AnalysisProgressBar detecta o job via realtime
      // e chama onJobChange quando concluir, que aciona o reload automático.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao reaplicar regras", description: msg, variant: "destructive" });
    } finally {
      setReanalyzingGroupId(null);
    }
  };

  /**
   * Gate: bloqueia avanço do lote enquanto houver itens em quarentena
   * (sem PJ vinculada) OU itens órfãos de empresa (company_id NULL não-pool).
   * O analista precisa resolver via UnmatchedItemsPanel/UnregisteredCompaniesPanel
   * antes de encerrar confecção, concluir em massa ou enviar para validação.
   * Retorna true quando pode seguir, false quando bloqueou (já emitiu toast).
   */
  const ensureQuarantineResolved = async (): Promise<boolean> => {
    if (!id) return true;
    const [{ count: unmatched }, { count: orphans }] = await Promise.all([
      supabase
        .from("payment_unmatched_items")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", id)
        .eq("status", "pending"),
      supabase
        .from("payment_items")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", id)
        .is("company_id", null)
        .or("is_pool_item.is.null,is_pool_item.eq.false"),
    ]);
    const totalPending = (unmatched ?? 0) + (orphans ?? 0);
    if (totalPending > 0) {
      toast({
        title: "Fila de bases sem PJ pendente",
        description: `${totalPending} item(ns) sem empresa vinculada aguardam sua revisão. Resolva o painel "Itens em quarentena" antes de seguir.`,
        variant: "destructive",
      });
      // Rola até o painel para o analista agir sem procurar.
      requestAnimationFrame(() => {
        document
          .querySelector('[data-quarantine-anchor="true"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return false;
    }
    return true;
  };

  // Analista envia o lote para validação.
  // Grupos prontos = {concluida_analista, devolvido_analista}. Grupos pendentes
  // (revisao_analista) ficam para trás e disparam modal de aviso. A validação
  // é fila coletiva: qualquer validador pode assumir.
  const doSendForValidation = async (targets: typeof groups) => {
    if (!id || targets.length === 0) return;
    if (!(await ensureQuarantineResolved())) return;
    // Gate: bloqueia envio enquanto houver médico provisório vinculado a
    // QUALQUER item deste pagamento. Admin precisa aprovar primeiro.
    {
      const { data: itemRows } = await supabase
        .from("payment_items")
        .select("doctor_id")
        .eq("payment_id", id)
        .not("doctor_id", "is", null);
      const doctorIds = Array.from(new Set(((itemRows ?? []) as Array<{ doctor_id: string | null }>)
        .map((r) => r.doctor_id).filter(Boolean) as string[]));
      if (doctorIds.length > 0) {
        const { data: pendingDocs } = await supabase
          .from("doctors")
          .select("full_name")
          .in("id", doctorIds)
          .eq("pending_admin_review", true);
        if (pendingDocs && pendingDocs.length > 0) {
          const names = Array.from(new Set(pendingDocs.map((d: any) => d.full_name).filter(Boolean))).slice(0, 5);
          toast({
            title: "Envio bloqueado: cadastros provisórios pendentes",
            description: `Aguardando aprovação do administrador para: ${names.join(", ")}${pendingDocs.length > 5 ? "…" : ""}.`,
            variant: "destructive",
          });
          return;
        }
      }
    }
    setBusy(true);
    await autoClaim();
    // Envio ATÔMICO via RPC — substitui o loop UPDATE-por-grupo que
    // deixava grupos travados em 'concluida_analista' quando uma das
    // chamadas falhava silenciosamente (RLS, AbortError de token refresh,
    // throttling). A RPC roda em uma única instrução, então ou tudo passa
    // ou nada passa.
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "bulk_send_groups_to_validation",
      { _payment_id: id, _group_ids: targets.map((g) => g.id) },
    );
    if (rpcErr) {
      setBusy(false);
      // Bloqueio do trigger de divergência pedido × regra: abre dialog
      // com ações diretas (devolver/liberar/abrir empresa) em vez de
      // só toast. Vale para o envio analista→validador agora que o gate
      // dispara também em 'aguardando_validacao'.
      const block = parseReconciliationBlock(rpcErr);
      if (block) {
        setReconBlock(block);
        setReconTargets(targets.map((g) => g.id));
        // Guarda o retry para que "Liberar com justificativa" possa re-disparar
        // o envio depois do override ser registrado.
        setReconRetry(() => async () => { await doSendForValidation(targets); });
        return;
      }
      toast({ title: "Falha ao enviar para validação", description: rpcErr.message, variant: "destructive" });
      return;
    }
    const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const updated = Number((rpcRow as { updated_count?: number } | null)?.updated_count ?? 0);
    if (updated === 0) {
      setBusy(false);
      toast({
        title: "Nenhuma empresa enviada",
        description: (rpcRow as { message?: string } | null)?.message ?? "Status atual não permite envio.",
        variant: "destructive",
      });
      return;
    }
    // Histórico + notificação por grupo são best-effort e NÃO bloqueiam o
    // envio (já efetivado pela RPC). Disparados em paralelo para não
    // recriar o problema de loop serial.
    await Promise.allSettled(
      targets.map(async (g) => {
        const obsRes = await recordObservation({
          payment_id: id, author_type: "analista", author_id: user!.id,
          message: `[${g.company_name}] Enviado para validação pelo analista.`,
          status_from: g.status, status_to: "aguardando_validacao",
        });
        if (!obsRes.ok) {
          console.warn("[sendForValidation] histórico falhou", g.id, obsRes.error);
        }
        supabase.functions.invoke("notify-validator-assignment", {
          body: { payment_id: id, group_id: g.id, sender_id: user!.id },
        }).catch((e) => console.warn("notify-validator-assignment failed", g.id, e));
      }),
    );
    await load();
    setBusy(false);
    toast({ title: "Lote enviado para validação", description: `${updated} empresa(s) a caminho do validador.` });
    navigate("/pagamentos");
  };

  // Picker de colunas do Excel de Confecção.
  const [exportPickerOpen, setExportPickerOpen] = useState(false);

  // Registry de colunas disponíveis no Excel de Confecção.
  // O usuário escolhe quais e em que ordem via ExportColumnPickerDialog.
  const CONFECCAO_EXPORT_COLUMNS: Array<{
    id: string;
    label: string;
    isMoney?: boolean;
    width: number;
    get: (it: any) => any;
  }> = [
    { id: "company_name", label: "Empresa", width: 32, get: (it) => it.company_name ?? "" },
    { id: "doctor_name", label: "Médico", width: 28, get: (it) => it.doctor_name ?? "" },
    { id: "doctor_role", label: "Função", width: 14, get: (it) => it.doctor_role ?? "" },
    { id: "patient_name", label: "Paciente", width: 26, get: (it) => it.patient_name ?? "" },
    { id: "attendance_number", label: "Atendimento", width: 14, get: (it) => it.attendance_number ?? "" },
    { id: "procedure_code", label: "Código TUSS", width: 14, get: (it) => it.procedure_code ?? "" },
    { id: "procedure_name", label: "Procedimento", width: 42, get: (it) => it.procedure_name ?? it.description ?? "" },
    { id: "agreement_text", label: "Convênio", width: 30, get: (it) => it.agreement_text ?? "" },
    { id: "procedure_date", label: "Data Procedimento", width: 16, get: (it) => it.procedure_date ? new Date(it.procedure_date).toLocaleDateString("pt-BR") : "" },
    { id: "procedure_amount", label: "Valor Convênio (R$)", width: 18, isMoney: true, get: (it) => Number(it.procedure_amount ?? it.gross_amount ?? 0) },
    { id: "expected_amount", label: "Repasse Calculado (R$)", width: 20, isMoney: true, get: (it) => it.expected_amount != null ? Number(it.expected_amount) : "" },
    { id: "applied_rule_label", label: "Regra Aplicada", width: 32, get: (it) => it.applied_rule_label ?? "" },
    { id: "sector", label: "Setor", width: 22, get: (it) => it.sector ?? "" },
  ];

  const DEFAULT_CONFECCAO_EXPORT_ORDER = [
    "company_name", "doctor_name", "doctor_role", "patient_name",
    "attendance_number", "procedure_code", "procedure_name",
    "agreement_text", "procedure_date", "procedure_amount",
    "expected_amount", "applied_rule_label", "sector",
  ];

  // Modo confecção: exporta xlsx formatado (cabeçalho azul Rede D'Or, zebra,
  // bordas, moeda BR, freeze pane, autofilter, total geral). Recebe a lista
  // ordenada de colunas escolhida pelo usuário.
  const exportConfeccaoXlsx = (orderedColumnIds: string[]) => {
    if (!items.length) return;
    const activeItems = (items as any[]).filter((it) => !it.is_cancelled);
    const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const cols = orderedColumnIds
      .map((id) => CONFECCAO_EXPORT_COLUMNS.find((c) => c.id === id))
      .filter((c): c is (typeof CONFECCAO_EXPORT_COLUMNS)[number] => !!c);
    if (cols.length === 0) return;

    const headers = cols.map((c) => c.label);
    const dataRows = activeItems.map((it) => cols.map((c) => c.get(it)));

    // Totais somente para colunas monetárias.
    const moneyIdx = cols.map((c, i) => (c.isMoney ? i : -1)).filter((i) => i >= 0);
    const totals = moneyIdx.reduce<Record<number, number>>((acc, i) => {
      acc[i] = dataRows.reduce((s, r) => s + (Number(r[i]) || 0), 0);
      return acc;
    }, {});

    const title = `Relatório de Confecção — ${payment?.reference ?? "Lote"}`;
    const metaParts = [`Itens: ${activeItems.length}`];
    moneyIdx.forEach((i) => metaParts.push(`${cols[i].label.replace(" (R$)", "")}: ${fmtBRL(totals[i])}`));
    const meta1 = metaParts.join("  ·  ");
    const meta2 = `Gerado em ${new Date().toLocaleString("pt-BR")}`;

    // Linha de total geral: rótulo na primeira coluna monetária - 1 (ou col 0).
    const totalLabelCol = moneyIdx.length > 0 ? Math.max(0, moneyIdx[0] - 1) : 0;
    const totalRow: any[] = cols.map((_, i) => {
      if (i === totalLabelCol) return "Total geral";
      if (totals[i] != null) return totals[i];
      return "";
    });

    const aoa: any[][] = [
      [title], [meta1], [meta2], [],
      headers,
      ...dataRows,
      totalRow,
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws["!cols"] = cols.map((c) => ({ wch: c.width }));
    (ws as any)["!views"] = [{ state: "frozen", ySplit: 5 }];
    const lastCol = cols.length - 1;
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
    ];

    const BRAND = "0B3D91";
    const BRAND_LIGHT = "E8EEF8";
    const ZEBRA = "F5F7FA";
    const BORDER = { style: "thin", color: { rgb: "D1D5DB" } } as const;
    const allBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    const moneyFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00;"R$ -"';

    const titleCell = ws[XLSX.utils.encode_cell({ r: 0, c: 0 })];
    if (titleCell) titleCell.s = {
      font: { bold: true, sz: 14, color: { rgb: BRAND } },
      alignment: { vertical: "center" },
    };
    [1, 2].forEach((r) => {
      const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      if (c) c.s = { font: { sz: 10, color: { rgb: "4B5563" } } };
    });
    ws["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 14 }, { hpt: 6 }, { hpt: 24 }];

    headers.forEach((_, i) => {
      const c = ws[XLSX.utils.encode_cell({ r: 4, c: i })];
      if (c) c.s = {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 10 },
        fill: { fgColor: { rgb: BRAND } },
        alignment: { vertical: "center", horizontal: "center", wrapText: true },
        border: allBorders,
      };
    });

    const procIdx = cols.findIndex((c) => c.id === "procedure_name");
    for (let i = 0; i < dataRows.length; i++) {
      const r = 5 + i;
      const isZebra = i % 2 === 1;
      for (let c = 0; c < cols.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const isMoney = cols[c].isMoney === true;
        cell.s = {
          font: { sz: 10, color: { rgb: "111827" } },
          fill: isZebra ? { fgColor: { rgb: ZEBRA } } : undefined,
          alignment: { vertical: "center", horizontal: isMoney ? "right" : "left", wrapText: c === procIdx },
          border: allBorders,
        };
        if (isMoney && typeof cell.v === "number") cell.z = moneyFmt;
      }
    }

    const totalRowIdx = aoa.length - 1;
    for (let c = 0; c < cols.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: totalRowIdx, c })];
      if (!cell) continue;
      const isMoney = cols[c].isMoney === true;
      cell.s = {
        font: { bold: true, sz: 10, color: { rgb: BRAND } },
        fill: { fgColor: { rgb: BRAND_LIGHT } },
        alignment: { vertical: "center", horizontal: isMoney ? "right" : (c === totalLabelCol ? "right" : "left") },
        border: { top: { style: "medium", color: { rgb: BRAND } }, bottom: BORDER, left: BORDER, right: BORDER },
      };
      if (isMoney && typeof cell.v === "number") cell.z = moneyFmt;
    }

    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + dataRows.length, c: lastCol } }) };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Confecção");
    XLSX.writeFile(wb, `confeccao-${payment?.reference ?? "lote"}.xlsx`);
  };

  // Modo confecção: encerra a confecção e encaminha o lote para o fluxo de ANÁLISE.
  // O motor passa a confrontar com a base hospitalar (modo padrão) e a IA é reacionada.
  const sendConfeccaoForAnalysis = async () => {
    if (!id || !user) return;
    const ok = await confirmDialog({
      title: "Encaminhar lote para análise?",
      description: "A confecção será encerrada e o motor passa a confrontar com a base hospitalar.",
      details:
        "• O lote sai de CONFECÇÃO e entra em ANÁLISE.\n" +
        "• O motor confronta com a base hospitalar e a IA reavalia cada item.\n" +
        "• Só depois da análise o lote pode ir para validação ou aprovação.",
      confirmText: "Encaminhar",
      cancelText: "Cancelar",
      tone: "warning",
    });
    if (!ok) return;
    // Gate: mesmo bloqueio do envio normal — médico provisório precisa aprovação admin.
    {
      const { data: itemRows } = await supabase
        .from("payment_items").select("doctor_id").eq("payment_id", id).not("doctor_id", "is", null);
      const doctorIds = Array.from(new Set(((itemRows ?? []) as Array<{ doctor_id: string | null }>)
        .map((r) => r.doctor_id).filter(Boolean) as string[]));
      if (doctorIds.length > 0) {
        const { data: pendingDocs } = await supabase
          .from("doctors").select("full_name").in("id", doctorIds).eq("pending_admin_review", true);
        if (pendingDocs && pendingDocs.length > 0) {
          const names = Array.from(new Set(pendingDocs.map((d: any) => d.full_name).filter(Boolean))).slice(0, 5);
          toast({
            title: "Envio bloqueado: cadastros provisórios pendentes",
            description: `Aguardando aprovação do administrador para: ${names.join(", ")}${pendingDocs.length > 5 ? "…" : ""}.`,
            variant: "destructive",
          });
          return;
        }
      }
    }
    setBusy(true);
    try {
      // Transição estrutural Confecção → Análise via RPC dedicado.
      // finalize_confeccao() troca analysis_mode, marca confeccao_status como
      // concluída, libera os grupos para revisao_analista e respeita o guard
      // de coerência do banco (status × analysis_mode × confeccao_status).
      const { error: rpcErr } = await supabase.rpc("finalize_confeccao", { _payment_id: id });
      if (rpcErr) throw rpcErr;
      await recordObservation({
        payment_id: id, author_type: "analista", author_id: user.id,
        message: `Confecção encerrada. Lote encaminhado para análise (modo padrão).`,
        status_from: payment?.status ?? null, status_to: "em_analise_ia",
      });
      const dispRes = await invokeDispatchAnalysis({ payment_id: id });
      if (!dispRes.ok) {
        if (dispRes.blocked) { await load(); return; }
        throw dispRes.error;
      }
      toast({ title: "Encaminhado para análise", description: "O motor está reanalisando o lote em modo padrão." });
      await load();
    } catch (e: unknown) {
      const err = e as any;
      const msg =
        err?.message ||
        err?.error_description ||
        err?.error ||
        err?.details ||
        err?.hint ||
        (typeof e === "string" ? e : "");
      const finalMsg = msg || (() => { try { return JSON.stringify(e); } catch { return "Erro desconhecido"; } })();
      console.error("[finalize_confeccao] erro ao encaminhar:", e);
      toast({ title: "Falha ao encaminhar", description: finalMsg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };


  const sendForValidation = async (onlyGroupId?: string) => {
    if (!id) return;
    const scope = onlyGroupId ? groups.filter((g) => g.id === onlyGroupId) : groups;
    const prontos = scope.filter((g) => g.status === "concluida_analista" || g.status === "devolvido_analista");
    const pendentes = scope.filter((g) => g.status === "revisao_analista");
    if (prontos.length === 0 && pendentes.length === 0) {
      toast({
        title: "Nenhuma empresa elegível",
        description: "Não há empresas em revisão ou concluídas neste lote.",
        variant: "destructive",
      });
      return;
    }
    if (pendentes.length > 0) {
      // Abre o diálogo mesmo quando não há prontas — única forma de oferecer
      // "Concluir e enviar todas" quando o analista quer despachar o lote
      // inteiro sem ter clicado em "Concluir" empresa por empresa.
      setPendingSendState({ prontos, pendentes });
      return;
    }
    await doSendForValidation(prontos);
  };


  // Analista conclui a análise de várias empresas de uma vez (em massa).
  // Apenas grupos em `revisao_analista` são elegíveis; passam para `concluida_analista`.
  // Depois o analista ainda precisa clicar em "Enviar lote para validação" para que
  // os grupos concluídos sigam ao validador (mesmo comportamento do botão individual
  // dentro da empresa).
  const bulkConcludeAnalysis = async (groupIds: string[]) => {
    if (!id || groupIds.length === 0) return;
    const targets = groups.filter((g) => groupIds.includes(g.id) && g.status === "revisao_analista");
    if (targets.length === 0) {
      toast({ title: "Nenhuma empresa elegível", description: "Selecione empresas em revisão pelo analista.", variant: "destructive" });
      return;
    }
    setBulkConcluding(true);
    if (!(await ensureQuarantineResolved())) {
      setBulkConcluding(false);
      return;
    }
    await autoClaim();
    // RPC atômica (SECURITY DEFINER) — antes era um loop com .update() que,
    // quando 0 linhas eram afetadas (RLS/gatilho recusando silenciosamente),
    // retornava upErr=null e o toast mentia dizendo "X concluídas".
    const { data, error } = await supabase.rpc("bulk_conclude_analyst_groups", {
      _payment_id: id,
      _group_ids: targets.map((g) => g.id),
    });
    setBulkConcluding(false);
    setBulkConcludeOpen(false);
    setBulkConcludeSelected(new Set());

    if (error) {
      toast({ title: "Falha ao concluir em massa", description: error.message, variant: "destructive" });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const updated = Number(row?.updated_count ?? 0);
    const skipped = Number(row?.skipped_count ?? 0);
    await load();
    if (updated === 0) {
      toast({
        title: "Nada foi concluído",
        description: row?.message ?? "A operação não atualizou nenhuma empresa. Verifique status atuais.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Análise concluída em massa",
      description: `${updated} empresa(s) marcadas como concluídas${skipped > 0 ? ` · ${skipped} ignorada(s)` : ""}. Use "Enviar lote para validação" para encaminhar.`,
    });
  };


  const toggleItemExpanded = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  /**
   * Gera o PDF da validação/aprovação. Inclui:
   *  - Identificação do pagamento e quem aprovou.
   *  - Tabela completa de itens (com status da IA).
   *  - Lista de divergências (alertas/reprovações com motivos).
   *  - Histórico de observações (data, autor, papel e mensagem) — base de
   *    auditoria para qualquer revisão futura.
   *
   * Faz upload em `approval-pdfs`, registra o caminho em `payments.approval_pdf_path`
   * e dispara o download local automaticamente.
   *
   * Quando `silentUpload=true`, não dispara o download (usado pelo gatilho
   * automático de aprovação a fim de não interromper o fluxo do diretor).
   */
  const generatePdf = async (opts: { silentUpload?: boolean } = {}) => {
    if (!payment) return;
    // Gerador unificado: o relatório por empresa usa o mesmo helper com
    // items/groups filtrados, garantindo PDFs idênticos em estrutura.
    const doc = await generatePaymentReportPdf({
      payment,
      items,
      groups,
      observations: obs,
      profiles,
      rulesIndex,
    });

    const blob = doc.output("blob");
    const path = `${payment.id}/aprovacao.pdf`;
    await supabase.storage.from("approval-pdfs").upload(path, blob, { upsert: true, contentType: "application/pdf" });
    await supabase.from("payments").update({ approval_pdf_path: path }).eq("id", payment.id);
    if (!opts.silentUpload) {
      doc.save(`aprovacao-${payment.reference}.pdf`);
      toast({ title: "PDF gerado" });
    }
  };

  // Auto-gera + baixa o PDF da validação assim que o pagamento é aprovado.
  // Dispara apenas quando o diretor/admin atual está vendo a tela e ainda
  // não há `approval_pdf_path` salvo — evita reemissão a cada visita e
  // garante que o documento de auditoria seja produzido na hora da decisão.
  const autoPdfFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!payment) return;
    if (payment.status !== "aprovado") return;
    if (payment.approval_pdf_path) return;
    if (!(hasRole("diretor") || hasRole("admin"))) return;
    if (autoPdfFiredRef.current === payment.id) return;
    if (items.length === 0) return; // espera carregar itens p/ não gerar PDF vazio
    autoPdfFiredRef.current = payment.id;
    (async () => {
      try {
        await generatePdf();
        toast({
          title: "PDF da aprovação gerado",
          description: "Download iniciado e cópia salva no histórico do lote.",
        });
      } catch (e) {
        toast({
          title: "Falha ao gerar PDF da aprovação",
          description: e instanceof Error ? e.message : "Tente novamente em Pós-aprovação → Gerar PDF.",
          variant: "destructive",
        });
        autoPdfFiredRef.current = null;
      }
    })();
  }, [payment, items.length, hasRole]);

  const sendInvoiceRequest = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("send-invoice-request", { body: { payment_id: id } });
    setBusy(false);
    // Erro de validação (CNPJ inválido) chega no body com status 422
    type InvalidEntry = { company_name?: string; doctor_name?: string; reason: string };
    type MissingCompanyEmail = { company_name: string };
    type SendInvoiceRequestResponse = {
      error?: string;
      message?: string;
      invalid?: InvalidEntry[];
      missing_company_emails?: MissingCompanyEmail[];
      invoices_created?: number;
      sent_ok?: number;
      sent_error?: number;
    };
    const payload = (data ?? {}) as SendInvoiceRequestResponse;
    if (payload?.error === "cnpj_invalido") {
      const detail = (payload.invalid ?? []).slice(0, 3).map((x) =>
        `• ${x.company_name ?? x.doctor_name}: ${x.reason}`
      ).join("\n");
      const more = (payload.invalid?.length ?? 0) > 3 ? `\n…e mais ${payload.invalid.length - 3} item(ns).` : "";
      toast({
        title: "Envio bloqueado: CNPJ inválido",
        description: `${payload.message}\n${detail}${more}`,
        variant: "destructive",
      });
      return;
    }
    if (payload?.error === "empresa_sem_email") {
      const detail = (payload.missing_company_emails ?? []).slice(0, 5).map((x) =>
        `• ${x.company_name}`
      ).join("\n");
      const total = payload.missing_company_emails?.length ?? 0;
      const more = total > 5 ? `\n…e mais ${total - 5} empresa(s).` : "";
      toast({
        title: "Empresas sem e-mail de NF",
        description: `${payload.message}\n${detail}${more}\n\nAbra Empresas → editar a empresa → "E-mails para pedido de NF".`,
        variant: "destructive",
      });
      return;
    }
    if (error || payload?.error) {
      toast({ title: "Erro", description: payload?.message ?? error?.message ?? "Falha ao enviar.", variant: "destructive" });
      return;
    }
    const n = payload?.invoices_created ?? 0;
    const ok = payload?.sent_ok ?? n;
    const err = payload?.sent_error ?? 0;
    if (err > 0 && ok === 0) {
      toast({
        title: "Falha no envio",
        description: `Nenhum e-mail foi enviado (${err} erro${err === 1 ? "" : "s"}). Verifique o provedor em Notas Fiscais.`,
        variant: "destructive",
      });
    } else if (err > 0) {
      toast({
        title: `${ok} pedido(s) enviado(s), ${err} com erro`,
        description: `Veja em Notas Fiscais para reenviar os que falharam.`,
      });
    } else {
      toast({
        title: "Pedido(s) de NF enviado(s)",
        description: `${n} pedido(s) gerado(s). Empresas recebem como destinatário (TO) e os médicos correspondentes em cópia (CC).`,
      });
    }
    load();
  };

  const openEditMeta = async () => {
    if (!payment) return;
    setMetaDraft({
      reference: payment.reference ?? "",
      description: payment.description ?? "",
      payment_due_date: payment.payment_due_date ?? "",
      competence_month: payment.competence_month ?? "",
      analysis_mode: (payment as any).analysis_mode ?? "padrao",
      pool_id: (payment as any).pool_id ?? "",
      rateio_source: (payment as any).rateio_source ?? "",
      cost_center_code: (payment as any).cost_center_code ?? "",
    });
    setEditMetaOpen(true);
    // carrega pools do hospital do lote
    try {
      const { data } = await supabase
        .from("pools")
        .select("id, nome, ativo, hospital_id")
        .eq("hospital_id", (payment as any).hospital_id)
        .eq("ativo", true)
        .order("nome");
      setPoolsForEdit(((data || []) as Array<{ id: string; nome: string }>).map((p) => ({ id: p.id, nome: p.nome })));
    } catch {
      setPoolsForEdit([]);
    }
  };
  const saveMeta = async () => {
    if (!id || !payment) return;
    if (!metaDraft.cost_center_code) {
      toast({ title: "Centro de custos obrigatório", description: "Selecione um centro de custos antes de salvar.", variant: "destructive" });
      return;
    }
    setSavingMeta(true);
    const newPoolId = metaDraft.pool_id || null;
    const updates: PaymentUpdate = {
      reference: metaDraft.reference.trim() || payment.reference,
      description: metaDraft.description.trim() || null,
      payment_due_date: metaDraft.payment_due_date || null,
      competence_month: metaDraft.competence_month || (payment as any).competence_month,
      analysis_mode: (metaDraft.analysis_mode || "padrao") as PaymentUpdate["analysis_mode"],
      pool_id: newPoolId,
      rateio_source: newPoolId ? (metaDraft.rateio_source || "planilha") : null,
      cost_center_code: metaDraft.cost_center_code,
    } as PaymentUpdate;
    const { error } = await supabase.from("payments").update(updates).eq("id", id);
    if (error) {
      setSavingMeta(false);
      toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    // Se mudou algo estrutural (pool/modo/competência), invalida fontes do motor
    // para que recalc-payment-pools + finalize-payment-engine releiam tudo.
    const structuralChanged =
      newPoolId !== ((payment as any).pool_id ?? null) ||
      (metaDraft.analysis_mode || "padrao") !== ((payment as any).analysis_mode ?? "padrao") ||
      (metaDraft.competence_month || "") !== ((payment as any).competence_month ?? "");
    if (structuralChanged) {
      try {
        // Se o vínculo de pool mudou, refleti-lo nos itens (is_pool_item) —
        // o PoolAnalysis filtra por essa flag; sem ela o pool fica "0 item(ns)".
        const poolChanged = newPoolId !== ((payment as any).pool_id ?? null);
        if (poolChanged) {
          await supabase
            .from("payment_items")
            .update({ is_pool_item: newPoolId !== null })
            .eq("payment_id", id);
        }
        // Só invalida fontes que finalize-payment-engine sabe relê-las.
        // rules/payout_model são remarcadas pelo analyze-payment ao final do
        // processamento — invalidar aqui deixaria o card travado em "pendente"
        // sem motivo (os cálculos por item permanecem íntegros após edição
        // de pool/modo/competência).
        await supabase
          .from("payment_engine_sources")
          .update({ read_at: null, applied_count: 0, total_value: 0 })
          .eq("payment_id", id)
          .in("source", [
            "company_adjustments",
            "glosa_debts",
            "minimum_guarantee",
            "pool_deductions",
            "retroactive_reconciliation",
            "special_case_marks",
          ]);
        await supabase.functions.invoke("finalize-payment-engine", { body: { payment_id: id, reason: "edit_meta_structural" } });
      } catch (e) {
        console.warn("[edit-meta] falha ao re-disparar motor:", e);
      }
    }


    setSavingMeta(false);
    await recordObservation({
      payment_id: id, author_type: "analista", author_id: user!.id,
      message: structuralChanged
        ? `Lote editado pelo analista (metadados + vínculo de pool/modo). Motor re-disparado.`
        : `Lote editado pelo analista (referência/descrição/vencimento).`,
      status_from: payment.status, status_to: payment.status,
    });
    toast({ title: "Lote atualizado" });
    setEditMetaOpen(false);
    load();
  };

  // ===== Reimportar base =====
  // Substitui itens/grupos do lote a partir de um novo arquivo Excel,
  // mantendo metadados (referência, competência, tipo, etc.). Disponível
  // apenas enquanto o lote está editável pelo analista (mesma regra do
  // botão "Editar lote"). Útil quando a planilha original tinha erro de
  // formato e o analista refez a base.
  const doReimport = async (files: File[], overrides: Record<string, Record<string, string>> = {}) => {
    if (!id || !payment || !user) return;
    const importingInitialPaymentBase = canImportInitialPaymentBase;
    setReimporting(true);
    try {
      const { parsePaymentFile, inspectFileHeaders } = await import("@/lib/parsePaymentFile");
      const { computeHeaderSignature, summarizeMissing, inspectColumnMapping } = await import("@/lib/columnMapping");
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const companiesData = await fetchAllPaginated<any>((from, to) =>
        supabase.from("companies").select("id,name,aliases").range(from, to),
      );
      const companies = companiesData.map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));

      // Pré-carrega catálogo de item_types para (a) achar id de "procedimento"
      // como fallback dinâmico quando o lote é Consulta e (b) extras de TUSS
      // aceitos pela Consulta.
      let dynamicFallbackItemTypeId: string | null = null;
      let consultaTussExtras: string[] = [];
      try {
        const { data: itemTypes } = await supabase
          .from("item_types" as any)
          .select("id,code,tuss_codes_extra");
        const it = (itemTypes ?? []) as any[];
        dynamicFallbackItemTypeId = it.find((t) => t.code === "procedimento")?.id ?? null;
        const consulta = it.find((t) => t.code === "consulta");
        consultaTussExtras = Array.isArray(consulta?.tuss_codes_extra) ? consulta.tuss_codes_extra : [];
      } catch { /* noop — fallback ausente apenas desativa reclassificação */ }

      let allRows: any[] = [];
      let fileNames: string[] = [];

      // Pré-inspeção: lê os cabeçalhos de TODAS as planilhas em paralelo,
      // busca templates salvos por hospital + assinatura, e determina o
      // mapping efetivo por arquivo (override manual > template salvo >
      // detecção heurística). Só abrimos o diálogo de mapeamento quando o
      // arquivo AINDA fica sem colunas obrigatórias — evita o comportamento
      // antigo "empresa por empresa" mesmo quando o padrão é o mesmo.
      const hospitalId = (payment as any).hospital_id ?? null;
      const inspections = await Promise.all(files.map(async (file) => {
        const { headers, sampleRow } = await inspectFileHeaders(file);
        const sig = await computeHeaderSignature(headers);
        const tplQuery = supabase
          .from("sheet_column_templates" as never)
          .select("id,mapping,name")
          .eq("header_signature", sig)
          .limit(1);
        const { data: tplRows } = hospitalId
          ? await tplQuery.or(`hospital_id.eq.${hospitalId},hospital_id.is.null`)
          : await tplQuery.is("hospital_id", null);
        const tpl = (tplRows ?? [])[0] as { id: string; mapping: any; name: string } | undefined;
        const overrideForFile = overrides[file.name];
        const manualMapping = overrideForFile ?? tpl?.mapping;
        const hits = inspectColumnMapping(headers).map((h) => {
          const override = manualMapping?.[h.field];
          if (override && headers.includes(override)) return { ...h, header: override, score: 100, confidence: "high" as const };
          return h;
        });
        const { missingRequired } = summarizeMissing(hits, paymentTypeMeta);
        return { file, headers, sampleRow, sig, tpl, manualMapping, hits, missingRequired };
      }));

      // Se houver algum arquivo sem colunas obrigatórias resolvidas, abrimos
      // o diálogo apenas UMA vez para o primeiro dele, oferecendo aplicar o
      // mesmo mapeamento aos demais arquivos com cabeçalho idêntico.
      const needs = inspections.find((i) => i.missingRequired.length > 0);
      if (needs) {
        const compatibleFileNames = inspections
          .filter((i) => i !== needs && i.sig === needs.sig && i.missingRequired.length > 0)
          .map((i) => i.file.name);
        const initial: Record<string, string> = {};
        needs.hits.forEach((h) => { if (h.header) initial[h.field] = h.header; });
        setColumnMappingDialog({
          open: true,
          source: "reimport",
          file: needs.file,
          pendingFiles: files,
          headers: needs.headers,
          sampleRow: needs.sampleRow,
          initialMapping: { ...initial, ...(needs.manualMapping ?? {}) },
          overrides,
          sig: needs.sig,
          compatibleFileNames,
        });
        setReimporting(false);
        return;
      }

      // Parsing + upload em paralelo (com limite de concorrência) para não
      // gastar minutos serializando dezenas de planilhas — era isso que dava
      // a percepção de "nada aconteceu" no reimport de lotes grandes.
      const sanitizeStorageName = (name: string) =>
        name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      const CONCURRENCY = 5;
      setImportProgress({ stage: "parse", current: 0, total: inspections.length });
      let doneParse = 0;
      const parseAndUpload = async (insp: typeof inspections[number]) => {
        const { file, tpl, manualMapping } = insp;
        try {
          const bucket = await parsePaymentFile(file, companies, payment.payment_kind, {
            manualMapping,
            paymentTypeMeta: paymentTypeMeta ? {
              code: paymentTypeMeta.code,
              label: paymentTypeMeta.label,
              tuss_default: paymentTypeMeta.tuss_default,
              requires_tuss_in_sheet: paymentTypeMeta.requires_tuss_in_sheet,
              default_function: paymentTypeMeta.default_function,
              tuss_codes_extra: consultaTussExtras,
              dynamic_fallback_item_type_id: dynamicFallbackItemTypeId,
            } : null,
          });
          if (bucket.rows.length > 0) {
            const path = `${user.id}/${Date.now()}-${sanitizeStorageName(file.name)}`;
            // upload em background — falha aqui não deve bloquear a reimportação
            void supabase.storage.from("payment-files").upload(path, file).then(({ error }) => {
              if (error) console.warn("[reimport] upload falhou", file.name, error.message);
            });
            if (tpl) {
              void supabase
                .from("sheet_column_templates" as never)
                .update({ last_used_at: new Date().toISOString() } as never)
                .eq("id", tpl.id);
            }
            return { file, rows: bucket.rows, ok: true as const };
          }
          return { file, rows: [] as any[], ok: true as const };
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          return { file, rows: [] as any[], ok: false as const, msg };
        } finally {
          doneParse += 1;
          setImportProgress({ stage: "parse", current: doneParse, total: inspections.length });
        }
      };
      const results: Array<Awaited<ReturnType<typeof parseAndUpload>>> = [];
      for (let i = 0; i < inspections.length; i += CONCURRENCY) {
        const batch = inspections.slice(i, i + CONCURRENCY);
        const r = await Promise.all(batch.map(parseAndUpload));
        results.push(...r);
      }
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast({
          title: `Falha ao ler ${failed.length} arquivo(s)`,
          description: `${failed.map((f) => `"${f.file.name}": ${(f as any).msg}`).join(" • ")}. Ajuste o mapeamento das colunas ou verifique os arquivos.`,
          variant: "destructive",
        });
        return;
      }
      // Memória arquivo→PJ do import anterior: se um arquivo foi previamente
      // vinculado dominantemente a uma empresa, reaplicamos automaticamente
      // — evita o usuário ter que re-vincular empresa por empresa quando a
      // reimportação é só para corrigir mapeamento de colunas.
      const fileCompanyMemory = new Map<string, { company_id: string; company_name: string }>();
      try {
        // Só nos interessa a memória dos arquivos que estão sendo reimportados agora.
        // Sem esse filtro, um lote grande varre milhares de linhas e estoura o
        // statement_timeout do Postgres (erro "canceling statement due to
        // statement timeout"). Escopar pelo nome dos arquivos reduz drasticamente.
        const targetFileNames = Array.from(new Set(results.map((r) => r.file.name)));
        if (targetFileNames.length > 0) {
          const prevItems = await fetchAllPaginated<any>((from, to) =>
            supabase
              .from("payment_items")
              .select("source_file_name,company_id,company_name")
              .eq("payment_id", id)
              .in("source_file_name", targetFileNames)
              .not("company_id", "is", null)
              .range(from, to),
          );
          const byFile = new Map<string, Map<string, { count: number; name: string }>>();
          for (const it of prevItems) {
            const fn = it.source_file_name as string | null;
            const cid = it.company_id as string | null;
            if (!fn || !cid) continue;
            if (!byFile.has(fn)) byFile.set(fn, new Map());
            const m = byFile.get(fn)!;
            const cur = m.get(cid) ?? { count: 0, name: (it.company_name as string) ?? "" };
            cur.count += 1;
            m.set(cid, cur);
          }
          for (const [fn, m] of byFile.entries()) {
            const entries = [...m.entries()].sort((a, b) => b[1].count - a[1].count);
            const total = entries.reduce((s, [, v]) => s + v.count, 0);
            const [topId, top] = entries[0];
            if (total > 0 && top.count / total >= 0.9) {
              fileCompanyMemory.set(fn, { company_id: topId, company_name: top.name });
            }
          }
        }
      } catch (memErr) {
        console.warn("[reimport] memória arquivo→PJ indisponível:", memErr);
      }


      let memoryApplied = 0;
      for (const r of results) {
        if (r.rows.length > 0) {
          const mem = fileCompanyMemory.get(r.file.name);
          for (const row of r.rows) {
            (row as any).source_file_name = r.file.name;
            if (mem && !row.company_id) {
              row.company_id = mem.company_id;
              if (mem.company_name) row.company_name = mem.company_name;
              memoryApplied += 1;
            }
          }
          allRows = [...allRows, ...r.rows];
          fileNames.push(r.file.name);
        }
      }
      if (memoryApplied > 0) {
        toast({
          title: "Vínculos preservados",
          description: `${memoryApplied} linha(s) tiveram a PJ recuperada da importação anterior — sem re-vinculação manual.`,
        });
      }

      if (allRows.length === 0) {
        toast({ title: "Arquivos vazios", description: "Nenhuma linha válida encontrada nos arquivos selecionados.", variant: "destructive" });
        return;
      }

      // === Preview de diff antes do commit ===
      // Só faz sentido quando o lote já tem itens (reimportação de fato); na
      // criação inicial (importingInitialPaymentBase) pula direto para o commit.
      if (!importingInitialPaymentBase) {
        try {
          // 1) SHA-256 dos arquivos atuais x hashes já registrados
          const currentHashes = await Promise.all(files.map((f) => sha256Hex(f)));
          const { data: knownFiles } = await supabase
            .from("payment_source_files")
            .select("sha256")
            .eq("payment_id", id);
          const knownHashSet = new Set((knownFiles ?? []).map((r: any) => (r.sha256 ?? "").toLowerCase()).filter(Boolean));
          const sha256Matched = currentHashes.length > 0 && currentHashes.every((h) => knownHashSet.has(h.toLowerCase()));

          // 2) Snapshot dos payment_items atuais (paginado)
          const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
          const existingItems = await fetchAllPaginated<ExistingItemRow>((from, to) =>
            supabase
              .from("payment_items")
              .select("attendance_number,procedure_code,doctor_name,source_file_name,gross_amount")
              .eq("payment_id", id)
              .range(from, to),
          );

          // 3) Diff
          const parsedForDiff = allRows.map((r: any) => ({
            attendance_number: r.attendance_number ?? null,
            procedure_code: r.procedure_code ?? null,
            doctor_name: r.doctor_name ?? null,
            source_file_name: r.source_file_name ?? null,
            gross_amount: r.gross_amount ?? null,
          }));
          const diff = computeReimportDiff(existingItems, parsedForDiff);

          // 4) Abre o modal e aguarda a decisão do analista
          const decision = await new Promise<"confirm" | "cancel" | "skip">((resolve) => {
            reimportDiffResolverRef.current = resolve;
            setReimportDiffState({ diff, sha256Matched });
          });
          setReimportDiffState(null);
          reimportDiffResolverRef.current = null;

          if (decision === "cancel") {
            toast({ title: "Reimportação cancelada" });
            return;
          }
          if (decision === "skip") {
            toast({ title: "Arquivo pulado", description: "SHA-256 idêntico ao já processado — nada foi alterado." });
            return;
          }
          // decision === "confirm" → segue para o commit abaixo
        } catch (diffErr) {
          // Falha no preview NÃO bloqueia a reimportação — apenas avisa e segue.
          console.warn("[reimport] falha ao montar preview do diff:", diffErr);
        }
      }



      // GUARD: grupos que já saíram de `revisao_analista`/`devolvido_analista`
      // (i.e., já foram encaminhados para validação, validados ou concluídos)
      // são congelados. Não apagamos seus itens nem sobrescrevemos suas
      // intervenções manuais (economia/perda/absorção/exceção). Também não
      // inserimos linhas novas para essas empresas — o resultado final já foi
      // aprovado no fluxo anterior.
      const nrm = (s: string) => (s ?? "").trim().toLowerCase();
      const { data: allExistingGroups } = await supabase
        .from("payment_company_groups")
        .select("id,company_name,status")
        .eq("payment_id", id);
      const PRESERVE_STATUSES = new Set(["aguardando_validacao", "validado", "concluido", "concluida_analista", "aprovado"]);
      const preservedCompanyKeys = new Set(
        (allExistingGroups ?? [])
          .filter((g) => PRESERVE_STATUSES.has((g.status ?? "") as string))
          .map((g) => nrm(g.company_name)),
      );
      const preservedCount = preservedCompanyKeys.size;
      if (preservedCount > 0) {
        toast({
          title: `${preservedCount} PJ(s) preservada(s)`,
          description: "Grupos já encaminhados para validação/concluídos não foram tocados na reimportação.",
        });
      }

      // Limpa itens dos grupos NÃO preservados. Grupos avançados mantêm
      // itens e todas as intervenções manuais (economia/perda/absorção).
      // Paginamos para evitar statement_timeout via cascades de triggers.
      const DEL_CHUNK = 100;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: idsBatch, error: idsErr } = await supabase
          .from("payment_items")
          .select("id,company_name")
          .eq("payment_id", id)
          .limit(DEL_CHUNK * 4);
        if (idsErr) { toast({ title: "Falha ao listar itens p/ limpar", description: idsErr.message, variant: "destructive" }); return; }
        if (!idsBatch || idsBatch.length === 0) break;
        const deletable = idsBatch.filter((r) => !preservedCompanyKeys.has(nrm((r as any).company_name ?? "")));
        if (deletable.length === 0) break;
        const slice = deletable.slice(0, DEL_CHUNK);
        const { error: delItemsErr } = await supabase
          .from("payment_items")
          .delete()
          .in("id", slice.map((r) => r.id));
        if (delItemsErr) { toast({ title: "Falha ao limpar itens", description: delItemsErr.message, variant: "destructive" }); return; }
        if (idsBatch.length < DEL_CHUNK * 4 && deletable.length <= DEL_CHUNK) break;
      }

      // Descarta linhas novas que pertenceriam a grupos preservados.
      const beforeFilter = allRows.length;
      allRows = allRows.filter((r) => !preservedCompanyKeys.has(nrm((r.company_name ?? "Sem empresa"))));
      if (beforeFilter !== allRows.length) {
        console.log(`[reimport] ${beforeFilter - allRows.length} linha(s) descartada(s) por pertencerem a grupos preservados.`);
      }

      // Sincronização eager de grupos: agrega por empresa a partir das linhas
      // recém-importadas e faz upsert/insert; remove grupos cuja empresa não
      // existe mais no novo arquivo. Status fica "revisao_analista" como skeleton
      // até o motor reescrever com os valores definitivos.
      const norm = (s: string) => (s ?? "").trim().toLowerCase();
      const newGroupsMap = new Map<string, { company_name: string; company_id: string | null; items_count: number; total_amount: number }>();
      for (const r of allRows) {
        const name = (r.company_name ?? "Sem empresa").trim() || "Sem empresa";
        const key = norm(name);
        const cur = newGroupsMap.get(key);
        if (cur) {
          cur.items_count += 1;
          cur.total_amount += Number(r.gross_amount) || 0;
          if (!cur.company_id && r.company_id) cur.company_id = r.company_id;
        } else {
          newGroupsMap.set(key, { company_name: name, company_id: r.company_id ?? null, items_count: 1, total_amount: Number(r.gross_amount) || 0 });
        }
      }
      // Só sincroniza grupos NÃO preservados.
      const existingGroups = (allExistingGroups ?? []).filter((g) => !preservedCompanyKeys.has(nrm(g.company_name)));
      const newKeys = new Set(newGroupsMap.keys());
      const toRemove = existingGroups.filter((g) => !newKeys.has(norm(g.company_name))).map((g) => g.id);
      if (toRemove.length > 0) {
        await supabase.from("payment_company_groups").delete().in("id", toRemove);
      }
      for (const [key, g] of newGroupsMap.entries()) {
        const existing = existingGroups.find((eg) => norm(eg.company_name) === key);
        if (existing) {
          await supabase
            .from("payment_company_groups")
            .update({
              company_name: g.company_name,
              company_id: g.company_id,
              items_count: g.items_count,
              total_amount: g.total_amount,
              status: "revisao_analista",
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("payment_company_groups").insert({
            hospital_id: (payment as any).hospital_id,
            payment_id: id,
            company_name: g.company_name,
            company_id: g.company_id,
            items_count: g.items_count,
            total_amount: g.total_amount,
            status: "revisao_analista",
          });
        }
      }


      const itemsToInsert = allRows.map((r) => ({
        hospital_id: (payment as any).hospital_id,
        payment_id: id,
        doctor_name: r.doctor_name,
        doctor_document: r.doctor_document,
        doctor_email: r.doctor_email,
        description: r.description,
        gross_amount: r.gross_amount,
        company_name: r.company_name,
        company_id: r.company_id,
        attendance_number: r.attendance_number,
        procedure_code: r.procedure_code,
        procedure_name: r.procedure_name,
        access_route: r.access_route,
        doctor_role: r.doctor_role,
        agreement_text: r.agreement_text,
        specialty: r.specialty,
        procedure_amount: r.procedure_amount,
        quantity: r.quantity,
        procedure_date: r.procedure_date,
        patient_name: r.patient_name,
        sector: r.sector,
        attendance_character: r.attendance_character,
        raw_data: r.raw_data as never,
        source_file_name: (r as any).source_file_name ?? null,
        tipo_linha: r.tipo_linha,
        // Override do parser: lote Consulta com TUSS fora dos códigos da Consulta
        // → reclassifica para "Procedimento" já na importação. Sem override,
        // mantém o tipo padrão do lote (resolvido pelo motor).
        ...(r.payment_type_id_override
          ? { item_type_id: r.payment_type_id_override, item_type_source: "auto_heuristic" as const }
          : {}),
      }));


      // Inserção em chunks menores: cada INSERT dispara triggers FOR EACH ROW
      // (hash, competência, financials) e FOR EACH STATEMENT (sync_company_groups
      // que chama sync_payment_company_group por (payment_id, company_id) distinto).
      // 200 é um meio-termo que evita statement_timeout em lotes médios/grandes.
      const chunkSize = 200;
      for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
        const chunk = itemsToInsert.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from("payment_items").insert(chunk);
        if (insErr) { toast({ title: "Falha ao inserir itens", description: insErr.message, variant: "destructive" }); return; }
      }

      const total = allRows.reduce((s, r) => s + r.gross_amount, 0);
      const previousStatus = payment.status;
      await supabase.from("payments").update({
        total_amount: total,
        items_count: allRows.length,
        status: "em_analise_ia",
      }).eq("id", id);

      const uploadAuthorType: "analista" | "validador" | "diretor" = hasRole("diretor")
        ? "diretor"
        : hasRole("validador")
          ? "validador"
          : "analista";

      await recordObservation({
        payment_id: id, author_type: uploadAuthorType, author_id: user.id,
        message: `Base de pagamento importada (${allRows.length} itens, total ${total.toFixed(2)}). Arquivos: ${fileNames.join(", ")}.`,
        status_from: previousStatus, status_to: "em_analise_ia",
      });

      // Aguarda confirmação do dispatcher; se falhar, reverte o status para
      // não deixar o lote travado em 'em_analise_ia'.
      try {
        const dispRes = await invokeDispatchAnalysis({ payment_id: id });
        if (!dispRes.ok) {
          if (dispRes.blocked) {
            await supabase.from("payments").update({ status: previousStatus as any }).eq("id", id);
          } else {
            throw dispRes.error;
          }
        } else {
          toast({ title: importingInitialPaymentBase ? "Base importada" : "Base reimportada", description: "Análise iniciada por empresa em background." });
        }
      } catch (dispatchErr) {
        const msg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
        console.error("[dispatch-payment-analysis] falhou no reimport", dispatchErr);
        await supabase.from("payments").update({ status: previousStatus as any }).eq("id", id);
        toast({
          title: "Base importada, mas análise não iniciou",
          description: `${msg}. Use "Reanalisar lote" para tentar novamente.`,
          variant: "destructive",
        });
      }
      load();
    } catch (e) {
      toast({ title: "Erro ao reimportar", description: String(e), variant: "destructive" });
    } finally {
      setReimporting(false);
      setReimportConfirm(null);
      setImportProgress(null);
      if (reimportInputRef.current) reimportInputRef.current.value = "";
    }
  };

  // ===== Adicionar empresa ao lote =====
  // Upload de planilha com itens APENAS de uma (ou mais) empresa(s) nova(s)
  // no lote em tratativa. NÃO toca em itens/grupos já existentes. Empresas
  // que já têm grupo no lote são puladas (analista deve usar "Reimportar
  // base" para refazer essas). Mesmas regras de gating do Reimportar.
  const doAddCompany = async (files: File[], overrides: Record<string, Record<string, string>> = {}) => {
    if (!id || !payment || !user) return;
    setAddingCompany(true);
    try {
      const { parsePaymentFile, inspectFileHeaders } = await import("@/lib/parsePaymentFile");
      const { computeHeaderSignature, summarizeMissing, inspectColumnMapping } = await import("@/lib/columnMapping");
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const companiesData = await fetchAllPaginated<any>((from, to) =>
        supabase.from("companies").select("id,name,aliases").range(from, to),
      );
      const companies = companiesData.map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));

      // Catálogo para reclassificação automática (lote Consulta + TUSS fora da consulta → Procedimento).
      let dynamicFallbackItemTypeId: string | null = null;
      let consultaTussExtras: string[] = [];
      try {
        const { data: itemTypes } = await supabase
          .from("item_types" as any)
          .select("id,code,tuss_codes_extra");
        const it = (itemTypes ?? []) as any[];
        dynamicFallbackItemTypeId = it.find((t) => t.code === "procedimento")?.id ?? null;
        const consulta = it.find((t) => t.code === "consulta");
        consultaTussExtras = Array.isArray(consulta?.tuss_codes_extra) ? consulta.tuss_codes_extra : [];
      } catch { /* noop */ }

      const norm = (s: string) => (s ?? "").trim().toLowerCase();
      const { data: existingGroups } = await supabase
        .from("payment_company_groups")
        .select("id,company_name")
        .eq("payment_id", id);
      const existingKeys = new Set((existingGroups ?? []).map((g: any) => norm(g.company_name)));

      let allRows: any[] = [];
      const fileNames: string[] = [];

      // Pré-inspeção paralela — ver comentário equivalente em doReimport.
      const hospitalId = (payment as any).hospital_id ?? null;
      const inspections = await Promise.all(files.map(async (file) => {
        const { headers, sampleRow } = await inspectFileHeaders(file);
        const sig = await computeHeaderSignature(headers);
        const tplQuery = supabase
          .from("sheet_column_templates" as never)
          .select("id,mapping,name")
          .eq("header_signature", sig)
          .limit(1);
        const { data: tplRows } = hospitalId
          ? await tplQuery.or(`hospital_id.eq.${hospitalId},hospital_id.is.null`)
          : await tplQuery.is("hospital_id", null);
        const tpl = (tplRows ?? [])[0] as { id: string; mapping: any; name: string } | undefined;
        const overrideForFile = overrides[file.name];
        const manualMapping = overrideForFile ?? tpl?.mapping;
        const hits = inspectColumnMapping(headers).map((h) => {
          const override = manualMapping?.[h.field];
          if (override && headers.includes(override)) return { ...h, header: override, score: 100, confidence: "high" as const };
          return h;
        });
        const { missingRequired } = summarizeMissing(hits, paymentTypeMeta);
        return { file, headers, sampleRow, sig, tpl, manualMapping, hits, missingRequired };
      }));

      const needs = inspections.find((i) => i.missingRequired.length > 0);
      if (needs) {
        const compatibleFileNames = inspections
          .filter((i) => i !== needs && i.sig === needs.sig && i.missingRequired.length > 0)
          .map((i) => i.file.name);
        const initial: Record<string, string> = {};
        needs.hits.forEach((h) => { if (h.header) initial[h.field] = h.header; });
        setColumnMappingDialog({
          open: true,
          source: "addCompany",
          file: needs.file,
          pendingFiles: files,
          headers: needs.headers,
          sampleRow: needs.sampleRow,
          initialMapping: { ...initial, ...(needs.manualMapping ?? {}) },
          overrides,
          sig: needs.sig,
          compatibleFileNames,
        });
        setAddingCompany(false);
        return;
      }

      // Parsing + upload paralelos com progresso (mesma motivação do doReimport).
      const sanitizeStorageName = (name: string) =>
        name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      const CONCURRENCY = 5;
      setImportProgress({ stage: "parse", current: 0, total: inspections.length });
      let doneParse = 0;
      const parseAndUpload = async (insp: typeof inspections[number]) => {
        const { file, tpl, manualMapping } = insp;
        try {
          const bucket = await parsePaymentFile(file, companies, payment.payment_kind, {
            manualMapping,
            paymentTypeMeta: paymentTypeMeta ? {
              label: paymentTypeMeta.label,
              tuss_default: paymentTypeMeta.tuss_default,
              requires_tuss_in_sheet: paymentTypeMeta.requires_tuss_in_sheet,
              default_function: paymentTypeMeta.default_function,
              tuss_codes_extra: consultaTussExtras,
              dynamic_fallback_item_type_id: dynamicFallbackItemTypeId,
            } : null,
          });
          if (bucket.rows.length > 0) {
            const path = `${user.id}/${Date.now()}-${sanitizeStorageName(file.name)}`;
            void supabase.storage.from("payment-files").upload(path, file).then(({ error }) => {
              if (error) console.warn("[addCompany] upload falhou", file.name, error.message);
            });
            if (tpl) {
              void supabase.from("sheet_column_templates" as never).update({ last_used_at: new Date().toISOString() } as never).eq("id", tpl.id);
            }
            return { file, rows: bucket.rows, ok: true as const };
          }
          return { file, rows: [] as any[], ok: true as const };
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          return { file, rows: [] as any[], ok: false as const, msg };
        } finally {
          doneParse += 1;
          setImportProgress({ stage: "parse", current: doneParse, total: inspections.length });
        }
      };
      const results: Array<Awaited<ReturnType<typeof parseAndUpload>>> = [];
      for (let i = 0; i < inspections.length; i += CONCURRENCY) {
        const batch = inspections.slice(i, i + CONCURRENCY);
        const r = await Promise.all(batch.map(parseAndUpload));
        results.push(...r);
      }
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast({
          title: `Falha ao ler ${failed.length} arquivo(s)`,
          description: `${failed.map((f) => `"${f.file.name}": ${(f as any).msg}`).join(" • ")}. Ajuste o mapeamento das colunas ou verifique os arquivos.`,
          variant: "destructive",
        });
        return;
      }
      for (const r of results) {
        if (r.rows.length > 0) {
          for (const row of r.rows) (row as any).source_file_name = r.file.name;
          allRows = [...allRows, ...r.rows];
          fileNames.push(r.file.name);
        }
      }

      if (allRows.length === 0) {
        toast({ title: "Arquivos vazios", description: "Nenhuma linha válida encontrada.", variant: "destructive" });
        return;
      }

      // Filtra linhas: só empresas que NÃO estão no lote ainda.
      const newRows: any[] = [];
      const skipped = new Set<string>();
      for (const r of allRows) {
        const name = (r.company_name ?? "Sem empresa").trim() || "Sem empresa";
        if (existingKeys.has(norm(name))) {
          skipped.add(name);
        } else {
          newRows.push({ ...r, company_name: name });
        }
      }

      if (newRows.length === 0) {
        toast({
          title: "Nada a adicionar",
          description: `Todas as empresas dos arquivos já existem no lote: ${[...skipped].join(", ")}. Use "Reimportar base" para refazer.`,
          variant: "destructive",
        });
        return;
      }

      // Agrega por empresa para criar grupos skeleton (revisao_analista).
      const newGroupsMap = new Map<string, { company_name: string; company_id: string | null; items_count: number; total_amount: number }>();
      for (const r of newRows) {
        const key = norm(r.company_name);
        const cur = newGroupsMap.get(key);
        if (cur) {
          cur.items_count += 1;
          cur.total_amount += Number(r.gross_amount) || 0;
          if (!cur.company_id && r.company_id) cur.company_id = r.company_id;
        } else {
          newGroupsMap.set(key, {
            company_name: r.company_name,
            company_id: r.company_id ?? null,
            items_count: 1,
            total_amount: Number(r.gross_amount) || 0,
          });
        }
      }
      for (const [, g] of newGroupsMap.entries()) {
        await supabase.from("payment_company_groups").insert({
          hospital_id: (payment as any).hospital_id,
          payment_id: id,
          company_name: g.company_name,
          company_id: g.company_id,
          items_count: g.items_count,
          total_amount: g.total_amount,
          status: "revisao_analista",
        });
      }

      const itemsToInsert = newRows.map((r) => ({
        hospital_id: (payment as any).hospital_id,
        payment_id: id,
        doctor_name: r.doctor_name,
        doctor_document: r.doctor_document,
        doctor_email: r.doctor_email,
        description: r.description,
        gross_amount: r.gross_amount,
        company_name: r.company_name,
        company_id: r.company_id,
        attendance_number: r.attendance_number,
        procedure_code: r.procedure_code,
        procedure_name: r.procedure_name,
        access_route: r.access_route,
        doctor_role: r.doctor_role,
        agreement_text: r.agreement_text,
        specialty: r.specialty,
        procedure_amount: r.procedure_amount,
        quantity: r.quantity,
        procedure_date: r.procedure_date,
        patient_name: r.patient_name,
        sector: r.sector,
        attendance_character: r.attendance_character,
        raw_data: r.raw_data as never,
        source_file_name: (r as any).source_file_name ?? null,
        tipo_linha: r.tipo_linha,
        ...(r.payment_type_id_override
          ? { item_type_id: r.payment_type_id_override, item_type_source: "auto_heuristic" as const }
          : {}),
      }));

      const chunkSize = 1000;
      for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
        const chunk = itemsToInsert.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from("payment_items").insert(chunk);
        if (insErr) { toast({ title: "Falha ao inserir itens", description: insErr.message, variant: "destructive" }); return; }
      }

      // Recalcula totais do lote a partir de TODOS os itens (não troca status).
      const { data: remaining } = await supabase
        .from("payment_items").select("gross_amount").eq("payment_id", id);
      const total = (remaining ?? []).reduce((s: number, r: any) => s + Number(r.gross_amount ?? 0), 0);
      const itemsCount = (remaining ?? []).length;
      await supabase.from("payments").update({ total_amount: total, items_count: itemsCount }).eq("id", id);

      const addedCompanies = [...newGroupsMap.values()].map((g) => g.company_name);
      const addedTotal = newRows.reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
      const skippedSuffix = skipped.size > 0 ? ` Puladas (já existiam): ${[...skipped].join(", ")}.` : "";
      await recordObservation({
        payment_id: id, author_type: "analista", author_id: user.id,
        message: `Empresa(s) adicionada(s) ao lote: ${addedCompanies.join(", ")} — ${newRows.length} itens, total ${addedTotal.toFixed(2)}. Arquivos: ${fileNames.join(", ")}.${skippedSuffix}`,
        status_from: payment.status, status_to: payment.status,
      });

      // Dispara análise apenas para as empresas adicionadas.
      const dispRes = await invokeDispatchAnalysis({ payment_id: id, only_companies: addedCompanies });
      if (dispRes.ok) {
        toast({
          title: "Empresa(s) adicionada(s)",
          description: `${addedCompanies.length} empresa(s), ${newRows.length} itens. Análise iniciada.${skippedSuffix}`,
        });
      } else if (!dispRes.blocked) {
        const msg = dispRes.error instanceof Error ? dispRes.error.message : String(dispRes.error);
        toast({
          title: "Itens inseridos, mas análise não iniciou",
          description: `${msg}. Use "Reanalisar lote" para tentar novamente.`,
          variant: "destructive",
        });
      }
      // se blocked (ex.: missing_parecer_report), o wrapper já mostrou o toast amigável
      load();
    } catch (e) {
      const msg = (e as any)?.message || (e as any)?.error?.message || (e as any)?.details || (typeof e === "string" ? e : JSON.stringify(e));
      toast({ title: "Erro ao adicionar empresa", description: msg, variant: "destructive" });
      console.error("[add-company]", e);
    } finally {
      setAddingCompany(false);
      setAddCompanyConfirm(null);
      setImportProgress(null);
      if (addCompanyInputRef.current) addCompanyInputRef.current.value = "";
    }
  };


  const reprocessAi = async (statuses?: string[], opts?: { runAi?: boolean }) => {
    if (!id || !user) return;
    setReprocessingAi(true);
    try {
      const isConfeccaoMode = payment?.analysis_mode === "confeccao";
      const isBatch = !statuses || statuses.length === 0;
      const runAi = !!opts?.runAi;

      const result = await invokeDispatchAnalysis({
        payment_id: id,
        ai_statuses: statuses && statuses.length > 0 ? statuses : undefined,
        tolerance_pct: toleranceValue,
        _job_id: null,
        _company_label: !isBatch ? "Processamento por filtro" : undefined,
        ...(runAi ? { run_ai: true } : {}),
      });
      if (!result.ok) {
        if (result.blocked) return; // toast já exibido pelo wrapper (ex.: missing_parecer_report)
        throw result.error;
      }
      const data = result.data;
      const skipped = isConfeccaoMode ? [] : ((data as any)?.skipped_companies ?? []);
      setSkippedCompanies(Array.isArray(skipped) ? skipped : []);

      const dispatched = (data as any)?.total_companies ?? 0;
      const alreadyRunning = (data as any)?.already_running === true;
      const deferredTo = (data as any)?.deferred_to as string | undefined;

      // Lote de parecer: dispatch foi deferido para cross-reference-parecer,
      // que vai reclassificar Parecer/Visita e re-chamar dispatch com
      // skip_parecer_cross_ref=true. Não é erro — é o caminho esperado.
      if (deferredTo === "cross-reference-parecer") {
        toast({
          title: "Reanálise enfileirada",
          description:
            (data as any)?.message ||
            "Reclassificando Parecer/Visita antes de aplicar as regras. Acompanhe pelo status do lote.",
        });
        await load();
        return;
      }

      // Nada foi disparado: todas as empresas foram bloqueadas pelo gate de governança
      // (status fora de revisao_analista/devolvido_analista — tipicamente já pago/validado).
      if (!alreadyRunning && dispatched === 0) {
        const sample = Array.isArray(skipped) && skipped.length > 0
          ? ` Status encontrados: ${Array.from(new Set(skipped.map((s: any) => s.status))).slice(0, 4).join(", ")}.`
          : "";
        toast({
          title: "Nenhuma empresa reanalisada",
          description:
            (data as any)?.message ||
            `As ${skipped.length || "demais"} empresa(s) estão fora do estado editável (ex.: pago, em validação, aprovado).${sample} Reabra a empresa para reanalisar.`,
          variant: "destructive",
        });
        return;
      }


      if (alreadyRunning) {
        toast({
          title: "Já existe uma análise em andamento",
          description: (data as any)?.message ?? "Aguarde a análise atual concluir.",
        });
        return;
      }

      const filterDesc = statuses && statuses.length > 0
        ? ` (filtrado por: ${statuses.join(", ")}; tolerância: ${toleranceValue * 100}%)`
        : ` em todo o lote (tolerância: ${toleranceValue * 100}%)`;

      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user.id,
        message: isConfeccaoMode
          ? `Repasse recalculado em todo o lote (modo confecção) manualmente pelo analista.`
          : `Regras de repasse reaplicadas${filterDesc} manualmente pelo analista.`,
        status_from: payment?.status ?? null,
        status_to: payment?.status ?? null,
      });
      toast({
        title: isConfeccaoMode ? "Repasse recalculado" : "Análise reprocessada",
        description: isConfeccaoMode
          ? `O motor recalculou o repasse de ${dispatched} empresa(s).`
          : `A IA está reprocessando ${dispatched} empresa(s) deste lote.`,
      });

      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao reprocessar", description: msg, variant: "destructive" });
    } finally {
      setReprocessingAi(false);
    }
  };

  // Converte um lote criado em modo padrão para confecção e dispara reanálise.
  // Útil quando o analista quis confecção mas subiu pela porta normal.
  const [convertingMode, setConvertingMode] = useState(false);
  const convertToConfeccao = async () => {
    if (!id || !user) return;
    const ok = await confirmDialog({
      title: "Converter para Modo Confecção?",
      description: "Os status de IA serão recalculados e o motor apenas calcula, sem justificativas.",
      details:
        "• Todos os status de IA serão recalculados (itens passam para 'aprovado' conforme regras do sistema).\n" +
        "• A IA não acionará justificativas — o motor apenas calcula.\n" +
        "• Você poderá revisar e enviar para validação manualmente.",
      confirmText: "Converter",
      cancelText: "Cancelar",
      tone: "warning",
    });
    if (!ok) return;
    setConvertingMode(true);
    try {
      const { error: upErr } = await supabase
        .from("payments")
        .update({ analysis_mode: "confeccao" })
        .eq("id", id);
      if (upErr) throw upErr;
      await recordObservation({
        payment_id: id, author_type: "analista", author_id: user.id,
        message: `Modo de análise alterado para CONFECÇÃO pelo analista. Reanálise iniciada.`,
        status_from: payment?.status ?? null, status_to: payment?.status ?? null,
      });
      const dispRes = await invokeDispatchAnalysis({ payment_id: id });
      if (!dispRes.ok) {
        if (dispRes.blocked) return; // wrapper já exibiu toast (ex.: missing_parecer_report)
        throw dispRes.error;
      }
      toast({ title: "Convertido para Confecção", description: "Reanálise em andamento. Acompanhe a barra de progresso." });
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao converter", description: msg, variant: "destructive" });
    } finally {
      setConvertingMode(false);
    }
  };

  // Recarrega dados quando um job de análise termina (reanálise por empresa ou lote inteiro)
  const prevJobStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!analysisJob) return;
    const prev = prevJobStatusRef.current;
    prevJobStatusRef.current = analysisJob.status;
    // Só recarrega quando TRANSICIONA de em_andamento para concluido/parcial
    if (prev === "em_andamento" && (analysisJob.status === "concluido" || analysisJob.status === "parcial")) {
      load();
    }
  }, [analysisJob]);

  if (!payment) {
    // Se o fetch terminou e não achou o pagamento no hospital ativo, mostra
    // uma tela clara em vez de "Carregando..." eterno. Cobre o caso comum
    // após refresh: usuário volta ao hospital principal e a rota /:id
    // aponta para um pagamento de outra unidade (bloqueado por RLS).
    if (paymentMissing) {
      return (
        <div className="flex items-center justify-center min-h-[60vh] p-6">
          <div className="max-w-lg w-full rounded-lg border bg-card p-6 shadow-card space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <span className="text-xs font-medium uppercase tracking-wide">
                Pagamento não disponível nesta unidade
              </span>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Não encontramos este pagamento</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Ele pode pertencer a outro hospital ou ter sido removido. Troque
                a unidade no seletor do topo se souber onde ele está, ou volte
                para a lista de pagamentos.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigate("/pagamentos")}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Voltar para pagamentos
              </button>
            </div>
          </div>
        </div>
      );
    }
    return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;
  }

  const isValidador = hasRole("validador") || hasRole("admin");
  const isDiretor = hasRole("diretor") || hasRole("admin");
  const isAnalista = hasRole("analista") || hasRole("admin");
  // Analista também precisa poder disparar o pedido de NF assim que o
  // pagamento for aprovado (era restrito a diretor/admin antes).
  const canRequestNf =
    (isAnalista || isValidador || isDiretor) && payment.status === "aprovado";
  // Para o botão "Enviar lote para validação" do analista no header.
  // Prontas: empresas que o analista marcou como concluídas (ou foram devolvidas e estão prontas de novo).
  // Pendentes: empresas que o analista ainda não concluiu.
  const groupsReadyToSend = groups.filter((g) => g.status === "concluida_analista" || g.status === "devolvido_analista");
  const groupsPendingAnalyst = groups.filter((g) => g.status === "revisao_analista");
  // Visão limpa por papel: quando o usuário acumula validador/diretor (sem ser admin),
  // a tela não mostra ações que pertencem à rotina do analista.
  const isAdmin = hasRole("admin");
  const showAnalystActions =
    isAdmin || (hasRole("analista") && !hasRole("validador") && !hasRole("diretor"));
  const canSendForValidation = showAnalystActions && (groupsReadyToSend.length > 0 || groupsPendingAnalyst.length > 0);
  const isOwner = payment.created_by === user?.id;
  const editableStatuses: PaymentStatus[] = ["rascunho", "em_analise_ia", "revisao_analista", "aguardando_validacao", "devolvido_analista", "cancelado"];
  const canCancel = (isOwner || isDiretor || isAnalista || isValidador) && payment.status !== "cancelado" && editableStatuses.includes(payment.status as PaymentStatus);
  const canDelete = (isOwner || isDiretor || isAnalista) && editableStatuses.includes(payment.status as PaymentStatus);
  const canEditMeta = canEditBatch(payment.status as PaymentStatus, {
    isOwner,
    isAnalista,
    isAdminOrDiretor: hasRole("admin") || hasRole("diretor"),
    isValidador,
  });
  const isPoolWithoutPaymentBase = Boolean((payment as any)?.pool_id) && !itemsLoading && items.length === 0 && Number((payment as any)?.items_count ?? 0) === 0;
  const canReimport = canReimportBatch(payment.status as PaymentStatus, { isOwner, isAnalista });
  const canImportInitialPaymentBase = isPoolWithoutPaymentBase && EMPTY_POOL_INITIAL_IMPORT_STATUSES.has(payment.status as PaymentStatus) && (isAnalista || isValidador || isDiretor);
  const canManagePaymentBase = canReimport || canImportInitialPaymentBase;
  const canAssumeNow = canAssumeBatch(payment.status as PaymentStatus, {
    isAnalista, isValidador, isDiretor, isOwner,
  });
  const batchActionStatuses: PaymentStatus[] = [
    "aguardando_validacao",
    "aguardando_aprovacao",
    "em_questionamento",
    "aprovado_parcial",
    "devolvido_analista",
  ];
  const batchActionActorRole: "validador" | "diretor" =
    payment.status === "aguardando_aprovacao" || groups.some((g) => g.status === "aguardando_aprovacao")
      ? "diretor"
      : "validador";
  const canUseBatchActions =
    batchActionStatuses.includes(payment.status as PaymentStatus) &&
    (batchActionActorRole === "diretor" ? isDiretor : isValidador);
  // Quando o usuário corrente é validador ou diretor MAS criou o lote,
  // mostramos um aviso de segregação de funções no topo.
  const segregationBlocked = isOwner && (isValidador || isDiretor) && !isAnalista
    ? false // só validador/diretor sem ser analista — caso raro
    : isOwner && (isValidador || isDiretor);

  // Fase do lote: cada status pertence a uma etapa (análise, validação,
  // aprovação, pedido_nf, conciliação, pagamento). A tela esconde blocos
  // de análise quando o pagamento já passou para fases pós-aprovação que
  // não dependem mais de IA/anomalias para o trabalho do usuário.
  const phase = resolvePhase(payment.status as PaymentStatus);
  const hidesAnalysisBlocks = phase === "pedido_nf" || phase === "conciliacao" || phase === "pagamento";
  const isNfPhase = hidesAnalysisBlocks; // mantém compat com gates existentes

  // Importação histórica: lote sobe em modo seco (sem fluxo de validação/
  // aprovação/NF). Os grupos ficam em `revisao_analista` até o analista
  // revisar e clicar em "Concluir importação histórica" — só então viram
  // `pago` e o lote fecha. Permite ajustar antes do sistema gravar como pago.
  const isHistoricoImport = (payment as any)?.import_mode === "historico";
  const canConcludeHistorico =
    isHistoricoImport &&
    (isAnalista || isDiretor) &&
    payment.status !== "pago" &&
    payment.status !== "cancelado" &&
    payment.status !== "arquivado" &&
    groups.some((g) => g.status !== "pago" && g.status !== "cancelado" && g.status !== "arquivado");

  const concludeHistorico = async () => {
    if (!id) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("conclude_historico_payment" as any, { _payment_id: id });
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao concluir importação histórica", description: error.message, variant: "destructive" });
      return;
    }
    const updated = Array.isArray(data) && data[0]?.updated_count != null ? data[0].updated_count : 0;
    toast({ title: "Importação histórica concluída", description: `${updated} grupo(s) marcado(s) como pago.` });
    load();
  };


  const cancelPayment = async () => {
    if (!id) return;
    setBusy(true);
    const { error: upErr } = await supabase.from("payments")
      .update({ status: "cancelado" }).eq("id", id);
    if (upErr) {
      setBusy(false);
      toast({ title: "Falha ao cancelar", description: upErr.message, variant: "destructive" });
      return;
    }
    const obsRes = await recordObservation({
      payment_id: id, author_type: isOwner ? "analista" : "diretor", author_id: user!.id,
      message: "Lote cancelado pelo responsável.", status_from: payment.status, status_to: "cancelado",
    });
    if (!obsRes.ok) {
      toast({ title: "Histórico não registrado", description: obsRes.error, variant: "destructive" });
    }
    setBusy(false);
    toast({ title: "Lote cancelado" });
    load();
  };

  const deletePayment = async () => {
    if (!id) return;
    setBusy(true);
    try {
      // Lotes grandes (centenas de itens + cascades) estouram o statement_timeout
      // do PostgREST (~8s) quando deletados pelo client. A edge function roda
      // com service_role e timeout maior.
      const { data, error } = await supabase.functions.invoke("delete-payment", {
        body: { payment_id: id },
      });
      if (error) throw error;
      if (data && (data as any).error) {
        throw new Error((data as any).detail || (data as any).error);
      }

      setDeleteOpen(false);
      toast({ title: "Lote excluído" });
      navigate("/pagamentos", { replace: true });
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Resumo objetivo a partir dos itens
  // Mapa de status do grupo por empresa para mascarar alertas já tratados pelo analista
  const groupStatusByCompany: Record<string, PaymentStatus> = {};
  groups.forEach((g) => {
    groupStatusByCompany[g.company_name.toLowerCase()] = g.status as PaymentStatus;
  });
  const itemAnalystDone = (it: PaymentItemRowType) => {
    const gs = groupStatusByCompany[(it.company_name ?? "Sem empresa").trim().toLowerCase()];
    return gs ? ANALYST_DONE_STATUSES.has(gs) : false;
  };
  const counts = items.reduce(
    (acc, it) => {
      const raw = (it.ai_status as ItemAiStatus) ?? "pendente";
      const s: ItemAiStatus =
        itemAnalystDone(it) && (raw === "reprovado" || raw === "alerta") ? "aprovado" : raw;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    { pendente: 0, aprovado: 0, alerta: 0, reprovado: 0, erro_duplicidade_pagamento: 0, erro_duplicidade_calculo: 0, acatado: 0 } as Record<ItemAiStatus, number>,
  );
  const topAlerts: { item: PaymentItemRowType; alerts: string[] }[] = items
    .filter((it) => it.ai_findings?.alerts?.length && !itemAnalystDone(it))
    .map((it) => ({ item: it, alerts: (it.ai_findings?.alerts ?? []) as string[] }));

  // ===== Histórico (timeline + comparador de versões da IA) =====
  const itemLabel = (itemId: string | null | undefined) => {
    if (!itemId) return null;
    const it = items.find((x) => x.id === itemId);
    if (!it) return "item";
    return it.doctor_name + (it.attendance_number ? ` · atend. ${it.attendance_number}` : "");
  };
  const filteredObs = historyItemFilter === "all"
    ? obs
    : historyItemFilter === "payment"
      ? obs.filter((o) => !o.item_id)
      : obs.filter((o) => o.item_id === historyItemFilter);
  const filteredVersions = historyItemFilter === "all" || historyItemFilter === "payment"
    ? aiVersions
    : aiVersions.filter((v) => v.item_id === historyItemFilter);
  const versionsForCompare = compareItemId
    ? aiVersions.filter((v) => v.item_id === compareItemId).sort((a, b) => b.version - a.version)
    : [];
  const verA = versionsForCompare.find((v) => v.version === compareA) ?? null;
  const verB = versionsForCompare.find((v) => v.version === compareB) ?? null;

  const canComment = isAnalista || isValidador || isDiretor;
  const myAuthorType: "analista" | "validador" | "diretor" =
    isDiretor ? "diretor" : isValidador ? "validador" : "analista";


  const addItemComment = async (itemId: string) => {
    const text = (itemCommentDraft[itemId] ?? "").trim();
    if (!text) return;
    setBusy(true);
    if (myAuthorType === "analista") await autoClaim();
    const isQuestion = !!itemCommentIsQuestion[itemId];
    const obsRes = await recordObservation({
      payment_id: id!,
      item_id: itemId,
      author_type: myAuthorType,
      author_id: user!.id,
      message: text,
      is_question: isQuestion,
      observation_type: itemCommentType[itemId] ?? "informativo",
    });
    setBusy(false);
    if (!obsRes.ok) {
      toast({ title: "Erro ao salvar", description: obsRes.error, variant: "destructive" });
      return;
    }
    setItemCommentDraft((m) => ({ ...m, [itemId]: "" }));
    setItemCommentIsQuestion((m) => ({ ...m, [itemId]: false }));
    load();
  };

  const authorBadgeClass = (t: string) =>
    t === "ia" ? TONE_CLASSES.info
      : t === "validador" ? TONE_CLASSES.warning
      : t === "diretor" ? TONE_CLASSES.success
      : TONE_CLASSES.muted;

  const VersionCell = ({ v }: { v: AiVersionRow }) => (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono">v{v.version}</span>
        <span className="text-muted-foreground">{formatDate(v.created_at)}</span>
      </div>
      <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{v.ai_status}</span></div>
      <div><span className="text-muted-foreground">Esperado:</span> <span className="tabular-nums">{v.expected_amount != null ? formatCurrency(v.expected_amount) : "—"}</span></div>
      <div><span className="text-muted-foreground">Repasse:</span> <span className="tabular-nums">{v.gross_amount_at_time != null ? formatCurrency(v.gross_amount_at_time) : "—"}</span></div>
      {Array.isArray(v.matched_rules) && v.matched_rules.length > 0 && (
        <div><span className="text-muted-foreground">Regras:</span> {v.matched_rules.join(", ")}</div>
      )}
      {Array.isArray(v.alerts) && v.alerts.length > 0 && (
        <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
          {v.alerts.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      {v.calculation_explanation && <p className="italic text-muted-foreground">{v.calculation_explanation}</p>}
    </div>
  );

  const renderHistoryCard = () => (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls="history-card-content"
            className="flex items-center gap-2 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/60 transition-colors"
          >
            {historyOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Histórico</CardTitle>
            <span className="text-xs text-muted-foreground">{obs.length} obs · {aiVersions.length} análises automáticas</span>
          </button>
          {historyOpen && (
            <Select value={historyItemFilter} onValueChange={setHistoryItemFilter}>
              <SelectTrigger className="h-8 w-[280px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os registros</SelectItem>
                <SelectItem value="payment">Apenas o pagamento (sem item)</SelectItem>
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.doctor_name}{it.attendance_number ? ` · ${it.attendance_number}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      {historyOpen && (
      <CardContent id="history-card-content">
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="ai">Versões automáticas</TabsTrigger>
            {canComment && <TabsTrigger value="comment">Comentar item</TabsTrigger>}
          </TabsList>

          <TabsContent value="timeline" className="mt-3 space-y-3">
            {payment?.id && <PaymentSourceFilesList paymentId={payment.id} />}
            <PaymentTimeline
              observations={filteredObs}
              items={items}
              invoices={invoices}
              profiles={profiles}
              itemLabel={itemLabel}
              onOpenQuestionInvoice={setOpenQuestionInvoiceId}
              onChanged={load}
            />
          </TabsContent>

          <TabsContent value="ai" className="mt-3">
            {filteredVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma versão de análise da IA registrada{historyItemFilter !== "all" && historyItemFilter !== "payment" ? " para este item" : ""}.</p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredVersions.map((v) => (
                  <div key={v.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono rounded bg-muted px-1.5 py-0.5">v{v.version}</span>
                        <span className={`inline-flex rounded-md border px-2 py-0.5 ${TONE_CLASSES[itemToneMap[v.ai_status as ItemAiStatus]] ?? TONE_CLASSES.muted}`}>
                          {v.ai_status}
                        </span>
                        <span className="text-muted-foreground">{itemLabel(v.item_id)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{formatDate(v.created_at)}</span>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2"
                          onClick={() => {
                            setCompareItemId(v.item_id);
                            const sameItem = aiVersions.filter((x) => x.item_id === v.item_id).sort((a, b) => b.version - a.version);
                            setCompareA(sameItem[1]?.version ?? sameItem[0]?.version ?? null);
                            setCompareB(v.version);
                          }}
                        >
                          <GitCompare className="h-3.5 w-3.5 mr-1" /> Comparar
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div><span className="text-muted-foreground">Esperado:</span> <span className="tabular-nums">{v.expected_amount != null ? formatCurrency(v.expected_amount) : "—"}</span></div>
                      <div><span className="text-muted-foreground">Repasse na época:</span> <span className="tabular-nums">{v.gross_amount_at_time != null ? formatCurrency(v.gross_amount_at_time) : "—"}</span></div>
                    </div>
                    {Array.isArray(v.alerts) && v.alerts.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                        {(v.alerts as string[]).slice(0, 4).map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    )}
                    {v.calculation_explanation && <p className="mt-1 text-xs italic text-muted-foreground">{v.calculation_explanation}</p>}
                  </div>
                ))}
              </div>
            )}

            <Dialog open={!!compareItemId} onOpenChange={(o) => { if (!o) setCompareItemId(null); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Comparar versões — {itemLabel(compareItemId)}</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Versão A</label>
                    <Select value={compareA?.toString() ?? ""} onValueChange={(v) => setCompareA(Number(v))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {versionsForCompare.map((v) => <SelectItem key={v.id} value={v.version.toString()}>v{v.version} · {formatDate(v.created_at)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="mt-2 rounded-md border border-border p-3">
                      {verA ? <VersionCell v={verA} /> : <p className="text-xs text-muted-foreground">Selecione</p>}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Versão B</label>
                    <Select value={compareB?.toString() ?? ""} onValueChange={(v) => setCompareB(Number(v))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {versionsForCompare.map((v) => <SelectItem key={v.id} value={v.version.toString()}>v{v.version} · {formatDate(v.created_at)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="mt-2 rounded-md border border-primary/40 p-3 bg-primary/5">
                      {verB ? <VersionCell v={verB} /> : <p className="text-xs text-muted-foreground">Selecione</p>}
                    </div>
                  </div>
                </div>
                {verA && verB && (
                  <div className="rounded-md border border-border p-3 text-xs space-y-1">
                    <p className="font-semibold uppercase tracking-wide text-muted-foreground">Diferenças (A → B)</p>
                    {verA.ai_status !== verB.ai_status && <p>• Status: {verA.ai_status} → <span className="font-medium">{verB.ai_status}</span></p>}
                    {(verA.expected_amount ?? null) !== (verB.expected_amount ?? null) && (
                      <p>• Valor esperado: {verA.expected_amount != null ? formatCurrency(verA.expected_amount) : "—"} → <span className="font-medium tabular-nums">{verB.expected_amount != null ? formatCurrency(verB.expected_amount) : "—"}</span></p>
                    )}
                    {(() => {
                      const A = new Set<string>(verA.alerts ?? []); const B = new Set<string>(verB.alerts ?? []);
                      const added = [...B].filter((x) => !A.has(x));
                      const removed = [...A].filter((x) => !B.has(x));
                      return (
                        <>
                          {added.length > 0 && <p>• + alertas: {added.join("; ")}</p>}
                          {removed.length > 0 && <p>• − alertas resolvidos: {removed.join("; ")}</p>}
                        </>
                      );
                    })()}
                    {(() => {
                      const A = new Set<string>(verA.matched_rules ?? []); const B = new Set<string>(verB.matched_rules ?? []);
                      const added = [...B].filter((x) => !A.has(x));
                      const removed = [...A].filter((x) => !B.has(x));
                      return (
                        <>
                          {added.length > 0 && <p>• + regras: {added.join("; ")}</p>}
                          {removed.length > 0 && <p>• − regras: {removed.join("; ")}</p>}
                        </>
                      );
                    })()}
                    {verA.ai_status === verB.ai_status &&
                      (verA.expected_amount ?? null) === (verB.expected_amount ?? null) &&
                      JSON.stringify(verA.alerts ?? []) === JSON.stringify(verB.alerts ?? []) &&
                      JSON.stringify(verA.matched_rules ?? []) === JSON.stringify(verB.matched_rules ?? []) &&
                      <p className="text-muted-foreground">Sem diferenças relevantes.</p>}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {canComment && (
            <TabsContent value="comment" className="mt-3">
              <p className="text-xs text-muted-foreground mb-3">Adicione uma observação ligada a um item específico. Ela aparecerá na timeline com seu nome e função.</p>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {items.map((it) => (
                  <div key={it.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div>
                        <span className="font-medium">{it.doctor_name}</span>
                        <span className="text-muted-foreground"> · {it.attendance_number ?? "—"} · {it.procedure_code ?? ""}</span>
                      </div>
                      <span className={`inline-flex rounded-md border px-2 py-0.5 ${TONE_CLASSES[itemToneMap[it.ai_status as ItemAiStatus]]}`}>{it.ai_status}</span>
                    </div>
                    <Textarea
                      rows={2}
                      value={itemCommentDraft[it.id] ?? ""}
                      onChange={(e) => setItemCommentDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                      placeholder={suggestingFor === it.id ? "Gerando sugestão..." : "Sua observação sobre este item..."}
                    />
                    {(it.ai_status === "reprovado" || it.ai_status === "alerta") && (
                      <div className="mt-1.5 flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={suggestingFor === it.id}
                          onClick={async () => {
                            setSuggestingFor(it.id);
                            try {
                              const { data, error } = await supabase.functions.invoke("explain-alert", {
                                body: { item_id: it.id, payment_id: it.payment_id },
                              });
                              if (error) throw error;
                              const ai = (data as { ai?: { explanation?: string; what_to_check?: string } } | null)?.ai;
                              const text = [ai?.explanation, ai?.what_to_check].filter(Boolean).join("\n\n").trim();
                              if (!text) throw new Error("IA não retornou sugestão");
                              setItemCommentDraft((m) => ({ ...m, [it.id]: text }));
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : "Falha ao gerar sugestão";
                              toast({ title: "Sugestão IA", description: msg, variant: "destructive" });
                            } finally {
                              setSuggestingFor(null);
                            }
                          }}
                        >
                          {suggestingFor === it.id ? (
                            <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5 mr-1" />
                          )}
                          Sugerir
                        </Button>
                      </div>
                    )}
                    <div className="mt-2 space-y-2">
                      <ObservationTypeSelector
                        value={itemCommentType[it.id] ?? "informativo"}
                        onChange={(v) => setItemCommentType((m) => ({ ...m, [it.id]: v }))}
                        disabled={busy}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={!!itemCommentIsQuestion[it.id]}
                            onCheckedChange={(v) => setItemCommentIsQuestion((m) => ({ ...m, [it.id]: !!v }))}
                          />
                          Esta observação é uma pergunta
                        </label>
                        <Button size="sm" disabled={busy || !(itemCommentDraft[it.id] ?? "").trim()} onClick={() => addItemComment(it.id)}>
                          <MessageSquarePlus className="h-3.5 w-3.5 mr-1" /> {itemCommentIsQuestion[it.id] ? "Pergunta" : "Salvar"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
      )}
    </Card>
  );

  const isConfeccao = payment?.analysis_mode === "confeccao";

  return (
    <HospitalScopedGuard
      recordHospitalId={(payment as { hospital_id?: string | null } | null)?.hospital_id ?? null}
      entityLabel="pagamento"
      fallbackHub="/pagamentos"
    >
    <>

      {isConfeccao && (
        <div
          className="sticky top-0 z-40 -mx-4 md:-mx-6 mb-2 border-b-2 border-amber-500/70 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/15 backdrop-blur-sm"
          role="status"
          aria-label="Modo confecção ativo"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, hsl(38 92% 50% / 0.10) 0px, hsl(38 92% 50% / 0.10) 12px, transparent 12px, transparent 24px)",
          }}
        >
          <div className="px-4 md:px-6 py-2 flex items-center gap-3 text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2 rounded-md bg-amber-500/20 px-2.5 py-1 ring-1 ring-amber-500/40">
              <Calculator className="h-3.5 w-3.5" />
              <span className="text-[11px] font-bold tracking-[0.18em] uppercase">Modo confecção</span>
            </div>
            <p className="text-xs hidden sm:block">
              O sistema está calculando o repasse pelas regras cadastradas — ainda não há confronto com a base hospitalar.
            </p>
            <span className="ml-auto text-[10px] font-medium uppercase tracking-wider opacity-80 hidden md:inline">
              Lote {payment.reference}
            </span>
          </div>
        </div>
      )}
      <PageHeader
        title={isConfeccao ? `🛠  ${payment.reference}` : payment.reference}
        description={(() => {
          const liq = Number((payment as any).liquido_total ?? payment.total_amount ?? 0);
          const persistedCount = Number((payment as any).items_count ?? 0);
          const displayCount = items.length > 0 ? items.length : persistedCount;
          const compLabel = formatCompetence(payment.competence_months?.length ? payment.competence_months : payment.competence_month);
          const ccCode = payment.cost_center_code;
          const track = (payment as any).payment_track as PaymentTrack | null | undefined;
          const trackLabel = track ? PAYMENT_TRACK_SHORT_LABELS[track] : null;
          const currentResponsibleId = assignments[0]?.analyst_id ?? null;
          const currentResponsibleName = currentResponsibleId ? (profiles[currentResponsibleId] || null) : null;
          const responsibleShort = currentResponsibleName
            ? currentResponsibleName.trim().split(/\s+/).slice(0, 2).join(" ")
            : null;
          const subtitleParts: string[] = [];
          if (compLabel) subtitleParts.push(String(compLabel));
          if (ccCode) subtitleParts.push(`CC ${ccCode}`);
          if (trackLabel) subtitleParts.push(trackLabel);
          if (responsibleShort) subtitleParts.push(responsibleShort);
          // KPIs leves — alertas/críticos só aparecem quando > 0
          let alertCount = 0;
          let criticalCount = 0;
          for (const it of items as any[]) {
            const s = it?.ai_status as ItemAiStatus | undefined;
            if (s === "alerta") alertCount++;
            else if (s === "reprovado" || s === "erro_duplicidade_pagamento" || s === "erro_duplicidade_calculo") criticalCount++;
          }
          return (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground min-w-0">
                <span className="truncate capitalize">{subtitleParts.join(" · ") || "—"}</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center h-5 w-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                      aria-label="Ver metadados do lote"
                      title="Ver metadados do lote"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3 space-y-2 text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-24 shrink-0">Previsão</span>
                      <span className="font-medium">{formatDateOnly(payment.payment_due_date) || "—"}</span>
                    </div>
                    {payment.payment_type && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-24 shrink-0">Tipo</span>
                        <span className="font-medium">{PAYMENT_TYPE_LABELS[payment.payment_type as keyof typeof PAYMENT_TYPE_LABELS]}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-24 shrink-0">Categoria</span>
                      <Select
                        value={(payment.payment_kind as string) ?? "__none__"}
                        onValueChange={async (v) => {
                          const newVal = v === "__none__" ? null : v;
                          const prev = (payment.payment_kind as string | null) ?? null;
                          if (newVal === prev) return;
                          const goingOutOfPendencia = prev === "pendencia" && newVal !== "pendencia";
                          const goingIntoPendencia = prev !== "pendencia" && newVal === "pendencia";
                          const msg = goingOutOfPendencia
                            ? "Ao sair de Pendência, os itens marcados como 'reprocessamento' voltam a ser tratados como procedimento e serão reanalisados pelo motor. Confirmar?"
                            : goingIntoPendencia
                            ? "Ao marcar como Pendência, o motor deixa de aplicar regras (itens tratados como lançamento financeiro). Confirmar?"
                            : "Trocar a categoria do lote?";
                          if (!window.confirm(msg)) return;
                          const { error } = await supabase
                            .from("payments")
                            .update({ payment_kind: newVal as any })
                            .eq("id", payment.id);
                          if (error) {
                            toast({ title: "Erro ao atualizar categoria", description: error.message, variant: "destructive" });
                            return;
                          }
                          if (goingOutOfPendencia) {
                            const { error: reclassErr, count } = await supabase
                              .from("payment_items")
                              .update({ tipo_linha: "procedimento" } as any, { count: "exact" })
                              .eq("payment_id", payment.id)
                              .eq("tipo_linha", "reprocessamento")
                              .not("procedure_code", "is", null);
                            if (reclassErr) {
                              toast({ title: "Categoria atualizada, mas falhou reclassificar itens", description: reclassErr.message, variant: "destructive" });
                            } else {
                              toast({ title: "Categoria atualizada", description: `${count ?? 0} itens reclassificados. Disparando reanálise…` });
                              try {
                                await supabase.functions.invoke("dispatch-payment-analysis", {
                                  body: { payment_id: payment.id, force_fresh_rules: true, skip_ai: true },
                                });
                              } catch (e) {
                                console.warn("[payment_kind] reanalysis dispatch falhou", e);
                              }
                            }
                          } else {
                            toast({ title: "Categoria atualizada", description: newVal ? PAYMENT_KIND_LABELS[newVal as keyof typeof PAYMENT_KIND_LABELS] : "Sem categoria" });
                          }
                          load();
                        }}
                      >
                        <SelectTrigger className="h-7 px-2 text-xs flex-1 border-dashed">
                          <SelectValue placeholder="Definir" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">— Sem categoria</SelectItem>
                          <SelectItem value="atual" className="text-xs">{PAYMENT_KIND_LABELS.atual}</SelectItem>
                          <SelectItem value="pendencia" className="text-xs">{PAYMENT_KIND_LABELS.pendencia}</SelectItem>
                          <SelectItem value="misto" className="text-xs">{PAYMENT_KIND_LABELS.misto}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-24 shrink-0">Trilha</span>
                      <Select
                        value={((payment as any).payment_track as string) ?? "__none__"}
                        onValueChange={async (v) => {
                          const newVal = v === "__none__" ? null : (v as PaymentTrack);
                          const { error } = await supabase
                            .from("payments")
                            .update({ payment_track: newVal })
                            .eq("id", payment.id);
                          if (error) {
                            toast({ title: "Erro ao atualizar trilha", description: error.message, variant: "destructive" });
                          } else {
                            toast({ title: "Trilha atualizada", description: newVal ? PAYMENT_TRACK_LABELS[newVal] : "Sem trilha" });
                            load();
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 px-2 text-xs flex-1 border-dashed">
                          <SelectValue placeholder="Definir" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs">— Não classificado</SelectItem>
                          <SelectItem value="habitual" className="text-xs">{PAYMENT_TRACK_SHORT_LABELS.habitual}</SelectItem>
                          <SelectItem value="prioritario" className="text-xs">{PAYMENT_TRACK_SHORT_LABELS.prioritario}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {currentResponsibleName && (
                      <div className="flex items-baseline gap-2 pt-1 border-t border-border/50">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-24 shrink-0">Responsável</span>
                        <span className="font-medium truncate">{currentResponsibleName}</span>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-primary/10 text-primary text-[11px] font-medium tabular-nums">
                  <ClipboardList className="h-3 w-3" />
                  {displayCount} itens
                </span>
                <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-primary/10 text-primary text-[11px] font-medium tabular-nums">
                  {formatCurrency(liq)}
                </span>
                {alertCount > 0 && (
                  <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-medium tabular-nums">
                    <AlertTriangle className="h-3 w-3" />
                    {alertCount} {alertCount === 1 ? "alerta" : "alertas"}
                  </span>
                )}
                {criticalCount > 0 && (
                  <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-destructive/15 text-destructive text-[11px] font-medium tabular-nums">
                    <ShieldAlert className="h-3 w-3" />
                    {criticalCount} {criticalCount === 1 ? "crítico" : "críticos"}
                  </span>
                )}
              </div>
            </div>
          );
        })()}
        sticky
        actions={
          <div className="flex items-center gap-2">
            {!isConfeccao && (
              <div className="md:hidden">
                <Select value={viewMode} onValueChange={(v) => setViewMode(v as PivotVariant)}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="detalhe">Detalhe</SelectItem>
                    <SelectItem value="compacto">Compacto</SelectItem>
                    <SelectItem value="executivo">Executivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isConfeccao && (
              <SegmentedControl
                className="hidden md:inline-flex"
                value={viewMode}
                onValueChange={(v) => setViewMode(v as PivotVariant)}
                ariaLabel="Modo de visualização do pagamento"
                options={[
                  { value: "detalhe", label: "Detalhe" },
                  { value: "compacto", label: "Compacto" },
                  { value: "executivo", label: "Executivo" },
                ]}
              />
            )}

            <Button variant="outline" size="sm" asChild title="Relatório de economia/aumento por empresa do lote">
              <Link to={`/pagamentos/${payment.id}/intervencoes`}>
                <ClipboardList className="h-4 w-4 mr-1.5" />
                Intervenções
              </Link>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsBatchReconReportOpen(true)}
              title="Panorama financeiro do lote — compara NF, snapshot e glosas efetivamente aplicadas por PJ"
            >
              <BarChart3 className="h-4 w-4 mr-1.5" />
              Panorama do lote
            </Button>



            {obs.some((o: any) => o.is_question) && (
              <Button 
                variant="outline" 
                size="sm" 
                className={cn(
                  "border-info/40 bg-info-soft text-info hover:bg-info-soft/80",
                  obs.some((o: any) => o.is_question && !o.resolved_at) && "animate-pulse"
                )}
                onClick={() => setIsQuestionsPanelOpen(true)}
              >
                <MessageCircleQuestion className="h-4 w-4 mr-1.5" />
                Questionamentos ({obs.filter((o: any) => o.is_question && !o.resolved_at).length})
              </Button>
            )}
            {/*
              Modo CONFECÇÃO: botão direto "Recalcular repasse" — sem dialog,
              sem filtros de alerta/reprovado (confecção não retorna esses
              status). Apenas reexecuta o motor de cálculo em todo o lote.
            */}
            {isConfeccao && (isAnalista || isDiretor) && (
              <Button
                variant="outline"
                size="sm"
                disabled={reprocessingAi}
                className="hidden md:inline-flex"
                title="Reexecuta o motor de cálculo de repasse em todo o lote (modo confecção)"
                onClick={() => reprocessAi()}
              >
                <RefreshCw className={cn("h-4 w-4 mr-1.5 text-muted-foreground", reprocessingAi && "animate-spin")} />
                {reprocessingAi ? "Recalculando..." : "Recalcular repasse"}
              </Button>
            )}
            {(payment as any)?.pool_id && (
              <Button
                variant="outline"
                size="sm"
                className="inline-flex"
                title="Abrir tela de rateio do pool (cálculo por PJ)"
                asChild
              >
                <Link to={`/pagamentos/${id}/pool`}>
                  <Layers className="h-4 w-4 mr-1.5 text-violet-600" />
                  Ver rateio do pool
                </Link>
              </Button>
            )}
            {canImportInitialPaymentBase && (
              <Button
                variant="default"
                size="sm"
                disabled={busy || reimporting}
                className="hidden md:inline-flex"
                onClick={() => reimportInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Importar base de pagamento
              </Button>
            )}

            {canConcludeHistorico && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busy}
                    className="inline-flex"
                    title="Marca todos os grupos como pago e fecha o lote histórico. Use só depois de revisar/ajustar."
                  >
                    <ShieldCheck className="h-4 w-4 mr-1.5" />
                    Concluir importação histórica
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Concluir importação histórica?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Todos os grupos ativos deste lote serão marcados como <strong>pago</strong> e o lote fechará.
                      Faça os ajustes necessários antes — depois de concluído, o lote sai do fluxo de revisão.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={concludeHistorico}>Concluir e marcar como pago</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}


            {!isConfeccao && (payment.status === "em_analise_ia" || payment.status === "revisao_analista" || payment.status === "devolvido_analista") && (isAnalista || isDiretor) && (
              <AlertDialog open={reprocessConfirmOpen} onOpenChange={setReprocessConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reprocessingAi}
                    className="hidden md:inline-flex"
                    title="Reaplicar o motor de regras e análise de IA"
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-1.5 text-muted-foreground", reprocessingAi && "animate-spin")} />
                    {reprocessingAi ? "Processando..." : "Reanalisar lote"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reanalisar itens do lote?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-4">
                        <p>
                          Selecione quais itens você deseja reanalisar e defina o critério de tolerância para divergências.
                        </p>
                        
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Tolerância aceitável:</p>
                          <Select 
                            value={String(toleranceValue)} 
                            onValueChange={(v) => setToleranceValue(Number(v))}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Selecione a tolerância" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0.01">Até 1% (Padrão)</SelectItem>
                              <SelectItem value="0.02">Até 2%</SelectItem>
                              <SelectItem value="0.05">Até 5%</SelectItem>
                              <SelectItem value="0.10">Até 10%</SelectItem>
                              <SelectItem value="0.00">0% (Divergência exata)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground italic">
                            Divergências menores que {toleranceValue * 100}% serão marcadas como "Aprovado".
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Filtrar por status:</p>
                          <div className="grid grid-cols-2 gap-2">
                            {["pendente", "alerta", "reprovado", "aprovado"].map((status) => (
                              <label key={status} className="flex items-center gap-2 text-sm p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer">
                                <Checkbox 
                                  checked={reprocessFilter.includes(status)}
                                  onCheckedChange={(checked) => {
                                    if (checked) setReprocessFilter([...reprocessFilter, status]);
                                    else setReprocessFilter(reprocessFilter.filter(s => s !== status));
                                  }}
                                />
                                <span className="capitalize">{status}</span>
                              </label>
                            ))}
                          </div>
                          <p className="text-[11px] text-muted-foreground italic">
                            {reprocessFilter.length === 0 
                              ? "Nenhum filtro selecionado: reanalisará TODO o lote." 
                              : `Reanalisando apenas itens: ${reprocessFilter.join(", ")}.`}
                          </p>
                        </div>

                        {(() => {
                          const scoped = reprocessFilter.length === 0
                            ? items
                            : items.filter((it: any) => reprocessFilter.includes(String(it.ai_status ?? "")));
                          const aiCount = scoped.filter((it: any) => String(it.ai_status ?? "") === "needs_ai_review").length;
                          return (
                            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs">
                              Esta reanálise processará aproximadamente{" "}
                              <strong>{aiCount}</strong> item(ns) por IA
                              {" "}(de <strong>{scoped.length}</strong> selecionados). Itens já em cache não consomem créditos.
                            </div>
                          );
                        })()}

                        <label className="flex items-start gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/40">
                          <Checkbox
                            checked={reprocessRunAi}
                            onCheckedChange={(c) => setReprocessRunAi(c === true)}
                            className="mt-0.5"
                          />
                          <span className="text-xs">
                            <strong>Incluir justificativas IA</strong>
                            <span className="block text-muted-foreground">
                              Quando desmarcado, roda apenas o motor de regras (sem consumo de créditos de IA).
                            </span>
                          </span>
                        </label>

                        <p className="text-sm pt-2">
                          Responsável: <strong>{user?.user_metadata?.full_name || user?.email}</strong>
                        </p>

                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => { setReprocessFilter([]); setReprocessRunAi(false); }}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => { const runAi = reprocessRunAi; setReprocessRunAi(false); void reprocessAi(reprocessFilter, { runAi }); }}
                      className="bg-warning hover:bg-warning/90 text-white"
                    >
                      Confirmar Reanálise
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {(isAnalista || isValidador || isDiretor) && !isNfPhase && (() => {
              const flagged = items.filter((it: any) => Array.isArray(it.validation_findings) && it.validation_findings.length > 0).length;
              const totalFindings = items.reduce((acc: number, it: any) => acc + (Array.isArray(it.validation_findings) ? it.validation_findings.length : 0), 0);
              const runValidation = async (scope: "batch" | "cross") => {
                if (!id) return;
                setValidatingRules(true);
                try {
                  const { data, error } = await supabase.functions.invoke("validate-payment", { body: { payment_id: id, scope } });
                  if (error) throw error;
                  const flaggedNow = (data as any)?.items_flagged ?? 0;
                  const totalNow = (data as any)?.total_findings ?? 0;
                  const extScanned = (data as any)?.external_items_scanned ?? 0;
                  const scopeLabel = scope === "cross"
                    ? ` (varredura cruzada — ${extScanned.toLocaleString("pt-BR")} itens externos)`
                    : " (somente este lote)";
                  toast({
                    title: "Validação concluída",
                    description: totalNow > 0
                      ? `${totalNow} alerta(s) em ${flaggedNow} item(ns)${scopeLabel}.`
                      : `Nenhuma inconsistência detectada${scopeLabel}.`,
                  });
                  const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
                  const freshItems = await fetchAllPaginated<any>((from, to) =>
                    supabase
                      .from("payment_items")
                      .select("*")
                      .eq("payment_id", id)
                      .order("created_at")
                      .range(from, to),
                  );
                  if (freshItems) setItems(freshItems as any);
                  load();
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  toast({ title: "Falha ao validar", description: msg, variant: "destructive" });
                } finally {
                  setValidatingRules(false);
                }
              };
              return (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={validatingRules}
                      className="hidden md:inline-flex"
                      title="Aplicar regras de validação assistencial nos itens deste lote"
                    >
                      <ShieldCheck className={cn("h-4 w-4 mr-1.5 text-muted-foreground", validatingRules && "animate-spin")} />
                      {validatingRules ? "Validando..." : "Validação assistencial"}
                      {!validatingRules && flagged > 0 && (
                        <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-warning-soft text-warning text-[10px] font-semibold">
                          {totalFindings}
                        </span>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Escopo da validação assistencial</AlertDialogTitle>
                      <AlertDialogDescription>
                        <strong>Somente este lote:</strong> cruza itens apenas entre os pagamentos deste lote. Mais rápido; ideal quando o lote agrupa várias especialidades.
                        <br /><br />
                        <strong>Este lote + outros lotes (30d):</strong> varre também itens de outros lotes do mesmo hospital dentro de ±30 dias das datas dos procedimentos. Detecta sobreposições entre lotes de especialidades diferentes (ex.: Neuro × Clínica Médica no mesmo paciente/dia). Pode levar mais tempo.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => runValidation("batch")}>Somente este lote</AlertDialogAction>
                      <AlertDialogAction onClick={() => runValidation("cross")}>Este lote + outros lotes</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              );
            })()}

            {/* "Fazer questionamento" agora vive no FAB flutuante (canto inferior direito). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Mais ações">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {(isAnalista || isDiretor) && !isNfPhase && (
                  <DropdownMenuItem onSelect={() => setIsConciliationOpen(true)}>
                    <GitCompare className="h-4 w-4 mr-2" /> Conciliar produção
                  </DropdownMenuItem>
                )}
                {isAnalista && groups.length > 0 && (
                  <DropdownMenuItem onSelect={() => setProductionValidationOpen(true)}>
                    <Send className="h-4 w-4 mr-2" /> Validação prévia da empresa
                  </DropdownMenuItem>
                )}
                {((isAnalista || isDiretor) && !isNfPhase) || (isAnalista && groups.length > 0) ? (
                  <DropdownMenuSeparator />
                ) : null}
                {/* Teste de regras vive só em /regras?tab=teste-motor — sem atalho aqui. */}


                {canEditMeta && (
                  <DropdownMenuItem onSelect={() => { openEditMeta(); setEditMetaOpen(true); }}>
                    <Pencil className="h-4 w-4 mr-2" /> Editar lote
                  </DropdownMenuItem>
                )}
                {canManagePaymentBase && (
                  <DropdownMenuItem disabled={busy || reimporting} onSelect={() => reimportInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" /> {canImportInitialPaymentBase ? "Importar base de pagamento" : "Reimportar base"}
                  </DropdownMenuItem>
                )}
                {canReimport && (
                  <DropdownMenuItem disabled={busy || addingCompany} onSelect={() => addCompanyInputRef.current?.click()}>
                    <Plus className="h-4 w-4 mr-2" /> Adicionar empresa ao lote
                  </DropdownMenuItem>
                )}
                {canReimport && (
                  <DropdownMenuItem disabled={busy} onSelect={() => setBonusDialogOpen(true)}>
                    <Sparkles className="h-4 w-4 mr-2" /> Adicionar pagamento avulso (atendimento)
                  </DropdownMenuItem>
                )}
                {canReimport && (
                  <DropdownMenuItem
                    onSelect={async (e) => {
                      e.preventDefault();
                      if (!id) return;
                      toast({ title: "Reprocessando deduções do lote…" });
                      try {
                        const { data: debts } = await (supabase as any)
                          .from("glosa_debts")
                          .select("company_id")
                          .or(`target_payment_id.eq.${id},last_payment_id.eq.${id}`)
                          .eq("status", "ativo")
                          .not("confirmed_at", "is", null)
                          .is("ignored_at", null);
                        const { data: apps } = await (supabase as any)
                          .from("glosa_payment_applications")
                          .select("company_id")
                          .eq("payment_id", id)
                          .is("reverted_at", null);
                        const appliedSet = new Set(((apps ?? []) as Array<{ company_id: string | null }>).map((r) => r.company_id).filter(Boolean));
                        const companies = Array.from(new Set(((debts ?? []) as Array<{ company_id: string | null }>)
                          .map((r) => r.company_id).filter((c): c is string => !!c)));
                        const pendentes = companies.filter((c) => !appliedSet.has(c));
                        if (pendentes.length === 0) {
                          toast({ title: "Nada a reprocessar", description: "Todas as PJs com débito já têm aplicação." });
                          return;
                        }
                        const results = await Promise.allSettled(pendentes.map((company_id) =>
                          supabase.functions.invoke("apply-company-deductions", { body: { payment_id: id, company_id } })
                        ));
                        const ok = results.filter((r) => r.status === "fulfilled").length;
                        const fail = results.length - ok;
                        toast({ title: `${ok} PJ(s) reprocessada(s)${fail ? ` · ${fail} falha(s)` : ""}` });
                      } catch (err: any) {
                        toast({ title: "Falha ao reprocessar deduções", description: err?.message, variant: "destructive" });
                      }
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" /> Reprocessar deduções pendentes
                  </DropdownMenuItem>
                )}


                <DropdownMenuItem onSelect={() => setAssignmentsHistoryOpen(true)}>
                  <UserCheck className="h-4 w-4 mr-2" /> Transferir / Histórico
                </DropdownMenuItem>
                {canCancel && (
                  <DropdownMenuItem onSelect={() => setCancelOpen(true)}>
                    <Ban className="h-4 w-4 mr-2" /> Cancelar
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Excluir
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <StatusBadge status={payment.status} />
          </div>
        }
      />
      <div className="p-3 md:px-6 md:py-6 space-y-4 md:space-y-6">

        {/* Memória de cálculo (lançamentos por Modelo de Repasse) */}
        {(payment as any)?.payout_breakdown && (
          <PayoutBreakdownCard breakdown={(payment as any).payout_breakdown} />
        )}


        {/* Card de Relatório de Parecer — só para lotes do tipo parecer */}
        {!isConfeccao &&
          String(payment?.payment_type ?? "").toLowerCase().includes("parecer") && (
            <ParecerReportCard
              paymentId={payment.id}
              competenceMonth={payment.competence_month ?? null}
              competenceMonths={(payment as any).competence_months ?? null}
            />
          )}

        {/* Funil de etapas — visão Apple do progresso do lote */}
        {!isConfeccao && payment?.status && (
          <PaymentStatusFunnel status={payment.status} />
        )}

        {/* Lotes de remessa: competência por item + bucket sem competência */}
        {!isConfeccao && (
          <RemessaCompetenceBuckets
            paymentId={payment.id}
            competenceRegime={(payment as any).competence_regime ?? null}
          />
        )}

        {/* Zeev: descompasso de competência (sugere remessa) */}
        {!isConfeccao && (
          <ProducaoDescompassoBanner
            paymentId={payment.id}
            competenceRegime={(payment as any).competence_regime ?? null}
            competenceMonth={payment.competence_month ?? null}
            onRegimeChanged={() => window.location.reload()}
          />
        )}

        {/* Banner de pool — preservado como bloco standalone após a compactação
            do bloco de metadados (que migrou para o subtítulo/popover do header). */}
        {(payment as any)?.pool_id && (
          <Card className="shadow-card">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300 min-w-0">
                  <Layers className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    Este lote alimenta um <strong>pool de rateio</strong>
                    {poolInfo?.nome ? <> · <span className="font-medium">{poolInfo.nome}</span></> : null}
                    {poolInfo?.deducao ? <span className="text-[10px] opacity-70"> · {poolInfo.deducao}</span> : null}
                    . Veja como o líquido será distribuído entre as PJs participantes.
                  </span>
                </div>
                <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700 text-white shrink-0">
                  <Link to={`/pagamentos/${id}/pool`}>
                    <Layers className="h-4 w-4 mr-1.5" />
                    Abrir rateio do pool
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {id && <AnalysisProgressBar paymentId={id} onJobChange={setAnalysisJob} />}
        {itemsLoadIssue && (
          <Alert className="border-warning/40 bg-warning-soft/70 text-warning-text">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <AlertTitle>Atualizando itens do lote</AlertTitle>
            <AlertDescription>{itemsLoadIssue}</AlertDescription>
          </Alert>
        )}
        {itemsLoading && !itemsLoadIssue && items.length === 0 && Number((payment as any).items_count ?? 0) > 0 && (
          <Alert className="border-primary/30 bg-primary/5">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <AlertTitle>Carregando itens do lote</AlertTitle>
            <AlertDescription>A lista está sendo carregada sem zerar os dados persistidos.</AlertDescription>
          </Alert>
        )}
        {id && <BatchAIFailureReport paymentId={id} />}
        {/* [Confecção] painel de auditoria pago×regra não faz sentido — o motor
            é dono do gross_amount, então não há "pago" para auditar. */}
        {id && !isConfeccao && tussAuditOpenCount > 0 && <TussPrincipalAuditPanel paymentId={id} />}
        {id && (
          <SpecialCaseRetroactiveBanner
            paymentId={id}
            paymentStatus={payment.status}
            paymentUpdatedAt={(payment as any).updated_at ?? null}
          />
        )}
        {id && (isAnalista || isDiretor) && hasSpecialCaseRules && (
          <div className="rounded-md border border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/20 dark:border-indigo-900/60 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <Sparkles className="h-4 w-4 mt-0.5 text-indigo-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Caso especial</p>
                <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80">
                  Existe regra cadastrada para casos especiais. Sinalize um atendimento ou item para aplicar a regra correspondente.
                </p>
              </div>
            </div>
            <MarkSpecialCaseDialog paymentId={id} />
          </div>
        )}

        {/* MOBILE: cards de IA colapsáveis — só na fase de análise, nunca em confecção */}
        {!isNfPhase && !isConfeccao && (
        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setAiCardsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-md border bg-primary/5 text-sm font-medium"
            aria-expanded={aiCardsOpen}
          >
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Análise
            </span>
            {aiCardsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {aiCardsOpen && (
            <div className="space-y-3 mt-2">
              {id && !isConfeccao && <ExecutiveSummaryCard paymentId={id} payment={payment} />}
              {id && <EngineSourcesCard paymentId={id} />}
              {id && <PoolCalculationCard paymentId={id} />}

              {id && (
                <EmailApprovalCard
                  paymentId={id}
                  hasGroupsAwaitingApproval={groups.some((g) => String(g.status) === "aguardando_aprovacao")}
                  onApplied={() => { void load(); }}
                />
              )}
              {id && <DirectorBriefingCard
                paymentId={id}
                payment={payment}
                roles={roles}
                onApprove={isDiretor ? async () => {
                  if (tussAuditOpenCount > 0) { toast({ title: "Aprovação bloqueada", description: `${tussAuditOpenCount} item(ns) com TUSS principal não usado como chave. Resolva na auditoria antes de aprovar.`, variant: "destructive" }); return; }
                  const approvable = groups.filter(g => String(g.status) === "aguardando_aprovacao");
                  if (approvable.length === 0) { toast({ title: "Nenhuma empresa aguardando aprovação", variant: "destructive" }); return; }
                  setApprovalBusy(true);
                  const { error } = await supabase.rpc("approve_payment" as "approve_payment", {
                    p_payment_id: id!,
                    p_group_ids: approvable.map(g => g.id),
                    p_author_id: user!.id,
                    p_author_name: profiles[user!.id] ?? user!.email ?? "Diretor",
                    p_note: null,
                  });
                  setApprovalBusy(false);
                  if (error) { toast({ title: "Falha ao aprovar", description: error.message, variant: "destructive" }); return; }
                  toast({ title: `${approvable.length} empresa(s) aprovada(s)` });
                  await load();
                  navigate("/pagamentos");
                } : undefined}
                onReturn={isDiretor ? async () => {
                  const approvable = groups.filter(g => String(g.status) === "aguardando_aprovacao");
                  if (approvable.length === 0) { toast({ title: "Nenhuma empresa aguardando aprovação", variant: "destructive" }); return; }
                  setApprovalBusy(true);
                  const { error } = await supabase.rpc("return_groups_to_analyst" as "return_groups_to_analyst", {
                    p_payment_id: id!,
                    p_group_ids: approvable.map(g => g.id),
                    p_author_id: user!.id,
                    p_author_name: profiles[user!.id] ?? user!.email ?? "Diretor",
                    p_message: "Devolvido pelo diretor via briefing de aprovação.",
                    p_lot_level: true,
                  } as never);
                  setApprovalBusy(false);
                  if (error) { toast({ title: "Falha ao devolver", description: error.message, variant: "destructive" }); return; }
                  toast({ title: `${approvable.length} empresa(s) devolvida(s) ao analista` });
                  await load();
                  navigate("/pagamentos");
                } : undefined}
              />}
              <PreAnalysisScoreCard payment={payment} />
              {id && <DoctorAnomalyAlerts paymentId={id} analysisMode={(payment as any)?.analysis_mode} />}
            </div>
          )}
        </div>
        )}
        {/* DESKTOP: cards de IA + alertas assistenciais lado a lado (renderizados juntos abaixo no grid). */}
        {segregationBlocked && (
          <Card className="shadow-card border-warning/40 bg-warning-soft/40">
            <CardContent className="p-3 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <span>
                <strong>Segregação de funções:</strong> você criou este lote, então não pode validar nem aprová-lo.
                Outro validador/diretor precisa concluir esta etapa.
              </span>
            </CardContent>
          </Card>
        )}

        {/* Input + dialogs extraídos (acionados pelo menu ···) */}
        <input
          ref={reimportInputRef}
          type="file"
          multiple
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setReimportConfirm((prev) => (prev ? [...prev, ...Array.from(files)] : Array.from(files)));
              e.target.value = "";
            }
          }}
        />

        {canEditMeta && (
          <Dialog open={editMetaOpen} onOpenChange={setEditMetaOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Editar lote</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
                <div>
                  <label className="text-xs text-muted-foreground">Referência</label>
                  <Input value={metaDraft.reference} onChange={(e) => setMetaDraft((m) => ({ ...m, reference: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Descrição</label>
                  <Textarea rows={3} value={metaDraft.description} onChange={(e) => setMetaDraft((m) => ({ ...m, description: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Competência</label>
                    <DateInput value={metaDraft.competence_month} onChange={(v) => setMetaDraft((m) => ({ ...m, competence_month: v }))} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Previsão de pagamento</label>
                    <DateInput value={metaDraft.payment_due_date} onChange={(v) => setMetaDraft((m) => ({ ...m, payment_due_date: v }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Modo de análise</label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={metaDraft.analysis_mode}
                      onChange={(e) => setMetaDraft((m) => ({ ...m, analysis_mode: e.target.value }))}
                    >
                      <option value="padrao">Padrão</option>
                      <option value="isolado">Isolado</option>
                      <option value="empresa_prioritaria">Empresa prioritária</option>
                      <option value="confeccao">Confecção</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Pool de rateio</label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={metaDraft.pool_id}
                      onChange={(e) => setMetaDraft((m) => ({ ...m, pool_id: e.target.value }))}
                    >
                      <option value="">— Sem rateio —</option>
                      {poolsForEdit.map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {metaDraft.pool_id && (
                  <div>
                    <label className="text-xs text-muted-foreground">Origem do rateio</label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={metaDraft.rateio_source || "planilha"}
                      onChange={(e) => setMetaDraft((m) => ({ ...m, rateio_source: e.target.value }))}
                    >
                      <option value="planilha">Planilha</option>
                      <option value="participantes">Participantes do pool</option>
                      <option value="filtrado">Filtros do pool</option>
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Alterar pool, modo ou competência re-dispara o motor (releitura de regras, deduções, créditos/débitos, glosas e garantia mínima).
                    </p>
                  </div>
                )}
                <div>
                  <label className="text-xs text-muted-foreground">Centro de custos *</label>
                  <CostCenterCombobox
                    value={metaDraft.cost_center_code || null}
                    onChange={(v) => setMetaDraft((m) => ({ ...m, cost_center_code: v ?? "" }))}
                    placeholder="Buscar por código P12 ou nome…"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Obrigatório. Define o centro de custos contábil do lote (usado no DRE e no rateio por CC).
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditMetaOpen(false)} disabled={savingMeta}>Cancelar</Button>
                <Button onClick={saveMeta} disabled={savingMeta}>{savingMeta ? "Salvando…" : "Salvar"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {canManagePaymentBase && (
          <AlertDialog open={!!reimportConfirm} onOpenChange={(v) => !v && !reimporting && setReimportConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{canImportInitialPaymentBase ? "Importar base de pagamento?" : "Reimportar base?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {canImportInitialPaymentBase ? "Esta ação cria os itens deste lote a partir dos arquivos selecionados e inicia a análise." : "Esta ação substitui todos os itens e grupos deste lote pelo conteúdo dos arquivos selecionados e reinicia a análise. Metadados (referência, competência, tipo) são mantidos. Não pode ser desfeita."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3">
                <div className="bg-muted/50 p-2.5 rounded-md border border-border/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Arquivos para reimportar ({reimportConfirm?.length}):</p>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => reimportInputRef.current?.click()}>
                      <Plus className="h-3 w-3 mr-1" /> Adicionar mais
                    </Button>
                  </div>
                  <ul className="text-xs space-y-1 max-h-[150px] overflow-y-auto pr-1">
                    {reimportConfirm?.map((f, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 group min-w-0">
                        <span className="truncate flex-1 min-w-0" title={f.name}>• {f.name}</span>
                        <button type="button" onClick={() => setReimportConfirm((prev) => prev?.filter((_, idx) => idx !== i) || null)} className="text-muted-foreground hover:text-destructive p-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-[10px] text-muted-foreground italic bg-info-soft/30 p-1.5 rounded border border-info/20">
                  Dica: Você pode selecionar vários arquivos de uma vez no explorador ou clicar em "Adicionar mais" acima.
                </p>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={reimporting}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={reimporting} onClick={() => reimportConfirm && doReimport(reimportConfirm)}>
                  {reimporting
                    ? (importProgress
                        ? `Lendo ${importProgress.current}/${importProgress.total}…`
                        : "Reimportando…")
                    : "Confirmar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <ReimportDiffDialog
          open={!!reimportDiffState}
          diff={reimportDiffState?.diff ?? null}
          sha256Matched={reimportDiffState?.sha256Matched ?? false}
          busy={reimporting}
          onCancel={() => reimportDiffResolverRef.current?.("cancel")}
          onConfirm={() => reimportDiffResolverRef.current?.("confirm")}
          onSkip={() => reimportDiffResolverRef.current?.("skip")}
        />



        <input
          ref={addCompanyInputRef}
          type="file"
          multiple
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              setAddCompanyConfirm((prev) => (prev ? [...prev, ...Array.from(files)] : Array.from(files)));
              e.target.value = "";
            }
          }}
        />

        {canReimport && (
          <AlertDialog open={!!addCompanyConfirm} onOpenChange={(v) => !v && !addingCompany && setAddCompanyConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Adicionar empresa ao lote?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-3">
                  <p>Os arquivos selecionados devem conter linhas <strong>apenas de empresas que ainda não estão no lote</strong>. Empresas já existentes são ignoradas — use "Reimportar base" para refazê-las.</p>
                  <div className="bg-muted/50 p-2.5 rounded-md border border-border/50">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Arquivos ({addCompanyConfirm?.length}):</p>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => addCompanyInputRef.current?.click()}>
                        <Plus className="h-3 w-3 mr-1" /> Adicionar mais
                      </Button>
                    </div>
                    <ul className="text-xs space-y-1 max-h-[150px] overflow-y-auto pr-1">
                      {addCompanyConfirm?.map((f, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 group">
                          <span className="truncate flex-1">• {f.name}</span>
                          <button type="button" onClick={() => setAddCompanyConfirm((prev) => prev?.filter((_, idx) => idx !== i) || null)} className="text-muted-foreground hover:text-destructive p-0.5">
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={addingCompany}>Cancelar</AlertDialogCancel>
                <AlertDialogAction disabled={addingCompany} onClick={() => addCompanyConfirm && doAddCompany(addCompanyConfirm)}>
                  {addingCompany
                    ? (importProgress
                        ? `Lendo ${importProgress.current}/${importProgress.total}…`
                        : "Adicionando…")
                    : "Confirmar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {columnMappingDialog && (
          <ColumnMappingDialog
            open={columnMappingDialog.open}
            onOpenChange={(open) => {
              if (!open) setColumnMappingDialog(null);
            }}
            fileName={columnMappingDialog.file.name}
            headers={columnMappingDialog.headers}
            initialMapping={columnMappingDialog.initialMapping as any}
            sampleRow={columnMappingDialog.sampleRow}
            hospitalId={(payment as any)?.hospital_id ?? null}
            mode={(payment as any)?.analysis_mode === "confeccao" ? "confeccao" : "analise"}
            paymentTypeMeta={paymentTypeMeta ? {
              tuss_default: paymentTypeMeta.tuss_default,
              requires_tuss_in_sheet: paymentTypeMeta.requires_tuss_in_sheet,
              default_function: paymentTypeMeta.default_function,
            } : null}
            compatibleCount={columnMappingDialog.compatibleFileNames.length}
            onApply={(mapping, applyToCompatible) => {
              const dlg = columnMappingDialog;
              if (!dlg) return;
              const nextOverrides = { ...dlg.overrides, [dlg.file.name]: mapping as Record<string, string> };
              if (applyToCompatible) {
                for (const name of dlg.compatibleFileNames) {
                  nextOverrides[name] = mapping as Record<string, string>;
                }
              }
              setColumnMappingDialog(null);
              if (dlg.source === "reimport") {
                void doReimport(dlg.pendingFiles, nextOverrides);
              } else {
                void doAddCompany(dlg.pendingFiles, nextOverrides);
              }
            }}
          />
        )}





        {canCancel && (
          <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar este lote?</AlertDialogTitle>
                <AlertDialogDescription>O lote ficará marcado como cancelado e sairá do fluxo. Use esta opção se anexou os arquivos errados.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={cancelPayment}>Confirmar cancelamento</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canDelete && (
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir este lote?</AlertDialogTitle>
                <AlertDialogDescription>Esta ação remove o lote, todos os itens e o histórico. Não pode ser desfeita. Use para refazer o anexo a partir do zero em <strong>Nova base</strong>.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={deletePayment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir definitivamente</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Responsável e histórico de atribuições (transferir / ver histórico) */}
        <Sheet open={assignmentsHistoryOpen} onOpenChange={setAssignmentsHistoryOpen}>
          <SheetContent side="right" className="w-[480px] sm:max-w-md overflow-y-auto">
            <SheetHeader><SheetTitle>Responsável e histórico</SheetTitle></SheetHeader>
            <div className="mt-4">
              <AssignmentCard
                assignments={assignments}
                profiles={profiles}
                currentUserId={user?.id ?? null}
                canAssume={canAssumeNow}
                onAssume={handleManualAssume}
              />
            </div>
          </SheetContent>
        </Sheet>

        {!isNfPhase && !isConfeccao && analysisJob?.status !== "em_andamento" && (payment.ai_summary || items.some((i) => i.ai_status && i.ai_status !== "pendente")) && (() => {
          const extractCount = (text: string, keyword: RegExp): number | null => {
            const m = text.match(keyword);
            return m ? Number(m[1]) : null;
          };
          const sum = payment.ai_summary ?? "";
          const summaryAprovado = extractCount(sum, /(\d+)\s+aprovad/i);
          const summaryAlerta = extractCount(sum, /(\d+)\s+alerta/i);
          const summaryReprovado = extractCount(sum, /(\d+)\s+reprovad/i);
          const summaryMatchesCounts = !!payment.ai_summary &&
            summaryAprovado === counts.aprovado &&
            summaryAlerta === counts.alerta &&
            summaryReprovado === counts.reprovado;
          const canReanalyze =
            (isAnalista || isDiretor) &&
            (payment.status === "em_analise_ia" ||
              payment.status === "revisao_analista" ||
              payment.status === "devolvido_analista");
          const jobConcluido = !!analysisJob;

          // Alertas assistenciais agregados por nome de regra
          const ruleCounts = new Map<string, number>();
          const ruleValues = new Map<string, number>();
          const seenConflictIds = new Set<string>();
          let conflictExtraValue = 0;
          items.forEach((it) => {
            const findings = (it as unknown as { validation_findings?: unknown }).validation_findings;
            if (!Array.isArray(findings)) return;
            findings.forEach((f: any) => {
              const name = String(f?.rule_name ?? "Regra sem nome");
              ruleCounts.set(name, (ruleCounts.get(name) ?? 0) + 1);
              ruleValues.set(name, (ruleValues.get(name) ?? 0) + Number(it.gross_amount ?? 0));
              const cid = f?.conflicting_item_id as string | undefined;
              if (cid && !seenConflictIds.has(cid)) {
                seenConflictIds.add(cid);
                conflictExtraValue += Number(conflictGrossForCard[cid] ?? 0);
              }
            });
          });
          const sortedRules = Array.from(ruleCounts.entries()).sort((a, b) => b[1] - a[1]);
          const totalRuleAlerts = sortedRules.reduce((acc, [, n]) => acc + n, 0);
          const totalRuleValue = Array.from(ruleValues.values()).reduce((a, b) => a + b, 0);
          const totalRiskWithConflicts = totalRuleValue + conflictExtraValue;

          const hasAssistanceAlerts = sortedRules.length > 0;
          return (
            <div className={`grid grid-cols-1 gap-3 ${hasAssistanceAlerts ? "md:grid-cols-3" : ""}`}>
              {/* Coluna principal: cards de IA + Anomalias. No mobile, IA já aparece no collapsible.
                  Ocupa 2/3 quando há alertas assistenciais; largura total quando não há. */}
              <div className={`min-w-0 space-y-4 ${hasAssistanceAlerts ? "md:col-span-2" : ""}`}>
                <div className="hidden md:block space-y-4">
                  {id && !isConfeccao && <ExecutiveSummaryCard paymentId={id} payment={payment} />}
                  {id && <DirectorBriefingCard
                    paymentId={id}
                    payment={payment}
                    roles={roles}
                    onApprove={isDiretor ? async () => {
                      if (tussAuditOpenCount > 0) { toast({ title: "Aprovação bloqueada", description: `${tussAuditOpenCount} item(ns) com TUSS principal não usado como chave. Resolva na auditoria antes de aprovar.`, variant: "destructive" }); return; }
                      const approvable = groups.filter(g => String(g.status) === "aguardando_aprovacao");
                      if (approvable.length === 0) { toast({ title: "Nenhuma empresa aguardando aprovação", variant: "destructive" }); return; }
                      setApprovalBusy(true);
                      const { error } = await supabase.rpc("approve_payment" as "approve_payment", {
                        p_payment_id: id!,
                        p_group_ids: approvable.map(g => g.id),
                        p_author_id: user!.id,
                        p_author_name: profiles[user!.id] ?? user!.email ?? "Diretor",
                        p_note: null,
                      });
                      setApprovalBusy(false);
                      if (error) { toast({ title: "Falha ao aprovar", description: error.message, variant: "destructive" }); return; }
                      toast({ title: `${approvable.length} empresa(s) aprovada(s)` });
                      await load();
                      navigate("/pagamentos");
                    } : undefined}
                    onReturn={isDiretor ? async () => {
                      const approvable = groups.filter(g => String(g.status) === "aguardando_aprovacao");
                      if (approvable.length === 0) { toast({ title: "Nenhuma empresa aguardando aprovação", variant: "destructive" }); return; }
                      setApprovalBusy(true);
                      const { error } = await supabase.rpc("return_groups_to_analyst" as "return_groups_to_analyst", {
                        p_payment_id: id!,
                        p_group_ids: approvable.map(g => g.id),
                        p_author_id: user!.id,
                        p_author_name: profiles[user!.id] ?? user!.email ?? "Diretor",
                        p_message: "Devolvido pelo diretor via briefing de aprovação.",
                        p_lot_level: true,
                      } as never);
                      setApprovalBusy(false);
                      if (error) { toast({ title: "Falha ao devolver", description: error.message, variant: "destructive" }); return; }
                      toast({ title: `${approvable.length} empresa(s) devolvida(s) ao analista` });
                      await load();
                      navigate("/pagamentos");
                    } : undefined}
                  />}
                  <PreAnalysisScoreCard payment={payment} />
                </div>
                {id && (
                  <div className="hidden md:block">
                    <DoctorAnomalyAlerts paymentId={id} analysisMode={(payment as any)?.analysis_mode} />
                  </div>
                )}
              </div>


              {/* Alertas assistenciais — 1/3 no desktop. Escondido quando não há alertas
                  para devolver espaço vertical na tela do lote. */}
              {hasAssistanceAlerts && (
                <Card
                  className="shadow-card md:col-span-1 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setIsAssistanceAlertsOpen(true)}
                  role="button"
                  title="Ver detalhamento e exportar"
                >
                  <CardContent className="p-4 text-sm space-y-2 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Alertas assistenciais</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-warning">{totalRuleAlerts} total</span>
                        {totalRuleValue > 0 && (
                          <span className="text-sm font-bold text-red-600">· {formatCurrency(totalRuleValue)} em risco</span>
                        )}
                      </div>
                    </div>
                    {totalRiskWithConflicts > totalRuleValue && (
                      <div className="text-xs text-muted-foreground">
                        incluindo outros lotes: <span className="text-red-600 font-semibold text-sm">{formatCurrency(totalRiskWithConflicts)}</span>
                      </div>
                    )}
                    <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                      {sortedRules.slice(0, 6).map(([name, n]) => (
                        <li key={name} className="flex items-center justify-between gap-2">
                          <span className="truncate flex-1 text-sm" title={name}>{name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-semibold text-warning">{n}</span>
                            {ruleValues.get(name) != null && (
                              <span className="text-sm text-red-600 font-semibold">{formatCurrency(ruleValues.get(name)!)}</span>
                            )}
                          </div>
                        </li>
                      ))}
                      {sortedRules.length > 6 && (
                        <li className="text-xs text-muted-foreground italic">+ {sortedRules.length - 6} regra(s)</li>
                      )}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        {!isConfeccao && <PhaseSummary payment={payment} groups={groups} invoices={invoices} />}



        {/* Banner de questionamento — destaque crítico no topo. Mostra a última
            pergunta do recebedor que ainda não recebeu resposta do analista. */}
        {(() => {
          // Agrupa por invoice_id e pega o último de cada thread.
          const byInvoice = new Map<string, InvoiceQuestion[]>();
          questions.forEach((q) => {
            const list = byInvoice.get(q.invoice_id) ?? [];
            list.push(q);
            byInvoice.set(q.invoice_id, list);
          });
          const pending: { invoice_id: string; q: InvoiceQuestion }[] = [];
          byInvoice.forEach((list, invoice_id) => {
            const last = list[list.length - 1];
            if (last && last.author_type === "recebedor") pending.push({ invoice_id, q: last });
          });
          if (pending.length === 0) return null;
          return (
            <Card className="shadow-card border-warning/60 bg-warning-soft/60">
              <CardContent className="p-4 flex items-start gap-3">
                <MessageCircleQuestion className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <p className="text-sm font-semibold text-warning-text">
                      {pending.length === 1
                        ? "Recebedor enviou um questionamento sobre a NF"
                        : `${pending.length} questionamentos abertos sobre a NF`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Aguardando resposta do analista. Responda pelo botão abaixo — o recebedor é notificado por e-mail.
                    </p>
                  </div>
                  <ul className="space-y-1.5">
                    {pending.slice(0, 3).map(({ invoice_id, q }) => {
                      const inv = invoices.find((i) => i.id === invoice_id);
                      return (
                        <li key={q.id} className="rounded-md border border-warning/30 bg-background/60 p-2.5 text-xs">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            {q.author_name ?? "Recebedor"}
                            {inv?.company_name ? ` · ${inv.company_name}` : ""}
                            {" · "}{formatDate(q.created_at)}
                          </p>
                          <p className="whitespace-pre-wrap break-words mb-2 line-clamp-3">{q.message}</p>
                          <Button size="sm" variant="outline" onClick={() => setOpenQuestionInvoiceId(invoice_id)}>
                            <MessageCircleQuestion className="h-3.5 w-3.5 mr-1.5" /> Responder
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </CardContent>
            </Card>
          );
        })()}


          {showAnalystActions && groupsPendingAnalyst.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-info-soft/90 border border-info/40 rounded-lg text-sm flex-wrap dark:bg-info-soft dark:border-info/50">
              <span className="w-2 h-2 rounded-full bg-info flex-shrink-0" />
              <span className="font-semibold text-info-text">Concluir análise em massa</span>
              <span className="text-info-text/80 text-xs">
                — {groupsPendingAnalyst.length} empresa(s) ainda em revisão. Selecione várias e finalize de uma vez.
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || bulkConcluding}
                onClick={() => {
                  setBulkConcludeSelected(new Set(groupsPendingAnalyst.map((g) => g.id)));
                  setBulkConcludeOpen(true);
                }}
                className="ml-auto h-7 px-3 text-xs"
              >
                <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                Selecionar empresas
              </Button>
            </div>
          )}

          {showAnalystActions && groups.some((g) => g.status === "revisao_pos_aprovacao") && (
            <div className="flex items-center gap-3 px-4 py-2 bg-teal-50 dark:bg-teal-950/30 border border-teal-300/60 dark:border-teal-800 rounded-lg text-sm flex-wrap">
              <span className="w-2 h-2 rounded-full bg-teal-600 flex-shrink-0" />
              <span className="font-medium text-teal-900 dark:text-teal-200">Liberar pedidos de NF em massa</span>
              <span className="text-muted-foreground text-xs">
                — {groups.filter((g) => g.status === "revisao_pos_aprovacao").length} empresa(s) aprovadas pelo diretor. Selecione e dispare os pedidos de uma vez.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkReleaseOpen(true)}
                className="ml-auto h-7 px-3 text-xs border-teal-400 text-teal-800 hover:bg-teal-100 dark:text-teal-200 dark:hover:bg-teal-900/40"
              >
                <Mail className="h-3.5 w-3.5 mr-1.5" />
                Selecionar empresas
              </Button>
            </div>
          )}

          <Dialog open={bulkConcludeOpen} onOpenChange={(o) => { if (!o) { setBulkConcludeOpen(false); } }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Concluir análise em massa</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground text-xs">
                  Marque as empresas que você já revisou. Elas serão marcadas como
                  <strong> concluídas pelo analista</strong> e ficarão prontas para envio ao validador.
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => setBulkConcludeSelected(new Set(groupsPendingAnalyst.map((g) => g.id)))}
                  >
                    Marcar todas
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => setBulkConcludeSelected(new Set())}
                  >
                    Desmarcar todas
                  </Button>
                  <span className="ml-auto text-muted-foreground">
                    {bulkConcludeSelected.size} de {groupsPendingAnalyst.length} selecionada(s)
                  </span>
                </div>
                <ul className="max-h-72 overflow-y-auto rounded border border-border bg-muted/20 p-2 space-y-1">
                  {groupsPendingAnalyst.map((g) => {
                    const checked = bulkConcludeSelected.has(g.id);
                    return (
                      <li key={g.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50">
                        <Checkbox
                          id={`bulk-${g.id}`}
                          checked={checked}
                          onCheckedChange={(v) => {
                            setBulkConcludeSelected((prev) => {
                              const n = new Set(prev);
                              if (v) n.add(g.id); else n.delete(g.id);
                              return n;
                            });
                          }}
                        />
                        <label htmlFor={`bulk-${g.id}`} className="flex-1 text-xs cursor-pointer">
                          <span className="font-medium">{g.company_name}</span>
                          <span className="text-muted-foreground ml-2">
                            {g.items_count ?? 0} itens · {formatCurrency(Number((g as any).liquido_total ?? g.total_amount ?? 0))}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setBulkConcludeOpen(false)} disabled={bulkConcluding}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={bulkConcluding || bulkConcludeSelected.size === 0}
                    onClick={() => bulkConcludeAnalysis(Array.from(bulkConcludeSelected))}
                  >
                    {bulkConcluding ? "Concluindo..." : `Concluir ${bulkConcludeSelected.size} empresa(s)`}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {canSendForValidation && (() => {
            const divergentGroups = groupsReadyToSend.filter((g) => {
              const inv = invoices.filter((i) =>
                i.received_amount != null &&
                ((i.company_id && g.company_id && i.company_id === g.company_id) ||
                 (i.company_name ?? "").trim().toLowerCase() === g.company_name.trim().toLowerCase()),
              );
              if (inv.length === 0) return false;
              const total = inv.reduce((a, x) => a + Number(x.received_amount ?? 0), 0);
              return Math.abs(Number((total - Number(g.total_amount)).toFixed(2))) > 0;
            });
            const blocked = divergentGroups.length > 0;
            const onlyPendentes = groupsReadyToSend.length === 0 && groupsPendingAnalyst.length > 0;
            return (
              <div className={`flex items-center gap-3 px-4 py-2 ${onlyPendentes ? "bg-warning-soft/90 border-warning/50 dark:bg-warning-soft dark:border-warning/60" : "bg-success-soft/90 border-success/40 dark:bg-success-soft dark:border-success/50"} border rounded-lg text-sm flex-wrap`}>
                <span className={`w-2 h-2 rounded-full ${onlyPendentes ? "bg-warning" : "bg-success"} flex-shrink-0`} />
                <span className={`font-semibold ${onlyPendentes ? "text-warning-text" : "text-success-text"}`}>
                  {onlyPendentes ? "Lote pronto para envio em massa" : "Empresas concluídas pelo analista"}
                </span>
                <span className={`text-xs ${onlyPendentes ? "text-warning-text/80" : "text-success-text/80"}`}>
                  {onlyPendentes
                    ? `— ${groupsPendingAnalyst.length} empresa(s) ainda em revisão`
                    : `— ${groupsReadyToSend.length} pronta(s) para envio${groupsPendingAnalyst.length > 0 ? ` · ${groupsPendingAnalyst.length} ainda pendente(s)` : ""}`}
                </span>
                {blocked && (
                  <span className="text-destructive text-xs flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {divergentGroups.length} com NF divergente
                  </span>
                )}
                <Button
                  size="sm"
                  disabled={busy || blocked}
                  onClick={() => sendForValidation()}
                  title={
                    onlyPendentes
                      ? `Abrir diálogo para concluir e enviar as ${groupsPendingAnalyst.length} empresa(s) do lote.`
                      : `${groupsReadyToSend.length} empresa(s) serão enviadas para validação.`
                  }
                  className="ml-auto h-7 px-3 text-xs"
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  {onlyPendentes ? "Concluir e enviar lote" : "Enviar lote para validação"}
                </Button>
              </div>
            );
          })()}


          <AlertDialog open={!!pendingSendState} onOpenChange={(o) => { if (!o) setPendingSendState(null); }}>
            <AlertDialogContent className="max-w-lg w-[calc(100vw-2rem)] sm:w-full">
              <AlertDialogHeader>
                <AlertDialogTitle className="break-words">Enviar lote com empresas pendentes?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm min-w-0">
                    <p className="break-words">
                      {pendingSendState?.pendentes.length} empresa(s) ainda não foram concluídas pelo analista:
                    </p>
                    <ul className="max-h-40 overflow-y-auto overflow-x-hidden rounded border border-border bg-muted/30 p-2 text-xs space-y-1">
                      {pendingSendState?.pendentes.map((g) => (
                        <li key={g.id} className="break-words leading-snug">• {g.company_name}</li>
                      ))}
                    </ul>
                    <p className="break-words">
                      {(pendingSendState?.prontos.length ?? 0) > 0
                        ? `Você quer concluir essas empresas e enviar tudo junto, ou enviar apenas as ${pendingSendState?.prontos.length} já prontas?`
                        : "Nenhuma empresa foi marcada como concluída ainda. Deseja concluir e enviar todas de uma vez?"}
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
                <AlertDialogCancel className="w-full sm:w-auto whitespace-normal text-center h-auto min-h-10 py-2">Cancelar</AlertDialogCancel>
                {(pendingSendState?.prontos.length ?? 0) > 0 && (
                  <AlertDialogAction
                    className="bg-muted text-foreground hover:bg-muted/80 w-full sm:w-auto whitespace-normal text-center h-auto min-h-10 py-2"
                    onClick={async () => {
                      const prontos = pendingSendState?.prontos ?? [];
                      setPendingSendState(null);
                      await doSendForValidation(prontos);
                    }}
                  >
                    Enviar apenas {pendingSendState?.prontos.length} pronta(s)
                  </AlertDialogAction>
                )}


                <AlertDialogAction
                  className="w-full sm:w-auto whitespace-normal text-center h-auto min-h-10 py-2"
                  onClick={async () => {
                    const prontos = pendingSendState?.prontos ?? [];
                    const pendentes = pendingSendState?.pendentes ?? [];
                    setPendingSendState(null);
                    if (pendentes.length > 0) {
                      setBusy(true);
                      await autoClaim();
                      const { data, error } = await supabase.rpc("bulk_conclude_analyst_groups", {
                        _payment_id: id!,
                        _group_ids: pendentes.map((g) => g.id),
                      });
                      setBusy(false);
                      if (error) {
                        toast({ title: "Falha ao concluir empresas pendentes", description: error.message, variant: "destructive" });
                        return;
                      }
                      const row = Array.isArray(data) ? data[0] : data;
                      if (Number(row?.updated_count ?? 0) === 0) {
                        toast({
                          title: "Nenhuma empresa foi concluída",
                          description: row?.message ?? "Verifique permissões e status das empresas.",
                          variant: "destructive",
                        });
                        return;
                      }
                    }
                    const all = [
                      ...prontos,
                      ...pendentes.map((g) => ({ ...g, status: "concluida_analista" as PaymentStatus })),
                    ];
                    await doSendForValidation(all);
                  }}

                >
                  Concluir e enviar todas ({(pendingSendState?.prontos.length ?? 0) + (pendingSendState?.pendentes.length ?? 0)})
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div data-quarantine-anchor="true" className="space-y-3">
            {id && <UnmatchedItemsPanel paymentId={id} onChanged={load} />}
            {id && <UnregisteredCompaniesPanel paymentId={id} onChanged={load} />}
          </div>
          {isAnalista && id && ["rascunho","em_analise_ia","revisao_analista","concluida_analista","devolvido_analista"].includes(String(payment.status)) && (
            <ProductionValidationPanel
              paymentId={id}
              currentUserId={user!.id}
              onChanged={load}
            />
          )}

          {skippedCompanies.length > 0 && (
            <Alert variant="warning" className="relative">
              <AlertTriangle className="h-4 w-4" />
              <button
                type="button"
                onClick={() => setSkippedCompanies([])}
                className="absolute right-3 top-3 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Fechar aviso"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <AlertTitle>{skippedCompanies.length} empresa(s) puladas na reanálise</AlertTitle>
              <AlertDescription>
                <p className="mb-1 text-xs">
                  Estas empresas já foram concluídas ou estão em fases posteriores e não foram reanalisadas:
                </p>
                <ul className="text-xs space-y-0.5 mb-2">
                  {skippedCompanies.slice(0, 5).map((s, i) => (
                    <li key={i}>• <strong>{s.company_name}</strong> ({humanizeCompanyGroupStatus(s.status)})</li>
                  ))}
                  {skippedCompanies.length > 5 && (
                    <li className="text-muted-foreground italic">e mais {skippedCompanies.length - 5} empresa(s)…</li>
                  )}
                </ul>
                <p className="text-xs">
                  Para reanalisar uma delas, abra a empresa e clique em <strong>"Reabrir análise"</strong>.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Pivot histórico — só aparece em Compacto/Executivo. Em Detalhe retorna null. */}
          {id && payment.competence_month && (
            <PaymentPivotSection
              paymentId={id}
              paymentReference={payment.reference}
              competenceDate={String(payment.competence_month).slice(0, 10)}
              variant={viewMode}
            />
          )}

          {/* CONFECÇÃO — Auditoria do motor de cálculo a nível de lote.
              Mostra cobertura (com/sem regra) e camadas aplicadas para que
              o analista valide antes de finalizar a confecção. */}
          {isConfeccao && items.length > 0 && (
            <ConfeccaoAuditPanel items={items} rulesIndex={rulesIndex} />
          )}


          {/* Footer de ações em lote — Questionar / Devolver / Aprovar */}
          {id && canUseBatchActions && (
              <PaymentBatchActionsFooter
                paymentId={id}
                groups={groups}
                currentUserId={user!.id}
                currentUserName={profiles[user!.id] ?? user!.email ?? "Usuário"}
                actorRole={batchActionActorRole}
                items={items.map((i) => ({
                  ai_status: i.ai_status,
                  validation_findings: i.validation_findings,
                  company_id: i.company_id,
                  is_cancelled: (i as any).is_cancelled,
                  package_absorbed: (i as any).package_absorbed,
                }))}
                onDone={load}
                onReviewPendencias={() => {
                  // Limpa filtros conflitantes e aplica o filtro que mostra
                  // itens reprovados/alerta (o mesmo bucket que dispara o gate).
                  setItemSearch("");
                  setCompanySearch("");
                  setOnlyRegIssues(false);
                  setMarkerFilter("all");
                  setFinancialFilters({ proposedGlosas: false, appliedDebits: false, appliedCredits: false });
                  setCriticalFilter("divergent");
                  // Rola até a seção de itens.
                  setTimeout(() => {
                    document.querySelector('[data-items-section="true"]')
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 100);
                }}
              />
            )}

          {/* Registro de validação/aprovação externa — disponível para analista/admin
              durante a transição ou como backup quando a decisão acontece fora do
              sistema (e-mail/WhatsApp). O caminho primário continua sendo a ação
              direta do supervisor/diretor no app. */}
          {id && (isAnalista || isAdmin) && !canUseBatchActions && (
            (() => {
              const stage: "validation" | "approval" | null =
                groups.some((g) => g.status === "aguardando_aprovacao") ? "approval"
                : groups.some((g) => g.status === "aguardando_validacao") ? "validation"
                : null;
              if (!stage) return null;
              return (
                <Card className="shadow-card border-dashed border-muted-foreground/30 bg-muted/20">
                  <CardContent className="p-3 flex flex-col md:flex-row md:items-center gap-2 text-xs">
                    <span className="text-muted-foreground md:mr-auto">
                      <strong>Backup:</strong> houve {stage === "approval" ? "aprovação" : "validação"} fora do sistema (e-mail/WhatsApp)?
                      Registre aqui para refletir no fluxo. Caminho primário continua sendo a ação direta no app pelo {stage === "approval" ? "diretor" : "supervisor"}.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExternalRegistrationOpen(stage)}
                    >
                      <MailCheck className="h-4 w-4 mr-2" />
                      Registrar {stage === "approval" ? "aprovação" : "validação"} externa
                    </Button>
                  </CardContent>
                </Card>
              );
            })()
          )}
          {id && externalRegistrationOpen && (
            <RegisterExternalApprovalDialog
              open={!!externalRegistrationOpen}
              onOpenChange={(v) => setExternalRegistrationOpen(v ? externalRegistrationOpen : null)}
              paymentId={id}
              groups={groups}
              stage={externalRegistrationOpen}
              registeredById={user!.id}
              onDone={load}
            />
          )}

        {/* Busca dentro do detalhe — filtra grupos/itens por PJ, médico,
            atendimento, centro de custos, especialidade ou descrição.
            Ocultado na visão Executivo (diretor) — esta visão prioriza
            apenas o pivot histórico e ações de aprovação. */}
        {viewMode !== "executivo" && (
        <>
        {/* Badge sempre visível do modo de análise — evita confusão entre
            "Modo Padrão" e "Modo Confecção" (que mudam radicalmente o motor). */}
        {payment.analysis_mode && payment.analysis_mode !== "confeccao" && payment.analysis_mode !== "empresa_prioritaria" && (
          <Card className="shadow-card border-border bg-muted/30">
            <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
              <div className="flex items-center gap-2 flex-1">
                <span className="font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                  Modo de análise
                </span>
                <span className="px-2 py-0.5 rounded bg-background border border-border font-medium">
                  {payment.analysis_mode === "padrao" ? "Padrão (verificação)" : payment.analysis_mode === "isolado" ? "Isolado" : payment.analysis_mode}
                </span>
                <span className="text-muted-foreground hidden sm:inline">
                  · O sistema verifica os valores que você já calculou.
                </span>
              </div>
              {isAnalista
                && payment.analysis_mode === "padrao"
                && (payment.status === "em_analise_ia"
                    || payment.status === "revisao_analista"
                    || payment.status === "devolvido_analista"
                    || payment.status === "rascunho") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={convertToConfeccao}
                  disabled={convertingMode}
                  className="gap-1.5 shrink-0"
                  title="Trocar para Confecção: o sistema calcula o repasse pelas regras em vez de verificar divergências."
                >
                  <Calculator className="h-3.5 w-3.5" />
                  {convertingMode ? "Convertendo…" : "Converter para Confecção"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
        {payment.analysis_mode === "empresa_prioritaria" && (
          <Card className="shadow-card border-warning/30 bg-warning-soft/30">
            <CardContent className="p-3 text-xs flex items-start gap-2">
              <span className="font-semibold uppercase tracking-wide text-warning-text shrink-0">
                Modo empresa prioritária
              </span>
              <span className="text-muted-foreground">
                Mostrando apenas itens com alerta ou reprovação. Empresas e atendimentos sem divergência foram ocultados desta visão.
              </span>
            </CardContent>
          </Card>
        )}
        {payment.analysis_mode === "confeccao" && (
          <Card className="shadow-card border-0 ring-1 ring-amber-500/40 bg-gradient-to-r from-amber-500/10 via-background to-background relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500" aria-hidden />
            <CardContent className="p-4 pl-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-start gap-3 flex-1">
                <div className="rounded-lg bg-amber-500/20 ring-1 ring-amber-500/40 p-2 flex-shrink-0">
                  <Calculator className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-300 tracking-wide uppercase">Modo confecção</p>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40">
                      Sem confronto hospitalar
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    O sistema calculou o repasse pelas regras cadastradas. Revise os valores e,
                    quando estiver pronto, encaminhe para análise — só então o motor confronta com a base hospitalar.
                  </p>
                </div>
              </div>
              {isAnalista && (
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setExportPickerOpen(true)} className="gap-1.5 border-amber-500/40 hover:bg-amber-500/10">
                    <Download className="h-4 w-4" />
                    Exportar xlsx
                  </Button>
                  <Button
                    size="sm"
                    onClick={sendConfeccaoForAnalysis}
                    disabled={busy}
                    className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Encaminhar para análise
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {payment.analysis_mode === "manual" && (
          <Card className="shadow-card border-0 ring-1 ring-amber-500/40 bg-gradient-to-r from-amber-500/10 via-background to-background relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500" aria-hidden />
            <CardContent className="p-4 pl-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-start gap-3 flex-1">
                <div className="rounded-lg bg-amber-500/20 ring-1 ring-amber-500/40 p-2 flex-shrink-0">
                  <Calculator className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-700 dark:text-amber-300 tracking-wide uppercase">Lançamento manual</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lote alimentado a partir de planilha externa. O motor de regras não roda — o valor de cada item é o informado pelo analista. A composição (rubricas) e a planilha-fonte ficam anexadas ao item para auditoria.
                  </p>
                </div>
              </div>
              {isAnalista && (payment.status === "rascunho" || payment.status === "em_analise_ia") && (
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/pagamentos/${payment.id}/manual`)}
                    className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Editar lançamentos
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row flex-wrap items-stretch md:items-center gap-2 md:gap-3">
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto flex-1">
              <div className="relative w-full sm:w-[280px]">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Filtrar empresa (PJ)..."
                  className="pl-9 pr-9"
                />
                {companySearch && (
                  <button
                    type="button"
                    onClick={() => setCompanySearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Limpar filtro de empresa"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="relative flex-1 min-w-[280px]">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Buscar médico, paciente, atendimento, CC..."
                  className="pl-9 pr-9"
                />
                {itemSearch && (
                  <button
                    type="button"
                    onClick={() => setItemSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Limpar busca"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {!isConfeccao && (
            <div className="flex items-center gap-1.5 p-1.5 bg-muted/50 rounded-full border w-full md:w-fit overflow-x-auto flex-nowrap [&_button]:rounded-full [&_[role=combobox]]:rounded-full">
              <Button
                variant={criticalFilter === "all" ? "default" : "ghost"}
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setCriticalFilter("all")}
              >
                Todos
              </Button>
              <Button
                variant={criticalFilter === "no_rule" ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5",
                  criticalFilter === "no_rule" ? "bg-amber-500 hover:bg-amber-600 text-white" : "text-amber-600"
                )}
                onClick={() => setCriticalFilter("no_rule")}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-current" />
                Sem regra
              </Button>
              <Button
                variant={criticalFilter === "divergent" ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5",
                  criticalFilter === "divergent" ? "bg-destructive hover:bg-destructive/90 text-white" : "text-destructive"
                )}
                onClick={() => setCriticalFilter("divergent")}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-current" />
                Divergente
              </Button>
              <Button
                variant={criticalFilter === "validation" ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5",
                  criticalFilter === "validation" ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "text-indigo-600"
                )}
                onClick={() => setCriticalFilter("validation")}
                title="Mostrar apenas empresas com itens que dispararam regras de validação assistencial"
              >
                <span className="leading-none">⊛</span>
                Alerta assistencial
              </Button>
              <Select 
                value={criticalFilter === "approved" || criticalFilter === "approved_strict" ? criticalFilter : undefined} 
                onValueChange={(v) => setCriticalFilter(v as any)}
              >
                <SelectTrigger 
                  className={cn(
                    "h-8 w-[160px] text-xs gap-1.5",
                    (criticalFilter === "approved" || criticalFilter === "approved_strict") ? "bg-success hover:bg-success/90 text-white" : "text-success border-success/30"
                  )}
                >
                  <SelectValue placeholder="Aprovados" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved" className="text-xs">Aprovados (flexível)</SelectItem>
                  <SelectItem value="approved_strict" className="text-xs">Aprovados (sem pendências)</SelectItem>
                </SelectContent>
              </Select>
              
              {hasRole("analista") || hasRole("admin") || hasRole("diretor") ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs gap-1.5 border-dashed"
                    onClick={() => setIsReportOpen(true)}
                  >
                    <BarChart3 className="h-4 w-4" />
                    Relatório
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs gap-1.5 border-dashed"
                    onClick={() => setIsBatchExportOpen(true)}
                    title="Exportar lote inteiro em XLSX, CSV ou PDF, com seleção de empresas"
                  >
                    <Download className="h-4 w-4" />
                    Exportar lote
                  </Button>
                </>
              ) : null}

              <Button
                variant={onlyRegIssues ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5 border-dashed",
                  onlyRegIssues ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500" : "text-amber-700 border-amber-400/60",
                )}
                onClick={() => setOnlyRegIssues((v) => !v)}
                title="Mostrar apenas itens com médico não cadastrado ou PJ sem vínculo no cadastro"
              >
                <AlertTriangle className="h-4 w-4" />
                Pend. cadastro {regIssueItemIds.size > 0 && `(${regIssueItemIds.size})`}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={Object.values(financialFilters).some(Boolean) ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-3 text-xs gap-1.5 border-dashed"
                    title="Filtrar empresas deste lote por glosas, débitos e créditos lançados"
                  >
                    <Filter className="h-4 w-4" />
                    Financeiro
                    {Object.values(financialFilters).filter(Boolean).length > 0 && ` (${Object.values(financialFilters).filter(Boolean).length})`}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Financeiro do lote</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={financialFilters.proposedGlosas}
                    onCheckedChange={(checked) => setFinancialFilters((prev) => ({ ...prev, proposedGlosas: checked === true }))}
                    className="text-xs"
                  >
                    Com glosas em aberto
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={financialFilters.appliedDebits}
                    onCheckedChange={(checked) => setFinancialFilters((prev) => ({ ...prev, appliedDebits: checked === true }))}
                    className="text-xs"
                  >
                    Com débitos aplicados
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={financialFilters.appliedCredits}
                    onCheckedChange={(checked) => setFinancialFilters((prev) => ({ ...prev, appliedCredits: checked === true }))}
                    className="text-xs"
                  >
                    Com créditos aplicados
                  </DropdownMenuCheckboxItem>
                  {Object.values(financialFilters).some(Boolean) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-xs"
                        onSelect={() => setFinancialFilters({ proposedGlosas: false, appliedDebits: false, appliedCredits: false })}
                      >
                        Limpar financeiro
                      </DropdownMenuItem>
                    </>
                  )}


                </DropdownMenuContent>
              </DropdownMenu>

              {/* Filtro pessoal — só você vê seus marcadores */}
              <Select value={markerFilter} onValueChange={(v) => setMarkerFilter(v as any)}>
                <SelectTrigger
                  className={cn(
                    "h-8 w-auto gap-1.5 border-dashed text-xs px-3",
                    markerFilter !== "all" && "bg-muted",
                  )}
                  title="Filtrar pelos seus marcadores pessoais (só você vê)"
                >
                  <SelectValue placeholder="Meus marcadores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos os marcadores</SelectItem>
                  <SelectItem value="pinned" className="text-xs">📌 Fixados por mim</SelectItem>
                  <SelectItem value="waiting" className="text-xs">⏳ Aguardando info</SelectItem>
                  <SelectItem value="reviewed" className="text-xs">✓ Já revisei</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}
          </div>
          
          {(criticalFilter !== "all" || Object.values(financialFilters).some(Boolean) || onlyRegIssues || markerFilter !== "all" || itemSearch.trim() || companySearch.trim() || payment.analysis_mode === "empresa_prioritaria") && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md border border-dashed flex-wrap">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 min-w-0">
                {(() => {
                  const parts: string[] = [];
                  if (criticalFilter === "no_rule") parts.push("Sem regra");
                  if (criticalFilter === "divergent") parts.push("Divergente");
                  if (criticalFilter === "validation") parts.push("Alerta assistencial");
                  if (criticalFilter === "approved") parts.push("Aprovados (flexível)");
                  if (criticalFilter === "approved_strict") parts.push("Aprovados (sem pendências)");
                  if (financialFilters.proposedGlosas) parts.push("Com glosas em aberto");
                  if (financialFilters.appliedDebits) parts.push("Com débitos aplicados");
                  if (financialFilters.appliedCredits) parts.push("Com créditos aplicados");
                  if (onlyRegIssues) parts.push("Pend. cadastro");
                  if (markerFilter !== "all") parts.push(`Marcador: ${markerFilter}`);
                  if (itemSearch.trim()) parts.push(`Busca: "${itemSearch.trim()}"`);
                  if (companySearch.trim()) parts.push(`Empresa: "${companySearch.trim()}"`);
                  if (parts.length === 0 && payment.analysis_mode === "empresa_prioritaria") return "Modo empresa prioritária: apenas divergências visíveis.";
                  return `Filtros ativos: ${parts.join(" + ")}.`;
                })()}
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs shrink-0"
                onClick={() => {
                  setCriticalFilter("all");
                  setFinancialFilters({ proposedGlosas: false, appliedDebits: false, appliedCredits: false });
                  setOnlyRegIssues(false);
                  setMarkerFilter("all");
                  setItemSearch("");
                  setCompanySearch("");
                }}
              >
                Limpar filtros
              </Button>
            </div>
          )}
        </div>

          <TooltipProvider delayDuration={150}>
            <CompanyListLegend />
            {(() => {
              const sqItem = itemSearch.trim().toLowerCase();
              const sqCompany = companySearch.trim().toLowerCase();
              
              const itemMatches = (it: PaymentItemRowType) => {
                const matchesCompany = !sqCompany || (it.company_name ?? "").toLowerCase().includes(sqCompany);
                if (!matchesCompany) return false;

                const matchesSearch = !sqItem || [
                  it.doctor_name,
                  it.doctor_role,
                  it.attendance_number,
                  it.cost_center_code,
                  it.description,
                  it.procedure_code,
                  it.procedure_name,
                  it.agreement_text,
                  ...(Array.isArray(it.raw_data) ? [] : Object.values(it.raw_data ?? {}).map(String)),
                ]
                  .filter(Boolean)
                  .join(" \u2022 ")
                  .toLowerCase()
                  .includes(sqItem);

                if (!matchesSearch) return false;

                if (onlyRegIssues && !regIssueItemIds.has(it.id)) return false;

                // Filtro de status crítico
                if (criticalFilter === "no_rule") {
                  return it.ai_findings?.matched_priority === "sem_regra";
                }
                if (criticalFilter === "divergent") {
                  // Bônus é bonificação — não conta como divergência de repasse.
                  const isBonusLine = (it as any).tipo_linha === "complemento_bonus";
                  if (isBonusLine) return false;
                  return it.ai_status === "reprovado" || it.ai_status === "alerta";
                }
                if (criticalFilter === "validation") {
                  const f = (it as unknown as { validation_findings?: unknown }).validation_findings;
                  return Array.isArray(f) && f.length > 0;
                }
                if (criticalFilter === "approved") {
                  // Flexível: status aprovado (pode ter alertas informativos ou justificativas)
                  return it.ai_status === "aprovado";
                }
                if (criticalFilter === "approved_strict") {
                  // Sem pendências: status aprovado E sem alertas E sem notas E sem divergência
                  const hasAlerts = (it.ai_findings?.alerts?.length ?? 0) > 0;
                  const hasAiNote = !!it.ai_findings?.engine?.ai_note;
                  const hasDiff = (it.ai_findings?.engine?.diff_pct ?? 0) !== 0;
                  return it.ai_status === "aprovado" && !hasAlerts && !hasAiNote && !hasDiff;
                }

                return true;
              };

              const paymentSpec = ((payment.specialties ?? []) as string[]).join(" ").toLowerCase();
              const hasFinancialFilter = Object.values(financialFilters).some(Boolean);
              const groupMatchesFinancialFilter = (g: typeof groups[number]) => {
                if (!hasFinancialFilter) return true;
                const flags = g.company_id ? financialFlagsByCompany[g.company_id] : null;
                if (financialFilters.proposedGlosas && !flags?.proposedGlosas) return false;
                if (financialFilters.appliedDebits && !flags?.appliedDebits) return false;
                if (financialFilters.appliedCredits && !flags?.appliedCredits) return false;
                return true;
              };
              const visibleGroups = groups.filter((g) => {
                if (!groupMatchesFinancialFilter(g)) return false;
                // Filtro pessoal de marcador (Fixado / Aguardando info / Já revisei).
                if (markerFilter !== "all") {
                  const m = privateNotes[g.id]?.marker ?? null;
                  if (m !== markerFilter) return false;
                }
                const sqItem = itemSearch.trim().toLowerCase();
                const sqComp = companySearch.trim().toLowerCase();
                
                const nameMatchesCompanySearch = !sqComp || g.company_name?.toLowerCase().includes(sqComp);
                if (!nameMatchesCompanySearch) return false;

                const nameMatchesItemSearch = !sqItem || g.company_name?.toLowerCase().includes(sqItem);
                const specMatchesItemSearch = !sqItem || paymentSpec.includes(sqItem);

                // Pegamos todos os itens deste grupo específico para validações agregadas
                const groupItems = items.filter(
                  (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase()
                );

                // Se houver filtro ativo (exceto "Todos"), o grupo só é visível se satisfizer a condição
                if (criticalFilter === "approved_strict") {
                  // REGRA DE OURO: Para aparecer no "sem pendências", TODOS os itens devem ser aprovados sem ressalvas
                  return groupItems.every((it) => itemMatches(it));
                }

                if (criticalFilter !== "all") {
                  // Para outros filtros (sem regra, divergente, aprovado flexível), 
                  // o grupo aparece se POSSUIR ao menos um item que atenda ao critério.
                  return groupItems.some((it) => itemMatches(it));
                }

                // Sem filtro de status (Todos): decide pela busca no nome ou nos itens
                return nameMatchesItemSearch || specMatchesItemSearch || groupItems.some((it) => itemMatches(it));
              });
              
              const finalSearchTerm = itemSearch.trim() || companySearch.trim() || (criticalFilter !== "all" ? criticalFilter : "") || (hasFinancialFilter ? "financeiro" : "") || (onlyRegIssues ? "regissues" : "") || (markerFilter !== "all" ? "marker" : "");
              if (finalSearchTerm && visibleGroups.length === 0) {
                return (
                  <Card className="shadow-card"><CardContent className="p-8 text-center text-sm text-muted-foreground space-y-3">
                    <p>Nenhum grupo ou item casa com os filtros selecionados.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCriticalFilter("all");
                        setFinancialFilters({ proposedGlosas: false, appliedDebits: false, appliedCredits: false });
                        setOnlyRegIssues(false);
                        setMarkerFilter("all");
                        setItemSearch("");
                        setCompanySearch("");
                      }}
                    >
                      Limpar todos os filtros
                    </Button>
                  </CardContent></Card>
                );
              }
              // Priorização por risco: ordena empresas pelo maior score de atendimento
              // (apenas reordena visualmente; não altera dados nem decisão).
              const groupItemsCache = new Map<string, typeof items>();
              const getGroupItems = (g: typeof visibleGroups[number]) => {
                const cached = groupItemsCache.get(g.id);
                if (cached) return cached;
                const all = items.filter(
                  (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase(),
                );
                groupItemsCache.set(g.id, all);
                return all;
              };
              const groupMaxScore = (g: typeof visibleGroups[number]) =>
                calculateFinancialRisk(getGroupItems(g)).score;
              // Conta alertas assistenciais (validation_findings) na empresa.
              const groupValidationCount = (g: typeof visibleGroups[number]) =>
                getGroupItems(g).reduce((acc, it) => {
                  const f = (it as unknown as { validation_findings?: unknown }).validation_findings;
                  return acc + (Array.isArray(f) ? f.length : 0);
                }, 0);
              // Status "pendentes" por papel — cobrem o ciclo inteiro até a
              // emissão/conciliação da NF. Sempre que o lote troca de etapa,
              // a priorização reaparece automaticamente para o novo dono.
              //   - analista: revisão inicial + ciclo de NF pós-aprovação
              //   - validador: aguardando validação
              //   - diretor: aguardando aprovação
              const pendingStatusesForMe = new Set<string>();
              if (isAnalista) {
                [
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
                ].forEach((s) => pendingStatusesForMe.add(s));
              }
              if (isValidador) {
                ["aguardando_validacao"].forEach((s) => pendingStatusesForMe.add(s));
              }
              if (isDiretor) {
                ["aguardando_aprovacao"].forEach((s) => pendingStatusesForMe.add(s));
              }
              const isPendingForMe = (g: typeof visibleGroups[number]) =>
                pendingStatusesForMe.has(String(g.status));
              // Prioridade por papel + marcadores pessoais:
              // 4 = fixado (📌 pinned) — sobe acima de tudo
              // 3 = pendente para o papel atual
              // 2 = tem alerta assistencial
              // 1 = default
              // 0 = já revisei (desce para o fim, mantém score/alertas)
              // ⏳ "Aguardando Info" é apenas badge informativo — não altera ordem.
              // Prioridade por papel + marcadores pessoais:
              // 4 = fixado (📌 pinned) — sobe acima de tudo
              // 3 = pendente para o papel atual (e não marcado como já revisei)
              // 2 = tem alerta assistencial (e não marcado como já revisei)
              // 1 = default / concluído / ✅ já revisei (mesmo peso da conclusão oficial)
              // ⏳ "Aguardando Info" é apenas badge informativo — não altera ordem.
              const priorityOf = (g: typeof visibleGroups[number]) => {
                const m = privateNotes[g.id]?.marker ?? null;
                if (m === "pinned") return 4;
                if (m === "reviewed") return 1;
                if (isPendingForMe(g)) return 3;
                if (groupValidationCount(g) > 0) return 2;
                return 1;
              };
              const sortedGroups = [...visibleGroups].sort((a, b) => {
                const pa = priorityOf(a);
                const pb = priorityOf(b);
                if (pa !== pb) return pb - pa;
                return groupMaxScore(b) - groupMaxScore(a);
              });
              return sortedGroups.map((g) => {
              const groupItemsAll = items.filter(
                (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase(),
              );
              const groupNameMatches = sqCompany && g.company_name?.toLowerCase().includes(sqCompany);
              const isErrorOnly = payment.analysis_mode === "empresa_prioritaria" || criticalFilter !== "all";
              const errorOnlyFilter = (it: typeof groupItemsAll[number]) => {
                if (criticalFilter === "no_rule") return it.ai_findings?.matched_priority === "sem_regra";
                if (criticalFilter === "divergent") {
                  const isBonusLine = (it as any).tipo_linha === "complemento_bonus";
                  if (isBonusLine) return false;
                  return it.ai_status === "reprovado" || it.ai_status === "alerta";
                }
                if (criticalFilter === "validation") {
                  const f = (it as unknown as { validation_findings?: unknown }).validation_findings;
                  return Array.isArray(f) && f.length > 0;
                }
                if (criticalFilter === "approved") {
                  return it.ai_status === "aprovado";
                }
                if (criticalFilter === "approved_strict") {
                  const hasAlerts = (it.ai_findings?.alerts?.length ?? 0) > 0;
                  const hasAiNote = !!it.ai_findings?.engine?.ai_note;
                  const hasDiff = (it.ai_findings?.engine?.diff_pct ?? 0) !== 0;
                  return it.ai_status === "aprovado" && !hasAlerts && !hasAiNote && !hasDiff;
                }
                
                const st = (it.ai_status as string) ?? "pendente";
                // Só mostra se for alerta/reprovado. Alertas informativos em itens aprovados não contam como crítico.
                return st === "alerta" || st === "reprovado";
              };
              // Filtro só decide se o card aparece (busca / modo erro-apenas / filtros críticos).
              const matchedItems = (itemSearch.trim() && !groupNameMatches) || sqCompany
                ? groupItemsAll.filter(itemMatches)
                : groupItemsAll;
              const visibleByFilters = isErrorOnly
                ? matchedItems.filter(errorOnlyFilter)
                : matchedItems;
              
              if (itemSearch.trim() && !groupNameMatches && matchedItems.length === 0) return null;
              if (isErrorOnly && visibleByFilters.length === 0) return null;
              const marker = privateNotes[g.id]?.marker ?? null;
              const waitingInfoText = (privateNotes[g.id]?.waiting_info ?? "").trim();
              const markerBadge =
                marker === "pinned"
                  ? { label: "Fixado", cls: "bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning-text))] border-[hsl(var(--warning-soft))]", icon: "📌" }
                  : marker === "waiting"
                  ? { label: waitingInfoText ? `Aguardando: ${waitingInfoText}` : "Aguardando info", cls: "bg-[hsl(var(--info-soft))] text-[hsl(var(--info-text))] border-[hsl(var(--info-soft))]", icon: "⏳" }
                  : marker === "reviewed"
                  ? { label: "Revisado por você", cls: "bg-[hsl(var(--success-soft))] text-[hsl(var(--success-text))] border-[hsl(var(--success-soft))]", icon: "✓" }
                  : null;
              return (
                <div key={g.id} id={`group-${g.id}`} className="scroll-mt-20 space-y-2 relative">
                  {markerBadge && (
                    <div
                      className={`absolute -top-2 right-3 z-10 inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10.5px] font-medium shadow-sm ${markerBadge.cls}`}
                      title={`Marcador pessoal: ${markerBadge.label} (só você vê)`}
                    >
                      <span>{markerBadge.icon}</span>
                      <span>{markerBadge.label}</span>
                    </div>
                  )}
                  <PaymentGroupCard
                    g={g}
                    groupItems={groupItemsAll}
                    searchActive={!!sqCompany}
                    obs={obs}
                    invoices={invoices}
                    questionCount={questionCounts[g.id] ?? 0}
                    canReleaseInvoice={isAnalista}
                    onReleaseInvoice={() => setReleaseGroup(g)}
                    isExpanded={expandedGroups.has(g.id)}
                    onToggleExpanded={() =>
                      setExpandedGroups((prev) => {
                        const n = new Set(prev);
                        n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                        return n;
                      })
                    }
                    isAiOpen={groupAiOpen.has(g.id)}
                    onToggleAiOpen={() =>
                      setGroupAiOpen((prev) => {
                        const n = new Set(prev);
                        n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                        return n;
                      })
                    }
                    hasReconciliationRun={hasReconciliationRun}
                    onOpenConciliation={() => openCompanyConciliation(g.company_name)}
                    onAskQuestion={
                      isAnalista || isValidador || isDiretor
                        ? () => {
                            setAskQuestion({ groupId: g.id, companyName: g.company_name });
                            setThreadsOpen(true);
                          }
                        : undefined
                    }
                  />

                  {expandedGroups.has(g.id) && (
                    <>
                      {(payment as any)?.hospital_id && !isConfeccao && (
                        <GroupReconciliationGate
                          groupId={g.id}
                          hospitalId={(payment as any).hospital_id}
                          compact
                        />
                      )}
                      <PrivateCompanyNote
                        note={privateNotes[g.id]?.note ?? ""}
                        marker={privateNotes[g.id]?.marker ?? null}
                        waitingInfo={privateNotes[g.id]?.waiting_info ?? ""}
                        attachments={privateAttachments[g.id] ?? []}
                        saveStatus={privateSaveStatus[g.id] ?? "idle"}
                        onNoteChange={(v) => setPrivateNote(g.id, v)}
                        onMarkerChange={(m) => setPrivateMarker(g.id, m)}
                        onWaitingInfoChange={(v) => setPrivateWaitingInfo(g.id, v)}
                        onUploadAttachment={(file) => uploadPrivateAttachment(g.id, file)}
                        onDeleteAttachment={(attId) => deletePrivateAttachment(g.id, attId)}
                        onDownloadAttachment={(att) => downloadPrivateAttachment(att)}
                      />
                    </>
                  )}
                </div>
              );
              });
            })()}
          </TooltipProvider>

          <ReleaseInvoiceRequestDialog
            open={!!releaseGroup}
            onOpenChange={(o) => { if (!o) setReleaseGroup(null); }}
            paymentId={id!}
            group={releaseGroup}
            onSuccess={() => { setReleaseGroup(null); load(); }}
          />

          <BulkReleaseInvoiceRequestDialog
            open={bulkReleaseOpen}
            onOpenChange={setBulkReleaseOpen}
            paymentId={id!}
            groups={groups.filter((g) => g.status === "revisao_pos_aprovacao")}
            onSuccess={() => { setBulkReleaseOpen(false); load(); }}
          />
        </>
        )}


          {/* (Footer Executivo foi movido para antes dos filtros operacionais) */}



          {payment.status === "aprovado" && (isDiretor || canRequestNf) && (
            <Card className="shadow-card border-success/30">
              <CardHeader><CardTitle className="text-base">Pós-aprovação</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {isDiretor && <Button variant="outline" onClick={() => generatePdf()}><FileDown className="h-4 w-4 mr-2" /> Gerar PDF</Button>}
                {canRequestNf && <Button onClick={sendInvoiceRequest} disabled={busy}><Mail className="h-4 w-4 mr-2" /> Enviar pedido de NF</Button>}
              </CardContent>
            </Card>
          )}

          {/* Lançamento contábil/ERP — analista marca por empresa após NF conciliada. */}
          {isAnalista && groups.some((g) => g.status === "nf_conciliada") && (
            <Card className="shadow-card border-primary/30">
              <CardHeader>
                <CardTitle className="text-base">Lançamento contábil</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Marque cada empresa como lançada após registrar no ERP/contábil. Data e usuário ficam no histórico.
                </p>
                {groups
                  .filter((g) => g.status === "nf_conciliada")
                  .map((g) => (
                    <div
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{g.company_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {g.items_count} itens · {formatCurrency(Number((g as any).liquido_total ?? g.total_amount ?? 0))}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          if (!id || !user) return;
                          setBusy(true);
                          const { error } = await supabase
                            .from("payment_company_groups")
                            .update({ status: "lancado" })
                            .eq("id", g.id);
                          if (error) {
                            toast({ title: "Falha ao marcar como lançado", description: error.message, variant: "destructive" });
                            setBusy(false);
                            return;
                          }
                          await recordObservation({
                            payment_id: id,
                            author_type: "analista",
                            author_id: user.id,
                            message: `[${g.company_name}] Lançado no contábil/ERP por ${user.email ?? user.id}.`,
                            status_from: "nf_conciliada",
                            status_to: "lancado",
                          });
                          toast({ title: "Marcado como lançado", description: g.company_name });
                          await load();
                          setBusy(false);
                        }}
                      >
                        Marcar como lançado
                      </Button>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Gap 4: Confirmar e arquivar — irreversível. Só analista, em grupos lancados. */}
          {isAnalista && groups.some((g) => g.status === "lancado") && (
            <Card className="shadow-card border-muted">
              <CardHeader>
                <CardTitle className="text-base">Confirmar e arquivar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Após confirmar, o lote (ou empresa) sai das filas ativas e fica somente leitura. Ação irreversível.
                </p>
                {groups.filter((g) => g.status === "lancado").map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{g.company_name}</p>
                      <p className="text-xs text-muted-foreground">{g.items_count} itens · {formatCurrency(Number((g as any).liquido_total ?? g.total_amount ?? 0))}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (!id || !user) return;
                        {
                          const ok = await confirmDialog({
                            title: "Arquivar empresa?",
                            description: `Arquivar "${g.company_name}" neste lote.`,
                            details: "Esta ação é irreversível dentro do lote. A empresa não voltará a aparecer nas listas ativas.",
                            confirmText: "Arquivar",
                            cancelText: "Cancelar",
                            tone: "danger",
                          });
                          if (!ok) return;
                        }
                        setBusy(true);
                        const { error } = await supabase
                          .from("payment_company_groups")
                          .update({ status: "arquivado" })
                          .eq("id", g.id);
                        if (error) {
                          toast({ title: "Falha ao arquivar", description: error.message, variant: "destructive" });
                          setBusy(false);
                          return;
                        }
                        await recordObservation({
                          payment_id: id,
                          author_type: "analista",
                          author_id: user.id,
                          message: `[${g.company_name}] Confirmado e arquivado por ${user.email ?? user.id}.`,
                          status_from: "lancado",
                          status_to: "arquivado",
                        });
                        toast({ title: "Arquivado", description: g.company_name });
                        await load();
                        setBusy(false);
                      }}
                    >
                      Confirmar e arquivar
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

        {(isAnalista || isValidador || isDiretor) && adjustmentItems.length > 0 && (
          <div className="px-6 pb-6">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-4">
              Ajustes de Conciliação
            </div>
            <div className="flex flex-col gap-2">
              {adjustmentItems.map((adj) => {
                const isCredit = adj.item_origem === "conciliacao_credito";
                return (
                  <div
                    key={adj.id}
                    className="grid items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg"
                    style={{
                      gridTemplateColumns: "1fr 160px 140px 160px",
                      borderLeft: `3px solid hsl(var(${isCredit ? "--success" : "--destructive"}))`,
                    }}
                  >
                    <div>
                      <div className="text-[12px] font-semibold">{adj.doctor_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {adj.procedure_code ?? "—"} · {adj.company_name ?? "—"}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {adj.origem_referencia ?? "—"}
                    </div>
                    <div
                      className="text-[12px] font-bold text-right tabular-nums"
                      style={{ color: `hsl(var(${isCredit ? "--success" : "--destructive"}))` }}
                    >
                      {Number(adj.gross_amount) > 0 ? "+" : ""}
                      {formatCurrency(Number(adj.gross_amount))}
                    </div>
                    <div
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-center border"
                      style={{
                        background: `hsl(var(${isCredit ? "--success" : "--destructive"}) / 0.1)`,
                        color: `hsl(var(${isCredit ? "--success" : "--destructive"}))`,
                        borderColor: `hsl(var(${isCredit ? "--success" : "--destructive"}) / 0.3)`,
                      }}
                    >
                      {isCredit ? "Crédito conciliação" : "Débito conciliação"}
                    </div>
                  </div>
                );
              })}
              <div className="text-[12px] font-semibold text-right px-4 pt-1">
                Total ajustes: {formatCurrency(adjustmentItems.reduce((s, a) => s + Number(a.gross_amount ?? 0), 0))}
              </div>
            </div>
          </div>
        )}

        {id && (isDiretor || (isAnalista && groups.some((g) => ["revisao_analista", "devolvido_analista", "aguardando_validacao"].includes(g.status)))) && (
          <ExceptionPatternSuggest paymentId={id} />
        )}


        {renderHistoryCard()}
      </div>

      <PaymentInternalQuestionsPanel
        isOpen={isQuestionsPanelOpen}
        onClose={() => setIsQuestionsPanelOpen(false)}
        observations={obs}
        items={items}
        invoices={invoices}
        profiles={profiles}
        itemLabel={itemLabel}
        onChanged={load}
        onOpenQuestionInvoice={setOpenQuestionInvoiceId}
        paymentReference={payment.reference}
      />

      {/* Sheet pra responder ao recebedor — alimentado pelo banner do topo. */}
      <Sheet open={!!openQuestionInvoiceId} onOpenChange={(v) => !v && setOpenQuestionInvoiceId(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Conversa sobre a NF</SheetTitle>
          </SheetHeader>
          {openQuestionInvoiceId && (() => {
            const inv = invoices.find((i) => i.id === openQuestionInvoiceId);
            const initial = questions.filter((q) => q.invoice_id === openQuestionInvoiceId);
            return (
              <div className="mt-4">
                {inv && (
                  <p className="text-xs text-muted-foreground mb-3">
                    {inv.company_name ?? ""} · {inv.recipient_email}
                  </p>
                )}
                <InvoiceQuestionsThread
                  invoiceId={openQuestionInvoiceId}
                  paymentId={id!}
                  initial={initial}
                  onSent={() => load()}
                />
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* RuleTestModal removido — abre em /regras?tab=teste-motor&payment_id=<id> */}


      {payment && (
        <PaymentReportModal
          open={isReportOpen}
          onOpenChange={setIsReportOpen}
          payment={payment}
          items={items}
          groups={groups}
          rulesIndex={rulesIndex}
          analystName={user?.id ? profiles[user.id] : undefined}
          observations={obs}
          profiles={profiles}
        />
      )}

      {payment && (
        <AssistanceAlertsDetailModal
          open={isAssistanceAlertsOpen}
          onOpenChange={setIsAssistanceAlertsOpen}
          items={items as never}
          paymentReference={payment.reference}
        />
      )}


      {payment && (
        <PaymentBatchExportDialog
          open={isBatchExportOpen}
          onOpenChange={setIsBatchExportOpen}
          payment={payment}
          items={items}
          groups={groups}
          rulesIndex={rulesIndex}
          observations={obs}
          profiles={profiles}
        />
      )}

      <BonusPacienteDialog
        open={bonusDialogOpen}
        onOpenChange={setBonusDialogOpen}
        lockedPayment={payment ? { id: payment.id, reference: payment.reference } : null}
        onSaved={() => load()}
      />

      {payment && (
        <BatchConciliationReportDialog
          open={isBatchReconReportOpen}
          onOpenChange={setIsBatchReconReportOpen}
          paymentId={payment.id}
          paymentReference={payment.reference}
        />
      )}

      {/* Gate de motivo de intervenção — bloqueia envio para validação/aprovação
          quando há itens com valor zerado/ausente pagos sem justificativa.
          Reaproveita o fluxo Zeev de tratativa em lote. */}
      <ZeevBulkManualDialog
        open={manualReasonGate.open}
        onOpenChange={(v) => setManualReasonGate((prev) => ({ ...prev, open: v }))}
        paymentId={id ?? ""}
        companyName={manualReasonGate.companyName}
        title="Itens exigem motivo antes da aprovação"
        subtitle="Esses itens foram pagos mas não têm valor base do convênio. Atribua um motivo (Zeev pode sugerir) para liberar o envio."
        items={manualReasonGate.items}
        onApplied={async () => {
          setManualReasonGate({ open: false, items: [], companyName: null });
          await load();
        }}
      />


      {/* Dialog disparado quando o trigger de divergência pedido × regra
          barra o envio analista→validador. Lista TODAS as empresas
          divergentes do lote em uma só tela para liberação/devolução em
          massa (em vez de uma por uma). */}
      <BatchReconciliationBlockDialog
        open={reconBlock !== null && reconTargets.length > 0}
        onOpenChange={(v) => { if (!v) { setReconBlock(null); setReconTargets([]); setReconRetry(null); } }}
        paymentId={id ?? ""}
        targetGroupIds={reconTargets}
        actorRole="analista"
        currentUserId={user?.id ?? ""}
        currentUserName={user?.user_metadata?.full_name ?? user?.email ?? "Analista"}
        onResolved={async () => { setReconBlock(null); setReconTargets([]); setReconRetry(null); await load(); }}
        retryAfterRelease={async () => {
          const retry = reconRetry;
          setReconRetry(null);
          if (retry) await retry();
        }}
      />





      <ExportColumnPickerDialog
        open={exportPickerOpen}
        onOpenChange={setExportPickerOpen}
        allColumns={CONFECCAO_EXPORT_COLUMNS.map(({ id, label, isMoney, width }) => ({ id, label, isMoney, width }))}
        defaultOrder={DEFAULT_CONFECCAO_EXPORT_ORDER}
        onConfirm={(ids) => exportConfeccaoXlsx(ids)}
      />





      {payment && (
        <PaymentConciliationModal
          open={isConciliationOpen}
          onOpenChange={(o) => {
            setIsConciliationOpen(o);
            if (!o) setConciliationCompany(null);
          }}
          paymentId={id!}
          paymentReference={payment.reference || "Lote"}
          paymentItems={items}
          initialCompany={conciliationCompany}
        />
      )}
      {isAnalista && id && user && groups.length > 0 && (
        <ProductionValidationButton
          paymentId={id}
          groups={groups}
          currentUserId={user.id}
          onDone={load}
          open={productionValidationOpen}
          onOpenChange={setProductionValidationOpen}
        />
      )}
      {id && user && (isAnalista || isValidador || isDiretor) && (
        <>
          {!isNfPhase && (
            <QuestionsFab openCount={openThreadsCount} onClick={() => setThreadsOpen(true)} />
          )}
          <ConversationsSheet
            open={threadsOpen}
            onOpenChange={(o) => {
              setThreadsOpen(o);
              if (!o) {
                setAskQuestion(null);
                setInitialThreadId(null);
              }
            }}
            paymentId={id}
            paymentLabel={(payment as any).reference ?? (payment as any).competence_month ?? null}
            paymentStatus={payment.status as string}
            groups={groups.map((g) => ({ id: g.id, company_name: g.company_name }))}
            profiles={profiles}
            currentUserId={user.id}
            currentUserName={profiles[user.id] ?? user.email ?? "Equipe interna"}
            currentRole={isDiretor ? "diretor" : isValidador ? "validador" : "analista"}
            initialCompose={askQuestion}
            onComposeConsumed={() => setAskQuestion(null)}
            initialThreadId={initialThreadId}
            onInitialThreadConsumed={() => setInitialThreadId(null)}
          />
        </>
      )}

    </>
    </HospitalScopedGuard>
  );
};


export default PaymentDetail;
