import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { recordObservation, type ObservationType } from "@/lib/observations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ItemsDataGrid } from "@/components/payment-detail/ItemsDataGrid";
import { CompanyHistoryPanel } from "@/components/payment-detail/CompanyHistoryPanel";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, Building2, AlertTriangle, MessageSquarePlus, Sparkles, RefreshCcw, Send, History, XCircle, ShieldCheck, Undo2, ThumbsUp, ThumbsDown, FileText, Wallet, Upload, Download, FileSpreadsheet, ChevronDown, Clock, X, Plus, Trash2, CheckCircle2 } from "lucide-react";
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
                    : "border-success/50 text-success-foreground bg-success/10"
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

  const handleExport = async (format: "pdf" | "excel") => {
    if (!group || !payment) return;
    
    const timestamp = new Date().toISOString().split('T')[0];
    const fileName = `${group.company_name} - ${payment.reference} - ${timestamp}`;
    
    // Impacta aprovação
    const criticalObs = obs.filter(o => o.observation_type === "impacta_aprovacao");
    const riskData = {
      score: calculateFinancialRisk(items).score,
      valorEmRisco: calculateFinancialRisk(items).valorEmRisco,
      percentualRisco: calculateFinancialRisk(items).percentualRisco
    };

    if (format === "excel") {
      const { utils, writeFile } = await import("xlsx");
      
      // Aba Itens
      const itemRows = items.map(it => ({
        "Atendimento": it.attendance_number || "-",
        "Paciente": (it.raw_data as any)?.["Paciente"] || it.patient_name || "-",
        "Convênio": it.agreement_text || "-",
        "TUSS": it.procedure_code || "-",
        "Procedimento": it.procedure_name || "-",
        "Médico": it.doctor_name || "-",
        "Valor Repasse": it.gross_amount,
        "Valor Esperado": it.ai_findings?.expected_amount || 0,
        "Diferença": (Number(it.gross_amount) - Number(it.ai_findings?.expected_amount || 0)),
        "Status": it.ai_status
      }));
      
      const wb = utils.book_new();
      const wsItems = utils.json_to_sheet(itemRows);
      utils.book_append_sheet(wb, wsItems, "Itens");
      
      // Aba Observações Críticas
      if (criticalObs.length > 0) {
        const obsRows = criticalObs.map(o => ({
          "Autor": profiles[o.author_id!] || "Sistema",
          "Data": new Date(o.created_at).toLocaleString("pt-BR"),
          "Mensagem": o.message
        }));
        const wsObs = utils.json_to_sheet(obsRows);
        utils.book_append_sheet(wb, wsObs, "Observações Críticas");
      }
      
      writeFile(wb, `${fileName}.xlsx`);
    } else {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      
      const doc = new jsPDF({ orientation: "landscape" });
      
      // Cabeçalho
      doc.setFontSize(18);
      doc.text("Análise de Pagamento", 14, 20);
      doc.setFontSize(12);
      doc.text(`Empresa: ${group.company_name}`, 14, 30);
      doc.text(`Lote: ${payment.reference}`, 14, 37);
      
      // Resumo
      doc.setFontSize(14);
      doc.text("Resumo Executivo", 14, 50);
      doc.setFontSize(10);
      const summary = [
        ["Total de Itens", String(items.length)],
        ["Valor Total", formatCurrency(Number(group.total_amount))],
        ["Alertas (itens)", String(counts.alertasTotal)],
        ["Críticos (itens)", String(counts.criticosTotal)],
        ["Score de Risco", String(riskData.score)],
        ["Valor em Risco", formatCurrency(riskData.valorEmRisco)],
        ["% em Risco", `${riskData.percentualRisco.toFixed(1)}%`]
      ];
      
      autoTable(doc, {
        startY: 55,
        head: [["Métrica", "Valor"]],
        body: summary,
        theme: "striped",
        headStyles: { fillColor: [100, 100, 100] },
        margin: { left: 14, right: 14 }
      });
      
      // Tabela de Itens
      doc.setFontSize(14);
      doc.text("Detalhamento de Itens", 14, (doc as any).lastAutoTable.finalY + 15);
      
      const tableData = items.map(it => [
        it.attendance_number || "-",
        (it.raw_data as any)?.["Paciente"] || it.patient_name || "-",
        it.agreement_text || "-",
        it.procedure_code || "-",
        it.procedure_name || "-",
        it.doctor_name || "-",
        formatCurrency(Number(it.gross_amount)),
        formatCurrency(Number(it.ai_findings?.expected_amount || 0)),
        formatCurrency(Number(it.gross_amount) - Number(it.ai_findings?.expected_amount || 0)),
        it.ai_status || "-"
      ]);
      
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 20,
        head: [["Atend.", "Paciente", "Conv.", "TUSS", "Proc.", "Médico", "Inf.", "Esp.", "Dif.", "Status"]],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [41, 128, 185] },
        margin: { left: 14, right: 14 }
      });
      
      // Observações Críticas
      if (criticalObs.length > 0) {
        doc.addPage();
        doc.setFontSize(14);
        doc.text("Observações Críticas (Impacta Aprovação)", 14, 20);
        
        const obsData = criticalObs.map(o => [
          profiles[o.author_id!] || "Sistema",
          new Date(o.created_at).toLocaleString("pt-BR"),
          o.message
        ]);
        
        autoTable(doc, {
          startY: 25,
          head: [["Autor", "Data", "Observação"]],
          body: obsData,
          headStyles: { fillColor: [192, 57, 43] },
          margin: { left: 14, right: 14 },
          columnStyles: { 2: { cellWidth: "auto" } }
        });
      }
      
      doc.save(`${fileName}.pdf`);
    }
  };

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const items = useMemo(() => {
    if (!group) return [] as PaymentItemRow[];
    const companyNorm = normalizeString(group.company_name);
    return allItems.filter(
      (x) => normalizeString(x.company_name ?? "Sem empresa") === companyNorm,
    );
  }, [allItems, group]);

  const [aiVersions, setAiVersions] = useState<AiVersionRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [groupDraft, setGroupDraft] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [changeCompanyOpen, setChangeCompanyOpen] = useState(false);
  const [newCompany, setNewCompany] = useState<CompanyOption | null>(null);
  const [changingCompany, setChangingCompany] = useState(false);
  const [isQuestion, setIsQuestion] = useState(false);
  const [groupCommentType, setGroupCommentType] = useState<ObservationType>("informativo");
  const [itemCommentType, setItemCommentType] = useState<Record<string, ObservationType>>({});

  const [editItem, setEditItem] = useState<PaymentItemRow | null>(null);
  const [editDraft, setEditDraft] = useState<{ gross_amount: string; specialty: string; doctor_name: string; description: string }>({ gross_amount: "", specialty: "", doctor_name: "", description: "" });
  const [savingItem, setSavingItem] = useState(false);
  const [deleteItem, setDeleteItem] = useState<PaymentItemRow | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [reimportConfirm, setReimportConfirm] = useState<File[] | null>(null);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    document.title = "Análise da empresa | MedPay Approval";
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
    const c = { aprovado: 0, pendente: 0, alerta: 0, reprovado: 0, alertasTotal: 0, criticosTotal: 0 };
    for (const it of items) {
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
      const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : (eff as ItemAiStatus);
      c[bucket] = (c[bucket] ?? 0) + 1;
      
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
    load();
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
    load();
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
    setReanalyzing(true);
    const startedAt = Date.now();
    try {
      const { error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: id, company_name: group.company_name },
      });
      if (error) throw error;
      await recordObservation({
        payment_id: id,
        author_type: myAuthorType,
        author_id: user!.id,
        message: `[${group.company_name}] Regras reaplicadas pelo analista (reanálise da IA).`,
        status_from: group.status,
        status_to: group.status,
      });
      toast.success("Regras reaplicadas");
      load();
    } catch (e) {
      // O cliente Supabase pode encerrar a conexão antes da função terminar
      // (timeout em pagamentos grandes com IA). Verificamos no banco se o
      // processamento concluiu mesmo assim antes de mostrar erro.
      const completed = await waitForProcessingCompletion(id, startedAt);
      if (completed) {
        await recordObservation({
          payment_id: id,
          author_type: myAuthorType,
          author_id: user!.id,
          message: `[${group.company_name}] Regras reaplicadas pelo analista (reanálise da IA).`,
          status_from: group.status,
          status_to: group.status,
        });
        toast.success("Regras reaplicadas");
        load();
      } else {
        const { data: finalCheck } = await supabase.from("payments").select("processing_timeout_occurred").eq("id", id).maybeSingle();
        if (finalCheck?.processing_timeout_occurred) {
          toast.warning("Análise parcial", { description: "O motor processou tudo, mas a IA excedeu o tempo limite." });
          load();
        } else {
          toast.error("Falha ao reaplicar regras", {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      setReanalyzing(false);
    }
  };

  /**
   * Faz polling em `payments.processing_diagnostics` para detectar conclusão
   * da reanálise quando a conexão HTTP cai antes do response final.
   * Retorna true se diagnostics.status === "success" e foi atualizado após `since`.
   */
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
    setChangingCompany(true);
    try {
      const oldName = group.company_name;
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

      // 3) remove grupo antigo (ficou vazio)
      await supabase.from("payment_company_groups").delete().eq("id", group.id);

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

      await recordObservation({
        payment_id: id,
        author_type: "analista",
        author_id: user.id,
        message: `[${oldName}] Empresa do grupo alterada para "${newCompany.name}" pelo analista. Apelido aprendido para futuras correspondências.`,
        status_from: group.status,
        status_to: group.status,
      });

      // 5) reanálise da IA para a empresa nova
      try {
        await supabase.functions.invoke("analyze-payment", {
          body: { payment_id: id, company_name: newCompany.name },
        });
      } catch (e) {
        console.warn("Reanálise pós-troca falhou (silencioso):", e);
      }

      toast.success("Empresa do grupo atualizada");
      setChangeCompanyOpen(false);
      setNewCompany(null);
      // Navega para o grupo destino — o antigo deixou de existir.
      navigate(`/pagamentos/${id}/empresa/${destGroupId}`);
    } catch (e) {
      toast.error("Falha ao trocar empresa", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setChangingCompany(false);
    }
  };

  const doReimport = async (files: File[]) => {
    if (!id || !payment || !user || !group) return;
    setReimporting(true);
    try {
      const { parsePaymentFile, similarity } = await import("@/lib/parsePaymentFile");
      const { data: companiesData } = await supabase.from("companies").select("id,name,aliases").limit(5000);
      const companies = (companiesData ?? []).map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));

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
        const bucket = await parsePaymentFile(file, companies, payment.payment_kind);
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

      // Limpa SOMENTE itens e o grupo desta empresa (não toca nas demais).
      await supabase
        .from("payment_items")
        .delete()
        .eq("payment_id", id)
        .eq("company_name", group.company_name);
      await supabase.from("payment_company_groups").delete().eq("id", group.id);

      const newItems = companyRows.map((r) => ({
        payment_id: id,
        doctor_name: r.doctor_name,
        doctor_document: r.doctor_document,
        doctor_email: r.doctor_email,
        description: r.description,
        gross_amount: r.gross_amount,
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

      supabase.functions.invoke("analyze-payment", {
        body: { payment_id: id, company_name: group.company_name },
      });
      toast.success("Base da empresa reimportada", {
        description: ignoredCount > 0
          ? `Reanalisando ${companyRows.length} itens. ${ignoredCount} linha(s) de outras empresas foram ignoradas.`
          : "Reanalisando itens...",
      });

      navigate(`/pagamentos/${id}`);
    } catch (e) {
      toast.error("Erro ao reimportar", { description: String(e) });
    } finally {
      setReimporting(false);
      setReimportConfirm(null);
      if (reimportInputRef.current) reimportInputRef.current.value = "";
    }
  };

  const openEditItem = (it: PaymentItemRow) => {
    setEditItem(it);
    setEditDraft({
      gross_amount: String(it.gross_amount ?? 0),
      specialty: it.specialty ?? "",
      doctor_name: it.doctor_name ?? "",
      description: it.description ?? "",
    });
  };

  const saveItem = async () => {
    if (!editItem || !id || !group) return;
    if (!guardEditable()) return;
    const newGross = Number(editDraft.gross_amount.replace(",", "."));
    if (Number.isNaN(newGross)) {
      toast.error("Valor inválido");
      return;
    }
    setSavingItem(true);
    try {
      const oldGross = Number(editItem.gross_amount ?? 0);
      const { error } = await supabase
        .from("payment_items")
        .update({
          gross_amount: newGross,
          specialty: editDraft.specialty || null,
          doctor_name: editDraft.doctor_name,
          description: editDraft.description || null,
          ai_status: "pendente",
        })
        .eq("id", editItem.id);
      if (error) throw error;
      const delta = newGross - oldGross;
      if (Math.abs(delta) > 0.001) {
        await supabase
          .from("payment_company_groups")
          .update({ total_amount: Number(group.total_amount ?? 0) + delta })
          .eq("id", group.id);
      }
      await recordObservation({
        payment_id: id,
        item_id: editItem.id,
        author_type: "analista",
        author_id: user!.id,
        message: `Item editado pelo analista (valor: ${oldGross} → ${newGross}).`,
      });
      try {
        await supabase.functions.invoke("analyze-payment", {
          body: { payment_id: id, company_name: group.company_name },
        });
      } catch (e) { console.warn("Reanálise pós-edição falhou:", e); }
      toast.success("Item atualizado");
      setEditItem(null);
      load();
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
      setItems(prev => prev.filter(it => it.id !== deleteItem.id));
      
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
      setItems(previousItems);
      toast.error("Falha ao excluir", { description: e instanceof Error ? e.message : String(e) });
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
  const canEdit = canEditBatch(gStatus, { isOwner, isAnalista, isAdminOrDiretor });
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
  // Governança: analista só atua se for o dono do lote (ou admin).
  // Validador/diretor só atuam se NÃO forem o criador (segregação de funções).
  const canActAnalista =
    (gStatus === "revisao_analista" || gStatus === "devolvido_analista" || gStatus === "aprovado_em_revisao") &&
    isAnalistaRole && (isOwner || isAdmin);
  const canActValidador = gStatus === "aguardando_validacao" && isValidador && canActAsVD;
  const canActDiretor = gStatus === "aguardando_aprovacao" && isDiretor && canActAsVD;
  const canAct = canActAnalista || canActValidador || canActDiretor;
  // (removido) returner: o fluxo unificado de "Concluir análise" não distingue mais reencaminhamento aqui — o envio ao validador é feito no lote inteiro.

  return (
    <div className="space-y-4 pb-32">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/pagamentos/${id}#group-${groupId}`}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao lote
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                <Download className="h-4 w-4 mr-2" /> Exportar <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={() => handleExport("pdf")}>
                <FileText className="h-4 w-4 mr-2" /> Exportar em PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("excel")}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Exportar em Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/20 hover:bg-destructive/10" disabled={busy}>
                  <Trash2 className="h-4 w-4 mr-1" /> Excluir lote
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir este lote?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação remove o lote <strong>{payment.reference}</strong>, todos os itens (incluindo esta empresa) e o histórico permanentemente. Não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={handleDeletePayment} 
                    disabled={busy}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {busy ? "Excluindo..." : "Excluir definitivamente"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold leading-tight truncate">{group.company_name}</h1>
                {canEdit && (
                  <Dialog open={changeCompanyOpen} onOpenChange={setChangeCompanyOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7">
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Trocar empresa
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Trocar empresa do grupo</DialogTitle>
                        <DialogDescription>
                          Reatribui todos os {items.length} itens deste grupo à empresa selecionada.
                          O nome atual <strong>{group.company_name}</strong> será aprendido como apelido
                          para futuras correspondências automáticas. As regras serão reaplicadas em seguida.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-2">
                        <CompanyCombobox value={newCompany} onChange={setNewCompany} className="w-full" />
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
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Itens"
              value={String(group.items_count ?? items.length)}
              tone="info"
              icon={<FileText className="h-4 w-4" />}
            />
            <Stat
              label="Valor total"
              value={formatCurrency(Number(group.total_amount ?? 0))}
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
          </div>
        </CardContent>
      </Card>

      {/* ABAS */}
      <Tabs defaultValue="analise" className="space-y-3">
        <TabsList>
          <TabsTrigger value="analise">Análise</TabsTrigger>
          <TabsTrigger value="divergencias">
            Divergências
            {divergentes.length > 0 && (
              <Badge variant="secondary" className="ml-2">{divergentes.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History className="h-3.5 w-3.5 mr-1" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="ia">Detalhe IA</TabsTrigger>
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
              <CardTitle className="text-base">Itens</CardTitle>
              <p className="text-xs text-muted-foreground">
                {items.length} itens · use os filtros do grid para focar em status, convênio, médico ou alertas.
                {payment?.processing_timeout_occurred && (
                  <span className="ml-2 text-destructive font-medium">⚠️ Algumas justificativas da IA podem estar ausentes por timeout.</span>
                )}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ItemsDataGrid
                items={items}
                groupStatus={gStatus}
                rulesIndex={rulesIndex}
                rulesByName={rulesByName}
                observations={obs}
                profiles={profiles}
                storageKey="companyAnalysisPage"
                canEdit={canEdit}
                onEditItem={openEditItem}
                onDeleteItem={(it) => setDeleteItem(it)}
                onAcceptItem={acceptItem}
                onUndoAcceptItem={undoAcceptItem}
              />
            </CardContent>
          </Card>

          {/* Comentário geral da empresa */}
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                Comentário geral da empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
             <Textarea
                placeholder="Anote uma observação para esta empresa…"
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
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="is-question"
                      checked={isQuestion}
                      onCheckedChange={(v) => setIsQuestion(!!v)}
                    />
                    <Label htmlFor="is-question" className="text-xs font-normal cursor-pointer select-none">
                      É um questionamento ao diretor (aguarda resposta)
                    </Label>
                  </div>
                  <Button size="sm" onClick={addGroupComment} disabled={busy || !groupDraft.trim()}>
                    Adicionar comentário
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
                        {" · "}{new Date(o.created_at).toLocaleString("pt-BR")}
                      </div>
                      <div className="whitespace-pre-wrap">{o.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2 — Divergências */}
        <TabsContent value="divergencias" className="space-y-3">
          {divergentes.length === 0 ? (
            <Card className="shadow-card">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma divergência identificada para esta empresa.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {divergentes.map((it) => (
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
            </div>
          )}
        </TabsContent>

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

        {/* ABA 3 — Detalhe IA */}
        <TabsContent value="ia" className="space-y-3">
          <AiDetail items={items} versions={aiVersions} />
        </TabsContent>
      </Tabs>

      {/* Footer sticky com ações de fluxo */}
      {canAct && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.2)]">
          <div className="mx-auto max-w-[1400px] flex flex-col md:flex-row md:items-start gap-2">
            <div className="flex flex-col md:flex-1 gap-2">
              <Textarea
                rows={2}
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                placeholder="Observação para esta empresa (obrigatória para devolver)..."
                className="w-full text-xs"
              />
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  id="footer-is-question"
                  checked={isQuestion}
                  onCheckedChange={(v) => setIsQuestion(!!v)}
                />
                <Label htmlFor="footer-is-question" className="text-[11px] font-normal cursor-pointer select-none">
                  Marcar como questionamento ao diretor
                </Label>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end shrink-0">
              {canActAnalista && (
                <>
                  {(gStatus === "revisao_analista" || gStatus === "devolvido_analista") && (
                    <>
                      <Button variant="outline" size="sm" onClick={reanalyzeGroup} disabled={busy || reanalyzing}>
                        <RefreshCcw className={cn("h-4 w-4 mr-2", reanalyzing && "animate-spin")} />
                        {reanalyzing ? "Reaplicando..." : "Reaplicar regras"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={busy} className="text-destructive hover:text-destructive">
                            <XCircle className="h-4 w-4 mr-2" /> Cancelar lote
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancelar este lote?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação marca todos os grupos do lote como cancelados e encerra o fluxo de aprovação.
                              Use quando o pagamento não deve ser processado (ex.: base enviada por engano).
                              A observação registrada acima (se houver) será anexada ao histórico.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Voltar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={cancelBatch}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Cancelar lote
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      {(() => {
                        const temItemAcatado = items.some((i) => i.ai_status === "acatado");
                        const observacaoOk = groupDraft.trim().length >= 20;
                        const podeEnviar = !temItemAcatado || observacaoOk;
                        const tooltip = !podeEnviar
                          ? "Preencha a observação da empresa (mín. 20 caracteres) para enviar itens acatados"
                          : undefined;
                        const handleClick = () => {
                          if (!podeEnviar) {
                            toast.error("Observação obrigatória", {
                              description:
                                "Há itens acatados nesta empresa. Preencha o comentário geral da empresa com no mínimo 20 caracteres antes de enviar para validação.",
                            });
                            return;
                          }
                          sendForValidation();
                        };
                        return (
                          <Button
                            size="sm"
                            onClick={handleClick}
                            disabled={busy}
                            title={tooltip}
                            className={podeEnviar ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                            variant={podeEnviar ? "default" : "secondary"}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Concluir análise
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
              {canActValidador && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("devolvido_analista", "validador", "Devolvido ao analista pelo validador", true)}
                  >
                    <Undo2 className="h-4 w-4 mr-2" /> Devolver ao analista
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("aguardando_aprovacao", "validador", "Validado e enviado para aprovação", false)}
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" /> Validar e enviar para aprovação
                  </Button>
                </>
              )}
              {canActDiretor && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("devolvido_analista", "diretor", "Devolvido ao analista pelo diretor", true)}
                  >
                    <Undo2 className="h-4 w-4 mr-2" /> Devolver ao analista
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="text-destructive hover:text-destructive"
                    onClick={() => transitionGroupStatus("rejeitado", "diretor", "Rejeitado pelo diretor", true)}
                  >
                    <ThumbsDown className="h-4 w-4 mr-2" /> Rejeitar
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => transitionGroupStatus("aprovado_em_revisao", "diretor", "Aprovado pelo diretor", false)}
                  >
                    <ThumbsUp className="h-4 w-4 mr-2" /> Aprovar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Editar item */}
      <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar item</DialogTitle>
            <DialogDescription>
              Ajuste valores ou metadados desta linha. O item será reanalisado pela IA.
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
      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem && (
                <>Remove a linha de <strong>{deleteItem.doctor_name}</strong> ({formatCurrency(Number(deleteItem.gross_amount ?? 0))}). Os totais do grupo serão recalculados.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingItem}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteItem} disabled={deletingItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingItem ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  tone = "muted",
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  icon?: React.ReactNode;
}) {
  // Cada tom tem: chip do ícone (fundo soft + texto da cor) e barra lateral.
  // Mantém fundo branco do card pra preservar a estética financeira sóbria,
  // mas usa o acento de cor pra deixar cada KPI visualmente distinto.
  const tones: Record<typeof tone, { chip: string; bar: string; value: string }> = {
    muted: {
      chip: "bg-muted text-muted-foreground",
      bar: "bg-border",
      value: "text-foreground",
    },
    info: {
      chip: "bg-info-soft text-info",
      bar: "bg-info",
      value: "text-foreground",
    },
    success: {
      chip: "bg-success-soft text-success",
      bar: "bg-success",
      value: "text-foreground",
    },
    warning: {
      chip: "bg-warning-soft text-warning-foreground",
      bar: "bg-warning",
      value: "text-warning-foreground",
    },
    destructive: {
      chip: "bg-destructive/10 text-destructive",
      bar: "bg-destructive",
      value: "text-destructive",
    },
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
          <div className={cn("mt-1 text-xl font-semibold leading-tight", mono && "tabular-nums", t.value)}>{value}</div>
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
                  {" · "}{new Date(o.created_at).toLocaleString("pt-BR")}
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