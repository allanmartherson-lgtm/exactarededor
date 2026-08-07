import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, type InvoiceStatus } from "@/lib/status";
import { InvoiceQuestionsThread, type InvoiceQuestion } from "@/components/InvoiceQuestionsThread";
import {
  MessageCircle, Bot, AlertTriangle, CheckCircle2, Wallet,
  Copy, Send, Mail, Users, Clock, FileText, ChevronDown, ChevronUp, MailWarning, RefreshCw,
  ShieldCheck, ShieldAlert, Eye, Download, Undo2, Landmark, History, PenLine,
} from "lucide-react";
import { formatCNPJ, onlyDigits } from "@/lib/cnpj";
import { APP_URL, invoiceUploadUrl } from "@/lib/appUrl";

const pillVariant: Record<InvoiceStatus, "warning" | "info" | "success" | "danger"> = {
  aguardando: "warning", recebida: "info", conciliada: "success", divergente: "danger", cancelada: "danger",
  lancada: "info", paga: "success",
};
const labels: Record<InvoiceStatus, string> = {
  aguardando: "Aguardando NF", recebida: "NF recebida", conciliada: "Conciliada", divergente: "Divergente", cancelada: "Cancelada",
  lancada: "Lançada no P12", paga: "Paga",
};

type TabKey = "todas" | InvoiceStatus;

const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "aguardando", label: "Aguardando NF" },
  { key: "recebida", label: "Recebidas" },
  { key: "conciliada", label: "Conciliadas" },
  { key: "divergente", label: "Divergentes" },
  { key: "lancada", label: "Lançadas" },
  { key: "paga", label: "Pagas" },
  { key: "cancelada", label: "Canceladas" },
];

interface InvoiceRow {
  id: string;
  payment_id: string;
  recipient_email: string;
  recipient_cc: string[] | null;
  request_message: string | null;
  items_count: number | null;
  upload_token: string;
  expected_amount: number;
  received_amount: number | null;
  invoice_number: string | null;
  file_path: string | null;
  status: InvoiceStatus;
  sent_at: string | null;
  send_error: string | null;
  reconciliation_notes: string | null;
  ai_validation: { divergences?: string[]; confidence?: string; notes?: string } | null;
  ai_extracted_amount: number | null;
  ai_extracted_cnpj: string | null;
  company_id: string | null;
  company_name: string | null;
  erp_document_number: string | null;
  erp_posted_at: string | null;
  erp_posted_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  manual_conciliation_note: string | null;
  manual_conciliated_at: string | null;
  manual_conciliated_by: string | null;
  payments: { reference: string; status: string } | null;
  question_count: number;
}

interface FileVersionRow {
  id: string;
  version: number;
  file_path: string | null;
  invoice_number: string | null;
  received_amount: number | null;
  reason: string | null;
  source: string;
  created_at: string;
}

/** Ações que abrem o modal de justificativa livre. */
type JustifyAction =
  | "conciliar_manual"
  | "aceitar_divergente"
  | "solicitar_correcao"
  | "estornar_lancamento"
  | "estornar_pagamento";

const JUSTIFY_CONFIG: Record<JustifyAction, {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  confirm: string;
  defaultValue?: string;
  destructive?: boolean;
}> = {
  conciliar_manual: {
    title: "Confirmar conciliação",
    description: "A nota será conciliada manualmente e seguirá para o lançamento no P12.",
    label: "Justificativa",
    placeholder: "Descreva o que foi conferido.",
    confirm: "Confirmar conciliação",
    defaultValue: "Revisão manual: leitura conferida com o PDF",
  },
  aceitar_divergente: {
    title: "Aceitar com justificativa",
    description: "A divergência será aceita e a nota passará para conciliada. A justificativa fica registrada no histórico do lote.",
    label: "Justificativa da aceitação",
    placeholder: "Ex.: diferença de centavos por arredondamento, autorizada pelo gestor.",
    confirm: "Aceitar e conciliar",
  },
  solicitar_correcao: {
    title: "Solicitar correção à empresa",
    description: "A nota atual será arquivada no histórico de versões e o portal será reaberto para reenvio. A empresa receberá um e-mail com exatamente o texto abaixo.",
    label: "Motivo da correção (vai no e-mail para a empresa)",
    placeholder: "Ex.: o valor da nota está R$ 120,00 acima do pedido. Reemitir com o valor correto.",
    confirm: "Solicitar correção",
  },
  estornar_lancamento: {
    title: "Estornar lançamento no P12",
    description: "A nota volta para conciliada e o número do documento no P12 será limpo.",
    label: "Justificativa do estorno",
    placeholder: "Ex.: documento lançado no fornecedor errado.",
    confirm: "Estornar lançamento",
    destructive: true,
  },
  estornar_pagamento: {
    title: "Estornar pagamento",
    description: "A nota volta para lançada no P12 e a data de pagamento será limpa. Ação restrita a administradores.",
    label: "Justificativa do estorno",
    placeholder: "Ex.: pagamento não compensado pelo banco.",
    confirm: "Estornar pagamento",
    destructive: true,
  },
};

const VERSION_SOURCE_LABEL: Record<string, string> = {
  reenvio_empresa: "Reenvio da empresa",
  correcao_solicitada: "Correção solicitada",
};

