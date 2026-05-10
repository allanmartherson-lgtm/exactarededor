import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { InvoiceQuestionsThread, type InvoiceQuestion } from "@/components/InvoiceQuestionsThread";
import { PaymentTimeline } from "@/components/payment-detail/PaymentTimeline";
import { PaymentInternalQuestionsPanel } from "@/components/payment-detail/PaymentInternalQuestionsPanel";
import { PaymentReportModal } from "@/components/payment-detail/PaymentReportModal";

import { PaymentGroupCard } from "@/components/payment-detail/PaymentGroupCard";
import { scoreAttendance, calculateFinancialRisk } from "@/lib/riskScore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { recordObservation, type ObservationType } from "@/lib/observations";
import { claimPayment } from "@/lib/assignments";
import { AssignmentCard } from "@/components/payment-detail/AssignmentCard";
import { usePaymentDetailData } from "@/hooks/usePaymentDetailData";
import type {
  PaymentItemRow as PaymentItemRowType,
  GroupRow,
  AiVersionRow,
} from "@/hooks/usePaymentDetailData";
import type { Database } from "@/integrations/supabase/types";

type PaymentUpdate = Database["public"]["Tables"]["payments"]["Update"];
type GroupUpdate = Database["public"]["Tables"]["payment_company_groups"]["Update"];
import { formatCurrency, formatDate, formatCompetence, formatDateOnly, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentStatus, type ItemAiStatus, TONE_CLASSES } from "@/lib/status";
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
import { AlertTriangle, ArrowLeft, Ban, CalendarDays, ChevronDown, ChevronRight, FileDown, GitCompare, History, Mail, MessageCircleQuestion, MessageSquarePlus, RefreshCw, Search, Send, Sparkles, Trash2, Upload, X, Info, ShieldAlert, Pencil, BarChart3 } from "lucide-react";

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


