import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { InvoiceQuestionsThread, type InvoiceQuestion } from "@/components/InvoiceQuestionsThread";
import { PaymentTimeline } from "@/components/payment-detail/PaymentTimeline";

import { PaymentGroupCard } from "@/components/payment-detail/PaymentGroupCard";
import { scoreAttendance } from "@/lib/riskScore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { recordObservation } from "@/lib/observations";
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
  resolveResendTarget,
  type ActorRole,
} from "@/lib/paymentFlow";
import { AlertTriangle, ArrowLeft, Ban, CalendarDays, ChevronDown, ChevronRight, FileDown, GitCompare, History, Mail, MessageCircleQuestion, MessageSquarePlus, Search, Send, Sparkles, Trash2, X } from "lucide-react";

const itemToneMap: Record<ItemAiStatus, keyof typeof TONE_CLASSES> = {
  pendente: "muted", aprovado: "success", alerta: "warning", reprovado: "destructive",
};

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const {
    payment,
    items,
    obs,
    profiles,
    aiVersions,
    groups,
    invoices,
    questions,
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
  const [itemCommentDraft, setItemCommentDraft] = useState<Record<string, string>>({});
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [groupComment, setGroupComment] = useState<Record<string, string>>({});
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [groupAiOpen, setGroupAiOpen] = useState<Set<string>>(new Set());
  const [reanalyzingGroupId, setReanalyzingGroupId] = useState<string | null>(null);
  const [openQuestionInvoiceId, setOpenQuestionInvoiceId] = useState<string | null>(null);
  // Busca dentro do detalhe (filtra grupos/itens por PJ, médico, atendimento, CC,
  // especialidade e descrição). Não esconde grupos cujo nome casa com a busca.
  const [itemSearch, setItemSearch] = useState("");

  useEffect(() => {
    document.title = "Pagamento | MedPay";
  }, []);

  const transition = async (newStatus: PaymentStatus, authorType: "validador" | "diretor" | "analista", message: string) => {
    if (!id || !payment) return;
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
    if (!id) return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
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

  // Analista enviar para validação (todos os grupos em revisao_analista ou devolvido_analista)
  const sendForValidation = async (onlyGroupId?: string) => {
    if (!id) return;
    const targets = (onlyGroupId ? groups.filter((g) => g.id === onlyGroupId) : groups)
      .filter((g) => g.status === "revisao_analista" || g.status === "devolvido_analista");
    if (targets.length === 0) {
      toast({ title: "Nada para enviar", description: "Nenhuma empresa pronta para validação." });
      return;
    }
    setBusy(true);
    for (const g of targets) {
      const { error: upErr } = await supabase.from("payment_company_groups")
        .update({ status: "aguardando_validacao" }).eq("id", g.id);
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

  const generatePdf = async () => {
    if (!payment) return;
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("Validação de Pagamento Médico", 14, 18);
    doc.setFontSize(10);
    doc.text(`Referência: ${payment.reference}`, 14, 28);
    doc.text(`Status: ${payment.status}`, 14, 34);
    doc.text(`Total: ${formatCurrency(payment.total_amount)}`, 14, 40);
    doc.text(`Aprovado por: ${profiles[payment.approved_by] ?? "—"} em ${formatDate(payment.approved_at)}`, 14, 46);
    autoTable(doc, {
      startY: 54,
      head: [["Médico", "Doc", "Descrição", "Valor", "IA"]],
      body: items.map((i) => [i.doctor_name, i.doctor_document ?? "", i.description ?? "", formatCurrency(i.gross_amount), i.ai_status]),
    });
    const blob = doc.output("blob");
    const path = `${payment.id}/aprovacao.pdf`;
    await supabase.storage.from("approval-pdfs").upload(path, blob, { upsert: true, contentType: "application/pdf" });
    await supabase.from("payments").update({ approval_pdf_path: path }).eq("id", payment.id);
    doc.save(`aprovacao-${payment.reference}.pdf`);
    toast({ title: "PDF gerado" });
  };

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
    const obsRes = await recordObservation({
      payment_id: id!, item_id: itemId, author_type: myAuthorType, author_id: user!.id, message: text,
    });
    setBusy(false);
    if (!obsRes.ok) {
      toast({ title: "Erro ao salvar", description: obsRes.error, variant: "destructive" });
      return;
    }
    setItemCommentDraft((m) => ({ ...m, [itemId]: "" }));
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
                    <div className="flex justify-end mt-2">
                      <Button size="sm" disabled={busy || !(itemCommentDraft[it.id] ?? "").trim()} onClick={() => addItemComment(it.id)}>
                        <MessageSquarePlus className="h-3.5 w-3.5 mr-1" /> Salvar observação
                      </Button>
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
          <>
            <StatusBadge status={payment.status} />
          </>
        }
      />
      <div className="p-8 space-y-6">
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
        {groups.length > 1 || items.length > 8 ? (
          <div className="relative max-w-md">
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
        ) : null}

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
                <Button onClick={() => sendForValidation()} disabled={busy || blocked}>
                  <Send className="h-4 w-4 mr-2" /> Enviar todas para validação
                </Button>
              </CardContent>
            </Card>
            );
          })()}

          <TooltipProvider delayDuration={150}>
            {(() => {
              const sq = itemSearch.trim().toLowerCase();
              const itemMatches = (it: PaymentItemRowType) => {
                if (!sq) return true;
                const haystack = [
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
                  .toLowerCase();
                return haystack.includes(sq);
              };
              const paymentSpec = ((payment.specialties ?? []) as string[]).join(" ").toLowerCase();
              const visibleGroups = groups.filter((g) => {
                if (!sq) return true;
                if (g.company_name?.toLowerCase().includes(sq)) return true;
                if (paymentSpec.includes(sq)) return true;
                return items.some(
                  (it) =>
                    (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase() &&
                    itemMatches(it),
                );
              });
              if (sq && visibleGroups.length === 0) {
                return (
                  <Card className="shadow-card"><CardContent className="p-8 text-center text-sm text-muted-foreground">
                    Nenhum grupo ou item casa com "{itemSearch}".
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
                const byAtt = new Map<string, typeof all>();
                for (const it of all) {
                  const att = (it.attendance_number ?? "").trim();
                  if (!att) continue;
                  const a = byAtt.get(att) ?? [];
                  a.push(it);
                  byAtt.set(att, a);
                }
                let max = 0;
                for (const arr of byAtt.values()) {
                  const s = scoreAttendance(arr).score;
                  if (s > max) max = s;
                }
                return max;
              };
              const sortedGroups = [...visibleGroups].sort(
                (a, b) => groupMaxScore(b) - groupMaxScore(a),
              );
              return sortedGroups.map((g) => {
              const groupItemsAll = items.filter(
                (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase(),
              );
              const groupNameMatches = sq && g.company_name?.toLowerCase().includes(sq);
              const isErrorOnly = payment.analysis_mode === "empresa_prioritaria";
              const errorOnlyFilter = (it: typeof groupItemsAll[number]) => {
                const st = (it.ai_status as string) ?? "pendente";
                return st === "alerta" || st === "reprovado" || (it.ai_findings?.alerts?.length ?? 0) > 0;
              };
              const baseGroupItems = sq && !groupNameMatches
                ? groupItemsAll.filter(itemMatches)
                : groupItemsAll;
              const groupItems = isErrorOnly
                ? baseGroupItems.filter(errorOnlyFilter)
                : baseGroupItems;
              // No modo empresa_prioritaria, oculta grupos sem nenhum erro.
              if (isErrorOnly && groupItems.length === 0) return null;
              return (
                <PaymentGroupCard
                  key={g.id}
                  g={g}
                  groupItems={groupItems}
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
              );
              });
            })()}
          </TooltipProvider>

          {payment.status === "aprovado" && (isDiretor || canRequestNf) && (
            <Card className="shadow-card border-success/30">
              <CardHeader><CardTitle className="text-base">Pós-aprovação</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {isDiretor && <Button variant="outline" onClick={generatePdf}><FileDown className="h-4 w-4 mr-2" /> Gerar PDF</Button>}
                {canRequestNf && <Button onClick={sendInvoiceRequest} disabled={busy}><Mail className="h-4 w-4 mr-2" /> Enviar pedido de NF</Button>}
              </CardContent>
            </Card>
          )}

        {renderHistoryCard()}
      </div>

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
    </>
  );
};

export default PaymentDetail;