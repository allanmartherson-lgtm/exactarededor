import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, TONE_CLASSES, type InvoiceStatus } from "@/lib/status";
import { InvoiceQuestionsThread, type InvoiceQuestion } from "@/components/InvoiceQuestionsThread";
import { MessageCircleQuestion, Bot, AlertTriangle, CheckCircle2, Wallet } from "lucide-react";

const tone: Record<InvoiceStatus, keyof typeof TONE_CLASSES> = {
  aguardando: "warning", recebida: "info", conciliada: "success", divergente: "destructive",
};
const labels: Record<InvoiceStatus, string> = {
  aguardando: "Aguardando NF", recebida: "NF recebida", conciliada: "Conciliada", divergente: "Divergente",
};

interface InvoiceRow {
  id: string;
  payment_id: string;
  recipient_email: string;
  expected_amount: number;
  received_amount: number | null;
  invoice_number: string | null;
  status: InvoiceStatus;
  sent_at: string | null;
  reconciliation_notes: string | null;
  ai_validation: { divergences?: string[]; confidence?: string; notes?: string } | null;
  ai_extracted_amount: number | null;
  payments: { reference: string; status: string } | null;
  question_count: number;
}

const Invoices = () => {
  const { user, hasRole } = useAuth();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [openInvoice, setOpenInvoice] = useState<InvoiceRow | null>(null);
  const [openQuestions, setOpenQuestions] = useState<InvoiceQuestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <>
      <PageHeader title="Notas Fiscais" description="Pedidos enviados e notas recebidas." />
      <div className="p-8">
        <Card className="shadow-card"><CardContent className="p-0">
          {rows.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum pedido enviado ainda.</p> :
            <div className="divide-y divide-border">{rows.map((i) => (
              <div key={i.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{i.payments?.reference} · {i.recipient_email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pedido: {formatCurrency(i.expected_amount)}
                    {i.received_amount != null && <> · Nota: {formatCurrency(i.received_amount)}</>}
                    {i.invoice_number && <> · NF #{i.invoice_number}</>}
                    · Enviado {formatDate(i.sent_at)}
                  </p>
                  {i.reconciliation_notes && <p className="text-xs mt-1">{i.reconciliation_notes}</p>}
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
                  <span className={`text-xs rounded-full border px-2.5 py-0.5 ${TONE_CLASSES[tone[i.status as InvoiceStatus]]}`}>{labels[i.status as InvoiceStatus]}</span>
                </div>
              </div>
            ))}</div>}
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