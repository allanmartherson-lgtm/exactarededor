import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, TONE_CLASSES, type InvoiceStatus } from "@/lib/status";
import { InvoiceQuestionsThread, type InvoiceQuestion } from "@/components/InvoiceQuestionsThread";
import {
  MessageCircleQuestion, Bot, AlertTriangle, CheckCircle2, Wallet,
  Copy, Send, Mail, Users, Clock, FileText, ChevronDown, ChevronUp, MailWarning, RefreshCw,
} from "lucide-react";

const tone: Record<InvoiceStatus, keyof typeof TONE_CLASSES> = {
  aguardando: "warning", recebida: "info", conciliada: "success", divergente: "destructive",
};
const labels: Record<InvoiceStatus, string> = {
  aguardando: "Aguardando NF", recebida: "NF recebida", conciliada: "Conciliada", divergente: "Divergente",
};

type TabKey = "todas" | InvoiceStatus;

const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "aguardando", label: "Aguardando NF" },
  { key: "recebida", label: "Recebidas" },
  { key: "conciliada", label: "Conciliadas" },
  { key: "divergente", label: "Divergentes" },
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
  status: InvoiceStatus;
  sent_at: string | null;
  send_error: string | null;
  reconciliation_notes: string | null;
  ai_validation: { divergences?: string[]; confidence?: string; notes?: string } | null;
  ai_extracted_amount: number | null;
  company_name: string | null;
  payments: { reference: string; status: string } | null;
  question_count: number;
}

const daysSince = (iso: string | null) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

const ageTone = (days: number | null) => {
  if (days == null) return "muted";
  if (days < 3) return "success";
  if (days <= 7) return "warning";
  return "destructive";
};

