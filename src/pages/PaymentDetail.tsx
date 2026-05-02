import { useEffect, useState, useCallback } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, formatCompetence, formatDateOnly, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentStatus, type ItemAiStatus, TONE_CLASSES } from "@/lib/status";
import {
  ANALYST_DONE_STATUSES,
  canTransition,
  effectiveItemAiStatus,
  resolveResendTarget,
  type ActorRole,
} from "@/lib/paymentFlow";
import { AlertTriangle, ArrowLeft, Ban, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, FileDown, GitCompare, History, Mail, MessageSquare, MessageSquarePlus, Pencil, Receipt, RefreshCcw, RotateCcw, Save, Send, ShieldCheck, Sparkles, Trash2, X, XCircle } from "lucide-react";

const itemToneMap: Record<ItemAiStatus, keyof typeof TONE_CLASSES> = {
  pendente: "muted", aprovado: "success", alerta: "warning", reprovado: "destructive",
};

const truncate = (s: string, max = 220) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

type RuleLite = { id: string; name: string; rule_text: string; description: string | null };
const RuleTooltipContent = ({
  rules,
  fallbackNames,
}: {
  rules: RuleLite[];
  fallbackNames: string[];
}) => {
  const blocks = rules.length
    ? rules.map((r) => ({
        name: r.name,
        text: truncate((r.rule_text ?? "").trim(), 220),
        desc: r.description ? truncate(r.description.trim(), 140) : "",
      }))
    : fallbackNames.map((n) => ({ name: n, text: "", desc: "" }));

  return (
    <div className="space-y-2 text-xs leading-snug">
      {blocks.map((b, i) => (
        <div key={i} className={i > 0 ? "border-t border-border/40 pt-2" : ""}>
          <div className="font-semibold">{truncate(b.name, 80)}</div>
          {b.text && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{b.text}</p>}
          {b.desc && <p className="mt-0.5 italic text-muted-foreground/80">{b.desc}</p>}
        </div>
      ))}
    </div>
  );
};

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [payment, setPayment] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [obs, setObs] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [rulesIndex, setRulesIndex] = useState<Record<string, { id: string; name: string; rule_text: string; description: string | null }>>({});
  const [rulesByName, setRulesByName] = useState<Record<string, { id: string; name: string; rule_text: string; description: string | null }>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiVersions, setAiVersions] = useState<any[]>([]);
  const [historyItemFilter, setHistoryItemFilter] = useState<string>("all");
  const [itemCommentDraft, setItemCommentDraft] = useState<Record<string, string>>({});
  const [compareItemId, setCompareItemId] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [groupComment, setGroupComment] = useState<Record<string, string>>({});
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupAiOpen, setGroupAiOpen] = useState<Set<string>>(new Set());
  const [editingObsId, setEditingObsId] = useState<string | null>(null);
  const [editingObsDraft, setEditingObsDraft] = useState<string>("");
  const [reanalyzingGroupId, setReanalyzingGroupId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: p }, { data: it }, { data: o }, { data: pr }, { data: vs }, { data: gs }, { data: inv }] = await Promise.all([
      supabase.from("payments").select("*").eq("id", id).single(),
      supabase.from("payment_items").select("*").eq("payment_id", id).order("created_at"),
      supabase.from("payment_observations").select("*").eq("payment_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,full_name,email"),
      supabase.from("ai_analysis_versions").select("*").eq("payment_id", id).order("version", { ascending: false }),
      supabase.from("payment_company_groups").select("*").eq("payment_id", id).order("company_name"),
      supabase.from("invoices").select("*").eq("payment_id", id),
    ]);
    setPayment(p); setItems(it ?? []); setObs(o ?? []); setAiVersions(vs ?? []); setGroups(gs ?? []); setInvoices(inv ?? []);
    // Por padrão, todos os grupos começam expandidos para manter a UX atual
    setExpandedGroups(new Set((gs ?? []).map((g: any) => g.id)));
    const map: Record<string, string> = {};
    (pr ?? []).forEach((x: any) => { map[x.id] = x.full_name || x.email; });
    setProfiles(map);
    // Carrega regras citadas pela IA (por id e por nome) para mostrar resumo + link
    const ids = Array.from(new Set((it ?? []).flatMap((x: any) => x.ai_findings?.matched_rule_ids ?? []))).filter(Boolean) as string[];
    const names = Array.from(new Set((it ?? []).flatMap((x: any) => x.ai_findings?.matched_rules ?? []))).filter(Boolean) as string[];
    const [byIdRes, byNameRes] = await Promise.all([
      ids.length ? supabase.from("rules").select("id,name,rule_text,description").in("id", ids) : Promise.resolve({ data: [] as any[] }),
      names.length ? supabase.from("rules").select("id,name,rule_text,description").in("name", names) : Promise.resolve({ data: [] as any[] }),
    ]);
    const idx: Record<string, any> = {};
    (byIdRes.data ?? []).forEach((r: any) => { idx[r.id] = r; });
    (byNameRes.data ?? []).forEach((r: any) => { idx[r.id] = r; });
    const nameIdx: Record<string, any> = {};
    Object.values(idx).forEach((r: any) => { nameIdx[String(r.name).trim().toLowerCase()] = r; });
    setRulesIndex(idx);
    setRulesByName(nameIdx);
  }, [id]);

  useEffect(() => { document.title = "Pagamento | MedPay"; load(); }, [load]);

  const transition = async (newStatus: PaymentStatus, authorType: "validador" | "diretor" | "analista", message: string) => {
    if (!id || !payment) return;
    setBusy(true);
    const updates: any = { status: newStatus };
    if (authorType === "validador" && newStatus === "aguardando_aprovacao") {
      updates.validated_by = user!.id; updates.validated_at = new Date().toISOString();
    }
    if (authorType === "diretor" && newStatus === "aprovado") {
      updates.approved_by = user!.id; updates.approved_at = new Date().toISOString();
    }
    await supabase.from("payments").update(updates).eq("id", id);
    await supabase.from("payment_observations").insert({
      payment_id: id, author_type: authorType, author_id: user!.id, message, status_from: payment.status, status_to: newStatus,
    });
    await load();
    setComment("");
    setBusy(false);
    toast({ title: "Status atualizado", description: message });
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
    const updates: any = { status: newStatus };
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
    await supabase.from("payment_observations").insert({
      payment_id: id, author_type: authorType, author_id: user!.id,
      message: `[${g.company_name}] ${messagePrefix}${text ? `: ${text}` : ""}`,
      status_from: g.status, status_to: newStatus,
    });
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
    await supabase.from("payment_company_groups").update({ status: target.nextStatus }).eq("id", groupId);
    await supabase.from("payment_observations").insert({
      payment_id: id,
      author_type: "analista",
      author_id: user!.id,
      message: `[${g.company_name}] Reencaminhado ao ${target.role} pelo analista${text ? `: ${text}` : ""}.`,
      status_from: g.status,
      status_to: target.nextStatus,
    });
    setGroupComment((m) => ({ ...m, [groupId]: "" }));
    await load();
    setBusy(false);
    toast({ title: `Empresa ${g.company_name}`, description: `Reencaminhada ao ${target.role}.` });
  };

  // Analista edita uma observação que ele mesmo escreveu (qualquer rodada).
  const startEditObs = (o: any) => {
    setEditingObsId(o.id);
    setEditingObsDraft(o.message ?? "");
  };
  const cancelEditObs = () => {
    setEditingObsId(null);
    setEditingObsDraft("");
  };
  const saveEditObs = async () => {
    if (!editingObsId) return;
    const text = editingObsDraft.trim();
    if (!text) {
      toast({ title: "A observação não pode ficar vazia", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("payment_observations")
      .update({ message: text, edited_at: new Date().toISOString() })
      .eq("id", editingObsId);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao salvar edição", description: error.message, variant: "destructive" });
      return;
    }
    cancelEditObs();
    await load();
    toast({ title: "Observação atualizada" });
  };

  // Analista reaplica as regras (reanálise da IA) APENAS para os itens da empresa devolvida,
  // antes de reencaminhar. Isso recalcula expected_amount, alerts e matched_rules.
  const reanalyzeGroup = async (g: any) => {
    if (!id) return;
    setReanalyzingGroupId(g.id);
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: id, company_name: g.company_name },
      });
      if (error) throw error;
      await supabase.from("payment_observations").insert({
        payment_id: id,
        author_type: "analista",
        author_id: user!.id,
        message: `[${g.company_name}] Regras reaplicadas pelo analista (reanálise da IA).`,
        status_from: g.status,
        status_to: g.status,
      });
      await load();
      toast({ title: "Regras reaplicadas", description: `IA reanalisou os itens de ${g.company_name}.` });
    } catch (e: any) {
      toast({ title: "Falha ao reaplicar regras", description: e?.message ?? String(e), variant: "destructive" });
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
      await supabase.from("payment_company_groups").update({ status: "aguardando_validacao" }).eq("id", g.id);
      await supabase.from("payment_observations").insert({
        payment_id: id, author_type: "analista", author_id: user!.id,
        message: `[${g.company_name}] Enviado para validação pelo analista.`,
        status_from: g.status, status_to: "aguardando_validacao",
      });
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
    const payload = (data ?? {}) as any;
    if (payload?.error === "cnpj_invalido") {
      const detail = (payload.invalid ?? []).slice(0, 3).map((x: any) =>
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
    if (error || payload?.error) {
      toast({ title: "Erro", description: payload?.message ?? error?.message ?? "Falha ao enviar.", variant: "destructive" });
      return;
    }
    const n = payload?.invoices_created ?? 0;
    toast({ title: "Pedido(s) de NF enviado(s)", description: `${n} destinatário(s) notificado(s) com resumo validado.` });
    load();
  };

  if (!payment) return <div className="p-8 text-sm text-muted-foreground">Carregando...</div>;

  const isValidador = hasRole("validador") || hasRole("admin");
  const isDiretor = hasRole("diretor") || hasRole("admin");
  const isAnalista = hasRole("analista") || hasRole("admin");
  const canRequestNf = isDiretor && payment.status === "aprovado";
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
    await supabase.from("payments").update({ status: "cancelado" }).eq("id", id);
    await supabase.from("payment_observations").insert({
      payment_id: id, author_type: isOwner ? "analista" : "diretor", author_id: user!.id,
      message: "Lote cancelado pelo responsável.", status_from: payment.status, status_to: "cancelado",
    });
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
  const itemAnalystDone = (it: any) => {
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
  const topAlerts: { item: any; alerts: string[] }[] = items
    .filter((it) => it.ai_findings?.alerts?.length && !itemAnalystDone(it))
    .map((it) => ({ item: it, alerts: it.ai_findings.alerts as string[] }));

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
    const { error } = await supabase.from("payment_observations").insert({
      payment_id: id, item_id: itemId, author_type: myAuthorType, author_id: user!.id, message: text,
    });
    setBusy(false);
    if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }
    setItemCommentDraft((m) => ({ ...m, [itemId]: "" }));
    load();
  };

  const authorBadgeClass = (t: string) =>
    t === "ia" ? TONE_CLASSES.info
      : t === "validador" ? TONE_CLASSES.warning
      : t === "diretor" ? TONE_CLASSES.success
      : TONE_CLASSES.muted;

  const VersionCell = ({ v }: { v: any }) => (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono">v{v.version}</span>
        <span className="text-muted-foreground">{formatDate(v.created_at)}</span>
      </div>
      <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{v.ai_status}</span></div>
      <div><span className="text-muted-foreground">Esperado:</span> <span className="tabular-nums">{v.expected_amount != null ? formatCurrency(v.expected_amount) : "—"}</span></div>
      <div><span className="text-muted-foreground">Bruto:</span> <span className="tabular-nums">{v.gross_amount_at_time != null ? formatCurrency(v.gross_amount_at_time) : "—"}</span></div>
      {Array.isArray(v.matched_rules) && v.matched_rules.length > 0 && (
        <div><span className="text-muted-foreground">Regras:</span> {(v.matched_rules as string[]).join(", ")}</div>
      )}
      {Array.isArray(v.alerts) && v.alerts.length > 0 && (
        <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
          {(v.alerts as string[]).map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      {v.calculation_explanation && <p className="italic text-muted-foreground">{v.calculation_explanation}</p>}
    </div>
  );

  const renderHistoryCard = () => (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Histórico</CardTitle>
            <span className="text-xs text-muted-foreground">{obs.length} obs · {aiVersions.length} análises da IA</span>
          </div>
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
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="ai">Versões da IA</TabsTrigger>
            {canComment && <TabsTrigger value="comment">Comentar item</TabsTrigger>}
          </TabsList>

          <TabsContent value="timeline" className="mt-3">
            {filteredObs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sem observações para o filtro selecionado.</p>
            ) : (
              <ol className="relative border-l border-border pl-4 space-y-3 max-h-[600px] overflow-y-auto">
                {filteredObs.map((o) => {
                  const canEdit = !!user && o.author_id === user.id;
                  const isEditing = editingObsId === o.id;
                  return (
                  <li key={o.id} className="ml-1">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="flex items-center gap-2 flex-wrap text-xs mb-1">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 uppercase tracking-wide ${authorBadgeClass(o.author_type)}`}>
                        {o.author_type}
                      </span>
                      {o.author_id && <span className="text-muted-foreground">{profiles[o.author_id] ?? ""}</span>}
                      {o.item_id && <span className="text-muted-foreground">· {itemLabel(o.item_id)}</span>}
                      {(o.status_from || o.status_to) && (
                        <span className="text-muted-foreground">· {o.status_from ?? "—"} → {o.status_to ?? "—"}</span>
                      )}
                      <span className="text-muted-foreground ml-auto">{formatDate(o.created_at)}</span>
                      {o.edited_at && (
                        <span className="text-muted-foreground italic">· editado {formatDate(o.edited_at)}</span>
                      )}
                      {canEdit && !isEditing && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => startEditObs(o)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          rows={3}
                          value={editingObsDraft}
                          onChange={(e) => setEditingObsDraft(e.target.value)}
                        />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" onClick={cancelEditObs} disabled={busy}>
                            <X className="h-3.5 w-3.5 mr-1" /> Cancelar
                          </Button>
                          <Button size="sm" onClick={saveEditObs} disabled={busy}>
                            <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{o.message}</p>
                    )}
                  </li>
                  );
                })}
              </ol>
            )}
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
    </Card>
  );

  return (
    <>
      <PageHeader
        title={payment.reference}
        description={payment.description ?? `${items.length} itens · ${formatCurrency(payment.total_amount)}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm"><Link to="/pagamentos"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
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
            {groups.map((g) => {
              const groupItems = items.filter(
                (it) => (it.company_name ?? "Sem empresa").trim().toLowerCase() === g.company_name.toLowerCase(),
              );
              const gStatus = g.status as PaymentStatus;
              const isGroupAnalista = isAnalista && (gStatus === "revisao_analista" || gStatus === "devolvido_analista");
              const isGroupValidador = isValidador && gStatus === "aguardando_validacao";
              const isGroupDiretor = isDiretor && gStatus === "aguardando_aprovacao";
              const isGroupExpanded = expandedGroups.has(g.id);
              // Se o analista já concluiu a triagem desse grupo, o parecer da IA não é mais alerta ativo:
              // ele vira informativo e deixa de pintar o item como "reprovado".
              const analystDone = ANALYST_DONE_STATUSES.has(gStatus);
              const groupAlerts = groupItems
                .filter((it) => it.ai_findings?.alerts?.length)
                .map((it) => ({ item: it, alerts: it.ai_findings.alerts as string[] }));
              const gCounts = groupItems.reduce(
                (acc, it) => {
                  const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
                  // "seguido" conta como aprovado para fins de resumo no header da empresa.
                  const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : eff;
                  acc[bucket] = (acc[bucket] ?? 0) + 1;
                  return acc;
                },
                { pendente: 0, aprovado: 0, alerta: 0, reprovado: 0 } as Record<ItemAiStatus, number>,
              );
              const isGroupAiOpen = groupAiOpen.has(g.id);
              const returnerForResend =
                gStatus === "devolvido_analista" ? resolveResendTarget(obs, g.company_name)?.role ?? null : null;
              // Conferência bruto x NF (por empresa, tolerância zero):
              // - Considera apenas notas RECEBIDAS (received_amount não nulo) deste grupo.
              // - Não trava se ainda não há NF (decisão de produto).
              const groupInvoices = invoices.filter((inv) => {
                if (inv.received_amount == null) return false;
                if (inv.company_id && g.company_id) return inv.company_id === g.company_id;
                return (inv.company_name ?? "").trim().toLowerCase() === g.company_name.trim().toLowerCase();
              });
              const nfReceivedTotal = groupInvoices.reduce(
                (acc, inv) => acc + Number(inv.received_amount ?? 0),
                0,
              );
              const nfDiff = groupInvoices.length > 0
                ? Number((nfReceivedTotal - Number(g.total_amount)).toFixed(2))
                : 0;
              const nfDivergent = groupInvoices.length > 0 && Math.abs(nfDiff) > 0;
              return (
                <Card key={g.id} className="shadow-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGroups((prev) => {
                        const n = new Set(prev);
                        n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                        return n;
                      })
                    }
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                    aria-expanded={isGroupExpanded}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isGroupExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-base font-semibold truncate">{g.company_name}</span>
                      <span className="text-xs text-muted-foreground">
                        · {g.items_count} itens · {formatCurrency(g.total_amount)}
                      </span>
                      <div className="hidden md:flex items-center gap-1 ml-2">
                        {gCounts.aprovado > 0 && <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.success}`}>✓ {gCounts.aprovado}</span>}
                        {gCounts.alerta > 0 && <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.warning}`}>⚠ {gCounts.alerta}</span>}
                        {gCounts.reprovado > 0 && <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.destructive}`}>✕ {gCounts.reprovado}</span>}
                        {nfDivergent && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.destructive}`}>
                                <Receipt className="h-3 w-3" /> NF divergente
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">
                                NF recebida: {formatCurrency(nfReceivedTotal)} ·
                                Bruto do pedido: {formatCurrency(Number(g.total_amount))} ·
                                Diferença: {formatCurrency(nfDiff)}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={gStatus} />
                  </button>
                  {isGroupExpanded && nfDivergent && (
                    <div className="border-t border-border/60 bg-destructive/5">
                      <div className="flex items-start gap-2 px-4 py-3 text-xs">
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-destructive">
                            Divergência entre o valor bruto do pedido e a nota fiscal recebida
                          </p>
                          <p className="text-muted-foreground mt-0.5">
                            Bruto do pedido: <span className="text-foreground tabular-nums">{formatCurrency(Number(g.total_amount))}</span> ·
                            NF recebida: <span className="text-foreground tabular-nums">{formatCurrency(nfReceivedTotal)}</span> ·
                            Diferença: <span className="text-destructive tabular-nums font-medium">{formatCurrency(nfDiff)}</span>
                          </p>
                          <p className="text-muted-foreground mt-1">
                            O analista precisa resolver com a empresa antes de reencaminhar — corrija o pedido ou solicite reemissão da nota.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {isGroupExpanded && groupAlerts.length > 0 && (
                    <div className="border-t border-border/60 bg-info-soft/30">
                      <button
                        type="button"
                        onClick={() =>
                          setGroupAiOpen((prev) => {
                            const n = new Set(prev);
                            n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                            return n;
                          })
                        }
                        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-info-soft/50 transition-colors text-xs"
                        aria-expanded={isGroupAiOpen}
                      >
                        {isGroupAiOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="font-semibold">Parecer da IA</span>
                        <span className="text-muted-foreground">
                          — {groupAlerts.length} item(ns) com observação
                          {analystDone && " · revisado pelo analista"}
                        </span>
                      </button>
                      {isGroupAiOpen && (
                        <ul className="divide-y divide-border/40 border-t border-border/40 bg-background/60">
                          {groupAlerts.map(({ item, alerts }) => {
                            // Quando o analista já concluiu, baixamos o tom do alerta: vira info, não destrutivo.
                            const tone: keyof typeof TONE_CLASSES = analystDone
                              ? "muted"
                              : item.ai_status === "reprovado"
                                ? "destructive"
                                : item.ai_status === "alerta"
                                  ? "warning"
                                  : "muted";
                            const raw = (item.raw_data ?? {}) as Record<string, any>;
                            const paciente = raw["Paciente"] ?? raw["paciente"] ?? null;
                            return (
                              <li key={item.id} className="px-4 py-2 text-xs">
                                <div className="flex items-start gap-2">
                                  <span className={`inline-block h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${tone === "destructive" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-muted-foreground"}`} />
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                      {item.attendance_number && <span className="font-mono">Atend. #{item.attendance_number}</span>}
                                      {paciente && <span>· Paciente: <span className="text-foreground">{paciente}</span></span>}
                                      <span>· Médico: <span className="text-foreground">{item.doctor_name}</span></span>
                                      {item.procedure_code && <span>· Procedimento: <span className="font-mono text-foreground">{item.procedure_code}</span></span>}
                                    </div>
                                    <ul className="space-y-0.5">
                                      {alerts.map((a, i) => (
                                        <li key={i} className="flex gap-1.5">
                                          <span className="text-muted-foreground">•</span>
                                          <span className="whitespace-pre-wrap">{a}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                  {isGroupExpanded && (
                  <CardContent className="p-0 overflow-x-auto print:overflow-visible">
                    <table className="w-full min-w-[960px] text-sm table-fixed print:min-w-0 print:text-[10px]">
                      <colgroup>
                        <col className="w-8" />
                        <col className="w-[80px]" />
                        <col className="w-[14%]" />
                        <col className="w-[12%] hidden md:table-column print:table-column" />
                        <col className="w-[16%]" />
                        <col className="w-[80px] hidden lg:table-column print:table-column" />
                        <col />
                        <col className="w-[44px]" />
                        <col className="w-[110px]" />
                        <col className="w-[88px] hidden sm:table-column print:table-column" />
                        <col className="w-10 print:hidden" />
                      </colgroup>
                      <thead className="bg-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-2 py-2 print:hidden"></th>
                          <th className="px-2 py-2">Atend.</th>
                          <th className="px-2 py-2">Paciente</th>
                          <th className="px-2 py-2 hidden md:table-cell print:table-cell">Convênio</th>
                          <th className="px-2 py-2">Médico / Função</th>
                          <th className="px-2 py-2 hidden lg:table-cell print:table-cell">TUSS</th>
                          <th className="px-2 py-2">Descrição</th>
                          <th className="px-2 py-2 text-right">Qtd</th>
                          <th className="px-2 py-2 text-right">Valor</th>
                          <th className="px-2 py-2 hidden sm:table-cell print:table-cell">IA</th>
                          <th className="px-2 py-2 print:hidden"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {groupItems.map((it) => {
                          const raw = (it.raw_data ?? {}) as Record<string, any>;
                          const paciente = raw["Paciente"] ?? raw["paciente"] ?? "—";
                          const convenio = raw["Convênio"] ?? raw["Convenio"] ?? raw["convenio"] ?? "—";
                          const matchedIds: string[] = it.ai_findings?.matched_rule_ids ?? [];
                          const matchedNames: string[] = it.ai_findings?.matched_rules ?? [];
                          const seen = new Set<string>();
                          const matchedRuleObjs: RuleLite[] = [];
                          matchedIds.forEach((rid) => {
                            const r = rulesIndex[rid];
                            if (r && !seen.has(r.id)) { seen.add(r.id); matchedRuleObjs.push(r); }
                          });
                          matchedNames.forEach((nm) => {
                            const r = rulesByName[String(nm).trim().toLowerCase()];
                            if (r && !seen.has(r.id)) { seen.add(r.id); matchedRuleObjs.push(r); }
                          });
                          const hasRule = matchedRuleObjs.length > 0 || matchedNames.length > 0;
                          const firstRule = matchedRuleObjs[0] ?? null;
                          const firstRuleLabel = firstRule?.name ?? matchedNames[0] ?? null;
                          const tooltipNode = hasRule ? (
                            <RuleTooltipContent rules={matchedRuleObjs} fallbackNames={matchedNames} />
                          ) : null;
                          const itemObs = obs.filter((o) => o.item_id === it.id);
                          const isExpanded = expandedItems.has(it.id);
                          const totalRules = matchedRuleObjs.length || matchedNames.length;
                          const extra = Math.max(0, totalRules - 1);
                          const valueEl = (
                            <span
                              className={`tabular-nums font-medium ${
                                firstRule?.id
                                  ? "text-primary underline decoration-dotted decoration-primary/50 cursor-help"
                                  : tooltipNode
                                  ? "underline decoration-dotted decoration-muted-foreground/50 cursor-help"
                                  : ""
                              }`}
                            >
                              {formatCurrency(it.gross_amount)}
                            </span>
                          );
                          return (
                            <>
                              <tr key={it.id} className="align-top hover:bg-muted/20 cursor-pointer" onClick={() => toggleItemExpanded(it.id)}>
                                <td className="px-2 py-2 text-muted-foreground print:hidden">
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </td>
                                <td className="px-2 py-2 text-xs font-mono text-muted-foreground break-all">{it.attendance_number ?? "—"}</td>
                                <td className="px-2 py-2 text-[13px] leading-snug break-words">{paciente}</td>
                                <td className="px-2 py-2 text-[13px] leading-snug text-muted-foreground break-words hidden md:table-cell print:table-cell">{convenio}</td>
                                <td className="px-2 py-2 leading-snug">
                                  <div className="font-medium text-[13px] break-words">{it.doctor_name}</div>
                                  <div className="text-[11px] text-muted-foreground break-words">{it.doctor_role ?? "—"}</div>
                                </td>
                                <td className="px-2 py-2 font-mono text-xs break-all hidden lg:table-cell print:table-cell">{it.procedure_code ?? "—"}</td>
                                <td className="px-2 py-2 leading-snug">
                                  <div className="text-[13px] line-clamp-2">{it.description ?? "—"}</div>
                                  {!isExpanded && it.ai_findings?.alerts?.length > 0 && (
                                    <div className="mt-0.5 text-[11px] text-warning-foreground line-clamp-1">⚠ {it.ai_findings.alerts[0]}{it.ai_findings.alerts.length > 1 && ` (+${it.ai_findings.alerts.length - 1})`}</div>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums text-[13px]">{it.quantity ?? "—"}</td>
                                <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1.5">
                                    {tooltipNode ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
                                        <TooltipContent side="left" className="max-w-xs">{tooltipNode}</TooltipContent>
                                      </Tooltip>
                                    ) : valueEl}
                                    {extra > 0 && (
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button type="button" className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition">
                                            +{extra}
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent side="left" align="end" className="w-80 p-0">
                                          <ul className="max-h-72 overflow-y-auto divide-y divide-border/60">
                                            {(matchedRuleObjs.length ? matchedRuleObjs : matchedNames.map((n) => ({ id: "", name: n, rule_text: "", description: null }))).map((r, i) => (
                                              <li key={i} className="px-3 py-2 text-xs">
                                                <span className={`font-medium ${r.id ? "text-primary" : ""}`}>{truncate(r.name, 80)}</span>
                                                {r.rule_text && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground leading-snug">{truncate(r.rule_text.trim(), 180)}</p>}
                                              </li>
                                            ))}
                                          </ul>
                                        </PopoverContent>
                                      </Popover>
                                    )}
                                  </div>
                                  {firstRuleLabel && (
                                    <span className={`block text-[11px] truncate max-w-[180px] ml-auto ${firstRule?.id ? "text-primary" : "text-muted-foreground"}`}>{firstRuleLabel}</span>
                                  )}
                                </td>
                                <td className="px-2 py-2">
                                  {(() => {
                                    const raw = (it.ai_status as ItemAiStatus) ?? "pendente";
                                    // Se o analista já encaminhou adiante, "reprovado/alerta" da IA viram "seguido".
                                    if (analystDone && (raw === "reprovado" || raw === "alerta")) {
                                      return (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.success}`}>
                                              seguido
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent side="left" className="max-w-xs text-xs">
                                            Análise inicial da IA: <strong>{raw}</strong>. O analista revisou e seguiu com este item.
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    }
                                    return (
                                      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES[itemToneMap[raw]]}`}>{raw}</span>
                                    );
                                  })()}
                                </td>
                                <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => toggleItemExpanded(it.id)}
                                    className="relative inline-flex items-center justify-center rounded-md p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                                    title={`${itemObs.length} comentário(s)`}
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                    {itemObs.length > 0 && (
                                      <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] px-1">
                                        {itemObs.length}
                                      </span>
                                    )}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${it.id}-x`} className="bg-muted/20">
                                  <td colSpan={11} className="px-6 py-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {(it.ai_findings?.alerts?.length > 0 || it.ai_findings?.calculation_explanation) && (
                                        <div className="md:col-span-2 space-y-1.5">
                                          {it.ai_findings?.alerts?.length > 0 && (
                                            <ul className="text-xs text-warning-foreground space-y-0.5">
                                              {it.ai_findings.alerts.map((a: string, i: number) => <li key={i}>⚠ {a}</li>)}
                                            </ul>
                                          )}
                                          {it.ai_findings?.calculation_explanation && (
                                            <div className="text-xs text-muted-foreground italic">{it.ai_findings.calculation_explanation}</div>
                                          )}
                                        </div>
                                      )}
                                      <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Histórico deste item</p>
                                        {itemObs.length === 0 ? (
                                          <p className="text-xs text-muted-foreground">Sem comentários ainda.</p>
                                        ) : (
                                          <ul className="space-y-2 max-h-48 overflow-y-auto">
                                            {itemObs.map((o) => (
                                              <li key={o.id} className="text-xs">
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                  <span className={`inline-flex rounded-full border px-1.5 py-0.5 uppercase tracking-wide ${authorBadgeClass(o.author_type)}`}>{o.author_type}</span>
                                                  {o.author_id && <span>{profiles[o.author_id] ?? ""}</span>}
                                                  <span className="ml-auto">{formatDate(o.created_at)}</span>
                                                </div>
                                                <p className="mt-1 whitespace-pre-wrap">{o.message}</p>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                      {canComment && (
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Adicionar comentário neste item</p>
                                          <Textarea
                                            rows={3}
                                            value={itemCommentDraft[it.id] ?? ""}
                                            onChange={(e) => setItemCommentDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                                            placeholder="Motivo de dúvida, reprovação, observação..."
                                          />
                                          <div className="flex justify-end mt-2">
                                            <Button size="sm" disabled={busy || !(itemCommentDraft[it.id] ?? "").trim()} onClick={() => addItemComment(it.id)}>
                                              <MessageSquarePlus className="h-3.5 w-3.5 mr-1" /> Salvar
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                  )}
                  {isGroupExpanded && (isGroupAnalista || isGroupValidador || isGroupDiretor) && (
                    <div className="border-t border-border bg-muted/20 p-4 space-y-2">
                      <Textarea
                        rows={2}
                        value={groupComment[g.id] ?? ""}
                        onChange={(e) => setGroupComment((m) => ({ ...m, [g.id]: e.target.value }))}
                        placeholder="Observação para esta empresa (obrigatória para devolver/rejeitar)..."
                      />
                      <div className="flex flex-wrap gap-2 justify-end">
                        {isGroupAnalista && (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => reanalyzeGroup(g)}
                              disabled={busy || reanalyzingGroupId === g.id}
                            >
                              <RefreshCcw className={`h-4 w-4 mr-2 ${reanalyzingGroupId === g.id ? "animate-spin" : ""}`} />
                              {reanalyzingGroupId === g.id ? "Reaplicando..." : "Reaplicar regras"}
                            </Button>
                            {returnerForResend ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button onClick={() => resendGroup(g.id)} disabled={busy || nfDivergent}>
                                      <Send className="h-4 w-4 mr-2" />
                                      Reencaminhar ao {returnerForResend}
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {nfDivergent && (
                                  <TooltipContent>NF divergente: ajuste o pedido ou peça reemissão antes de reencaminhar.</TooltipContent>
                                )}
                              </Tooltip>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button onClick={() => sendForValidation(g.id)} disabled={busy || nfDivergent}>
                                      <Send className="h-4 w-4 mr-2" /> Enviar esta empresa para validação
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {nfDivergent && (
                                  <TooltipContent>NF divergente: ajuste o pedido ou peça reemissão antes de enviar.</TooltipContent>
                                )}
                              </Tooltip>
                            )}
                          </>
                        )}
                        {isGroupValidador && <>
                          <Button onClick={() => transitionGroup(g.id, "aguardando_aprovacao", "validador", "Validado", false)} disabled={busy}>
                            <CheckCircle2 className="h-4 w-4 mr-2" /> Validar empresa
                          </Button>
                          <Button variant="outline" onClick={() => transitionGroup(g.id, "devolvido_analista", "validador", "Devolvido ao analista")} disabled={busy}>
                            <RotateCcw className="h-4 w-4 mr-2" /> Devolver ao analista
                          </Button>
                        </>}
                        {isGroupDiretor && <>
                          <Button onClick={() => transitionGroup(g.id, "aprovado", "diretor", "Aprovado", false)} disabled={busy}>
                            <ShieldCheck className="h-4 w-4 mr-2" /> Aprovar empresa
                          </Button>
                          <Button variant="outline" onClick={() => transitionGroup(g.id, "devolvido_analista", "diretor", "Devolvido ao analista")} disabled={busy}>
                            <RotateCcw className="h-4 w-4 mr-2" /> Devolver ao analista
                          </Button>
                          <Button variant="destructive" onClick={() => transitionGroup(g.id, "rejeitado", "diretor", "Rejeitado")} disabled={busy}>
                            <XCircle className="h-4 w-4 mr-2" /> Rejeitar empresa
                          </Button>
                        </>}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </TooltipProvider>

          {payment.status === "aprovado" && isDiretor && (
            <Card className="shadow-card border-success/30">
              <CardHeader><CardTitle className="text-base">Pós-aprovação</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={generatePdf}><FileDown className="h-4 w-4 mr-2" /> Gerar PDF</Button>
                {canRequestNf && <Button onClick={sendInvoiceRequest} disabled={busy}><Mail className="h-4 w-4 mr-2" /> Enviar pedido de NF</Button>}
              </CardContent>
            </Card>
          )}

        {renderHistoryCard()}
      </div>
    </>
  );
};

export default PaymentDetail;