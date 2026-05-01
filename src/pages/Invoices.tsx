import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatDate, TONE_CLASSES, type InvoiceStatus } from "@/lib/status";

const tone: Record<InvoiceStatus, keyof typeof TONE_CLASSES> = {
  aguardando: "warning", recebida: "info", conciliada: "success", divergente: "destructive",
};
const labels: Record<InvoiceStatus, string> = {
  aguardando: "Aguardando NF", recebida: "NF recebida", conciliada: "Conciliada", divergente: "Divergente",
};

const Invoices = () => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    document.title = "Notas Fiscais | MedPay";
    supabase.from("invoices").select("*, payments(reference)").order("created_at", { ascending: false }).then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <>
      <PageHeader title="Notas Fiscais" description="Pedidos enviados e notas recebidas." />
      <div className="p-8">
        <Card className="shadow-card"><CardContent className="p-0">
          {rows.length === 0 ? <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nenhum pedido enviado ainda.</p> :
            <div className="divide-y divide-border">{rows.map((i) => (
              <div key={i.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{i.payments?.reference} · {i.recipient_email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pedido: {formatCurrency(i.expected_amount)}
                    {i.received_amount != null && <> · Nota: {formatCurrency(i.received_amount)}</>}
                    {i.invoice_number && <> · NF #{i.invoice_number}</>}
                    · Enviado {formatDate(i.sent_at)}
                  </p>
                  {i.reconciliation_notes && <p className="text-xs mt-1">{i.reconciliation_notes}</p>}
                </div>
                <span className={`text-xs rounded-full border px-2.5 py-0.5 ${TONE_CLASSES[tone[i.status as InvoiceStatus]]}`}>{labels[i.status as InvoiceStatus]}</span>
              </div>
            ))}</div>}
        </CardContent></Card>
      </div>
    </>
  );
};
export default Invoices;