const Invoices = () => {
  const { user, hasRole } = useAuth();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [openInvoice, setOpenInvoice] = useState<InvoiceRow | null>(null);
  const [openQuestions, setOpenQuestions] = useState<InvoiceQuestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("todas");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const canActOnNF = hasRole("analista") || hasRole("admin") || hasRole("diretor");

  const load = async () => {
    const { data: invoices } = await supabase
      .from("invoices")
      .select("*, payments(reference,status)")
      .order("created_at", { ascending: false });
    const ids = (invoices ?? []).map((i: { id: string }) => i.id);
    const countByInvoice = new Map<string, number>();
    if (ids.length > 0) {
      const { data: qs } = await supabase
        .from("invoice_questions")
        .select("invoice_id")
        .in("invoice_id", ids);
      (qs ?? []).forEach((q: { invoice_id: string }) => {
        countByInvoice.set(q.invoice_id, (countByInvoice.get(q.invoice_id) ?? 0) + 1);
      });
    }
    setRows(((invoices ?? []) as unknown as InvoiceRow[]).map((i) => ({
      ...i,
      question_count: countByInvoice.get(i.id) ?? 0,
    })));
  };

  useEffect(() => {
    document.title = "Notas Fiscais | MedPay";
    void load();
  }, []);

  const openThread = async (inv: InvoiceRow) => {
    setOpenInvoice(inv);
    const { data } = await supabase
      .from("invoice_questions")
      .select("id, author_type, author_name, message, created_at, read_at")
      .eq("invoice_id", inv.id)
      .order("created_at", { ascending: true });
    setOpenQuestions((data ?? []) as InvoiceQuestion[]);
  };

  const markConciliada = async (inv: InvoiceRow) => {
    if (!user) return;
    setBusyId(inv.id);
    const { error: e1 } = await supabase
      .from("invoices")
      .update({ status: "conciliada", reconciliation_notes: inv.reconciliation_notes ?? "Conciliada manualmente pelo analista." })
      .eq("id", inv.id);
    if (e1) {
      toast({ title: "Falha ao conciliar", description: e1.message, variant: "destructive" });
      setBusyId(null); return;
    }
    await supabase.from("payments").update({ status: "nf_conciliada", updated_at: new Date().toISOString() }).eq("id", inv.payment_id);
    await supabase.from("payment_observations").insert({
      payment_id: inv.payment_id, author_type: "analista", author_id: user.id,
      message: `NF #${inv.invoice_number ?? "—"} conciliada manualmente.`,
      status_to: "nf_conciliada",
    });
    setBusyId(null);
    toast({ title: "NF conciliada" });
    await load();
  };

  const markPaga = async (inv: InvoiceRow) => {
    if (!user) return;
    setBusyId(inv.id);
    const { error } = await supabase
      .from("payments")
      .update({ status: "pago", updated_at: new Date().toISOString() })
      .eq("id", inv.payment_id);
    if (error) {
      toast({ title: "Falha ao marcar como pago", description: error.message, variant: "destructive" });
      setBusyId(null); return;
    }
    await supabase.from("payment_observations").insert({
      payment_id: inv.payment_id, author_type: "analista", author_id: user.id,
      message: `Pagamento liquidado no sistema financeiro (NF #${inv.invoice_number ?? "—"}).`,
      status_to: "pago",
    });
    setBusyId(null);
    toast({ title: "Pagamento marcado como pago" });
    await load();
  };

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { todas: rows.length, aguardando: 0, recebida: 0, conciliada: 0, divergente: 0 };
    rows.forEach((r) => { c[r.status as InvoiceStatus] = (c[r.status as InvoiceStatus] ?? 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => (tab === "todas" ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab],
  );

  const copyLink = async (inv: InvoiceRow) => {
    const url = `${window.location.origin}/portal/nota/${inv.upload_token}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Link copiado", description: url });
  };

  const resend = async (inv: InvoiceRow) => {
    setBusyId(inv.id);
    const { error } = await supabase.functions.invoke("send-invoice-request", {
      body: { payment_id: inv.payment_id },
    });
    setBusyId(null);
    if (error) {
      toast({ title: "Falha ao reenviar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pedido reenviado" });
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
    const paymentIds = Array.from(new Set(failedInvoices.map((i) => i.payment_id)));
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];
    for (const pid of paymentIds) {
      const { data, error } = await supabase.functions.invoke("send-invoice-request", {
        body: { payment_id: pid },
      });
      const payload = (data ?? {}) as { sent_ok?: number; sent_error?: number; error?: string; message?: string };
      if (error || payload.error) {
        fail++;
        const msg = payload.message ?? error?.message ?? "erro desconhecido";
        errors.push(`${pid.slice(0, 8)}…: ${msg}`);
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

  return (
    <>
      <PageHeader title="Notas Fiscais" description="Pedidos enviados e notas recebidas." />
      <div className="p-8">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mb-4">
          <TabsList>
            {TAB_ORDER.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                {t.label}
                <Badge variant="secondary" className="rounded-full px-2 text-[11px]">{counts[t.key]}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Card className="shadow-card"><CardContent className="p-0">
          {filtered.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? "Nenhum pedido enviado ainda." : "Nenhum pedido neste status."}
          </p> :
            <div className="divide-y divide-border">{filtered.map((i) => {
              const age = daysSince(i.sent_at);
              const ccCount = (i.recipient_cc ?? []).length;
              const expanded = expandedId === i.id;
              return (
              <div key={i.id} className="px-6 py-4">
               <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">
                    {i.payments?.reference}
                    {i.company_name && <> · <span className="text-muted-foreground">{i.company_name}</span></>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <Mail className="h-3 w-3" /> <span className="truncate max-w-[260px]">{i.recipient_email}</span>
                    {ccCount > 0 && (
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />+{ccCount} em cópia</span>
                    )}
                    {i.sent_at && age != null && (
                      <span className={`inline-flex items-center gap-1 ${TONE_CLASSES[ageTone(age) as keyof typeof TONE_CLASSES]?.split(" ")[1] ?? ""}`}>
                        <Clock className="h-3 w-3" /> enviado há {age === 0 ? "hoje" : `${age}d`}
                      </span>
                    )}
                    {!i.sent_at && !i.send_error && (
                      <span className="inline-flex items-center gap-1 text-warning-foreground">
                        <Clock className="h-3 w-3" /> aguardando envio
                      </span>
                    )}
                    {i.send_error && (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <MailWarning className="h-3 w-3" /> erro no envio
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pedido: {formatCurrency(i.expected_amount)}
                    {i.received_amount != null && <> · Nota: {formatCurrency(i.received_amount)}</>}
                    {i.invoice_number && <> · NF #{i.invoice_number}</>}
                    {i.items_count ? <> · {i.items_count} item{i.items_count === 1 ? "" : "ns"}</> : null}
                    {" "}· {formatDate(i.sent_at)}
                  </p>
                  {i.reconciliation_notes && <p className="text-xs mt-1">{i.reconciliation_notes}</p>}
                  {i.send_error && (
                    <p className="text-xs mt-1 text-destructive flex items-start gap-1.5">
                      <MailWarning className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span><strong>Falha do provedor de e-mail:</strong> {i.send_error}</span>
                    </p>
                  )}
                  {i.ai_validation && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                      <Bot className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="font-medium">IA conferiu o PDF</span>
                        {i.ai_extracted_amount != null && (
                          <> · valor extraído {formatCurrency(i.ai_extracted_amount)}</>
                        )}
                        {(i.ai_validation.divergences?.length ?? 0) > 0 && (
                          <ul className="mt-0.5 ml-1 text-destructive">
                            {i.ai_validation.divergences!.map((d, idx) => (
                              <li key={idx} className="flex gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{d}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {i.question_count > 0 && (
                    <Button variant="outline" size="sm" onClick={() => openThread(i)}>
                      <MessageCircleQuestion className="h-3.5 w-3.5 mr-1.5" />
                      {i.question_count} mensagem{i.question_count === 1 ? "" : "s"}
                    </Button>
                  )}
                  {canActOnNF && i.status === "aguardando" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copyLink(i)}>
                        <Copy className="h-3.5 w-3.5 mr-1.5" /> Link
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => resend(i)}>
                        <Send className="h-3.5 w-3.5 mr-1.5" /> Reenviar
                      </Button>
                    </>
                  )}
                  {canActOnNF && i.status === "recebida" && (
                    <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => markConciliada(i)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Conciliar
                    </Button>
                  )}
                  {canActOnNF && i.status === "conciliada" && i.payments?.status !== "pago" && (
                    <Button size="sm" disabled={busyId === i.id} onClick={() => markPaga(i)}>
                      <Wallet className="h-3.5 w-3.5 mr-1.5" /> Marcar como pago
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setExpandedId(expanded ? null : i.id)}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Detalhes {expanded ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                  </Button>
                  <span className={`text-xs rounded-full border px-2.5 py-0.5 ${TONE_CLASSES[tone[i.status as InvoiceStatus]]}`}>{labels[i.status as InvoiceStatus]}</span>
                </div>
               </div>

               {expanded && (
                 <div className="mt-3 rounded-md border bg-muted/30 p-3 space-y-3 text-xs">
                   <div>
                     <p className="font-medium mb-1 flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Destinatários</p>
                     <p><span className="text-muted-foreground">Para:</span> {i.recipient_email}</p>
                     {ccCount > 0 && (
                       <p className="mt-0.5"><span className="text-muted-foreground">CC:</span> {(i.recipient_cc ?? []).join(", ")}</p>
                     )}
                   </div>
                   <div>
                     <p className="font-medium mb-1 flex items-center gap-1.5"><Copy className="h-3.5 w-3.5" /> Link único de upload</p>
                     <div className="flex items-center gap-2">
                       <code className="text-[11px] bg-background border rounded px-2 py-1 truncate max-w-full flex-1">
                         {window.location.origin}/portal/nota/{i.upload_token}
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
            })}</div>}
        </CardContent></Card>
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
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};
export default Invoices;