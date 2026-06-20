import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { recordObservation, type ObservationType } from "@/lib/observations";
import { confirmDialog } from "@/lib/confirm";
import { formatDateTimeBR } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ItemsDataGrid } from "@/components/payment-detail/ItemsDataGrid";
import { MarkSpecialCaseDialog } from "@/components/payment-detail/MarkSpecialCaseDialog";
import { useHasSpecialCaseRules } from "@/components/payment-detail/useHasSpecialCaseRules";

/** Banner indigo no topo do grid de itens com botão para marcar caso especial.
 *  Só renderiza se houver ao menos 1 regra ativa com special_case_filter no hospital. */
function SpecialCaseHeaderBanner({
  paymentId,
  companyId,
  canUse,
}: { paymentId?: string; companyId?: string | null; canUse: boolean }) {
  // Passa companyId para o hook: banner só aparece se houver regra de caso
  // especial REALMENTE vinculada a esta PJ (via target_company_id,
  // target_doctor_id de médico com itens da PJ, ou regra global).
  const hasRules = useHasSpecialCaseRules(paymentId, companyId ?? null);
  if (!paymentId || !canUse || hasRules !== true) return null;
  return (
    <div className="mx-4 mt-3 mb-2 rounded-md border border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/20 dark:border-indigo-900/60 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-start gap-2 min-w-0">
        <Sparkles className="h-4 w-4 mt-0.5 text-indigo-600 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Caso especial</p>
          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80">
            Existe regra cadastrada para casos especiais. Sinalize um atendimento ou item para aplicar a regra correspondente.
          </p>
        </div>
      </div>
      <MarkSpecialCaseDialog paymentId={paymentId} />
    </div>
  );
}


import { AddManualItemDialog } from "@/components/payment-detail/AddManualItemDialog";
import { CompanyHistoryPanel } from "@/components/payment-detail/CompanyHistoryPanel";
import { ConfeccaoAuditPanel } from "@/components/payment-detail/ConfeccaoAuditPanel";
import { PaymentReportModal } from "@/components/payment-detail/PaymentReportModal";
import { PaymentConciliationModal } from "@/components/payment-detail/PaymentConciliationModal";

import { QuestionsFab } from "@/components/payment-detail/QuestionsFab";
import { ConversationsSheet } from "@/components/payment-detail/conversations/ConversationsSheet";
import { DeductionsBanner } from "@/components/payment-detail/DeductionsBanner";
import { FinancialCompositionStrip } from "@/components/payment-detail/FinancialCompositionStrip";
import {
  ReapplyRulesProgressDialog,
  type ReapplyPhase,
  type ReapplyStep,
  type ReapplySnapshot,
  type ReapplyDiff,
  takeSnapshot,
  diffSnapshots,
} from "@/components/payment-detail/ReapplyRulesProgressDialog";
import { MinimumGuaranteeCard } from "@/components/payment-detail/MinimumGuaranteeCard";
import { useFinancialComposition } from "@/hooks/useFinancialComposition";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import CancelPaymentDialog from "@/components/payment-detail/CancelPaymentDialog";
import { CancelledGroupBanner } from "@/components/payment-detail/CancelledGroupBanner";
import { CancelledItemsBanner } from "@/components/payment-detail/CancelledItemsBanner";
import { ArrowLeft, Building2, AlertTriangle, MessageSquarePlus, Sparkles, RefreshCcw, Send, History, XCircle, ShieldCheck, Undo2, ThumbsUp, ThumbsDown, FileText, Wallet, Upload, Download, FileSpreadsheet, ChevronDown, Clock, X, Plus, Trash2, CheckCircle2, GitCompareArrows, Calculator } from "lucide-react";
import { GroupReapprovalBadge } from "@/components/GroupReapprovalBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { canEditBatch, canActAsValidatorOrDirector, canReimportBatch } from "@/lib/paymentFlow";
import { claimPayment } from "@/lib/assignments";
import { isCompanyGroupEditable, isCompanyGroupReopenable, COMPANY_GROUP_LOCKED_TOOLTIP } from "@/lib/companyGroupGuards";
// useAuth já importado acima
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import ColumnMappingDialog from "@/components/payment/ColumnMappingDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Pencil already imported below
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatCurrency,
  TONE_CLASSES,
  type ItemAiStatus,
  type PaymentStatus,
} from "@/lib/status";
import { effectiveItemAiStatus } from "@/lib/paymentFlow";
import {
  usePaymentDetailData,
  type PaymentItemRow,
  type ObservationRow,
  type AiVersionRow,
  type AiFindings,
} from "@/hooks/usePaymentDetailData";
import { calculateFinancialRisk } from "@/lib/riskScore";
import { cn, normalizeString } from "@/lib/utils";

import { Info, ShieldAlert, Pencil, MessageSquarePlus as MessageSquarePlusIcon } from "lucide-react";
import { useUserCompanyNotes } from "@/hooks/useUserCompanyNotes";
import { PrivateCompanyNote } from "@/components/payment-detail/PrivateCompanyNote";