const daysSince = (iso: string | null) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

const ageColorClass = (days: number | null) => {
  if (days == null) return "text-muted-foreground";
  if (days < 3) return "text-success-text";
  if (days <= 7) return "text-warning-text";
  return "text-destructive";
};

const Invoices = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const { hasRole } = useAuth();
  const activeHospitalId = useActiveHospitalId();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<InvoiceRow | null>(null);
  const [openQuestions, setOpenQuestions] = useState<InvoiceQuestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("todas");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendInvoice, setResendInvoice] = useState<InvoiceRow | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [companyDocs, setCompanyDocs] = useState<Map<string, string | null>>(new Map());
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());

  // Modal de justificativa (conciliação manual, correção, estornos)
  const [justifyOpen, setJustifyOpen] = useState(false);
  const [justifyAction, setJustifyAction] = useState<JustifyAction>("conciliar_manual");
  const [justifyInvoice, setJustifyInvoice] = useState<InvoiceRow | null>(null);
  const [justifyText, setJustifyText] = useState("");

  // Modal "Lançada no P12"
  const [erpOpen, setErpOpen] = useState(false);
  const [erpInvoice, setErpInvoice] = useState<InvoiceRow | null>(null);
  const [erpDoc, setErpDoc] = useState("");

  // Visualizador de PDF
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");

  // Histórico de versões por invoice (carregado ao expandir)
  const [versions, setVersions] = useState<Map<string, FileVersionRow[]>>(new Map());

  const isAdmin = hasRole("admin");
  const canActOnNF = hasRole("analista") || isAdmin || hasRole("diretor");

  const load = async () => {
    setLoadError(null);
    const { data: invoices, error: invoicesError } = await supabase
      .from("invoices")
      .select(
        "id,payment_id,expected_amount,received_amount,invoice_number,file_path,status,recipient_email,sent_at,received_at,reconciliation_notes,created_at,updated_at,company_id,company_name,ai_validation,ai_validated_at,ai_extracted_amount,ai_extracted_number,ai_extracted_cnpj,recipient_cc,request_message,items_count,send_error,company_group_id,hospital_id,erp_document_number,erp_posted_at,erp_posted_by,paid_at,paid_by,manual_conciliation_note,manual_conciliated_at,manual_conciliated_by, payments(reference,status)",
      )
      .order("created_at", { ascending: false });
    // NUNCA cair em lista vazia silenciosa: erro de query vira banner + toast.
    if (invoicesError) {
      const msg = `${invoicesError.message}${invoicesError.hint ? ` — ${invoicesError.hint}` : ""}`;
      setLoadError(msg);
      toast({ title: "Falha ao carregar notas fiscais", description: msg, variant: "destructive" });
      setRows([]);
      return;
    }
    const ids = (invoices ?? []).map((i: { id: string }) => i.id);
    const countByInvoice = new Map<string, number>();
    if (ids.length > 0) {
      const { data: qs } = await supabase
        .from("invoice_questions")
        .select("invoice_id, author_type, answered_at")
        .in("invoice_id", ids)
        .eq("author_type", "recebedor")
        .is("answered_at", null);
      (qs ?? []).forEach((q: { invoice_id: string }) => {
        countByInvoice.set(q.invoice_id, (countByInvoice.get(q.invoice_id) ?? 0) + 1);
      });
    }
    const tokenMap = new Map<string, string>();
    if (ids.length > 0) {
      const { data: tokRows } = await supabase.rpc("get_invoice_upload_tokens", { p_invoice_ids: ids });
      ((tokRows ?? []) as Array<{ invoice_id: string; upload_token: string }>).forEach((t) =>
        tokenMap.set(t.invoice_id, t.upload_token),
      );
    }
    const companyIds = Array.from(
      new Set(((invoices ?? []) as { company_id: string | null }[]).map((i) => i.company_id).filter(Boolean)),
    ) as string[];
    const docMap = new Map<string, string | null>();
    if (companyIds.length > 0) {
      const { data: comps } = await supabase.from("companies").select("id,document").in("id", companyIds);
      (comps ?? []).forEach((c: { id: string; document: string | null }) => docMap.set(c.id, c.document));
    }
    setCompanyDocs(docMap);

    // Nomes de quem lançou/pagou/conciliou manualmente
    const actorIds = Array.from(new Set(
      ((invoices ?? []) as Array<{ erp_posted_by: string | null; paid_by: string | null; manual_conciliated_by: string | null }>)
        .flatMap((i) => [i.erp_posted_by, i.paid_by, i.manual_conciliated_by])
        .filter(Boolean) as string[],
    ));
    const nameMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", actorIds);
      (profs ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) =>
        nameMap.set(p.id, p.full_name ?? p.email ?? "usuário"),
      );
    }
    setActorNames(nameMap);

    setRows(((invoices ?? []) as unknown as InvoiceRow[]).map((i) => ({
      ...i,
      upload_token: tokenMap.get(i.id) ?? "",
      question_count: countByInvoice.get(i.id) ?? 0,
    })));
  };

  const markDivergente = async (inv: InvoiceRow) => {
    setBusyId(inv.id);
    try {
      const { error } = await supabase.from("invoices").update({ status: "divergente" }).eq("id", inv.id);
      if (error) throw error;
      toast({ title: "NF marcada como divergente" });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    document.title = "Notas Fiscais | Exacta";
    if (!activeHospitalId) { setRows([]); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHospitalId]);

  const openThread = async (inv: InvoiceRow) => {
    setOpenInvoice(inv);
    const { data } = await supabase
      .from("invoice_questions")
      .select("id, author_type, author_name, message, created_at, read_at")
      .eq("invoice_id", inv.id)
      .order("created_at", { ascending: true });
    setOpenQuestions((data ?? []) as InvoiceQuestion[]);
  };

  /* ------------------------------ arquivos ------------------------------ */

  const signedUrl = async (path: string) => {
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Não foi possível abrir o arquivo", description: error?.message ?? "URL não gerada", variant: "destructive" });
      return null;
    }
    return data.signedUrl;
  };

  const viewFile = async (path: string, title: string) => {
    const url = await signedUrl(path);
    if (!url) return;
    setViewerUrl(url);
    setViewerTitle(title);
    setViewerOpen(true);
  };

  const downloadFile = async (path: string, filename: string) => {
    const url = await signedUrl(path);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const loadVersions = async (invoiceId: string) => {
    const { data, error } = await supabase
      .from("invoice_file_versions")
      .select("id,version,file_path,invoice_number,received_amount,reason,source,created_at")
      .eq("invoice_id", invoiceId)
      .order("version", { ascending: true });
    if (error) {
      toast({ title: "Falha ao carregar versões", description: error.message, variant: "destructive" });
      return;
    }
    setVersions((prev) => new Map(prev).set(invoiceId, (data ?? []) as FileVersionRow[]));
  };

  const toggleExpanded = (inv: InvoiceRow) => {
    const next = expandedId === inv.id ? null : inv.id;
    setExpandedId(next);
    if (next && !versions.has(inv.id)) void loadVersions(inv.id);
  };

  /* ------------------------------ ações NF ------------------------------ */

  const openJustify = (inv: InvoiceRow, action: JustifyAction) => {
    setJustifyInvoice(inv);
    setJustifyAction(action);
    setJustifyText(JUSTIFY_CONFIG[action].defaultValue ?? "");
    setJustifyOpen(true);
  };

  const runJustify = async () => {
    const inv = justifyInvoice;
    const texto = justifyText.trim();
    if (!inv || !texto) return;
    setBusyId(inv.id);
    try {
      if (justifyAction === "conciliar_manual" || justifyAction === "aceitar_divergente") {
        const { error } = await supabase.rpc("mark_invoice_conciliada_manual", {
          p_invoice_id: inv.id, p_justificativa: texto,
        });
        if (error) throw error;
        toast({ title: "NF conciliada", description: "Pronta para o lançamento no P12." });
      } else if (justifyAction === "estornar_lancamento") {
        const { error } = await supabase.rpc("revert_invoice_lancamento", {
          p_invoice_id: inv.id, p_justificativa: texto,
        });
        if (error) throw error;
        toast({ title: "Lançamento estornado" });
      } else if (justifyAction === "estornar_pagamento") {
        const { error } = await supabase.rpc("revert_invoice_paga", {
          p_invoice_id: inv.id, p_justificativa: texto,
        });
        if (error) throw error;
        toast({ title: "Pagamento estornado" });
      } else if (justifyAction === "solicitar_correcao") {
        const { data, error } = await supabase.functions.invoke("request-invoice-correction", {
          body: { invoice_id: inv.id, motivo: texto },
        });
        const payload = (data ?? {}) as { error?: string; email?: { ok?: boolean; error?: string } };
        if (error || payload.error) throw new Error(payload.error ?? error?.message ?? "Falha ao solicitar correção");
        toast({
          title: "Correção solicitada",
          description: payload.email?.ok === false
            ? `Portal reaberto, mas o e-mail falhou: ${payload.email?.error ?? "erro desconhecido"}`
            : "A empresa recebeu o e-mail com o motivo e o portal foi reaberto.",
          variant: payload.email?.ok === false ? "destructive" : undefined,
        });
      }
      setJustifyOpen(false);
      setVersions((prev) => { const m = new Map(prev); m.delete(inv.id); return m; });
      await load();
    } catch (e) {
      toast({ title: "Ação não concluída", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const openErpDialog = (inv: InvoiceRow) => {
    setErpInvoice(inv);
    setErpDoc(inv.erp_document_number ?? "");
    setErpOpen(true);
  };

  const runErpLancada = async () => {
    const inv = erpInvoice;
    const doc = erpDoc.trim();
    if (!inv || !doc) return;
    setBusyId(inv.id);
    try {
      const { error } = await supabase.rpc("mark_invoice_lancada", {
        p_invoice_id: inv.id, p_erp_document_number: doc,
      });
      if (error) throw error;
      toast({ title: "NF lançada no P12", description: `Documento ${doc}` });
      setErpOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Falha ao registrar lançamento", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const markPaga = async (inv: InvoiceRow) => {
    setBusyId(inv.id);
    try {
      const { error } = await supabase.rpc("mark_invoice_paga", { p_invoice_id: inv.id });
      if (error) throw error;
      toast({ title: "NF marcada como paga" });
      await load();
    } catch (e) {
      toast({ title: "Falha ao marcar como paga", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { todas: rows.length, aguardando: 0, recebida: 0, conciliada: 0, divergente: 0, cancelada: 0, lancada: 0, paga: 0 };
    rows.forEach((r) => { c[r.status as InvoiceStatus] = (c[r.status as InvoiceStatus] ?? 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (tab === "todas" ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab],
  );

  const copyLink = async (inv: InvoiceRow) => {
    const url = invoiceUploadUrl(inv.upload_token);
    await navigator.clipboard.writeText(url);
    toast({ title: "Link copiado", description: url });
  };

  const openResendDialog = (inv: InvoiceRow) => {
    setResendInvoice(inv);
    setResendEmail(inv.recipient_email ?? "");
    setResendOpen(true);
  };

  const resend = async (inv: InvoiceRow, overrideEmail?: string) => {
    setBusyId(inv.id);
    const { error } = await supabase.functions.invoke("send-invoice-request", {
      body: { invoice_id: inv.id, recipient_email: overrideEmail?.trim() || undefined },
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Falha ao reenviar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pedido reenviado", description: inv.company_name ?? (overrideEmail?.trim() || inv.recipient_email) });
    await load();
  };

  const [bulkBusy, setBulkBusy] = useState(false);
  /**
   * Reenvia em lote todos os pedidos com erro de envio.
   * Agrupa por `payment_id` para chamar a edge function uma única vez por
   * pagamento (a função recria os buckets de empresa/médico do payment),
   * evitando múltiplas observações redundantes.
   */
  const failedInvoices = useMemo(
    () => rows.filter((r) => !!r.send_error),
    [rows],
  );
  const resendAllFailed = async () => {
    if (failedInvoices.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    for (const inv of failedInvoices) {
      const { data, error } = await supabase.functions.invoke("send-invoice-request", {
        body: { invoice_id: inv.id },
      });
      const payload = (data ?? {}) as { sent_ok?: number; sent_error?: number; error?: string; message?: string };
      if (error || payload.error) {
        fail++;
        const msg = payload.message ?? error?.message ?? "erro desconhecido";
        errors.push(`${(inv.company_name ?? inv.recipient_email).slice(0, 32)}: ${msg}`);
        continue;
      }
      ok += payload.sent_ok ?? 0;
      fail += payload.sent_error ?? 0;
    }
    setBulkBusy(false);
    if (ok === 0 && fail > 0) {
      toast({
        title: "Reenvio em lote falhou",
        description: errors.slice(0, 3).join(" · ") || `${fail} envio(s) ainda com erro.`,
        variant: "destructive",
      });
    } else if (fail > 0) {
      toast({
        title: `${ok} reenviado(s), ${fail} ainda com erro`,
        description: "Verifique os pedidos que continuam falhando.",
      });
    } else {
      toast({
        title: "Reenvio em lote concluído",
        description: `${ok} pedido(s) enviado(s) com sucesso.`,
      });
    }
    await load();
  };

  const fileLabel = (inv: InvoiceRow) =>
    `NF-${inv.invoice_number ?? inv.id.slice(0, 8)}.${(inv.file_path ?? "").split(".").pop() || "pdf"}`;

  return (
    <>
      {!embedded && <PageHeader title="Notas Fiscais" description="Pedidos enviados e notas recebidas." />}
      <div className={embedded ? "" : "p-8"}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mb-4">
          <TabsList className="filter-tabs">
            {TAB_ORDER.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                <span className="filter-tabs__label">{t.label}</span>
                <span className="filter-tabs__count">{counts[t.key]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loadError && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <div>
                <p className="font-medium text-destructive">Não foi possível carregar as notas fiscais</p>
                <p className="text-xs text-muted-foreground break-all">{loadError}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Tentar novamente
            </Button>
          </div>
        )}

        {canActOnNF && failedInvoices.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3">
            <div className="flex items-start gap-2 text-sm">
              <MailWarning className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <div>
                <p className="font-medium text-destructive">
                  {failedInvoices.length} pedido{failedInvoices.length === 1 ? "" : "s"} com erro de envio
                </p>
                <p className="text-xs text-muted-foreground">
                  O provedor de e-mail recusou o envio. Você pode reenviar todos de uma vez.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkBusy}
              onClick={resendAllFailed}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${bulkBusy ? "animate-spin" : ""}`} />
              {bulkBusy ? "Reenviando…" : `Reenviar ${failedInvoices.length} com erro`}
            </Button>
          </div>
        )}

        <div
          className="rounded-lg border border-border bg-card overflow-hidden"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "Nenhum pedido enviado ainda." : "Nenhum pedido neste status."}
            </p>
          ) : (
            <div>
              {filtered.map((i) => {
                const age = daysSince(i.sent_at);
                const ccCount = (i.recipient_cc ?? []).length;
                const expanded = expandedId === i.id;
                const invVersions = versions.get(i.id) ?? [];
                return (
                  <div key={i.id}>
                    <div className="list-row">
                      {/* Coluna 1 — Identificação */}
                      <div className="list-row__main">
                        <span className="list-row__title" title={i.payments?.reference ?? ""}>
                          {i.payments?.reference}
                        </span>
                        {i.company_name && (
                          <span className="list-row__sub" title={i.company_name}>
                            {i.company_name}
                          </span>
                        )}
                        <span className="list-row__meta">
                          <Mail className="h-3 w-3 flex-shrink-0" aria-hidden />
                          <span className="truncate">{i.recipient_email}</span>
                          {ccCount > 0 && (
                            <span className="inline-flex items-center gap-1 flex-shrink-0">
                              <Users className="h-3 w-3" aria-hidden />+{ccCount} em cópia
                            </span>
                          )}
                          {i.sent_at && age != null && (
                            <span className={`inline-flex items-center gap-1 flex-shrink-0 ${ageColorClass(age)}`}>
                              <Clock className="h-3 w-3" aria-hidden /> enviado há {age === 0 ? "hoje" : `${age}d`}
                            </span>
                          )}
                          {!i.sent_at && !i.send_error && (
                            <span className="inline-flex items-center gap-1 flex-shrink-0 text-warning-text">
                              <Clock className="h-3 w-3" aria-hidden /> aguardando envio
                            </span>
                          )}
                          {i.send_error && (
                            <span className="inline-flex items-center gap-1 flex-shrink-0 text-destructive">
                              <MailWarning className="h-3 w-3" aria-hidden /> erro no envio
                            </span>
                          )}
                        </span>
                        <span className="list-row__meta">
                          Pedido: {formatCurrency(i.expected_amount)}
                          {i.received_amount != null && <> · Nota: {formatCurrency(i.received_amount)}</>}
                          {i.invoice_number && <> · NF #{i.invoice_number}</>}
                          {i.items_count ? <> · {i.items_count} item{i.items_count === 1 ? "" : "ns"}</> : null}
                          {" "}· {formatDate(i.sent_at)}
                        </span>
                        {i.status === "lancada" && (
                          <span className="list-row__meta text-info">
                            <Landmark className="h-3 w-3 flex-shrink-0" aria-hidden />
                            P12 #{i.erp_document_number ?? "—"}
                            {i.erp_posted_by && <> · por {actorNames.get(i.erp_posted_by) ?? "usuário"}</>}
                            {i.erp_posted_at && <> · {formatDate(i.erp_posted_at)}</>}
                          </span>
                        )}
                        {i.status === "paga" && (
                          <span className="list-row__meta text-success-text">
                            <Wallet className="h-3 w-3 flex-shrink-0" aria-hidden />
                            Paga{i.paid_at && <> em {formatDate(i.paid_at)}</>}
                            {i.paid_by && <> · por {actorNames.get(i.paid_by) ?? "usuário"}</>}
                            {i.erp_document_number && <> · P12 #{i.erp_document_number}</>}
                          </span>
                        )}
                      </div>

                      {/* Coluna 2 — Ações */}
                      <div className="list-row__actions">
                        {i.question_count > 0 && (
                          <button
                            type="button"
                            className="list-row__btn border-warning/60 bg-warning-soft text-warning-text hover:bg-warning-soft/80"
                            onClick={() => openThread(i)}
                            title="Abrir conversa sobre esta NF"
                          >
                            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                            Responder ({i.question_count})
                          </button>
                        )}

                        {i.file_path && (
                          <>
                            <button
                              type="button"
                              className="list-row__btn"
                              onClick={() => viewFile(i.file_path!, `NF ${i.invoice_number ?? ""} · ${i.company_name ?? ""}`)}
                              title="Visualizar a nota fiscal"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden />
                              Visualizar
                            </button>
                            <button
                              type="button"
                              className="list-row__btn"
                              onClick={() => downloadFile(i.file_path!, fileLabel(i))}
                              title="Baixar a nota fiscal"
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Baixar
                            </button>
                          </>
                        )}

                        {canActOnNF && i.status === "aguardando" && (
                          <>
                            <button type="button" className="list-row__btn" onClick={() => copyLink(i)}>
                              <Copy className="h-3.5 w-3.5" aria-hidden />
                              Link
                            </button>
                            <button
                              type="button"
                              className="list-row__btn"
                              disabled={busyId === i.id}
                              onClick={() => openResendDialog(i)}
                            >
                              <Send className="h-3.5 w-3.5" aria-hidden />
                              Reenviar
                            </button>
                          </>
                        )}

                        {canActOnNF && i.status === "recebida" && (
                          <>
                            <button
                              type="button"
                              className="list-row__btn list-row__btn--primary"
                              disabled={busyId === i.id}
                              onClick={() => openJustify(i, "conciliar_manual")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                              Confirmar conciliação
                            </button>
                            <button
                              type="button"
                              className="list-row__btn"
                              disabled={busyId === i.id}
                              onClick={() => markDivergente(i)}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                              Marcar divergente
                            </button>
                            <button
                              type="button"
                              className="list-row__btn"
                              disabled={busyId === i.id}
                              onClick={() => openJustify(i, "solicitar_correcao")}
                            >
                              <PenLine className="h-3.5 w-3.5" aria-hidden />
                              Solicitar correção
                            </button>
                          </>
                        )}

                        {canActOnNF && i.status === "conciliada" && (
                          <>
                            <button
                              type="button"
                              className="list-row__btn list-row__btn--primary"
                              disabled={busyId === i.id}
                              onClick={() => openErpDialog(i)}
                            >
                              <Landmark className="h-3.5 w-3.5" aria-hidden />
                              Lançada no P12
                            </button>
                            <button
                              type="button"
                              className="list-row__btn"
                              disabled={busyId === i.id}
                              onClick={() => openJustify(i, "solicitar_correcao")}
                            >
                              <PenLine className="h-3.5 w-3.5" aria-hidden />
                              Solicitar correção
                            </button>
                          </>
                        )}

                        {canActOnNF && i.status === "divergente" && (
                          <>
                            <button
                              type="button"
                              className="list-row__btn"
                              disabled={busyId === i.id}
                              onClick={() => openJustify(i, "aceitar_divergente")}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                              Aceitar com justificativa
                            </button>
                            <button
                              type="button"
                              className="list-row__btn list-row__btn--primary"
                              disabled={busyId === i.id}
                              onClick={() => openJustify(i, "solicitar_correcao")}
                            >
                              <PenLine className="h-3.5 w-3.5" aria-hidden />
                              Solicitar correção
                            </button>
                          </>
                        )}

                        {canActOnNF && i.status === "lancada" && (
                          <>
                            <button
                              type="button"
                              className="list-row__btn list-row__btn--primary"
                              disabled={busyId === i.id}
                              onClick={() => markPaga(i)}
                            >
                              <Wallet className="h-3.5 w-3.5" aria-hidden />
                              Marcar como paga
                            </button>
                            <button
                              type="button"
                              className="list-row__btn text-muted-foreground"
                              disabled={busyId === i.id}
                              onClick={() => openJustify(i, "estornar_lancamento")}
                              title="Estornar o lançamento no P12"
                            >
                              <Undo2 className="h-3.5 w-3.5" aria-hidden />
                              Estornar lançamento
                            </button>
                          </>
                        )}

                        {isAdmin && i.status === "paga" && (
                          <button
                            type="button"
                            className="list-row__btn text-muted-foreground"
                            disabled={busyId === i.id}
                            onClick={() => openJustify(i, "estornar_pagamento")}
                            title="Estornar o pagamento (somente administradores)"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden />
                            Estornar pagamento
                          </button>
                        )}

                        <button
                          type="button"
                          className="list-row__btn"
                          aria-expanded={expanded}
                          onClick={() => toggleExpanded(i)}
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          Detalhes
                          {expanded ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      </div>

                      {/* Coluna 3 — Status */}
                      <div className="list-row__status">
                        <span className={`pill pill--${pillVariant[i.status as InvoiceStatus]}`}>
                          {labels[i.status as InvoiceStatus]}
                        </span>
                      </div>
                    </div>

                    {/* Motivo em destaque — recebida (revisão manual) e divergente */}
                    {(i.status === "divergente" || i.status === "recebida") && i.reconciliation_notes && (
                      <div
                        className={`mx-5 mb-3 -mt-1 rounded-md border p-3 flex items-start gap-2 text-[12px] ${
                          i.status === "divergente"
                            ? "border-destructive/40 bg-destructive/5"
                            : "border-warning/40 bg-warning-soft"
                        }`}
                      >
                        <AlertTriangle
                          className={`h-4 w-4 mt-0.5 shrink-0 ${i.status === "divergente" ? "text-destructive" : "text-warning-text"}`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className={`font-medium ${i.status === "divergente" ? "text-destructive" : "text-warning-text"}`}>
                            {i.status === "divergente" ? "Motivo da divergência" : "Motivo da revisão manual"}
                          </p>
                          <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{i.reconciliation_notes}</p>
                        </div>
                      </div>
                    )}

                    {/* CNPJ check — NF recebida */}
                    {i.status === "recebida" && i.ai_extracted_cnpj && (() => {
                      const cadastro = i.company_id ? companyDocs.get(i.company_id) ?? null : null;
                      const ok = !!cadastro && onlyDigits(cadastro) === onlyDigits(i.ai_extracted_cnpj || "");
                      if (ok) {
                        return (
                          <div className="px-5 pb-2 -mt-1">
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                              <ShieldCheck className="h-3 w-3" aria-hidden /> CNPJ conferido
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div className="mx-5 mb-3 -mt-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
                          <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden />
                          <div className="min-w-0 flex-1 text-[12px]">
                            <p className="font-medium text-destructive">CNPJ da NF diverge do cadastro</p>
                            <p className="text-muted-foreground mt-0.5">
                              NF: <span className="tabular-nums">{formatCNPJ(i.ai_extracted_cnpj)}</span>
                              {" · "}Cadastro:{" "}
                              <span className="tabular-nums">
                                {cadastro ? formatCNPJ(cadastro) : "não cadastrado"}
                              </span>
                            </p>
                          </div>
                          {canActOnNF && (
                            <button
                              type="button"
                              className="list-row__btn shrink-0"
                              disabled={busyId === i.id}
                              onClick={() => markDivergente(i)}
                            >
                              Marcar como divergente
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Linha extra ocupando largura inteira: notas/erros/IA */}
                    {((i.reconciliation_notes && i.status !== "divergente" && i.status !== "recebida") || i.send_error || i.ai_validation) && (
                      <div className="px-5 pb-3 -mt-2 space-y-1.5 text-[12px]">
                        {i.reconciliation_notes && i.status !== "divergente" && i.status !== "recebida" && (
                          <p className="text-muted-foreground">{i.reconciliation_notes}</p>
                        )}
                        {i.send_error && (
                          <p className="text-destructive flex items-start gap-1.5">
                            <MailWarning className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                            <span><strong>Falha do provedor de e-mail:</strong> {i.send_error}</span>
                          </p>
                        )}
                        {i.ai_validation && (
                          <div className="flex items-start gap-1.5">
                            <Bot className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" aria-hidden />
                            <div className="min-w-0">
                              <span className="font-medium">IA conferiu o PDF</span>
                              {i.ai_extracted_amount != null && (
                                <> · valor extraído {formatCurrency(i.ai_extracted_amount)}</>
                              )}
                              {(i.ai_validation.divergences?.length ?? 0) > 0 && (
                                <ul className="mt-0.5 ml-1 text-destructive">
                                  {i.ai_validation.divergences!.map((d, idx) => (
                                    <li key={idx} className="flex gap-1.5">
                                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                                      {d}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

               {expanded && (
                 <div className="mx-5 mb-4 rounded-md border border-border bg-muted/30 p-3 space-y-3 text-xs">
                   <div>
                     <p className="font-medium mb-1 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Destinatários</p>
                     <p><span className="text-muted-foreground">Para:</span> {i.recipient_email}</p>
                     {ccCount > 0 && (
                       <p className="mt-0.5"><span className="text-muted-foreground">CC:</span> {(i.recipient_cc ?? []).join(", ")}</p>
                     )}
                   </div>

                   {i.file_path && (
                     <div>
                       <p className="font-medium mb-1 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Arquivo da nota</p>
                       <div className="flex items-center gap-2">
                         <Button size="sm" variant="outline" onClick={() => viewFile(i.file_path!, `NF ${i.invoice_number ?? ""}`)}>
                           <Eye className="h-3 w-3 mr-1" /> Visualizar
                         </Button>
                         <Button size="sm" variant="outline" onClick={() => downloadFile(i.file_path!, fileLabel(i))}>
                           <Download className="h-3 w-3 mr-1" /> Baixar
                         </Button>
                       </div>
                     </div>
                   )}

                   {(i.status === "lancada" || i.status === "paga") && (
                     <div>
                       <p className="font-medium mb-1 flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> Lançamento no P12</p>
                       <p><span className="text-muted-foreground">Documento:</span> {i.erp_document_number ?? "—"}</p>
                       <p className="mt-0.5 text-muted-foreground">
                         Lançada por {i.erp_posted_by ? actorNames.get(i.erp_posted_by) ?? "usuário" : "—"}
                         {i.erp_posted_at && <> em {formatDate(i.erp_posted_at)}</>}
                       </p>
                       {i.status === "paga" && (
                         <p className="mt-0.5 text-muted-foreground">
                           Paga por {i.paid_by ? actorNames.get(i.paid_by) ?? "usuário" : "—"}
                           {i.paid_at && <> em {formatDate(i.paid_at)}</>}
                         </p>
                       )}
                     </div>
                   )}

                   {i.manual_conciliation_note && (
                     <div>
                       <p className="font-medium mb-1 flex items-center gap-1.5"><PenLine className="h-3.5 w-3.5" /> Conciliação manual</p>
                       <p className="whitespace-pre-wrap">{i.manual_conciliation_note}</p>
                       <p className="mt-0.5 text-muted-foreground">
                         {i.manual_conciliated_by ? actorNames.get(i.manual_conciliated_by) ?? "usuário" : "—"}
                         {i.manual_conciliated_at && <> · {formatDate(i.manual_conciliated_at)}</>}
                       </p>
                     </div>
                   )}

                   {invVersions.length > 0 && (
                     <div>
                       <p className="font-medium mb-1 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Histórico de versões</p>
                       <ul className="space-y-1.5">
                         {invVersions.map((v) => (
                           <li key={v.id} className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5">
                             <span className="pill pill--info shrink-0">v{v.version}</span>
                             <div className="min-w-0 flex-1">
                               <p>
                                 {formatDate(v.created_at)}
                                 {v.invoice_number && <> · NF #{v.invoice_number}</>}
                                 {v.received_amount != null && <> · {formatCurrency(v.received_amount)}</>}
                                 {" · "}{VERSION_SOURCE_LABEL[v.source] ?? v.source}
                               </p>
                               {v.reason && <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{v.reason}</p>}
                             </div>
                             {v.file_path && (
                               <Button
                                 size="sm"
                                 variant="outline"
                                 className="shrink-0"
                                 onClick={() => downloadFile(v.file_path!, `NF-v${v.version}.${(v.file_path ?? "").split(".").pop() || "pdf"}`)}
                               >
                                 <Download className="h-3 w-3" />
                               </Button>
                             )}
                           </li>
                         ))}
                       </ul>
                     </div>
                   )}

                   <div>
                     <p className="font-medium mb-1 flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" /> Link único de upload</p>
                     <div className="flex items-center gap-2">
                       <code className="text-[11px] bg-background border rounded px-2 py-1 truncate max-w-full flex-1">
                         {APP_URL}/portal/nota/{i.upload_token}
                       </code>
                       <Button size="sm" variant="outline" onClick={() => copyLink(i)}>
                         <Copy className="h-3 w-3" />
                       </Button>
                     </div>
                   </div>
                   {i.request_message && (
                     <div>
                       <p className="font-medium mb-1 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Texto enviado</p>
                       <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed bg-background border rounded p-2 max-h-64 overflow-auto">
{i.request_message}
                       </pre>
                     </div>
                   )}
                 </div>
               )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Sheet open={!!openInvoice} onOpenChange={(v) => !v && setOpenInvoice(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Conversa sobre a NF</SheetTitle>
          </SheetHeader>
          {openInvoice && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-3">
                {openInvoice.payments?.reference} · {openInvoice.recipient_email}
              </p>
              <InvoiceQuestionsThread
                invoiceId={openInvoice.id}
                paymentId={openInvoice.payment_id}
                initial={openQuestions}
                onSent={() => { void load(); }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Modal — justificativa / motivo */}
      <Dialog open={justifyOpen} onOpenChange={setJustifyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{JUSTIFY_CONFIG[justifyAction].title}</DialogTitle>
            <DialogDescription>{JUSTIFY_CONFIG[justifyAction].description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {justifyInvoice && (
              <p className="text-xs text-muted-foreground">
                {justifyInvoice.company_name ?? justifyInvoice.recipient_email}
                {justifyInvoice.invoice_number && <> · NF #{justifyInvoice.invoice_number}</>}
                {" · "}Pedido {formatCurrency(justifyInvoice.expected_amount)}
                {justifyInvoice.received_amount != null && <> · Nota {formatCurrency(justifyInvoice.received_amount)}</>}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="justify-text" className="text-sm font-medium">
                {JUSTIFY_CONFIG[justifyAction].label}
              </Label>
              <Textarea
                id="justify-text"
                rows={4}
                value={justifyText}
                onChange={(e) => setJustifyText(e.target.value)}
                placeholder={JUSTIFY_CONFIG[justifyAction].placeholder}
              />
              {justifyAction === "solicitar_correcao" && (
                <p className="text-xs text-muted-foreground">
                  Este texto é enviado por e-mail para a empresa, exatamente como escrito.
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setJustifyOpen(false)}>Cancelar</Button>
            <Button
              variant={JUSTIFY_CONFIG[justifyAction].destructive ? "destructive" : "default"}
              disabled={!justifyText.trim() || busyId === justifyInvoice?.id}
              onClick={() => void runJustify()}
            >
              {busyId === justifyInvoice?.id ? "Processando…" : JUSTIFY_CONFIG[justifyAction].confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal — lançamento no P12 */}
      <Dialog open={erpOpen} onOpenChange={setErpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lançada no P12</DialogTitle>
            <DialogDescription>
              Informe o número do documento gerado no P12. A nota fica aguardando a confirmação do pagamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {erpInvoice && (
              <p className="text-xs text-muted-foreground">
                {erpInvoice.company_name ?? erpInvoice.recipient_email}
                {erpInvoice.invoice_number && <> · NF #{erpInvoice.invoice_number}</>}
                {" · "}{formatCurrency(erpInvoice.received_amount ?? erpInvoice.expected_amount)}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="erp-doc" className="text-sm font-medium">Nº do documento no P12</Label>
              <Input
                id="erp-doc"
                value={erpDoc}
                onChange={(e) => setErpDoc(e.target.value)}
                placeholder="Ex.: 100234567"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setErpOpen(false)}>Cancelar</Button>
            <Button
              disabled={!erpDoc.trim() || busyId === erpInvoice?.id}
              onClick={() => void runErpLancada()}
            >
              {busyId === erpInvoice?.id ? "Registrando…" : "Confirmar lançamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal — visualizador de PDF */}
      <Dialog open={viewerOpen} onOpenChange={(v) => { setViewerOpen(v); if (!v) setViewerUrl(null); }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{viewerTitle || "Nota fiscal"}</DialogTitle>
          </DialogHeader>
          {viewerUrl ? (
            <iframe
              src={viewerUrl}
              title="Nota fiscal"
              className="w-full h-[70vh] rounded-md border border-border bg-background"
            />
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando arquivo…</p>
          )}
          <DialogFooter className="gap-2">
            {viewerUrl && (
              <Button variant="outline" asChild>
                <a href={viewerUrl} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>
              </Button>
            )}
            <Button variant="ghost" onClick={() => setViewerOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resendOpen} onOpenChange={setResendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reenviar pedido de NF</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="resend-email" className="text-sm font-medium">E-mail destinatário</Label>
              <Input
                id="resend-email"
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                placeholder="email@empresa.com"
              />
              <p className="text-xs text-muted-foreground">
                O e-mail será salvo neste pedido e usado como destinatário principal.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setResendOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!resendEmail.trim() || busyId === resendInvoice?.id}
              onClick={() => {
                if (!resendInvoice) return;
                void resend(resendInvoice, resendEmail);
                setResendOpen(false);
              }}
            >
              {busyId === resendInvoice?.id ? "Reenviando…" : "Reenviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
export default Invoices;
