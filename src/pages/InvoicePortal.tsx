import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/status";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-invoice`;
const AUTH = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

const InvoicePortal = () => {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ matches: boolean; diff: number } | null>(null);

  useEffect(() => {
    document.title = "Envio de Nota Fiscal";
    fetch(`${FN_URL}?token=${token}`, { headers: { Authorization: AUTH } })
      .then((r) => r.json()).then((d) => { setInfo(d); setLoading(false); });
  }, [token]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.append("token", token!);
    setSubmitting(true);
    const r = await fetch(FN_URL, { method: "POST", body: fd, headers: { Authorization: AUTH } });
    const data = await r.json();
    setSubmitting(false);
    if (!r.ok) return toast({ title: "Erro", description: data.error, variant: "destructive" });
    setDone(data);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  if (info?.error || !info?.invoice) return <div className="min-h-screen flex items-center justify-center"><Card className="max-w-md"><CardContent className="p-8 text-center"><p className="font-medium">Link inválido ou expirado.</p></CardContent></Card></div>;

  const inv = info.invoice;
  const expired = inv.status !== "aguardando";

  return (
    <div className="min-h-screen bg-gradient-soft p-4 flex items-center justify-center">
      <div className="w-full max-w-lg">
        <header className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand mb-3"><ShieldCheck className="h-6 w-6 text-primary-foreground" /></div>
          <h1 className="text-xl font-semibold">Envio de Nota Fiscal</h1>
          <p className="text-sm text-muted-foreground mt-1">{info.payment?.reference}</p>
        </header>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Pedido aprovado</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm mb-4">Valor a ser emitido: <strong>{formatCurrency(inv.expected_amount)}</strong></p>
            {done ? (
              <div className={`rounded-lg p-4 text-sm ${done.matches ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive"}`}>
                {done.matches ? "✓ Nota recebida e conciliada com sucesso!" : `⚠ Nota recebida mas com divergência de ${formatCurrency(done.diff)}. Entraremos em contato.`}
              </div>
            ) : expired ? (
              <p className="text-sm text-muted-foreground">Esta nota já foi enviada anteriormente.</p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5"><Label>Número da NF</Label><Input name="invoice_number" required maxLength={50} /></div>
                <div className="space-y-1.5"><Label>Valor bruto da nota (R$)</Label><Input name="received_amount" type="number" step="0.01" required /></div>
                <div className="space-y-1.5"><Label>Arquivo (PDF/XML)</Label><Input name="file" type="file" accept=".pdf,.xml" required /></div>
                <Button type="submit" disabled={submitting} className="w-full">{submitting ? "Enviando..." : "Enviar nota"}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
export default InvoicePortal;