const HighlightBanner = ({
  observations,
  profiles
}: {
  observations: ObservationRow[];
  profiles: Record<string, string>;
}) => {
  const highlights = useMemo(() => {
    return observations.filter(o => 
      o.observation_type === "impacta_aprovacao" || 
      o.observation_type === "justificativa_override"
    );
  }, [observations]);

  if (highlights.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {highlights.map((h) => (
        <div 
          key={h.id} 
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border shadow-sm animate-in fade-in slide-in-from-top-2 duration-300",
            h.observation_type === "impacta_aprovacao" 
              ? "bg-amber-100 border-amber-400 ring-2 ring-amber-500/20" 
              : "bg-success-soft border-success/30"
          )}
        >
          <div className="mt-0.5">
            {h.observation_type === "impacta_aprovacao" ? (
              <ShieldAlert className="h-5 w-5 text-amber-600 animate-pulse" />
            ) : (
              <Pencil className="h-4 w-4 text-success" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[11px] uppercase tracking-tight font-black h-5 px-1.5",
                  h.observation_type === "impacta_aprovacao"
                    ? "border-amber-600 text-amber-800 bg-amber-200"
                    : "border-success/40 text-success bg-success-soft"
                )}
              >
                {h.observation_type === "impacta_aprovacao" ? "⚠️ IMPACTA APROVAÇÃO" : "Justificativa de Override"}
              </Badge>
              <span className="text-[10px] text-muted-foreground font-medium">
                {profiles[h.author_id!] || "Sistema"} · {new Date(h.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            <p className={cn(
              "text-sm leading-relaxed",
              h.observation_type === "impacta_aprovacao" ? "font-bold text-amber-900" : "font-medium text-foreground"
            )}>
              {h.message}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

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
    <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-md border w-fit">
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
export default function CompanyAnalysis() {
  const { id, groupId } = useParams<{ id: string; groupId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const {
    payment,
    items: allItems,
    obs,
    groups,
    rulesIndex,
    rulesByName,
    profiles,
    assignments,
    load,
    setItems,
  } = usePaymentDetailData(id, { groupId });

  // Notas pessoais + marcadores + anexos (mesmos do PaymentDetail) — agora também no painel da empresa.
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

  // Exportação unificada: usa o mesmo PaymentReportModal do lote (mesmas
  // colunas, mesmas regras, validação assistencial sintetizada), só que
  // pré-filtrado para esta empresa via `items`/`groups` reduzidos. Garante
  // que o relatório por empresa reflita exatamente o relatório do lote.
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isConciliationOpen, setIsConciliationOpen] = useState(false);
  const [hasReconciliationRun, setHasReconciliationRun] = useState<boolean | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const check = async () => {
      const { count } = await (supabase as any)
        .from("reconciliation_runs")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", id);
      if (active) setHasReconciliationRun((count ?? 0) > 0);
    };
    check();
    const ch = supabase
      .channel(`recon-runs-company:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reconciliation_runs", filter: `payment_id=eq.${id}` }, check)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [id]);

  const handleOpenConciliation = () => {
    if (hasReconciliationRun === false) {
      toast.info("Lote sem conciliação", { description: "Ainda não foi feita nenhuma rodada de conciliação para este lote." });
      return;
    }
    setIsConciliationOpen(true);
  };

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const [locallyDeletedItemIds, setLocallyDeletedItemIds] = useState<Set<string>>(() => new Set());

  const hideItemImmediately = useCallback((itemId: string) => {
    setLocallyDeletedItemIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    setItems((prev) => prev.filter((it) => it.id !== itemId));
  }, [setItems]);

  const restoreItemVisibility = useCallback((itemId: string) => {
    setLocallyDeletedItemIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const items = useMemo(() => {
    if (!group) return [] as PaymentItemRow[];
    const companyNorm = normalizeString(group.company_name);
    return allItems.filter((x) => {
      if (normalizeString(x.company_name ?? "Sem empresa") !== companyNorm) return false;
      if (locallyDeletedItemIds.has(x.id)) return false;
      const tipo = String((x as any).tipo_linha ?? "").toLowerCase();
      const isOrphanBonus = tipo.includes("bonus") && !(x as any).applied_rule_id;
      if (isOrphanBonus && (x as any).is_cancelled === true) return false;
      return true;
    });
  }, [allItems, group, locallyDeletedItemIds]);

  // Composição financeira da empresa.
  // - analise: bruto/débitos/glosas/pool/líquido via compute-company-financials.
  // - confeccao: bruto = Σ procedure_amount, liquido = Σ expected_amount (sem deduções).
  const compMode: "analise" | "confeccao" =
    (payment as any)?.analysis_mode === "confeccao" ? "confeccao" : "analise";
  const composition = useFinancialComposition(
    id,
    group?.company_id ?? undefined,
    Number(group?.total_amount ?? 0),
    compMode,
  );




  const [aiVersions, setAiVersions] = useState<AiVersionRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [groupDraft, setGroupDraft] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);

  // ---- Reaplicar regras: progresso + diff antes/depois ----
  const [reapplyOpen, setReapplyOpen] = useState(false);
  const [reapplyPhase, setReapplyPhase] = useState<ReapplyPhase>("iniciando");
  const [reapplyStep, setReapplyStep] = useState<ReapplyStep>("ler_regras");
  const [reapplyError, setReapplyError] = useState<string | null>(null);
  const [reapplyDiff, setReapplyDiff] = useState<ReapplyDiff | null>(null);
  const [reapplyElapsed, setReapplyElapsed] = useState(0);
  const reapplySnapshotRef = useRef<ReapplySnapshot>({});
  const reapplyTimerRef = useRef<number | null>(null);


  // Timer de tempo decorrido enquanto a reanálise roda.
  useEffect(() => {
    if (reapplyPhase === "iniciando" || reapplyPhase === "processando") {
      reapplyTimerRef.current = window.setInterval(() => {
        setReapplyElapsed((s) => s + 1);
      }, 1000) as unknown as number;
    } else if (reapplyTimerRef.current != null) {
      clearInterval(reapplyTimerRef.current);
      reapplyTimerRef.current = null;
    }
    return () => {
      if (reapplyTimerRef.current != null) {
        clearInterval(reapplyTimerRef.current);
        reapplyTimerRef.current = null;
      }
    };
  }, [reapplyPhase]);

  const [changeCompanyOpen, setChangeCompanyOpen] = useState(false);
  const [newCompany, setNewCompany] = useState<CompanyOption | null>(null);
  const [changingCompany, setChangingCompany] = useState(false);
  const [changeCompanyReason, setChangeCompanyReason] = useState("");
  const [isQuestion, setIsQuestion] = useState(false);
  const [groupCommentType, setGroupCommentType] = useState<ObservationType>("informativo");
  const [itemCommentType, setItemCommentType] = useState<Record<string, ObservationType>>({});

  const [editItem, setEditItem] = useState<PaymentItemRow | null>(null);
  const [editDraft, setEditDraft] = useState<{ gross_amount: string; specialty: string; doctor_name: string; description: string; procedure_amount: string; procedure_code: string; doctor_role: string; sector: string }>({ gross_amount: "", specialty: "", doctor_name: "", description: "", procedure_amount: "", procedure_code: "", doctor_role: "", sector: "" });
  const [savingItem, setSavingItem] = useState(false);
  const [deleteItem, setDeleteItem] = useState<PaymentItemRow | null>(null);
  const [manualItemOpen, setManualItemOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  // Paginação leve da aba "Divergências" para evitar overflow vertical no mobile
  const DIVERGENCE_PAGE_SIZE = 10;
  const [divergencesVisible, setDivergencesVisible] = useState(DIVERGENCE_PAGE_SIZE);

  // FAB de Conversas — escopo desta empresa. Conta apenas mensagens NÃO LIDAS
  // (não autoradas pelo usuário atual e ausentes em payment_question_reads).
  // Permissão: somente analista/validador/diretor/admin podem ver/conversar.
  const canConverse =
    hasRole("analista") || hasRole("validador") || hasRole("diretor") || hasRole("admin");
  const [unreadQuestionsCount, setUnreadQuestionsCount] = useState(0);
  const [conversationsOpen, setConversationsOpen] = useState(false);

  useEffect(() => {
    if (!groupId || !user || !canConverse) {
      setUnreadQuestionsCount(0);
      return;
    }
    let alive = true;
    const fetchUnread = async () => {
      const { data: msgs } = await supabase
        .from("payment_questions")
        .select("id, author_id")
        .eq("company_group_id", groupId)
        .neq("author_id", user.id);
      const ids = (msgs ?? []).map((m: { id: string }) => m.id);
      if (!ids.length) {
        if (alive) setUnreadQuestionsCount(0);
        return;
      }
      const { data: reads } = await supabase
        .from("payment_question_reads")
        .select("message_id")
        .eq("user_id", user.id)
        .in("message_id", ids);
      const readSet = new Set((reads ?? []).map((r: { message_id: string }) => r.message_id));
      if (alive) setUnreadQuestionsCount(ids.filter((i) => !readSet.has(i)).length);
    };
    fetchUnread();
    const ch = supabase
      .channel(`cqt-fab-${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_questions", filter: `company_group_id=eq.${groupId}` },
        () => fetchUnread(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_question_reads", filter: `user_id=eq.${user.id}` },
        () => fetchUnread(),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [groupId, user, canConverse]);

  // Ao abrir o modal, marca tudo como lido para zerar o contador.
  useEffect(() => {
    if (!conversationsOpen || !groupId || !user || !canConverse) return;
    (async () => {
      const { data: msgs } = await supabase
        .from("payment_questions")
        .select("id")
        .eq("company_group_id", groupId)
        .neq("author_id", user.id);
      const ids = (msgs ?? []).map((m: { id: string }) => m.id);
      if (!ids.length) return;
      await supabase
        .from("payment_question_reads")
        .upsert(
          ids.map((message_id) => ({ message_id, user_id: user.id })),
          { onConflict: "message_id,user_id", ignoreDuplicates: true },
        );
      setUnreadQuestionsCount(0);
    })();
  }, [conversationsOpen, groupId, user, canConverse]);


  const [postConcluirOpen, setPostConcluirOpen] = useState(false);
  const [reimportConfirm, setReimportConfirm] = useState<File[] | null>(null);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);
  const [mappingPrompt, setMappingPrompt] = useState<{
    file: File;
    headers: string[];
    sampleRow: Record<string, unknown> | null;
    initialMapping: Record<string, string>;
  } | null>(null);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, Record<string, string>>>({});
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    document.title = "Análise da empresa | Exacta Approval";
  }, []);

  // Versões da IA são exclusivas desta tela (aba "Detalhe IA"), busca dedicada.
  useEffect(() => {
    if (!id) return;
    let active = true;
    supabase
      .from("ai_analysis_versions")
      .select("*")
      .eq("payment_id", id)
      .order("version", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setAiVersions((data ?? []) as unknown as AiVersionRow[]);
      });
    return () => { active = false; };
  }, [id, obs.length]);

  const loading = !payment || !group;

  const gStatus = (group?.status ?? "em_analise_ia") as PaymentStatus;

  const counts = useMemo(() => {
    const c = { aprovado: 0, pendente: 0, alerta: 0, reprovado: 0, alertasTotal: 0, criticosTotal: 0, cancelado: 0 };
    for (const it of items) {
      const tl = (it as any).tipo_linha as string | null | undefined;
      const src = (it as any).source as string | null | undefined;
      const origem = (it as any).item_origem as string | null | undefined;
      const isInformativo =
        tl === "complemento_bonus" || tl === "complemento" || tl === "outros" ||
        src === "manual" || origem === "inclusao_manual";

      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus, (it as any).is_cancelled);
      // Cancelados (item ou grupo) saem dos buckets de status e não geram alerta.
      if (eff === "cancelado") {
        c.cancelado += 1;
        continue;
      }
      const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : (eff as ItemAiStatus);
      c[bucket] = (c[bucket] ?? 0) + 1;

      if (isInformativo) continue; // bônus/complemento/manual não contam como alerta

      // Alertas/críticos contam apenas itens ainda em aberto.
      // Itens acatados, aprovados ou seguidos pelo analista já foram resolvidos
      // e não devem inflar o contador do card.
      if (eff === "acatado" || eff === "aprovado" || eff === "seguido") continue;

      const alerts = (it.ai_findings?.alerts ?? []) as string[];
      if (alerts.length > 0) {
        if (it.ai_status === "reprovado") c.criticosTotal += 1;
        else c.alertasTotal += 1;
      }

    }
    return c;
  }, [items, gStatus]);

  const divergentes = useMemo(
    () =>
      items.filter((it) => {
        const alerts = (it.ai_findings?.alerts ?? []) as string[];
        return alerts.length > 0 || it.ai_status === "alerta" || it.ai_status === "reprovado";
      }),
    [items],
  );

  const groupComments = useMemo(
    () => obs.filter((o) => !o.item_id),
    [obs],
  );
  const itemComments = (itemId: string) => obs.filter((o) => o.item_id === itemId);

  const isValidador = hasRole("validador") || hasRole("admin");
  const isDiretor = hasRole("diretor") || hasRole("admin");
  const isAnalistaRole = hasRole("analista") || hasRole("admin");
  const myAuthorType: "analista" | "validador" | "diretor" =
    gStatus === "aguardando_validacao" && isValidador ? "validador"
    : gStatus === "aguardando_aprovacao" && isDiretor ? "diretor"
    : isDiretor ? "diretor"
    : isValidador ? "validador"
    : "analista";

  const guardEditable = (): boolean => {
    // Em modo CONFECÇÃO o estado vivo está em confeccao_status, não em status
    // (que fica em 'rascunho'). O grupo é editável enquanto em_confeccao.
    const _isConfeccao = (payment as any)?.analysis_mode === "confeccao";
    const _confStatus = (group as any)?.confeccao_status as string | null | undefined;
    if (_isConfeccao) {
      if (_confStatus === "em_confeccao") return true;
      toast.error("Empresa concluída", { description: COMPANY_GROUP_LOCKED_TOOLTIP });
      return false;
    }
    if (!isCompanyGroupEditable(group?.status)) {
      toast.error("Empresa concluída", { description: COMPANY_GROUP_LOCKED_TOOLTIP });
      return false;
    }
    return true;
  };

  const addItemComment = async (itemId: string) => {
    const text = (itemDraft[itemId] ?? "").trim();
    if (!text || !id) return;
    if (!guardEditable()) return;
    setBusy(true);
    const r = await recordObservation({
      payment_id: id,
      item_id: itemId,
      author_type: myAuthorType,
      author_id: user!.id,
      message: text,
      observation_type: itemCommentType[itemId] ?? "informativo",
    });
    setBusy(false);
    if (!r.ok) return toast.error("Erro ao salvar", { description: r.error });
    setItemDraft((m) => ({ ...m, [itemId]: "" }));
    load();
  };

  const addGroupComment = async () => {
    const text = groupDraft.trim();
    if (!text || !id || !group) return;
    if (!guardEditable()) return;
    setBusy(true);
    const r = await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] ${text}`,
      is_question: isQuestion,
      observation_type: groupCommentType,
    });
    setBusy(false);
    if (!r.ok) return toast.error("Erro ao salvar", { description: r.error });
    setGroupDraft("");
    setIsQuestion(false);
    setGroupCommentType("informativo");
    load();
  };

  const acceptItem = async (it: PaymentItemRow) => {
    if (!guardEditable()) return;

    // Detecta ação de "manter pagamento" (alerta assistencial em item aprovado)
    const isManterAction = (it as any)._validationAction === "manter";

    if (isManterAction) {
      // Não chama RPC — apenas registra que o analista revisou e manteve
      setBusy(true);
      const r = await recordObservation({
        payment_id: id!,
        item_id: it.id,
        author_type: myAuthorType,
        author_id: user!.id,
        message: `Item revisado pelo analista: alerta de validação assistencial avaliado e pagamento mantido (${formatCurrency(Number(it.gross_amount ?? 0))}).`,
        observation_type: "justificativa_override",
      });
      setBusy(false);
      if (!r.ok) return toast.error("Erro ao registrar", { description: r.error });
      toast.success("Revisão registrada", { description: "Pagamento mantido. Registro no histórico." });
      load();
      return;
    }

    // Fluxo normal: acatar item reprovado/alerta financeiramente
    const justif = (obs.find((o) => o.item_id === it.id && (o.message?.trim().length ?? 0) >= 1)?.message ?? "").trim();
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_payment_item", {
      _item_id: it.id,
      _justification: justif,
    });
    setBusy(false);
    if (error) return toast.error("Erro ao acatar", { description: error.message });
    const res = data as { ok: boolean; error?: string } | null;
    if (!res?.ok) return toast.error("Erro ao acatar", { description: res?.error ?? "Falha desconhecida" });
    toast.success("Item acatado");
    await load();
    await composition.refresh();
  };

  const undoAcceptItem = async (it: PaymentItemRow) => {
    if (!guardEditable()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("undo_accept_payment_item", { _item_id: it.id });
    setBusy(false);
    if (error) return toast.error("Erro ao desfazer", { description: error.message });
    const res = data as { ok: boolean; error?: string } | null;
    if (!res?.ok) return toast.error("Erro ao desfazer", { description: res?.error ?? "Falha desconhecida" });
    toast.success("Acate desfeito");
    await load();
    await composition.refresh();
  };

  // Ações de fluxo (paridade com o popup de análise por empresa).
  const autoClaim = async () => {
    if (!id || !user) return;
    if (!(hasRole("analista") || hasRole("admin"))) return;
    await claimPayment(id, user.id, "auto");
  };

  const reanalyzeGroup = async () => {
    if (!id || !group) return;
    if (!guardEditable()) return;
    await autoClaim();

    // Etapa 1 — Ler regras: snapshot ANTES + dispatch.
    // Snapshot buscado direto do DB (não do state local, que pode estar
    // desatualizado em relação a um job anterior). Isso garante que o diff
    // compare o estado real pré-motor com o estado real pós-motor.
    setReapplyDiff(null);
    setReapplyError(null);
    setReapplyElapsed(0);
    setReapplyStep("ler_regras");
    setReapplyPhase("iniciando");
    setReapplyOpen(true);
    setReanalyzing(true);

    const itemIds = items.map((it) => it.id);
    let snapshot: ReturnType<typeof takeSnapshot> = {};
    if (itemIds.length > 0) {
      const { data: before } = await supabase
        .from("payment_items")
        .select("id, ai_status, applied_rule_id, expected_amount")
        .in("id", itemIds);
      snapshot = takeSnapshot((before ?? []) as unknown as PaymentItemRow[]);
    }
    reapplySnapshotRef.current = snapshot;

    const startedAt = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-payment-analysis", {
        // force_fresh_rules: este botão é manual e geralmente vem logo após o
        // analista editar/cadastrar uma regra. Pulamos o ctx_cache para garantir
        // que o motor leia o estado atual do banco — caso contrário, workers
        // de uma reanalise nova podem reusar snapshot de regras antigo.
        body: { payment_id: id, only_companies: [group.company_name], force_fresh_rules: true },
      });
      if (error) throw error;

      const dispatched = Number((data as any)?.total_companies ?? 0);
      const alreadyRunning = (data as any)?.already_running === true;
      if (!alreadyRunning && dispatched === 0) {
        const skipped = Array.isArray((data as any)?.skipped_companies) ? (data as any).skipped_companies : [];
        const sample = skipped.length
          ? ` Status: ${Array.from(new Set(skipped.map((s: any) => s.status))).slice(0, 3).join(", ")}.`
          : "";
        const msg = ((data as any)?.message ?? "A empresa não está em estado editável para reanálise.") + sample;
        setReapplyError(msg);
        setReapplyPhase("erro");
        toast.error("Empresa não foi reanalisada", { description: msg });
        return;
      }

      await recordObservation({
        payment_id: id,
        author_type: myAuthorType,
        author_id: user!.id,
        message: `[${group.company_name}] Reanálise solicitada pelo analista. Job: ${(data as any)?.job_id ?? (alreadyRunning ? "já em andamento" : "—")}.`,
        status_from: group.status,
        status_to: group.status,
      });

      // Etapa 2 — Motor rodando (recalculando itens).
      setReapplyStep("rodar_motor");
      setReapplyPhase("processando");

      // Aguarda o motor finalizar antes de calcular o diff. Sem polling, o
      // "concluído" apareceria com snapshot antigo e o diff seria zero.
      // Prioriza polling do JOB específico retornado pelo dispatch — evita
      // falso positivo quando processing_diagnostics do pagamento já estava
      // "success" de um job anterior (qualquer worker sobrescreve esse campo).
      const jobId = (data as any)?.job_id as string | undefined;
      const done = jobId
        ? await waitForJobCompletion(jobId, 120_000)
        : await waitForProcessingCompletion(id, startedAt, 120_000);

      // Etapa 3 — Persistir/ler de volta os itens.
      setReapplyStep("persistir_itens");

      // Releitura direta dos itens da empresa para garantir o estado pós-motor
      // (independente da atualização do hook usePaymentDetailData).
      let after: PaymentItemRow[] = [];
      if (itemIds.length > 0) {
        const { data: fresh } = await supabase
          .from("payment_items")
          .select("id, ai_status, applied_rule_id, expected_amount")
          .in("id", itemIds);
        after = (fresh ?? []) as unknown as PaymentItemRow[];
      }

      const diff = diffSnapshots(reapplySnapshotRef.current, after);
      setReapplyDiff(diff);

      // Etapa 4 — Atualizar a UI (recarrega o detalhe da empresa).
      setReapplyStep("carregar_ui");
      await load();

      if (!done) {
        // Motor não confirmou conclusão no tempo — ainda assim mostramos o diff
        // com o estado atual; o usuário pode reaplicar de novo se necessário.
        setReapplyPhase("erro");
        toast.warning("Reanálise concluída sem confirmação do motor", {
          description: reapplyError ?? "Exibindo o estado atual dos itens. Se algo não mudou, tente novamente em alguns segundos.",
        });
      } else {
        setReapplyPhase("concluido");
        const _isConfeccao = (payment as any)?.analysis_mode === "confeccao";
        if (_isConfeccao) {
          toast.success("Cálculo do repasse concluído", {
            description: `${diff.approvedTotal} com regra · ${diff.reprovedTotal} sem regra cadastrada.`,
          });
        } else {
          toast.success("Reanálise concluída", {
            description: `${diff.becameApproved} passaram a aprovado · ${diff.stayedReproved} continuam reprovados.`,
          });
        }
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setReapplyError(msg);
      setReapplyPhase("erro");
      toast.error("Falha ao iniciar reanálise", { description: msg });
    } finally {
      setReanalyzing(false);
    }
  };



  /**
   * Faz polling em `payments.processing_diagnostics` para detectar conclusão
   * da reanálise quando a conexão HTTP cai antes do response final.
   * Retorna true se diagnostics.status === "success" e foi atualizado após `since`.
   */
  const waitForJobCompletion = async (
    jobId: string,
    timeoutMs = 120_000,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { data } = await supabase
          .from("payment_processing_jobs")
          .select("status, processed_companies, total_companies, failed_companies")
          .eq("id", jobId)
          .maybeSingle();
        const status = (data as any)?.status as string | undefined;
        const processed = Number((data as any)?.processed_companies ?? 0);
        const total = Number((data as any)?.total_companies ?? 0);
        const failed = Array.isArray((data as any)?.failed_companies) ? (data as any).failed_companies : [];
        if (status === "concluido") return true;
        if (status === "parcial" || status === "erro") {
          const firstError = failed[0]?.error ? ` ${failed[0].error}` : "";
          setReapplyError(`Reanálise não concluiu para todas as empresas.${firstError}`.trim());
          return false;
        }
        if (total > 0 && processed >= total && failed.length === 0) return true;
      } catch {
        // ignora e tenta novamente
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  };

  const waitForProcessingCompletion = async (
    paymentId: string,
    since: number,
    timeoutMs = 90_000,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { data } = await supabase
          .from("payments")
          .select("processing_diagnostics, processing_timeout_occurred, updated_at")
          .eq("id", paymentId)
          .maybeSingle();
        const diag = (data?.processing_diagnostics ?? null) as { status?: string; finished_at?: string } | null;
        const updatedAt = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
        if (diag?.status === "success" && updatedAt >= since - 5_000) {
          return true;
        }
        if (data?.processing_timeout_occurred) return false;
      } catch {
        // ignore e tenta de novo
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    return false;
  };

  const sendForValidation = async () => {
    if (!id || !group) return;
    if (!(group.status === "revisao_analista" || group.status === "devolvido_analista")) return;
    setBusy(true);
    await autoClaim();
    const { error } = await supabase
      .from("payment_company_groups")
      .update({ status: "concluida_analista" })
      .eq("id", group.id);
    if (error) {
      setBusy(false);
      return toast.error("Erro ao concluir análise", { description: error.message });
    }
    const text = groupDraft.trim();
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] Análise concluída pelo analista${text ? `: ${text}` : ""}.`,
      status_from: group.status,
      status_to: "concluida_analista",
    });
    setGroupDraft("");
    setBusy(false);
    toast.success("Análise concluída", {
      description: "Esta empresa será incluída no próximo envio do lote.",
    });
    setPostConcluirOpen(true);
    load();
  };

  /**
   * Finaliza a CONFECÇÃO desta empresa. Diferente de "Concluir análise":
   * - não envia ao validador (em confecção não existe validador por empresa);
   * - não muda confeccao_status do grupo (a finalização do lote é atômica e
   *   ocorre via RPC finalize_confeccao no PaymentDetail);
   * - apenas registra observação marcando a empresa como pronta na confecção.
   * O envio efetivo para análise é feito no lote inteiro via "Encaminhar para análise"
   * no PaymentDetail (sendConfeccaoForAnalysis → rpc finalize_confeccao).
   */
  const finalizeConfeccaoGroup = async () => {
    if (!id || !group) return;
    setBusy(true);
    const text = groupDraft.trim();
    // Marca o grupo como confeccao_concluida — o dispatcher de reanálise
    // (dispatch-payment-analysis) passa a pular esta empresa automaticamente
    // até que ela seja reaberta.
    const { error: upErr } = await supabase
      .from("payment_company_groups")
      .update({
        confeccao_status: "confeccao_concluida",
        confeccao_finalized_at: new Date().toISOString(),
        confeccao_finalized_by: user!.id,
      })
      .eq("id", group.id);
    if (upErr) {
      setBusy(false);
      return toast.error("Erro ao finalizar confecção", { description: upErr.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] Confecção finalizada pelo analista${text ? `: ${text}` : "."} Reanálise desta empresa fica bloqueada até reabertura.`,
      status_from: group.status,
      status_to: group.status,
    });
    setGroupDraft("");
    setBusy(false);
    toast.success("Confecção desta empresa finalizada", {
      description: "Reanálise bloqueada até reabrir. Use \"Encaminhar para análise\" no lote para enviar tudo ao motor de análise.",
    });
    load();
  };

  /**
   * Reabre a confecção desta empresa — desfaz `finalizeConfeccaoGroup`.
   * Permite voltar a recalcular o repasse e ajustar antes de encaminhar o lote.
   */
  const reopenConfeccaoGroup = async () => {
    if (!id || !group) return;
    setBusy(true);
    const { error: upErr } = await supabase
      .from("payment_company_groups")
      .update({
        confeccao_status: "em_confeccao",
        confeccao_finalized_at: null,
        confeccao_finalized_by: null,
      })
      .eq("id", group.id);
    if (upErr) {
      setBusy(false);
      return toast.error("Erro ao reabrir confecção", { description: upErr.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] Confecção reaberta pelo analista. Reanálise desta empresa liberada novamente.`,
      status_from: group.status,
      status_to: group.status,
    });
    setBusy(false);
    toast.success("Confecção reaberta", {
      description: "Esta empresa volta a aceitar recálculo de repasse.",
    });
    load();
  };



  const cancelBatch = async () => {
    if (!id || !group) return;
    const text = groupDraft.trim();
    setBusy(true);
    // Cancela todos os grupos do lote + o próprio pagamento
    const { error: gErr } = await supabase
      .from("payment_company_groups")
      .update({ status: "cancelado" })
      .eq("payment_id", id);
    if (gErr) {
      setBusy(false);
      return toast.error("Erro ao cancelar", { description: gErr.message });
    }
    const { error: pErr } = await supabase
      .from("payments")
      .update({ status: "cancelado" })
      .eq("id", id);
    if (pErr) {
      setBusy(false);
      return toast.error("Erro ao cancelar pagamento", { description: pErr.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: myAuthorType,
      author_id: user!.id,
      message: `[${group.company_name}] Lote cancelado pelo analista${text ? `: ${text}` : "."}`,
      status_from: group.status,
      status_to: "cancelado",
    });
    setGroupDraft("");
    setBusy(false);
    toast.success("Lote cancelado");
    navigate(`/pagamentos/${id}`);
  };

  /**
   * Troca a empresa de TODOS os itens deste grupo. Usado quando o match
   * automático apontou a empresa errada. O sistema:
   *  1) reatribui os itens (company_id/company_name);
   *  2) move-os para o grupo da empresa correta — cria o grupo se não existir,
   *     e remove o grupo antigo se ficar vazio;
   *  3) registra o nome antigo como ALIAS na empresa nova (aprendizado);
   *  4) reanalisa a IA para os itens reatribuídos.
   */
  const changeGroupCompany = async () => {
    if (!id || !group || !newCompany || !user) return;
    if (newCompany.id === group.company_id) {
      toast.info("Esta já é a empresa do grupo.");
      return;
    }
    // Se grupo já foi aprovado uma vez, exige motivo (vai para re-aprovação).
    const wasApproved = (group as any).approval_version > 0 || !!(group as any).approved_at;
    const reason = changeCompanyReason.trim();
    if (wasApproved && reason.length < 4) {
      toast.error("Informe um motivo para a troca de PJ (mínimo 4 caracteres).", {
        description: "Esta alteração gera nova aprovação do diretor.",
      });
      return;
    }
    setChangingCompany(true);
    try {
      const oldName = group.company_name;
      const sourceGroupId = group.id;
      const itemIds = items.map((it) => it.id);

      // 1) reatribui itens
      const { error: itErr } = await supabase
        .from("payment_items")
        .update({ company_id: newCompany.id, company_name: newCompany.name })
        .in("id", itemIds);
      if (itErr) throw itErr;

      // 2) acha/cria grupo destino
      const { data: existing } = await supabase
        .from("payment_company_groups")
        .select("id, items_count, total_amount")
        .eq("payment_id", id)
        .eq("company_id", newCompany.id)
        .maybeSingle();

      const total = items.reduce((s, it) => s + Number(it.gross_amount ?? 0), 0);

      let destGroupId = existing?.id ?? null;
      if (destGroupId) {
        await supabase
          .from("payment_company_groups")
          .update({
            items_count: (existing!.items_count ?? 0) + items.length,
            total_amount: Number(existing!.total_amount ?? 0) + total,
          })
          .eq("id", destGroupId);
      } else {
        const { data: created, error: cErr } = await supabase
          .from("payment_company_groups")
          .insert({
            hospital_id: (payment as any).hospital_id,
            payment_id: id,
            company_id: newCompany.id,
            company_name: newCompany.name,
            items_count: items.length,
            total_amount: total,
            status: "em_analise_ia",
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        destGroupId = created.id;
      }

      // 3) Se grupo de origem não esvaziar (caso de troca parcial via UI futura),
      //    a deleção abaixo só ocorre quando vazio. Hoje a troca é total → apaga.
      let sourceDeleted = false;
      if (!wasApproved) {
        await supabase.from("payment_company_groups").delete().eq("id", sourceGroupId);
        sourceDeleted = true;
      }
      // Se grupo origem foi aprovado, mantemos ele vivo (com itens=0) para
      // o fluxo de re-aprovação enxergar a versão anterior e o diretor decidir.

      // 4) aprendizado de alias
      const { data: comp } = await supabase
        .from("companies")
        .select("aliases")
        .eq("id", newCompany.id)
        .single();
      const aliases = new Set<string>((comp?.aliases ?? []) as string[]);
      aliases.add(oldName);
      await supabase
        .from("companies")
        .update({ aliases: Array.from(aliases) })
        .eq("id", newCompany.id);

      // 5) Re-aprovação: grava motivo nos dois grupos (origem se ainda existir + destino).
      //    Triggers do banco já marcam reapproval_pending quando company_id muda em
      //    item de grupo com approval_version>0.
      if (wasApproved) {
        const updates: Promise<unknown>[] = [];
        if (!sourceDeleted) {
          updates.push(
            Promise.resolve(
              supabase
                .from("payment_company_groups")
                .update({ reapproval_reason: reason })
                .eq("id", sourceGroupId),
            ),
          );
        }
        if (destGroupId) {
          updates.push(
            Promise.resolve(
              supabase
                .from("payment_company_groups")
                .update({ reapproval_reason: reason })
                .eq("id", destGroupId),
            ),
          );
        }
        await Promise.all(updates);

        // dispara notificação para diretor em cada grupo afetado
        const notifyTargets = [
          !sourceDeleted ? sourceGroupId : null,
          destGroupId,
        ].filter(Boolean) as string[];
        await Promise.all(
          notifyTargets.map((gid) =>
            supabase.functions
              .invoke("notify-director-reapproval", {
                body: { paymentId: id, companyGroupId: gid },
              })
              .catch((e) => console.warn("notify-director-reapproval falhou:", e)),
          ),
        );
      }

      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user.id,
        message:
          `[${oldName}] Empresa do grupo alterada para "${newCompany.name}" pelo analista. ` +
          (wasApproved
            ? `Motivo: ${reason}. Grupo(s) em re-aprovação pelo diretor.`
            : "Apelido aprendido para futuras correspondências."),
        status_from: group.status,
        status_to: group.status,
      });

      // 6) reanálise da IA para a empresa nova via orquestrador
      try {
        await supabase.functions.invoke("dispatch-payment-analysis", {
          body: { payment_id: id, only_companies: [newCompany.name] },
        });
      } catch (e) {
        console.warn("Reanálise pós-troca falhou (silencioso):", e);
      }

      toast.success(
        wasApproved
          ? "Empresa trocada — re-aprovação enviada ao diretor"
          : "Empresa do grupo atualizada",
      );
      setChangeCompanyOpen(false);
      setNewCompany(null);
      setChangeCompanyReason("");
      navigate(`/pagamentos/${id}/empresa/${destGroupId}`);
    } catch (e) {
      toast.error("Falha ao trocar empresa", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setChangingCompany(false);
    }
  };

  const doReimport = async (files: File[], extraOverrides?: Record<string, Record<string, string>>) => {
    if (!id || !payment || !user || !group) return;
    setReimporting(true);
    try {
      const { parsePaymentFile, similarity, inspectFileHeaders } = await import("@/lib/parsePaymentFile");
      const { computeHeaderSignature, FIELD_BY_KEY, inspectColumnMapping } = await import("@/lib/columnMapping");
      const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");
      const companiesData = await fetchAllPaginated<any>((from, to) =>
        supabase.from("companies").select("id,name,aliases").range(from, to),
      );
      const companies = companiesData.map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));

      // Matching tolerante em três camadas:
      //   1. company_id direto (parser casou pelo CNPJ/alias);
      //   2. chave alfanumérica (ignora hífens/pontuação/espaços);
      //   3. similaridade tokenizada (cobre nomes com setor/sufixo extra colado).
      const looseKey = (s: string | null | undefined) =>
        normalizeString(s ?? "").replace(/[^a-z0-9]/g, "");
      const targetLoose = looseKey(group.company_name);
      const targetId = group.company_id ?? null;
      let parsedRows: any[] = [];
      let fileNames: string[] = [];

      const matchesTarget = (raw: string | null | undefined, rid: string | null | undefined) => {
        if (targetId && rid && rid === targetId) return true;
        const lk = looseKey(raw ?? "Sem empresa");
        if (lk === targetLoose) return true;
        if (lk && targetLoose && (lk.includes(targetLoose) || targetLoose.includes(lk))) return true;
        return similarity(raw ?? "", group.company_name) >= 0.85;
      };

      for (const file of files) {
        // Aplica template salvo (se houver) e abre tela de mapeamento se faltar obrigatório
        const { headers, sampleRow } = await inspectFileHeaders(file);
        const sig = await computeHeaderSignature(headers);
        const hospitalId = (payment as any).hospital_id ?? null;
        const tplQuery = supabase
          .from("sheet_column_templates" as never)
          .select("id,mapping,name")
          .eq("header_signature", sig)
          .limit(1);
        const { data: tplRows } = hospitalId
          ? await tplQuery.or(`hospital_id.eq.${hospitalId},hospital_id.is.null`)
          : await tplQuery.is("hospital_id", null);
        const tpl = (tplRows ?? [])[0] as { id: string; mapping: any; name: string } | undefined;
        const override = extraOverrides?.[file.name] ?? mappingOverrides[file.name];
        const manualMapping = override ?? tpl?.mapping;
        const hits = inspectColumnMapping(headers).map((h) => {
          const ov = manualMapping?.[h.field];
          if (ov && headers.includes(ov)) return { ...h, header: ov, score: 100, confidence: "high" as const };
          return h;
        });
        const isReimportConfeccao = (payment as any)?.analysis_mode === "confeccao";
        const missingRequired = hits.filter((h) => {
          const required = isReimportConfeccao
            ? h.field === "procedure_amount" || (FIELD_BY_KEY[h.field].requirement === "required" && h.field !== "gross_amount")
            : FIELD_BY_KEY[h.field].requirement === "required";
          return required && (!h.header || h.score < 30);
        });
        if (missingRequired.length > 0) {
          // Abre tela de mapeamento manual em vez de bloquear com erro
          const initialMapping: Record<string, string> = Object.fromEntries(
            hits.filter((h) => h.header).map((h) => [h.field, h.header!]),
          );
          setMappingPrompt({ file, headers, sampleRow, initialMapping });
          setReimporting(false);
          return;
        }

        const bucket = await parsePaymentFile(file, companies, payment.payment_kind, { manualMapping });
        if (tpl) {
          await supabase
            .from("sheet_column_templates" as never)
            .update({ last_used_at: new Date().toISOString() } as never)
            .eq("id", tpl.id);
        }
        if (bucket.rows.length > 0) {
          const fileMatchesGroup = matchesTarget(bucket.rawCompanyName, bucket.matchedCompany?.id ?? null)
            || matchesTarget(bucket.matchedCompany?.name ?? null, bucket.matchedCompany?.id ?? null);

          // Se o nome do arquivo identifica a PJ atual, ele prevalece sobre colunas
          // como hospital/unidade/setor dentro da planilha, que frequentemente não são a PJ.
          const scopedRows = fileMatchesGroup
            ? bucket.rows.map((r) => ({ ...r, company_name: group.company_name, company_id: targetId ?? r.company_id }))
            : bucket.rows;

          parsedRows = [...parsedRows, ...scopedRows];
          fileNames.push(file.name);

          // Upload do arquivo para histórico
          const path = `${user.id}/${Date.now()}-${file.name}`;
          await supabase.storage.from("payment-files").upload(path, file);
        }
      }

      if (parsedRows.length === 0) {
        toast.error("Arquivos vazios", { description: "Nenhuma linha válida encontrada nos arquivos selecionados." });
        return;
      }

      // Reimportação no escopo da empresa: mantém somente as linhas desta PJ.
      // Linhas de outras empresas presentes no arquivo são ignoradas — a tela
      // do lote é o lugar para reimportar tudo.
      const companyRows = parsedRows.filter((r) => matchesTarget(r.company_name, r.company_id));
      const ignoredCount = parsedRows.length - companyRows.length;

      if (companyRows.length === 0) {
        toast.error("Nenhuma linha da empresa", {
          description: `Os arquivos não contêm linhas de "${group.company_name}". A reimportação local exige a base apenas desta empresa.`,
        });
        return;
      }

      // Limpa SOMENTE itens desta empresa via edge function (service_role +
      // statement_timeout=0). O DELETE direto pelo PostgREST estoura o timeout
      // de ~8s quando há muitos itens + cascades (rule_calculations etc).
      // NUNCA apagamos o payment_company_groups: se a reanálise falhar, a
      // empresa não pode sumir da lista. Só zeramos totais e deixamos o
      // analyze-payment reconciliar via UPDATE.
      const { data: clearRes, error: clearErr } = await supabase.functions.invoke(
        "clear-company-items",
        { body: { payment_id: id, company_name: group.company_name } },
      );
      if (clearErr) throw clearErr;
      if (clearRes && (clearRes as any).error) {
        throw new Error((clearRes as any).detail || (clearRes as any).error);
      }
      // Reseta totais do grupo (analyze-payment vai recalcular ao reanalisar).
      await supabase
        .from("payment_company_groups")
        .update({ items_count: 0, total_amount: 0 })
        .eq("id", group.id);


      const newItems = companyRows.map((r) => ({
        hospital_id: (payment as any).hospital_id,
        payment_id: id,
        doctor_name: r.doctor_name,
        doctor_document: r.doctor_document,
        doctor_email: r.doctor_email,
        description: r.description,
        gross_amount: (payment as any)?.analysis_mode === "confeccao" ? null : r.gross_amount,
        company_name: group.company_name,
        company_id: group.company_id ?? r.company_id,
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
        tipo_linha: r.tipo_linha,
      }));

      const chunkSize = 1000;
      for (let i = 0; i < newItems.length; i += chunkSize) {
        const chunk = newItems.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from("payment_items").insert(chunk);
        if (insErr) throw insErr;
      }

      // Recalcula totais do lote a partir dos itens remanescentes (todas empresas).
      const { data: remaining } = await supabase
        .from("payment_items")
        .select("gross_amount")
        .eq("payment_id", id);
      const total = (remaining ?? []).reduce((s: number, r: any) => s + Number(r.gross_amount ?? 0), 0);
      const itemsCount = (remaining ?? []).length;
      await supabase.from("payments").update({
        total_amount: total,
        items_count: itemsCount,
      }).eq("id", id);

      const companyTotal = companyRows.reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
      const ignoredSuffix = ignoredCount > 0 ? ` (${ignoredCount} linha(s) de outras empresas ignoradas)` : "";
      await recordObservation({
        payment_id: id, author_type: "analista", author_id: user.id,
        message: `[${group.company_name}] Base da empresa reimportada pelo analista (${companyRows.length} itens, total ${companyTotal.toFixed(2)})${ignoredSuffix}. Arquivos: ${fileNames.join(", ")}.`,
        status_from: payment.status, status_to: payment.status,
      });

      supabase.functions.invoke("dispatch-payment-analysis", {
        body: { payment_id: id, only_companies: [group.company_name] },
      });
      toast.success("Base da empresa reimportada", {
        description: ignoredCount > 0
          ? `Reanalisando ${companyRows.length} itens. ${ignoredCount} linha(s) de outras empresas foram ignoradas.`
          : "Reanalisando itens...",
      });

      navigate(`/pagamentos/${id}`);
    } catch (e) {
      const msg = (e as any)?.message
        || (e as any)?.error?.message
        || (e as any)?.details
        || (e as any)?.hint
        || (typeof e === "string" ? e : JSON.stringify(e));
      toast.error("Erro ao reimportar", { description: msg });
      console.error("[reimport-company]", e);
    } finally {
      setReimporting(false);
      setReimportConfirm(null);
      if (reimportInputRef.current) reimportInputRef.current.value = "";
    }
  };

  const openEditItem = (it: PaymentItemRow) => {
    setEditItem(it);
    // Sugestão automática: se a IA calculou um expected_amount e ele difere do
    // valor atual, pré-preenche o campo com a sugestão da IA. Assim o analista
    // só precisa confirmar (Salvar) sem digitar/copiar o valor manualmente.
    const gross = Number(it.gross_amount ?? 0);
    const expected = it.expected_amount != null ? Number(it.expected_amount) : null;
    const suggested =
      expected != null && Number.isFinite(expected) && Math.abs(expected - gross) > 0.001
        ? expected
        : gross;
    setEditDraft({
      gross_amount: String(suggested),
      specialty: it.specialty ?? "",
      doctor_name: it.doctor_name ?? "",
      description: it.description ?? "",
      procedure_amount: String(Number(it.procedure_amount ?? 0)),
      procedure_code: String(it.procedure_code ?? ""),
      doctor_role: String((it as any).doctor_role ?? ""),
      sector: String((it as any).sector ?? ""),
    });
  };

  const saveItem = async () => {
    if (!editItem || !id || !group) return;
    if (!guardEditable()) return;
    const _isConfeccao = (payment as any)?.analysis_mode === "confeccao";
    const newGross = Number(editDraft.gross_amount.replace(",", "."));
    const newProcedureAmount = Number((editDraft.procedure_amount || "0").replace(",", "."));
    if (_isConfeccao ? Number.isNaN(newProcedureAmount) : Number.isNaN(newGross)) {
      toast.error("Valor inválido");
      return;
    }
    setSavingItem(true);
    try {
      const oldGross = Number(editItem.gross_amount ?? 0);
      const oldProcedure = Number(editItem.procedure_amount ?? 0);
      const cleanTuss = (editDraft.procedure_code || "").replace(/\D/g, "");
      const patch: Record<string, unknown> = _isConfeccao
        ? {
            // Em confecção a base não tem "valor pago" — quem manda é o valor
            // do convênio (procedure_amount). gross_amount fica espelhado com
            // procedure_amount para manter consistência dos agregadores legados
            // até o lote ir para análise.
            procedure_amount: newProcedureAmount,
            gross_amount: newProcedureAmount,
            doctor_name: editDraft.doctor_name,
            doctor_role: editDraft.doctor_role || null,
            sector: editDraft.sector || null,
            procedure_code: cleanTuss || null,
            description: editDraft.description || null,
            specialty: editDraft.specialty || null,
            manual_edit: true,
            ai_status: "pendente",
          }
        : {
            gross_amount: newGross,
            specialty: editDraft.specialty || null,
            doctor_name: editDraft.doctor_name,
            description: editDraft.description || null,
            ai_status: "pendente",
          };
      const { error } = await supabase
        .from("payment_items")
        .update(patch as any)
        .eq("id", editItem.id);
      if (error) throw error;
      const delta = _isConfeccao ? (newProcedureAmount - oldProcedure) : (newGross - oldGross);
      if (Math.abs(delta) > 0.001) {
        await supabase
          .from("payment_company_groups")
          .update({ total_amount: Number(group.total_amount ?? 0) + delta })
          .eq("id", group.id);
      }
      const valorMsg = _isConfeccao
        ? `valor convênio: ${oldProcedure} → ${newProcedureAmount}`
        : `valor: ${oldGross} → ${newGross}`;
      await recordObservation({
        payment_id: id,
        item_id: editItem.id,
        author_type: "analista",
        author_id: user!.id,
        message: `Item editado pelo analista (${valorMsg}).`,
      });
      try {
        await supabase.functions.invoke("dispatch-payment-analysis", {
          body: { payment_id: id, only_companies: [group.company_name] },
        });
      } catch (e) { console.warn("Reanálise pós-edição falhou:", e); }
      toast.success("Item atualizado");
      setEditItem(null);
      await load();
      // Reexecuta o cálculo server-side para refletir o novo bruto no líquido.
      await composition.refresh();
    } catch (e) {
      toast.error("Falha ao salvar", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingItem(false);
    }
  };

  const confirmDeleteItem = async () => {
    if (!deleteItem || !id || !group) return;
    setDeletingItem(true);
    const previousItems = [...allItems]; // Use allItems from the hook
    try {
      const gross = Number(deleteItem.gross_amount ?? 0);
      
      // Optimistic update
      hideItemImmediately(deleteItem.id);
      
      // Deleta registros dependentes em reconciliation_items antes (FK sem CASCADE)
      await supabase
        .from("reconciliation_items")
        .delete()
        .eq("payment_item_id", deleteItem.id);

      // Agora pode deletar o item com segurança
      const { error } = await supabase.from("payment_items").delete().eq("id", deleteItem.id);
      if (error) throw error;
      
      // Calculate remaining items for this group specifically
      const remainingItemsInGroup = allItems.filter(it => 
        it.id !== deleteItem.id && 
        normalizeString(it.company_name ?? "") === normalizeString(group.company_name)
      );
      
      const remainingCount = remainingItemsInGroup.length;

      if (remainingCount <= 0) {
        // Deletou o último item da empresa, remove o grupo
        await supabase.from("payment_company_groups").delete().eq("id", group.id);
      } else {
        // Atualiza totais do grupo
        const newTotal = Math.max(0, Number(group.total_amount ?? 0) - gross);
        await supabase
          .from("payment_company_groups")
          .update({
            items_count: remainingCount,
            total_amount: newTotal,
          })
          .eq("id", group.id);
      }
      
      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user!.id,
        message: `[${group.company_name}] Item excluído pelo analista (${deleteItem.doctor_name} · ${formatCurrency(gross)}).`,
      });
      
      toast.success("Item excluído com sucesso");
      setDeleteItem(null);
      
      if (remainingCount <= 0) {
        navigate(`/pagamentos/${id}`);
      }
      // load() será chamado via Realtime automaticamente, não precisamos chamar aqui
    } catch (e) {
      // Rollback
      restoreItemVisibility(deleteItem.id);
      setItems(previousItems);
      // Supabase errors são objetos com .message, não instâncias de Error
      const msg = e instanceof Error
        ? e.message
        : (e as any)?.message
        ?? (e as any)?.error_description
        ?? JSON.stringify(e);
      toast.error("Falha ao excluir", { description: msg });
    } finally {
      setDeletingItem(false);
    }
  };

  const handleDeletePayment = async () => {
    if (!id || !group) return;
    setBusy(true);
    try {
      // O banco de dados agora possui ON DELETE CASCADE para todas as tabelas relacionadas
      // ao deletar da tabela 'payments'.
      
      // Se houver mais de um grupo, o usuário pode querer deletar apenas este grupo (empresa) do lote,
      // ou o lote inteiro se for o único.
      
      const { data: otherGroups } = await supabase
        .from("payment_company_groups")
        .select("id")
        .eq("payment_id", id)
        .neq("id", group.id);
      
      if (!otherGroups || otherGroups.length === 0) {
        // É o último grupo, deleta o lote inteiro (cascade deleta o grupo)
        const { error } = await supabase.from("payments").delete().eq("id", id);
        if (error) throw error;
        toast.success("Lote excluído com sucesso");
        navigate("/pagamentos", { replace: true });
      } else {
        // Existem outros grupos, deleta apenas este grupo e seus itens
        // Cascade delete em payment_items deve ser verificado para groups, 
        // mas como a relação principal de itens é com o lote, deletamos manualmente os itens do grupo aqui.
        await supabase.from("payment_items").delete().eq("payment_id", id).eq("company_name", group.company_name);
        const { error } = await supabase.from("payment_company_groups").delete().eq("id", group.id);
        if (error) throw error;
        
        toast.success("Empresa excluída do lote");
        navigate(`/pagamentos/${id}`, { replace: true });
      }
    } catch (e: any) {
      console.error("handleDeletePayment error:", e);
      toast.error("Erro ao excluir", { description: e.message || "Erro desconhecido" });
    } finally {
      setBusy(false);
    }
  };

  // Transições de fluxo do validador/diretor para esta empresa.
  const transitionGroupStatus = async (
    nextStatus: PaymentStatus,
    authorType: "validador" | "diretor" | "analista",
    actionLabel: string,
    requireMsg: boolean,
  ) => {
    if (!id || !group) return;
    const text = groupDraft.trim();
    if (requireMsg && !text) {
      toast.error("Adicione um motivo", { description: "Justifique a devolução ou rejeição no campo de observação." });
      return;
    }
    setBusy(true);
    const updates: Record<string, unknown> = { status: nextStatus };
    if (authorType === "validador" && nextStatus === "aguardando_aprovacao") {
      updates.validated_by = user!.id;
      updates.validated_at = new Date().toISOString();
    }
    if (authorType === "diretor" && nextStatus === "aprovado") {
      updates.approved_by = user!.id;
      updates.approved_at = new Date().toISOString();
    }
    if (authorType === "diretor" && nextStatus === "rejeitado") {
      updates.rejected_by = user!.id;
      updates.rejected_at = new Date().toISOString();
      updates.rejection_reason = text || null;
    }
    const { error } = await supabase
      .from("payment_company_groups")
      .update(updates as never)
      .eq("id", group.id);
    if (error) {
      setBusy(false);
      return toast.error("Falha ao atualizar", { description: error.message });
    }
    await recordObservation({
      payment_id: id,
      author_type: authorType,
      author_id: user!.id,
      message: `[${group.company_name}] ${actionLabel}${text ? `: ${text}` : "."}`,
      status_from: group.status,
      status_to: nextStatus,
    });
    if (nextStatus === "aguardando_aprovacao") {
      supabase.functions.invoke("notify-director-approval", { body: { paymentId: id } })
        .catch((e) => console.warn("notify-director-approval failed", e));
    }
    if (nextStatus === "aprovado_em_revisao") {
      supabase.functions.invoke("notify-analyst-review", { body: { paymentId: id } })
        .catch((e) => console.warn("notify-analyst-review failed", e));
    }
    if (nextStatus === "devolvido_analista") {
      supabase.functions.invoke("notify-analyst-event", { 
        body: { 
          paymentId: id, 
          eventType: "returned",
          actorName: user?.user_metadata?.full_name || user?.email,
          reason: text 
        } 
      }).catch((e) => console.warn("notify-analyst-event failed", e));
    }
    setGroupDraft("");
    toast.success(actionLabel);
    await load();
    setBusy(false);
  };

  const reopenCompanyAnalysis = async () => {
    if (!id || !group || !user) return;
    const reason = reopenReason.trim();
    if (reason.length < 10) {
      toast.error("Motivo obrigatório", { description: "Descreva o motivo com ao menos 10 caracteres." });
      return;
    }
    setReopening(true);
    try {
      const previousStatus = group.status;
      const { error } = await supabase
        .from("payment_company_groups")
        .update({ status: "revisao_analista", validated_by: null, validated_at: null })
        .eq("id", group.id);
      if (error) throw error;

      // Registra em audit_log (tabela já existente — usamos diff/jsonb para metadados)
      await supabase.from("audit_log").insert({
        entity_type: "payment_company_group",
        entity_id: group.id,
        action: "company_group_reopened",
        actor_id: user.id,
        company_id: group.company_id ?? null,
        company_name: group.company_name,
        diff: {
          previous_status: { before: previousStatus, after: "revisao_analista" },
          motivo: { before: null, after: reason },
          payment_id: { before: null, after: id },
        } as never,
      });

      // Observação visível no histórico da empresa
      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user.id,
        message: `[${group.company_name}] Análise reaberta pelo analista. Motivo: ${reason}`,
        status_from: previousStatus,
        status_to: "revisao_analista",
      });

      toast.success("Análise reaberta", { description: "Você pode editar a empresa novamente." });
      setReopenOpen(false);
      setReopenReason("");
      await load();
    } catch (e) {
      toast.error("Falha ao reabrir análise", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setReopening(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Carregando análise…" />
      </div>
    );
  }

  if (!payment || !group) {
    return (
      <div className="space-y-4">
        <PageHeader title="Empresa não encontrada" />
        <Button variant="outline" onClick={() => navigate(`/pagamentos/${id}${groupId ? `#group-${groupId}` : ""}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
        </Button>
      </div>
    );
  }

  const isOwner = payment.created_by === user?.id;
  const isAnalista = hasRole("analista") || hasRole("admin");
  const isAdmin = hasRole("admin");
  const isAdminOrDiretor = hasRole("admin") || hasRole("diretor");
  const canEdit = canEditBatch(gStatus, { isOwner, isAnalista, isAdminOrDiretor, isValidador: hasRole("validador") });
  // Gate por empresa: mesmo que o lote esteja editável, uma empresa concluída
  // (concluida_analista/aguardando_validacao/...) congela até ser reaberta.
  const companyEditable = isCompanyGroupEditable(gStatus);
  const canEditCompany = canEdit && companyEditable;
  // Reabrir análise: só aparece em estados pós-conclusão do analista,
  // e somente para o analista atualmente atribuído ao lote.
  const currentAssignedAnalystId = assignments[0]?.analyst_id ?? null;
  const isCurrentAnalyst = !!user && !!currentAssignedAnalystId && user.id === currentAssignedAnalystId;
  const canReopenCompany =
    isAnalistaRole && isCompanyGroupReopenable(gStatus) && (isCurrentAnalyst || isAdmin);
  const canReimport = canReimportBatch(payment.status as PaymentStatus, { isOwner, isAnalista });
  const isTerminal = ["pago", "rejeitado", "cancelado", "lancado"].includes(payment.status as string);
  const canDelete = isAdmin || (isAnalistaRole && !isTerminal);
  
  console.log("Render Info:", {
    id,
    paymentStatus: payment.status,
    canDelete,
    isAdmin,
    isAnalista,
    userRole: user?.role
  });

  const canActAsVD = canActAsValidatorOrDirector(payment.created_by, user?.id);
  // Em CONFECÇÃO, o estado vivo do grupo está em confeccao_status (gStatus fica
  // em 'rascunho' como placeholder). Em ANÁLISE, o estado vivo é gStatus.
  const gConfeccaoStatus = (group as any)?.confeccao_status as string | null | undefined;
  const isConfeccao = (payment as any)?.analysis_mode === "confeccao";
  const isConfeccaoEditable = isConfeccao && gConfeccaoStatus === "em_confeccao";
  // Governança: analista só atua se for o dono do lote (ou admin).
  // Validador/diretor só atuam se NÃO forem o criador (segregação de funções).
  const canActAnalista =
    (gStatus === "revisao_analista" || gStatus === "devolvido_analista" || gStatus === "aprovado_em_revisao" || isConfeccaoEditable) &&
    isAnalistaRole && (isOwner || isAdmin);
  const canActValidador = gStatus === "aguardando_validacao" && isValidador && canActAsVD;
  const canActDiretor = gStatus === "aguardando_aprovacao" && isDiretor && canActAsVD;
  const canAct = canActAnalista || canActValidador || canActDiretor;
  const canReopenConfeccao =
    isConfeccao && gConfeccaoStatus === "confeccao_concluida" && isAnalistaRole && (isOwner || isAdmin);
  // Em CONFECÇÃO o analista conduz o processo: pode ajustar valores, editar
  // metadados, excluir (soft delete) e adicionar linhas. Esse flag controla
  // os botões da área de itens (separado do canEditCompany que rege ações
  // de análise como acatar/devolver). guardEditable() já cobre a regra
  // server-side e bloqueia se a confecção foi finalizada.
  const canEditItems = canEditCompany || isConfeccaoEditable;
  // (removido) returner: o fluxo unificado de "Concluir análise" não distingue mais reencaminhamento aqui — o envio ao validador é feito no lote inteiro.


  return (
    <div className="space-y-4 pb-32 overflow-x-hidden max-w-full">
      {isConfeccao && (
        <div
          className="sticky top-0 z-40 -mx-3 md:-mx-6 mb-2 border-b-2 border-amber-500/70 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/15 backdrop-blur-sm"
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
              <span className="hidden lg:inline"> O envio para análise é feito no lote inteiro, não por empresa.</span>
            </p>
            <span className="ml-auto text-[10px] font-medium uppercase tracking-wider opacity-80 hidden md:inline">
              Lote {payment.reference}
            </span>
          </div>
        </div>
      )}
      <CancelledGroupBanner
        group={group as unknown as React.ComponentProps<typeof CancelledGroupBanner>["group"]}
        canReactivate={hasRole("admin") || hasRole("diretor") || hasRole("validador")}
        onReactivated={load}
      />
      <CancelledItemsBanner
        items={items as unknown as React.ComponentProps<typeof CancelledItemsBanner>["items"]}
        canReactivate={hasRole("admin") || hasRole("diretor") || hasRole("validador")}
        onReactivated={load}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/pagamentos/${id}#group-${groupId}`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
            </Link>
          </Button>

          <Button variant="outline" size="sm" disabled={busy} onClick={() => setIsReportOpen(true)}>
            <Download className="h-4 w-4 mr-2" /> Exportar relatório
          </Button>

          {(() => {
            const pt = (payment as unknown as { payment_track?: "prioritario" | "habitual" | null })?.payment_track;
            if (!pt) {
              return (
                <Badge variant="outline" className="text-[11px] gap-1">
                  Sem trilha
                </Badge>
              );
            }
            const isPri = pt === "prioritario";
            return (
              <Badge
                variant="outline"
                title="Trilha de pagamento — segmentação comercial usada para comparar e filtrar relatórios"
                className={cn(
                  "text-[11px] gap-1",
                  isPri
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                )}
              >
                Trilha: {isPri ? "Prioritário" : "Habitual"}
              </Badge>
            );
          })()}

          {!isConfeccao && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || hasReconciliationRun === null}
              onClick={handleOpenConciliation}
              title={hasReconciliationRun === false ? "Lote sem conciliação" : "Ver conciliação desta empresa"}
            >
              <GitCompareArrows className="h-4 w-4 mr-2" /> Conciliação desta empresa
            </Button>
          )}

          {canReimport && (
            <>
              <input
                ref={reimportInputRef}
                type="file"
                multiple={true}
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    const newFiles = Array.from(files);
                    setReimportConfirm(prev => prev ? [...prev, ...newFiles] : newFiles);
                    // Reset input value to allow selecting same file again
                    e.target.value = "";
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy || reimporting}
                onClick={() => reimportInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" /> {reimporting ? "Reimportando…" : "Reimportar base"}
              </Button>
              <AlertDialog open={!!reimportConfirm} onOpenChange={(v) => !v && !reimporting && setReimportConfirm(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reimportar base?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <p>Esta ação <strong>substitui apenas os itens desta empresa</strong> ({group.company_name}) pelo conteúdo dos arquivos selecionados e reinicia a análise <strong>somente desta PJ</strong>. As demais empresas do lote não são afetadas. Os arquivos devem conter apenas linhas desta empresa. Não pode ser desfeita.</p>
                      <div className="bg-muted/50 p-2.5 rounded-md border border-border/50">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Arquivos para reimportar ({reimportConfirm?.length}):</p>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-[10px] px-2"
                            onClick={() => reimportInputRef.current?.click()}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Adicionar mais
                          </Button>
                        </div>
                        <ul className="text-xs space-y-1 max-h-[150px] overflow-y-auto pr-1">
                          {reimportConfirm?.map((f, i) => (
                            <li key={i} className="flex items-center justify-between gap-2 group">
                              <span className="truncate flex-1">• {f.name}</span>
                              <button 
                                type="button" 
                                onClick={() => setReimportConfirm(prev => prev?.filter((_, idx) => idx !== i) || null)}
                                className="text-muted-foreground hover:text-destructive p-0.5"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <p className="text-[10px] text-muted-foreground italic bg-info-soft/30 p-1.5 rounded border border-info/20">
                        Dica: Você pode selecionar vários arquivos de uma vez no explorador ou clicar em "Adicionar mais" acima.
                      </p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={reimporting}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={reimporting}
                      onClick={() => reimportConfirm && doReimport(reimportConfirm)}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {reimporting ? "Reimportando…" : "Confirmar"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {canDelete && group && !(group as unknown as { cancelled_at?: string | null }).cancelled_at && (
            <CancelPaymentDialog
              level="group"
              targetId={group.id}
              targetLabel={`${group.company_name} — ${formatCurrency(Number((group as unknown as { liquido_total?: number }).liquido_total ?? group.total_amount ?? 0))}`}
              onCancelled={() => {
                toast.success("Pagamento da empresa cancelado. Vai para o relatório de Pagamentos Cancelados.");
                navigate(`/pagamentos/${id}`, { replace: true });
              }}
              trigger={
                <Button variant="outline" size="sm" className="text-destructive border-destructive/20 hover:bg-destructive/10" disabled={busy}>
                  <XCircle className="h-4 w-4 mr-1" /> Cancelar pagamento da empresa
                </Button>
              }
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEditCompany && (
            <div className="flex items-center gap-2 mr-2 pr-2 border-r">
              <Switch 
                id="group-totalized" 
                checked={items.every(it => it.convenio_value_totalized === true)}
                onCheckedChange={async (checked) => {
                  if (!id || !group) return;
                  setBusy(true);
                  const { error } = await supabase
                    .from("payment_items")
                    .update({ convenio_value_totalized: checked })
                    .eq("payment_id", id)
                    .eq("company_name", group.company_name);
                  
                  if (error) {
                    toast.error("Falha ao atualizar itens: " + error.message);
                  } else {
                    toast.success(checked ? "Valor do convênio marcado como totalizado" : "Valor do convênio marcado como unitário");
                    await recordObservation({
                      payment_id: id,
                      author_type: "analista",
                      author_id: user?.id,
                      message: `[${group.company_name}] Valor do convênio marcado como ${checked ? "TOTALIZADO" : "UNITÁRIO"} para todos os itens. Reanalisando...`,
                    });
                    await reanalyzeGroup();
                  }
                  setBusy(false);
                }}
              />
              <Label htmlFor="group-totalized" className="text-[11px] font-normal text-muted-foreground cursor-pointer whitespace-nowrap">
                Valor convênio já totalizado
              </Label>
            </div>
          )}
          <StatusBadge status={gStatus} />
          {canReopenCompany && (
            <Dialog open={reopenOpen} onOpenChange={(o) => { setReopenOpen(o); if (!o) setReopenReason(""); }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-amber-400 text-amber-700 hover:bg-amber-50">
                  <Undo2 className="h-4 w-4 mr-1.5" />
                  Reabrir análise
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reabrir análise da empresa</DialogTitle>
                  <DialogDescription>
                    A empresa <strong>{group.company_name}</strong> voltará para <strong>Em revisão do analista</strong> e poderá ser editada novamente.
                    O motivo será registrado no histórico e na auditoria.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="reopen-reason" className="text-xs">Motivo da reabertura (obrigatório, mín. 10 caracteres)</Label>
                  <Textarea
                    id="reopen-reason"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value.slice(0, 500))}
                    rows={4}
                    placeholder="Ex.: identificada divergência em 3 itens após conferência manual com a base original."
                    disabled={reopening}
                  />
                  <p className="text-[11px] text-muted-foreground text-right">{reopenReason.trim().length}/500</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReopenOpen(false)} disabled={reopening}>Cancelar</Button>
                  <Button onClick={reopenCompanyAnalysis} disabled={reopening || reopenReason.trim().length < 10}>
                    {reopening ? "Reabrindo…" : "Reabrir"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* TOPO */}
      <Card className="shadow-card">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2 flex-wrap">
                <h1 className="text-xl font-semibold leading-tight break-words min-w-0 flex-1 sm:flex-none sm:max-w-full">{group.company_name}</h1>
                {canEdit && (
                  <Dialog open={changeCompanyOpen} onOpenChange={setChangeCompanyOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 shrink-0">
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Trocar empresa
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="w-[calc(100vw-2rem)] max-w-[min(95vw,720px)] sm:max-w-[min(92vw,720px)]">
                      <DialogHeader>
                        <DialogTitle className="break-words">Trocar empresa do grupo</DialogTitle>
                        <DialogDescription className="break-words">
                          Reatribui todos os {items.length} itens deste grupo à empresa selecionada.
                          O nome atual <strong className="break-words">{group.company_name}</strong> será aprendido como apelido
                          para futuras correspondências automáticas. As regras serão reaplicadas em seguida.
                          {((group as any).approval_version > 0 || (group as any).approved_at) && (
                            <span className="block mt-2 text-amber-700 text-xs">
                              ⚠ Este grupo já foi aprovado. A troca de PJ marca origem e destino como
                              <strong> re-aprovação pendente</strong> e envia novo magic link ao diretor.
                            </span>
                          )}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-2 min-w-0 space-y-3">
                        <CompanyCombobox value={newCompany} onChange={setNewCompany} className="w-full min-w-0 max-w-full" />
                        {((group as any).approval_version > 0 || (group as any).approved_at) && (
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-foreground">
                              Motivo da troca <span className="text-destructive">*</span>
                            </label>
                            <Textarea
                              value={changeCompanyReason}
                              onChange={(e) => setChangeCompanyReason(e.target.value)}
                              placeholder="Ex.: Médico alterou a PJ — produção deve ir para DLM SERVICOS MEDICOS LTDA."
                              rows={3}
                              className="text-sm"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Será exibido ao diretor no e-mail/WhatsApp de re-aprovação.
                            </p>
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setChangeCompanyOpen(false)} disabled={changingCompany}>
                          Cancelar
                        </Button>
                        <Button onClick={changeGroupCompany} disabled={!newCompany || changingCompany}>
                          {changingCompany ? "Atualizando…" : "Confirmar troca"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lote: <span className="font-medium text-foreground">{payment.reference}</span>
              </p>
              {group?.id && (
                <div className="mt-3">
                  <GroupReapprovalBadge companyGroupId={group.id} />
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Itens"
              value={String(group.items_count ?? items.length)}
              tone="info"
              icon={<FileText className="h-4 w-4" />}
            />
            {isConfeccao ? (
              <>
                <Stat
                  label="Repasse calculado"
                  value={formatCurrency(composition.liquido)}
                  sub={`Convênio: ${formatCurrency(composition.bruto)}`}
                  mono
                  tone="warning"
                  icon={<Calculator className="h-4 w-4" />}
                />
                {(() => {
                  const semRegra = items.filter(
                    (it) => !(it as any).applied_rule_id && !(it as any).is_cancelled,
                  ).length;
                  const comRegra = items.filter(
                    (it) => !!(it as any).applied_rule_id && !(it as any).is_cancelled,
                  ).length;
                  return (
                    <>
                      <Stat
                        label="Com regra"
                        value={String(comRegra)}
                        tone={comRegra > 0 ? "success" : "muted"}
                        icon={<FileText className="h-4 w-4" />}
                      />
                      <Stat
                        label="Sem regra"
                        value={String(semRegra)}
                        tone={semRegra > 0 ? "warning" : "muted"}
                        icon={<AlertTriangle className="h-4 w-4" />}
                      />
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <Stat
                  label="Valor líquido"
                  value={formatCurrency(composition.liquido)}
                  sub={`Bruto: ${formatCurrency(composition.bruto)}`}
                  mono
                  tone="success"
                  icon={<Wallet className="h-4 w-4" />}
                />
                <Stat
                  label="Alertas"
                  value={String(counts.alertasTotal)}
                  tone={counts.alertasTotal > 0 ? "warning" : "muted"}
                  icon={<AlertTriangle className="h-4 w-4" />}
                />
                <Stat
                  label="Críticos"
                  value={String(counts.criticosTotal)}
                  tone={counts.criticosTotal > 0 ? "destructive" : "muted"}
                  icon={<ShieldAlert className="h-4 w-4" />}
                />
              </>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Banner de deduções auto-aplicadas (débitos/glosas) */}
      {id && group?.company_id && (
        <DeductionsBanner
          paymentId={id}
          companyId={group.company_id}
          canEdit={isAnalista || isAdminOrDiretor || isValidador}
        />
      )}

      {/* Faixa de composição financeira: Bruto − Débitos − Glosas − Pool ± Conciliação = Líquido */}
      {id && group?.company_id && <FinancialCompositionStrip comp={composition} mode={compMode} />}

      {id && group?.company_id && (
        <MinimumGuaranteeCard
          paymentId={id}
          companyId={group.company_id}
          canRecalc={isAdminOrDiretor}
        />
      )}

      {/* Notas pessoais + marcadores (Fixar / Aguardando info / Já revisei) — visíveis apenas para você. */}
      {id && groupId && (
        <PrivateCompanyNote
          note={privateNotes[groupId]?.note ?? ""}
          marker={privateNotes[groupId]?.marker ?? null}
          waitingInfo={privateNotes[groupId]?.waiting_info ?? ""}
          attachments={privateAttachments[groupId] ?? []}
          saveStatus={privateSaveStatus[groupId] ?? "idle"}
          onNoteChange={(v) => setPrivateNote(groupId, v)}
          onMarkerChange={(m) => setPrivateMarker(groupId, m)}
          onWaitingInfoChange={(v) => setPrivateWaitingInfo(groupId, v)}
          onUploadAttachment={(file) => uploadPrivateAttachment(groupId, file)}
          onDeleteAttachment={(attId) => deletePrivateAttachment(groupId, attId)}
          onDownloadAttachment={(att) => downloadPrivateAttachment(att)}
        />
      )}






      {/* Thread de questionamentos foi movida para o modal de Conversas (FAB) —
          o bloco redundante na página foi removido a pedido do usuário. */}


      {/* ABAS */}
      <Tabs defaultValue="analise" className="space-y-3">
        <TabsList>
          <TabsTrigger value="analise">
            {(payment as any)?.analysis_mode === "confeccao" ? "Confecção" : "Análise"}
          </TabsTrigger>
          {(payment as any)?.analysis_mode === "confeccao" && (
            <TabsTrigger value="confeccao-audit" data-testid="tab-confeccao-audit">
              Auditoria de cálculo
            </TabsTrigger>
          )}
          {!isConfeccao && (
            <TabsTrigger value="divergencias">
              Divergências
              {divergentes.length > 0 && (
                <Badge variant="secondary" className="ml-2">{divergentes.length}</Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="historico">
            <History className="h-3.5 w-3.5 mr-1" /> Histórico
          </TabsTrigger>
          {!isConfeccao && <TabsTrigger value="ia">Detalhe IA</TabsTrigger>}
        </TabsList>

        {/* ABA 1 — Análise */}
        <TabsContent value="analise" className="space-y-3">
          {payment?.processing_timeout_occurred && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <Clock className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-destructive leading-tight">
                  Análise Incompleta (Timeout detectado)
                </p>
                <p className="text-[11px] text-destructive/80 leading-snug">
                  O motor de regras processou todos os itens, mas a IA excedeu o tempo limite ao gerar as justificativas. 
                  {payment.processing_diagnostics && typeof payment.processing_diagnostics === 'object' && (
                    <>
                      {" "}Apenas <strong>{(payment.processing_diagnostics as any).ai_processed_items ?? 0}</strong> de <strong>{(payment.processing_diagnostics as any).total_items ?? 0}</strong> alertas foram revisados.
                    </>
                  )}
                  {" "}Você pode clicar em "Reaplicar regras" para tentar processar o restante.
                </p>
              </div>
            </div>
          )}
          <HighlightBanner observations={obs} profiles={profiles} />
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Itens</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {items.length} itens · use os filtros do grid para focar em status, convênio, médico ou alertas.
                    {payment?.processing_timeout_occurred && (
                      <span className="ml-2 text-destructive font-medium">⚠️ Algumas justificativas da IA podem estar ausentes por timeout.</span>
                    )}
                  </p>
                </div>
                {canEditItems && (
                  <Button size="sm" variant="outline" onClick={() => setManualItemOpen(true)} className="shrink-0">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar item manual
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 max-h-[70vh] sm:max-h-none overflow-y-auto overscroll-contain">
              <SpecialCaseHeaderBanner paymentId={id} companyId={group.company_id ?? null} canUse={isAnalista || isDiretor} />
              <ItemsDataGrid

                items={items}
                groupStatus={gStatus}
                rulesIndex={rulesIndex}
                rulesByName={rulesByName}
                observations={obs}
                profiles={profiles}
                storageKey="companyAnalysisPage"
                canEdit={canEditItems}
                onEditItem={openEditItem}
                onDeleteItem={async (it) => {
                  const tipo = String((it as any).tipo_linha ?? "").toLowerCase();
                  const isBonus = tipo.includes("bonus");
                  const isOrphanBonus = isBonus && !(it as any).applied_rule_id;
                  if (!isOrphanBonus) {
                    setDeleteItem(it);
                    return;
                  }
                  // Bônus órfão (veio na base, não foi gerado pelo motor).
                  // Hard delete: linhas extras que não impactam regras nem auditoria de cancelamento.
                  const ok = await confirmDialog({
                    title: "Excluir bônus importado?",
                    description: `Esta linha de bônus veio da base original e será removida permanentemente. O motor continuará aplicando os bônus calculados pelas regras vinculadas. Deseja excluir "${(it as any).doctor_name ?? "—"} · ${formatCurrency(Number(it.gross_amount ?? 0))}"?`,
                    confirmText: "Excluir",
                    tone: "danger",
                  });
                  if (!ok) return;
                  try {
                    hideItemImmediately(it.id);
                    await supabase.from("reconciliation_items").delete().eq("payment_item_id", it.id);
                    const { error } = await supabase.from("payment_items").delete().eq("id", it.id);
                    if (error) throw error;
                    toast.success("Bônus removido");
                    await load();
                    await composition.refresh();
                  } catch (e) {
                    restoreItemVisibility(it.id);
                    const msg = (e as any)?.message ?? String(e);
                    toast.error("Falha ao excluir", { description: msg });
                    await load();
                  }
                }}
                onAcceptItem={acceptItem}
                onUndoAcceptItem={undoAcceptItem}
                mode={(payment as any).analysis_mode === "confeccao" ? "confeccao" : "analise"}
                onRefresh={() => { void (async () => { await load(); await composition.refresh(); })(); }}
              />
            </CardContent>
          </Card>
          {group && (
            <AddManualItemDialog
              open={manualItemOpen}
              onOpenChange={setManualItemOpen}
              paymentId={id!}
              companyId={group.company_id ?? null}
              companyName={group.company_name}
              onCreated={() => { void load(); }}
            />
          )}

          {/* Comentário / Observação geral da empresa (unificado) */}
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                Observação geral da empresa
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Use este campo para registrar comentários, observações de fluxo ou questionamentos ao diretor. Em caso de ambiguidade, marque como questionamento — o diretor será notificado para esclarecer.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
             <Textarea
                placeholder={
                  canActAnalista
                    ? "Observação geral da empresa (opcional · obrigatória se houver itens acatados, mín. 20 caracteres)…"
                    : "Observação para esta empresa (obrigatória para devolver)…"
                }
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                rows={3}
                className={cn(
                  items.some((i) => i.ai_status === "acatado") && groupDraft.trim().length < 20
                    && "border-amber-500/70 focus-visible:ring-amber-500/40"
                )}
              />
              {items.some((i) => i.ai_status === "acatado") && groupDraft.trim().length < 20 && (
                <p className="text-xs text-amber-600">
                  Há itens acatados nesta empresa. Preencha a observação (mín. 20 caracteres) para liberar o envio para validação.
                </p>
              )}
              <div className="flex flex-col gap-3">
                <ObservationTypeSelector
                  value={groupCommentType}
                  onChange={setGroupCommentType}
                  disabled={busy}
                />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="is-question"
                      checked={isQuestion}
                      onCheckedChange={(v) => setIsQuestion(!!v)}
                    />
                    <Label htmlFor="is-question" className="text-xs font-normal cursor-pointer select-none">
                      Em caso de ambiguidade, marcar como questionamento ao diretor (aguarda resposta)
                    </Label>
                  </div>
                  <Button size="sm" variant="outline" onClick={addGroupComment} disabled={busy || !groupDraft.trim()}>
                    Salvar como comentário no histórico
                  </Button>
                </div>
              </div>
              {groupComments.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {groupComments.slice(0, 5).map((o) => (
                    <li key={o.id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                      <div className="text-muted-foreground mb-0.5">
                        {o.author_type}
                        {o.author_id && profiles[o.author_id] ? ` · ${profiles[o.author_id]}` : ""}
                        {" · "}{formatDateTimeBR(o.created_at)}
                      </div>
                      <div className="whitespace-pre-wrap">{o.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2 — Divergências (não existe em confecção) */}
        {!isConfeccao && (
          <TabsContent value="divergencias" className="space-y-3">
            {divergentes.length === 0 ? (
              <Card className="shadow-card">
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma divergência identificada para esta empresa.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {divergentes.slice(0, divergencesVisible).map((it) => (
                  <DivergenceCard
                    key={it.id}
                    it={it}
                    comments={itemComments(it.id)}
                    profiles={profiles}
                    draft={itemDraft[it.id] ?? ""}
                    onDraftChange={(v) => setItemDraft((m) => ({ ...m, [it.id]: v }))}
                    type={itemCommentType[it.id] ?? "informativo"}
                    onTypeChange={(v) => setItemCommentType((m) => ({ ...m, [it.id]: v }))}
                    onAdd={() => addItemComment(it.id)}
                    busy={busy}
                  />
                ))}
                {divergencesVisible < divergentes.length && (
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                    <span className="text-xs text-muted-foreground">
                      Mostrando {divergencesVisible} de {divergentes.length}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDivergencesVisible((n) => Math.min(divergentes.length, n + DIVERGENCE_PAGE_SIZE))
                      }
                    >
                      Carregar mais
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        )}



        {/* ABA — Histórico unificado (IA + analistas/validadores/diretores) */}
        <TabsContent value="historico" className="space-y-3">
          <CompanyHistoryPanel
            items={items}
            observations={obs}
            aiVersions={aiVersions}
            assignments={assignments}
            profiles={profiles}
          />
        </TabsContent>

        {/* ABA 3 — Detalhe IA (oculta em confecção: motor de regras não roda IA) */}
        {!isConfeccao && (
          <TabsContent value="ia" className="space-y-3">
            <AiDetail items={items} versions={aiVersions} />
          </TabsContent>
        )}


        {/* ABA Confecção — auditoria de cálculo (só no modo confecção) */}
        {(payment as any)?.analysis_mode === "confeccao" && (
          <TabsContent value="confeccao-audit" className="space-y-3">
            <ConfeccaoAuditPanel items={items} rulesIndex={rulesIndex} />
          </TabsContent>
        )}
      </Tabs>

      {/* Footer sticky com ações de fluxo */}
      {canReopenConfeccao && (
        <div className="sticky bottom-0 z-30 -mx-3 md:-mx-6 mt-4 border-t bg-background/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.2)]">
          <div className="mx-auto max-w-[1400px] flex flex-wrap items-center justify-end gap-2">
            <div className="mr-auto flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confecção desta empresa finalizada — reanálise bloqueada.
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={reopenConfeccaoGroup}
              disabled={busy}
              className="border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
            >
              <Undo2 className="h-4 w-4 mr-2" />
              Reabrir confecção
            </Button>
          </div>
        </div>
      )}
      {canAct && (
        <div className="sticky bottom-0 z-30 -mx-3 md:-mx-6 mt-4 border-t bg-background/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.2)]">
          <div className="mx-auto max-w-[1400px] flex flex-wrap items-center justify-end gap-2">

              {canActAnalista && (
                <>
                  {(gStatus === "revisao_analista" || gStatus === "devolvido_analista" || isConfeccaoEditable) && (
                    <>
                      <Button variant="outline" size="sm" onClick={reanalyzeGroup} disabled={busy || reanalyzing}>
                        <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzing && "animate-spin")} />
                        {isConfeccao
                          ? (reanalyzing ? "Recalculando..." : "Recalcular repasse")
                          : (reanalyzing ? "Reaplicando..." : "Reaplicar regras")}
                      </Button>
                      {/* "Cancelar lote" removido: para desfazer um lote inteiro use Excluir lote em PaymentDetail.
                          Cancelar PJ ou item específico (não-devido) é feito pelo botão Cancelar pagamento da empresa. */}
                      {(() => {
                        const temItemAcatado = items.some((i) => i.ai_status === "acatado");
                        const observacaoOk = groupDraft.trim().length >= 20;
                        // Em confecção a observação obrigatória não se aplica — não há "acatado" indo para validador.
                        const podeEnviar = isConfeccao ? true : (!temItemAcatado || observacaoOk);
                        const tooltip = !podeEnviar
                          ? "Preencha a observação da empresa (mín. 20 caracteres) para enviar itens acatados"
                          : (isConfeccao
                              ? "Marca esta empresa como pronta. O envio para análise é feito no lote (Encaminhar para análise)."
                              : undefined);
                        const handleClick = () => {
                          if (!podeEnviar) {
                            toast.error("Observação obrigatória", {
                              description:
                                "Há itens acatados nesta empresa. Preencha o comentário geral da empresa com no mínimo 20 caracteres antes de enviar para validação.",
                            });
                            return;
                          }
                          if (isConfeccao) {
                            finalizeConfeccaoGroup();
                          } else {
                            sendForValidation();
                          }
                        };
                        return (
                          <Button
                            size="sm"
                            onClick={handleClick}
                            disabled={busy}
                            title={tooltip}
                            className={podeEnviar ? (isConfeccao ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white") : ""}
                            variant={podeEnviar ? "default" : "secondary"}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            {isConfeccao ? "Finalizar confecção" : "Concluir análise"}
                          </Button>
                        );
                      })()}
                    </>
                  )}
                  {gStatus === "aprovado_em_revisao" && (
                    <Button
                      size="sm"
                      onClick={() => transitionGroupStatus("pedido_nf_enviado", "analista", "Pedido de nota enviado pelo analista", false)}
                      disabled={busy}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Enviar pedido de nota
                    </Button>
                  )}
                </>
              )}
            {/* Ações de validador/diretor por empresa foram movidas para o footer
                de ações em lote no PaymentDetail (Questionar / Devolver / Aprovar). */}
          </div>
        </div>
      )}
      {/* (thread movida para o topo da página, acima das abas) */}
      {/* Editar item */}
      <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{(payment as any)?.analysis_mode === "confeccao" ? "Editar linha (confecção)" : "Editar item"}</DialogTitle>
            <DialogDescription>
              {(payment as any)?.analysis_mode === "confeccao"
                ? "Ajuste os dados da linha. Após salvar, o motor recalcula o repasse esperado."
                : "Ajuste valores ou metadados desta linha. O item será reanalisado pela IA."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Médico</Label>
              <Input value={editDraft.doctor_name} onChange={(e) => setEditDraft((d) => ({ ...d, doctor_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Valor (R$)</Label>
              <Input value={editDraft.gross_amount} onChange={(e) => setEditDraft((d) => ({ ...d, gross_amount: e.target.value }))} inputMode="decimal" />
              {(() => {
                if (!editItem) return null;
                const gross = Number(editItem.gross_amount ?? 0);
                const expected = editItem.expected_amount != null ? Number(editItem.expected_amount) : null;
                const hasSuggestion = expected != null && Number.isFinite(expected) && Math.abs(expected - gross) > 0.001;
                if (!hasSuggestion) return null;
                const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                const currentDraft = Number(editDraft.gross_amount.replace(",", "."));
                const draftMatchesSuggestion = Math.abs(currentDraft - (expected as number)) < 0.001;
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      Sugestão IA: <strong className="text-foreground">{fmt(expected as number)}</strong>{" "}
                      · Original: {fmt(gross)}
                    </span>
                    {draftMatchesSuggestion ? (
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => setEditDraft((d) => ({ ...d, gross_amount: String(gross) }))}
                      >
                        restaurar original
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => setEditDraft((d) => ({ ...d, gross_amount: String(expected) }))}
                      >
                        usar sugestão
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
            <div>
              <Label className="text-xs">Especialidade</Label>
              <Input value={editDraft.specialty} onChange={(e) => setEditDraft((d) => ({ ...d, specialty: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input value={editDraft.description} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)} disabled={savingItem}>Cancelar</Button>
            <Button onClick={saveItem} disabled={savingItem}>{savingItem ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir item */}
      {/* Cancelar item (não-devido) */}
      {deleteItem && (
        <CancelPaymentDialog
          level="item"
          targetId={deleteItem.id}
          targetLabel={`${deleteItem.doctor_name ?? "—"} · ${formatCurrency(Number(deleteItem.gross_amount ?? 0))}`}
          open={!!deleteItem}
          onOpenChange={(v) => { if (!v) setDeleteItem(null); }}
          onCancelled={() => {
            const cancelledId = deleteItem.id;
            // Update otimista: remove imediatamente da grid
            hideItemImmediately(cancelledId);
            setDeleteItem(null);
            // Refetch para sincronizar totais/contadores
            load();
          }}
        />
      )}

      {payment && (
        <PaymentReportModal
          open={isReportOpen}
          onOpenChange={setIsReportOpen}
          payment={payment}
          items={items}
          groups={group ? [group] : []}
          rulesIndex={rulesIndex}
          analystName={user?.id ? profiles[user.id] : undefined}
          observations={obs}
          profiles={profiles}
        />
      )}

      {payment && group && (
        <PaymentConciliationModal
          open={isConciliationOpen}
          onOpenChange={(open) => {
            setIsConciliationOpen(open);
            if (!open) {
              // Recarrega snapshot financeiro: cancelamentos via conciliação
              // alteram is_cancelled e precisam refletir no Valor Líquido / Bruto.
              composition.refresh();
            }
          }}
          paymentId={payment.id}
          paymentReference={payment.reference}
          paymentItems={items}
          initialCompany={group.company_name}
          onItemsChanged={() => {
            // Cancelamento ocorreu dentro do modal — recomputa Bruto/Líquido
            // imediatamente, sem esperar o usuário fechar a conciliação.
            composition.refresh();
          }}
        />
      )}

      <ReapplyRulesProgressDialog
        open={reapplyOpen}
        onOpenChange={setReapplyOpen}
        phase={reapplyPhase}
        step={reapplyStep}
        elapsedSec={reapplyElapsed}
        totalItems={items.length}
        errorMessage={reapplyError}
        diff={reapplyDiff}
        companyLabel={group?.company_name}
        mode={isConfeccao ? "confeccao" : "analise"}
      />


      <AlertDialog open={postConcluirOpen} onOpenChange={setPostConcluirOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Análise concluída</AlertDialogTitle>
            <AlertDialogDescription>
              Para onde você quer ir agora?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { setPostConcluirOpen(false); navigate("/"); }}>
              Ir para o Dashboard
            </Button>
            <Button onClick={() => { setPostConcluirOpen(false); navigate(`/pagamentos/${id}`); }}>
              Voltar para o Lote
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* FAB Conversas — abre o modal de bate-papo já escopado a esta empresa,
          em vez de rolar até o bloco interno de questionamentos. */}
      {id && groupId && group && canConverse && (
        <QuestionsFab
          openCount={unreadQuestionsCount}
          onClick={() => setConversationsOpen(true)}
          className="bottom-24"
        />
      )}

      {id && user && group && canConverse && (
        <ConversationsSheet
          open={conversationsOpen}
          onOpenChange={setConversationsOpen}
          paymentId={id}
          paymentLabel={(payment as any)?.reference ?? (payment as any)?.competence_month ?? null}
          paymentStatus={(payment?.status as string) ?? null}
          groups={[{ id: group.id, company_name: group.company_name }]}
          profiles={profiles}
          currentUserId={user.id}
          currentUserName={profiles[user.id] ?? user.email ?? "Equipe interna"}
          currentRole={isDiretor ? "diretor" : isValidador ? "validador" : "analista"}
          initialCompose={conversationsOpen ? { groupId: group.id, companyName: group.company_name } : null}
        />
      )}
      {mappingPrompt && (
        <ColumnMappingDialog
          open={!!mappingPrompt}
          onOpenChange={(o) => { if (!o) setMappingPrompt(null); }}
          fileName={mappingPrompt.file.name}
          headers={mappingPrompt.headers}
          initialMapping={mappingPrompt.initialMapping}
          sampleRow={mappingPrompt.sampleRow}
          hospitalId={(payment as any)?.hospital_id ?? null}
          mode={isConfeccao ? "confeccao" : "analise"}
          onApply={(mapping) => {
            const file = mappingPrompt.file;
            setMappingOverrides((prev) => ({ ...prev, [file.name]: mapping }));
            setMappingPrompt(null);
            // Reexecuta a reimportação passando o override explicitamente —
            // setState é assíncrono e o closure de doReimport ainda veria vazio.
            const files = reimportConfirm ?? [file];
            void doReimport(files, { [file.name]: mapping });
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  mono,
  tone = "muted",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  icon?: React.ReactNode;
}) {
  // Cada tom tem: chip do ícone (fundo soft + texto da cor) e barra lateral.
  const tones: Record<typeof tone, { chip: string; bar: string; value: string }> = {
    muted: { chip: "bg-muted text-muted-foreground", bar: "bg-border", value: "text-foreground" },
    info: { chip: "bg-info-soft text-info", bar: "bg-info", value: "text-foreground" },
    success: { chip: "bg-success-soft text-success", bar: "bg-success", value: "text-foreground" },
    warning: { chip: "bg-warning-soft text-warning-text", bar: "bg-warning", value: "text-foreground" },
    destructive: { chip: "bg-destructive/10 text-destructive", bar: "bg-destructive", value: "text-foreground" },
  };
  const t = tones[tone];
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card shadow-soft">
      <span aria-hidden className={cn("absolute left-0 top-0 h-full w-1", t.bar)} />
      <div className="flex items-start gap-3 px-3 py-3 pl-4">
        {icon && (
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-md flex-shrink-0", t.chip)}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={cn("mt-1 text-lg sm:text-xl font-semibold leading-tight break-words", mono && "tabular-nums", t.value)}>{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ItemsTable foi substituída por <ItemsDataGrid /> compartilhado.

function DivergenceCard({
  it,
  comments,
  profiles,
  draft,
  onDraftChange,
  type,
  onTypeChange,
  onAdd,
  busy,
}: {
  it: PaymentItemRow;
  comments: ObservationRow[];
  profiles: Record<string, string>;
  draft: string;
  onDraftChange: (v: string) => void;
  type: ObservationType;
  onTypeChange: (v: ObservationType) => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const alerts = (it.ai_findings?.alerts ?? []) as string[];
  const isCritico = it.ai_status === "reprovado";
  const expected = it.ai_findings?.expected_amount;
  const raw = (it.raw_data ?? {}) as Record<string, unknown>;
  const paciente =
    (it.patient_name as string | null) ??
    ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
    "—";
  return (
    <Card
      className={cn(
        "shadow-card border-l-4",
        isCritico ? "border-l-destructive" : "border-l-warning",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isCritico ? (
                <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{paciente}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground truncate">{it.doctor_name}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {it.procedure_code && (
                <span>
                  TUSS: <span className="font-mono text-foreground">{it.procedure_code}</span>
                </span>
              )}
              {it.attendance_number && (
                <span>
                  Atend.: <span className="font-mono text-foreground">{it.attendance_number}</span>
                </span>
              )}
              <span>
                Valor: <span className="tabular-nums text-foreground">{formatCurrency(Number(it.gross_amount ?? 0))}</span>
              </span>
              {expected != null && (
                <span>
                  Esperado: <span className="tabular-nums text-foreground">{formatCurrency(Number(expected))}</span>
                </span>
              )}
              {(() => {
                const basis = (it as any).convenio_basis_detected as string | null | undefined;
                const qty = Number((it as any).quantity ?? 1);
                if (!basis || basis === "na" || qty <= 1) return null;
                const label =
                  basis === "unit" ? `Base: unitário × ${qty}` :
                  basis === "total" ? "Base: já totalizado" :
                  "Base: ambígua";
                const cls =
                  basis === "ambiguous"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-border bg-muted text-foreground";
                return (
                  <span
                    title="Detecção automática (stateless) da base do valor convênio com base no que casa com o pago."
                    className={cn(
                      "inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-medium",
                      cls,
                    )}
                  >
                    {label}
                  </span>
                );
              })()}

            </div>
          </div>
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-[10px] shrink-0",
              isCritico ? TONE_CLASSES.destructive : TONE_CLASSES.warning,
            )}
          >
            {isCritico ? "Crítico" : "Alerta"}
          </span>
        </div>

        {alerts.length > 0 && (
          <ul className="space-y-1 text-xs">
            {alerts.map((a, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground">•</span>
                <span className="whitespace-pre-wrap">{a}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Comentários por item */}
        {comments.length > 0 && (
          <ul className="space-y-1.5">
            {comments.slice(0, 3).map((o) => (
              <li key={o.id} className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                <div className="text-muted-foreground text-[10px] mb-0.5">
                  {o.author_type}
                  {o.author_id && profiles[o.author_id] ? ` · ${profiles[o.author_id]}` : ""}
                  {" · "}{formatDateTimeBR(o.created_at)}
                </div>
                <div className="whitespace-pre-wrap">{o.message}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Textarea
              placeholder="Comentar este item…"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              rows={2}
              className="flex-1"
            />
            <Button size="sm" onClick={onAdd} disabled={busy || !draft.trim()} className="self-end">
              Comentar
            </Button>
          </div>
          <ObservationTypeSelector
            value={type}
            onChange={onTypeChange}
            disabled={busy}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AiDetail({ items, versions }: { items: PaymentItemRow[]; versions: AiVersionRow[] }) {
  const withExplanation = items.filter((it) => {
    const f = it.ai_findings as AiFindings | null;
    return (
      (f?.calculation_explanation && f.calculation_explanation.trim().length > 0) ||
      (f?.matched_rules && f.matched_rules.length > 0)
    );
  });
  if (withExplanation.length === 0) {
    return (
      <Card className="shadow-card">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma explicação de regra disponível para esta empresa.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {withExplanation.map((it) => {
        const f = it.ai_findings as AiFindings;
        const lastVersion = versions.find((v) => v.item_id === it.id);
        const raw = (it.raw_data ?? {}) as Record<string, unknown>;
        const paciente =
          (it.patient_name as string | null) ??
          ((raw["Paciente"] ?? raw["paciente"]) as string | null) ??
          "—";
        return (
          <Card key={it.id} className="shadow-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-info" />
                <span className="text-sm font-medium truncate">{paciente}</span>
                <span className="text-xs text-muted-foreground">· {it.doctor_name}</span>
                {lastVersion && (
                  <span className="text-[10px] text-muted-foreground ml-auto">v{lastVersion.version}</span>
                )}
              </div>
              {f.matched_rules && f.matched_rules.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Regras aplicadas:{" "}
                  <span className="text-foreground">{f.matched_rules.join(", ")}</span>
                </div>
              )}
              {f.calculation_explanation && (
                <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">
                  {f.calculation_explanation}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}