const itemToneMap: Record<ItemAiStatus, keyof typeof TONE_CLASSES> = {
  pendente: "muted", aprovado: "success", alerta: "warning", reprovado: "destructive",
};

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const location = useLocation();

  const {
    payment,
    items,
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
    load,
  } = usePaymentDetailData(id);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyItemFilter, setHistoryItemFilter] = useState<string>("all");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [obsType, setObsType] = useState<ObservationType>("informativo");
  const [itemCommentDraft, setItemCommentDraft] = useState<Record<string, string>>({});
  const [itemCommentIsQuestion, setItemCommentIsQuestion] = useState<Record<string, boolean>>({});
  const [itemCommentType, setItemCommentType] = useState<Record<string, ObservationType>>({});
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [groupComment, setGroupComment] = useState<Record<string, string>>({});
  const [groupCommentType, setGroupCommentType] = useState<Record<string, ObservationType>>({});
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [metaDraft, setMetaDraft] = useState<{ reference: string; description: string; payment_due_date: string }>({ reference: "", description: "", payment_due_date: "" });
  const [savingMeta, setSavingMeta] = useState(false);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);
  const [reimporting, setReimporting] = useState(false);
  const [reimportConfirm, setReimportConfirm] = useState<File | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [groupAiOpen, setGroupAiOpen] = useState<Set<string>>(new Set());
  const [reanalyzingGroupId, setReanalyzingGroupId] = useState<string | null>(null);
  const [reprocessingAi, setReprocessingAi] = useState(false);
  const [reprocessConfirmOpen, setReprocessConfirmOpen] = useState(false);
  const [reprocessFilter, setReprocessFilter] = useState<string[]>([]);
  const [openQuestionInvoiceId, setOpenQuestionInvoiceId] = useState<string | null>(null);
  const [isQuestionsPanelOpen, setIsQuestionsPanelOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  // Busca dentro do detalhe (filtra grupos/itens por PJ, médico, atendimento, CC,
  // especialidade e descrição). Não esconde grupos cujo nome casa com a busca.
  const [itemSearch, setItemSearch] = useState("");
  const [criticalFilter, setCriticalFilter] = useState<"all" | "no_rule" | "divergent" | "approved" | "approved_strict">("all");
  const [toleranceValue, setToleranceValue] = useState<number>(0.01);

  useEffect(() => {
    document.title = "Pagamento | MedPay";
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
  };

  // Analista reaplica as regras (reanálise da IA) APENAS para os itens da empresa devolvida,
  // antes de reencaminhar. Isso recalcula expected_amount, alerts e matched_rules.
  const reanalyzeGroup = async (g: GroupRow) => {
    if (!id) return;
    setReanalyzingGroupId(g.id);
    await autoClaim();
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: id, company_name: g.company_name },
      });
      if (error) throw error;
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
      await load();
      toast({ title: "Regras reaplicadas", description: `IA reanalisou os itens de ${g.company_name}.` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao reaplicar regras", description: msg, variant: "destructive" });
    } finally {
      setReanalyzingGroupId(null);
    }
  };

  // Analista enviar para validação (todos os grupos em revisao_analista ou devolvido_analista).
  // A validação é fila coletiva: qualquer validador pode assumir.
  const sendForValidation = async (onlyGroupId?: string) => {
    if (!id) return;
    const targets = (onlyGroupId ? groups.filter((g) => g.id === onlyGroupId) : groups)
      .filter((g) => g.status === "revisao_analista" || g.status === "devolvido_analista");
    if (targets.length === 0) {
      toast({ title: "Nada para enviar", description: "Nenhuma empresa pronta para validação." });
      return;
    }
    setBusy(true);
    await autoClaim();
    for (const g of targets) {
      const { error: upErr } = await supabase.from("payment_company_groups")
        .update({ status: "aguardando_validacao" })
        .eq("id", g.id);
      if (upErr) {
        toast({ title: `Falha em ${g.company_name}`, description: upErr.message, variant: "destructive" });
        continue;
      }
      const obsRes = await recordObservation({
        payment_id: id, author_type: "analista", author_id: user!.id,
        message: `[${g.company_name}] Enviado para validação pelo analista.`,
        status_from: g.status, status_to: "aguardando_validacao",
      });
      if (!obsRes.ok) {
        toast({ title: `Histórico não registrado em ${g.company_name}`, description: obsRes.error, variant: "destructive" });
      }
      // Notifica todos os validadores (fila coletiva) + auditoria. Fire-and-forget.
      supabase.functions.invoke("notify-validator-assignment", {
        body: {
          payment_id: id,
          group_id: g.id,
          sender_id: user!.id,
        },
      }).catch((e) => console.warn("notify-validator-assignment failed", g.id, e));
    }
    await load();
    setBusy(false);
    toast({ title: "Enviado para validação", description: `${targets.length} empresa(s) a caminho do validador.` });
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
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("Validação de Pagamento Médico", 14, 18);
    doc.setFontSize(10);
    doc.text(`Referência: ${payment.reference}`, 14, 28);
    doc.text(`Status: ${payment.status}`, 14, 34);
    doc.text(`Total: ${formatCurrency(payment.total_amount)}`, 14, 40);

    // Aprovador / data: prioriza payment.approved_*; se ausente (aprovação por
    // grupo agregada por trigger), deriva do grupo aprovado mais recente.
    const approvedGroups = groups.filter((g) => g.approved_at && g.approved_by);
    const latestApprovedGroup = approvedGroups
      .slice()
      .sort((a, b) => (a.approved_at! < b.approved_at! ? 1 : -1))[0];
    const approverId = payment.approved_by ?? latestApprovedGroup?.approved_by ?? null;
    const approverAt = payment.approved_at ?? latestApprovedGroup?.approved_at ?? null;
    const aprovador = approverId ? (profiles[approverId] ?? "—") : "—";
    const aprovadoEm = approverAt ? formatDate(approverAt) : "—";
    doc.text(`Aprovado por: ${aprovador}  ·  em: ${aprovadoEm}`, 14, 46);

    // Totais por empresa — visão executiva antes do detalhamento.
    let cursorYTop = 54;
    if (groups.length > 0) {
      doc.setFontSize(12);
      doc.text(`Totais por empresa (${groups.length})`, 14, cursorYTop);
      autoTable(doc, {
        startY: cursorYTop + 4,
        head: [["Empresa", "Itens", "Status", "Total"]],
        body: groups.map((g) => [
          g.company_name,
          String(g.items_count ?? 0),
          g.status,
          formatCurrency(g.total_amount ?? 0),
        ]),
        foot: [[
          "Total geral",
          String(groups.reduce((s, g) => s + (g.items_count ?? 0), 0)),
          "",
          formatCurrency(payment.total_amount),
        ]],
        styles: { fontSize: 9 },
        footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      });
      type DocWithLastTable2 = jsPDF & { lastAutoTable?: { finalY?: number } };
      cursorYTop = ((doc as DocWithLastTable2).lastAutoTable?.finalY ?? cursorYTop) + 8;
    }

    autoTable(doc, {
      startY: cursorYTop,
      head: [["Médico", "Doc", "Descrição", "Valor", "IA"]],
      body: items.map((i) => [i.doctor_name, i.doctor_document ?? "", i.description ?? "", formatCurrency(i.gross_amount), i.ai_status]),
      styles: { fontSize: 8 },
    });

    // Divergências relevantes (alertas/reprovações)
    type DocWithLastTable = jsPDF & { lastAutoTable?: { finalY?: number } };
    let cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? 60) + 8;
    const divergencias = items.filter(
      (i) => i.ai_status === "alerta" || i.ai_status === "reprovado" || (i.ai_findings?.alerts?.length ?? 0) > 0,
    );
    if (divergencias.length > 0) {
      doc.setFontSize(12);
      doc.text(`Divergências (${divergencias.length})`, 14, cursorY);
      autoTable(doc, {
        startY: cursorY + 4,
        head: [["Item", "Status", "Motivos"]],
        body: divergencias.map((i) => [
          `${i.doctor_name}${i.attendance_number ? ` · #${i.attendance_number}` : ""}`,
          i.ai_status,
          ((i.ai_findings?.alerts ?? []) as string[]).join(" | ") || "—",
        ]),
        styles: { fontSize: 8, cellWidth: "wrap" },
        columnStyles: { 2: { cellWidth: 110 } },
      });
      cursorY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? cursorY) + 8;
    }

    // Histórico (observações) — base de auditoria
    if (obs.length > 0) {
      if (cursorY > 250) { doc.addPage(); cursorY = 20; }
      doc.setFontSize(12);
      doc.text(`Histórico de observações (${obs.length})`, 14, cursorY);
      autoTable(doc, {
        startY: cursorY + 4,
        head: [["Data/hora", "Autor", "Papel", "Mensagem"]],
        body: [...obs]
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
          .map((o) => [
            formatDate(o.created_at),
            (o.author_id && profiles[o.author_id]) || "—",
            o.author_type,
            o.message,
          ]),
        styles: { fontSize: 8 },
        columnStyles: { 3: { cellWidth: 95 } },
      });
    }

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

  const openEditMeta = () => {
    if (!payment) return;
    setMetaDraft({
      reference: payment.reference ?? "",
      description: payment.description ?? "",
      payment_due_date: payment.payment_due_date ?? "",
    });
    setEditMetaOpen(true);
  };
  const saveMeta = async () => {
    if (!id || !payment) return;
    setSavingMeta(true);
    const updates: PaymentUpdate = {
      reference: metaDraft.reference.trim() || payment.reference,
      description: metaDraft.description.trim() || null,
      payment_due_date: metaDraft.payment_due_date || null,
    };
    const { error } = await supabase.from("payments").update(updates).eq("id", id);
    setSavingMeta(false);
    if (error) {
      toast({ title: "Falha ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    await recordObservation({
      payment_id: id, author_type: "analista", author_id: user!.id,
      message: `Lote editado pelo analista (referência/descrição/vencimento).`,
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
  const doReimport = async (file: File) => {
    if (!id || !payment || !user) return;
    setReimporting(true);
    try {
      const { parsePaymentFile } = await import("@/lib/parsePaymentFile");
      const { data: companiesData } = await supabase.from("companies").select("id,name,aliases").limit(5000);
      const companies = (companiesData ?? []).map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));
      const bucket = await parsePaymentFile(file, companies, payment.payment_kind);
      if (bucket.rows.length === 0) {
        toast({ title: "Arquivo vazio", description: "Nenhuma linha válida encontrada.", variant: "destructive" });
        return;
      }
      // Upload do novo arquivo
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("payment-files").upload(path, file);
      if (upErr) {
        toast({ title: "Falha no upload", description: upErr.message, variant: "destructive" });
        return;
      }
      // Limpa itens e grupos existentes
      const { error: delItemsErr } = await supabase.from("payment_items").delete().eq("payment_id", id);
      if (delItemsErr) { toast({ title: "Falha ao limpar itens", description: delItemsErr.message, variant: "destructive" }); return; }
      await supabase.from("payment_company_groups").delete().eq("payment_id", id);

      const items = bucket.rows.map((r) => ({
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
        raw_data: r.raw_data as never,
        tipo_linha: r.tipo_linha,
      }));
      const { error: insErr } = await supabase.from("payment_items").insert(items);
      if (insErr) { toast({ title: "Falha ao inserir itens", description: insErr.message, variant: "destructive" }); return; }

      const total = bucket.rows.reduce((s, r) => s + r.gross_amount, 0);
      await supabase.from("payments").update({
        source_file_path: path,
        total_amount: total,
        items_count: bucket.rows.length,
        status: "em_analise_ia",
      }).eq("id", id);

      await recordObservation({
        payment_id: id, author_type: "analista", author_id: user.id,
        message: `Base reimportada pelo analista (${bucket.rows.length} itens, total ${total.toFixed(2)}). Arquivo: ${file.name}.`,
        status_from: payment.status, status_to: "em_analise_ia",
      });

      supabase.functions.invoke("analyze-payment", { body: { payment_id: id } });
      toast({ title: "Base reimportada", description: "Reanalisando itens..." });
      load();
    } catch (e) {
      toast({ title: "Erro ao reimportar", description: String(e), variant: "destructive" });
    } finally {
      setReimporting(false);
      setReimportConfirm(null);
      if (reimportInputRef.current) reimportInputRef.current.value = "";
    }
  };

  const reprocessAi = async (statuses?: string[]) => {
    if (!id || !user) return;
    setReprocessingAi(true);
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { 
          payment_id: id,
          ai_statuses: statuses && statuses.length > 0 ? statuses : undefined,
          tolerance_pct: toleranceValue
        },
      });
      if (error) throw error;
      
      const filterDesc = statuses && statuses.length > 0 
        ? ` (filtrado por: ${statuses.join(", ")}; tolerância: ${toleranceValue * 100}%)` 
        : ` em todo o lote (tolerância: ${toleranceValue * 100}%)`;

      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user.id,
        message: `Regras de repasse reaplicadas${filterDesc} manualmente pelo analista.`,
        status_from: payment?.status ?? null,
        status_to: payment?.status ?? null,
      });
      toast({ title: "Análise reprocessada", description: "A IA reprocessou os itens deste lote." });
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Falha ao reprocessar", description: msg, variant: "destructive" });
    } finally {
      setReprocessingAi(false);
    }
  };

  if (!payment) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;

  const isValidador = hasRole("validador") || hasRole("admin");
  const isDiretor = hasRole("diretor") || hasRole("admin");
  const isAnalista = hasRole("analista") || hasRole("admin");
  // Analista também precisa poder disparar o pedido de NF assim que o
  // pagamento for aprovado (era restrito a diretor/admin antes).
  const canRequestNf =
    (isAnalista || isValidador || isDiretor) && payment.status === "aprovado";
  // Para o botão "Enviar para validação" do analista no header
  const groupsReadyToSend = groups.filter((g) => g.status === "revisao_analista" || g.status === "devolvido_analista");
  const canSendForValidation = isAnalista && groupsReadyToSend.length > 0;
  const isOwner = payment.created_by === user?.id;
  const editableStatuses: PaymentStatus[] = ["rascunho", "em_analise_ia", "aguardando_validacao", "devolvido_analista", "cancelado"];
  const canCancel = (isOwner || isDiretor) && payment.status !== "cancelado" && editableStatuses.includes(payment.status as PaymentStatus);
  const canDelete = (isOwner || isDiretor) && editableStatuses.includes(payment.status as PaymentStatus);
  const canEditMeta = canEditBatch(payment.status as PaymentStatus, {
    isOwner,
    isAnalista,
    isAdminOrDiretor: hasRole("admin") || hasRole("diretor"),
  });
  const canReimport = canReimportBatch(payment.status as PaymentStatus, { isOwner, isAnalista });
  const canAssumeNow = canAssumeBatch(payment.status as PaymentStatus, {
    isAnalista, isValidador, isDiretor, isOwner,
  });
  // Quando o usuário corrente é validador ou diretor MAS criou o lote,
  // mostramos um aviso de segregação de funções no topo.
  const segregationBlocked = isOwner && (isValidador || isDiretor) && !isAnalista
    ? false // só validador/diretor sem ser analista — caso raro
    : isOwner && (isValidador || isDiretor);

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
    await supabase.from("payment_items").delete().eq("payment_id", id);
    await supabase.from("payment_observations").delete().eq("payment_id", id);
    const { error } = await supabase.from("payments").delete().eq("id", id);
    setBusy(false);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Lote excluído" });
    navigate("/pagamentos");
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
    { pendente: 0, aprovado: 0, alerta: 0, reprovado: 0 } as Record<ItemAiStatus, number>,
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
      <div><span className="text-muted-foreground">Bruto:</span> <span className="tabular-nums">{v.gross_amount_at_time != null ? formatCurrency(v.gross_amount_at_time) : "—"}</span></div>
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
            <span className="text-xs text-muted-foreground">{obs.length} obs · {aiVersions.length} análises da IA</span>
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
            <TabsTrigger value="ai">Versões da IA</TabsTrigger>
            {canComment && <TabsTrigger value="comment">Comentar item</TabsTrigger>}
          </TabsList>

          <TabsContent value="timeline" className="mt-3">
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
                        <span className={`inline-flex rounded-full border px-2 py-0.5 ${TONE_CLASSES[itemToneMap[v.ai_status as ItemAiStatus]] ?? TONE_CLASSES.muted}`}>
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
                      <div><span className="text-muted-foreground">Bruto na época:</span> <span className="tabular-nums">{v.gross_amount_at_time != null ? formatCurrency(v.gross_amount_at_time) : "—"}</span></div>
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
                      <span className={`inline-flex rounded-full border px-2 py-0.5 ${TONE_CLASSES[itemToneMap[it.ai_status as ItemAiStatus]]}`}>{it.ai_status}</span>
                    </div>
                    <Textarea
                      rows={2}
                      value={itemCommentDraft[it.id] ?? ""}
                      onChange={(e) => setItemCommentDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                      placeholder="Sua observação sobre este item..."
                    />
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

  return (
    <>
      <PageHeader
        title={payment.reference}
        description={payment.description ?? `${items.length} itens · ${formatCurrency(payment.total_amount)}`}
        sticky
        actions={
          <div className="flex items-center gap-2">
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
            {(payment.status === "em_analise_ia" || payment.status === "revisao_analista" || payment.status === "devolvido_analista") && (isAnalista || isDiretor) && (
              <AlertDialog open={reprocessConfirmOpen} onOpenChange={setReprocessConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reprocessingAi}
                    className="border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft/80"
                    title="Reaplicar o motor de regras e análise de IA"
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-1.5", reprocessingAi && "animate-spin")} />
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
                        
                        <p className="text-sm pt-2">
                          Responsável: <strong>{user?.user_metadata?.full_name || user?.email}</strong>
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setReprocessFilter([])}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => reprocessAi(reprocessFilter)}
                      className="bg-warning hover:bg-warning/90 text-white"
                    >
                      Confirmar Reanálise
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <StatusBadge status={payment.status} />
          </div>
        }
      />
      <div className="p-8 space-y-6">
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
        <Card className="shadow-card">
          <CardContent className="p-4 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Competência:</span>
              <span className="font-medium capitalize">{formatCompetence(payment.competence_months?.length ? payment.competence_months : payment.competence_month)}</span>
            </div>
            <div><span className="text-muted-foreground">Previsão pgto:</span> <span className="font-medium">{formatDateOnly(payment.payment_due_date)}</span></div>
            {payment.payment_type && <div><span className="text-muted-foreground">Tipo:</span> <span className="font-medium">{PAYMENT_TYPE_LABELS[payment.payment_type as keyof typeof PAYMENT_TYPE_LABELS]}</span></div>}
            {payment.payment_kind && <div><span className="text-muted-foreground">Categoria:</span> <span className="font-medium">{PAYMENT_KIND_LABELS[payment.payment_kind as keyof typeof PAYMENT_KIND_LABELS]}</span></div>}
            {payment.cost_center_code && <div><span className="text-muted-foreground">Centro de custos:</span> <span className="font-mono text-xs font-medium">{payment.cost_center_code}</span></div>}
            <div className="ml-auto flex gap-2">
              {canEditMeta && (
                <Dialog open={editMetaOpen} onOpenChange={setEditMetaOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={busy} onClick={openEditMeta}>
                      <MessageSquarePlus className="h-4 w-4 mr-1" /> Editar lote
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Editar lote</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Referência</label>
                        <Input value={metaDraft.reference} onChange={(e) => setMetaDraft((m) => ({ ...m, reference: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Descrição</label>
                        <Textarea rows={3} value={metaDraft.description} onChange={(e) => setMetaDraft((m) => ({ ...m, description: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Previsão de pagamento</label>
                        <Input type="date" value={metaDraft.payment_due_date} onChange={(e) => setMetaDraft((m) => ({ ...m, payment_due_date: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditMetaOpen(false)} disabled={savingMeta}>Cancelar</Button>
                      <Button onClick={saveMeta} disabled={savingMeta}>{savingMeta ? "Salvando…" : "Salvar"}</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {canReimport && (
                <>
                  <input
                    ref={reimportInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setReimportConfirm(f);
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
                        <AlertDialogDescription>
                          Esta ação <strong>substitui todos os itens e grupos</strong> deste lote pelo conteúdo de <strong>{reimportConfirm?.name}</strong> e reinicia a análise. Metadados (referência, competência, tipo) são mantidos. Não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={reimporting}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={reimporting}
                          onClick={() => reimportConfirm && doReimport(reimportConfirm)}
                        >
                          {reimporting ? "Reimportando…" : "Confirmar"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
              {canCancel && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={busy}><Ban className="h-4 w-4 mr-1" /> Cancelar</Button>
                  </AlertDialogTrigger>
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
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={busy}><Trash2 className="h-4 w-4 mr-1" /> Excluir</Button>
                  </AlertDialogTrigger>
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
            </div>
          </CardContent>
        </Card>

        <AssignmentCard
          assignments={assignments}
          profiles={profiles}
          currentUserId={user?.id ?? null}
          canAssume={canAssumeNow}
          onAssume={handleManualAssume}
        />

        {(payment.ai_summary || items.some((i) => i.ai_status && i.ai_status !== "pendente")) && (
          <Card className="shadow-card border-info/30 bg-info-soft/40">
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <Sparkles className="h-4 w-4 shrink-0" />
              <span className="text-sm font-semibold">Resumo da IA</span>
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASSES.success}`}>✓ {counts.aprovado} aprovado(s)</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASSES.warning}`}>⚠ {counts.alerta} alerta(s)</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASSES.destructive}`}>✕ {counts.reprovado} reprovado(s)</span>
                {counts.pendente > 0 && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASSES.muted}`}>• {counts.pendente} pendente(s)</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground ml-auto">
                {topAlerts.length > 0
                  ? `${topAlerts.length} item(ns) com observação — veja por empresa abaixo.`
                  : "Nenhum alerta gerado."}
              </span>
              {payment.ai_summary && (
                <details className="basis-full text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Resumo detalhado</summary>
                  <p className="mt-2 whitespace-pre-wrap">{payment.ai_summary}</p>
                </details>
              )}
            </CardContent>
          </Card>
        )}

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
                    <p className="text-sm font-semibold text-warning-foreground">
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

        {/* Busca dentro do detalhe — filtra grupos/itens por PJ, médico,
            atendimento, centro de custos, especialidade ou descrição. */}
        {payment.analysis_mode === "empresa_prioritaria" && (
          <Card className="shadow-card border-warning/30 bg-warning-soft/30">
            <CardContent className="p-3 text-xs flex items-start gap-2">
              <span className="font-semibold uppercase tracking-wide text-warning-foreground shrink-0">
                Modo empresa prioritária
              </span>
              <span className="text-muted-foreground">
                Mostrando apenas itens com alerta ou reprovação. Empresas e atendimentos sem divergência foram ocultados desta visão.
              </span>
            </CardContent>
          </Card>
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-md flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Buscar PJ, médico, atendimento, CC, especialidade…"
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

            <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-md border w-fit">
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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5 border-dashed"
                  onClick={() => setIsReportOpen(true)}
                >
                  <BarChart3 className="h-4 w-4" />
                  Relatório
                </Button>
              ) : null}
            </div>
          </div>
          
          {(criticalFilter !== "all" || payment.analysis_mode === "empresa_prioritaria") && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md border border-dashed">
              <Info className="h-3.5 w-3.5" />
              <span>
                {criticalFilter === "no_rule" && "Mostrando apenas empresas com itens sem regra cadastrada."}
                {criticalFilter === "divergent" && "Mostrando apenas empresas com divergência de valores."}
                {criticalFilter === "approved" && "Mostrando apenas empresas aprovadas (considera justificativas/blacklists)."}
                {criticalFilter === "approved_strict" && "Mostrando apenas empresas 100% limpas (sem alertas ou notas da IA)."}
                {criticalFilter === "all" && payment.analysis_mode === "empresa_prioritaria" && "Modo empresa prioritária: apenas divergências visíveis."}
              </span>
              <Button 
                variant="link" 
                size="sm" 
                className="h-auto p-0 text-xs ml-auto" 
                onClick={() => {
                  setCriticalFilter("all");
                  setItemSearch("");
                }}
              >
                Limpar filtros
              </Button>
            </div>
          )}
        </div>

          {canSendForValidation && (() => {
            // Calcula divergências NF para os grupos prontos para envio
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
            return (
            <Card className="shadow-card border-primary/40 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm">
                  <p className="font-medium">Revisão concluída pelo analista?</p>
                  <p className="text-xs text-muted-foreground">
                    {groupsReadyToSend.length} empresa(s) prontas para enviar ao validador. Você também pode enviar uma a uma no card de cada empresa.
                  </p>
                  {blocked && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {divergentGroups.length} empresa(s) com NF divergente — resolva antes de enviar.
                    </p>
                  )}
                </div>
                <Button
                  disabled={busy || blocked}
                  onClick={() => sendForValidation()}
                  title={`${groupsReadyToSend.length} empresa(s) serão enviadas para validação.`}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Enviar todas para validação
                </Button>
              </CardContent>
            </Card>
            );
          })()}

          <TooltipProvider delayDuration={150}>
            {(() => {
              const sq = itemSearch.trim().toLowerCase();
              const itemMatches = (it: PaymentItemRowType) => {
                const sq = itemSearch.trim().toLowerCase();
                const matchesSearch = !sq || [
                  it.company_name,
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
                  .includes(sq);

                if (!matchesSearch) return false;

                // Filtro de status crítico
                if (criticalFilter === "no_rule") {
                  return it.ai_findings?.matched_priority === "sem_regra";
                }
                if (criticalFilter === "divergent") {
                  return it.ai_status === "reprovado" || it.ai_status === "alerta";
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
              const visibleGroups = groups.filter((g) => {
                const sq = itemSearch.trim().toLowerCase();
                const nameMatches = !sq || g.company_name?.toLowerCase().includes(sq);
                const specMatches = !sq || paymentSpec.includes(sq);

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
                return nameMatches || specMatches || groupItems.some((it) => itemMatches(it));
              });
              
              const finalSearchTerm = itemSearch.trim() || (criticalFilter !== "all" ? criticalFilter : "");
              if (finalSearchTerm && visibleGroups.length === 0) {
                return (
                  <Card className="shadow-card"><CardContent className="p-8 text-center text-sm text-muted-foreground">
                    Nenhum grupo ou item casa com os filtros selecionados.
                  </CardContent></Card>
                );
              }
              // Priorização por risco: ordena empresas pelo maior score de atendimento
              // (apenas reordena visualmente; não altera dados nem decisão).
              const groupItemsCache = new Map<string, typeof items>();
              const groupMaxScore = (g: typeof visibleGroups[number]) => {
                const cached = groupItemsCache.get(g.id);
                const all = cached ?? items.filter(
                  (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase(),
                );
                if (!cached) groupItemsCache.set(g.id, all);
                return calculateFinancialRisk(all).score;
              };
              const sortedGroups = [...visibleGroups].sort(
                (a, b) => groupMaxScore(b) - groupMaxScore(a),
              );
              return sortedGroups.map((g) => {
              const groupItemsAll = items.filter(
                (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase(),
              );
              const groupNameMatches = sq && g.company_name?.toLowerCase().includes(sq);
              const isErrorOnly = payment.analysis_mode === "empresa_prioritaria" || criticalFilter !== "all";
              const errorOnlyFilter = (it: typeof groupItemsAll[number]) => {
                if (criticalFilter === "no_rule") return it.ai_findings?.matched_priority === "sem_regra";
                if (criticalFilter === "divergent") return it.ai_status === "reprovado" || it.ai_status === "alerta";
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
              const matchedItems = (itemSearch.trim() && !groupNameMatches)
                ? groupItemsAll.filter(itemMatches)
                : groupItemsAll;
              const visibleByFilters = isErrorOnly
                ? matchedItems.filter(errorOnlyFilter)
                : matchedItems;
              
              if (itemSearch.trim() && !groupNameMatches && matchedItems.length === 0) return null;
              if (isErrorOnly && visibleByFilters.length === 0) return null;
              return (
                <div key={g.id} id={`group-${g.id}`} className="scroll-mt-20">
                  <PaymentGroupCard
                    g={g}
                    groupItems={groupItemsAll}
                    searchActive={!!sq}
                    obs={obs}
                    invoices={invoices}
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
                  />
                </div>
              );
              });
            })()}
          </TooltipProvider>

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
                          {g.items_count} itens · {formatCurrency(Number(g.total_amount ?? 0))}
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
                      <p className="text-xs text-muted-foreground">{g.items_count} itens · {formatCurrency(Number(g.total_amount ?? 0))}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (!id || !user) return;
                        if (!window.confirm(`Arquivar "${g.company_name}"? Esta ação é irreversível.`)) return;
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

      {payment && (
        <PaymentReportModal
          open={isReportOpen}
          onOpenChange={setIsReportOpen}
          payment={payment}
          items={items}
          groups={groups}
          analystName={user?.id ? profiles[user.id] : undefined}
        />
      )}
    </>
  );
};

export default PaymentDetail;
