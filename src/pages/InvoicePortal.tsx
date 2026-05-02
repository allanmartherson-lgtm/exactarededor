import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, MessageCircleQuestion } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/status";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-invoice`;
const AUTH = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

interface PortalQuestion {
  id: string;
  author_type: "recebedor" | "analista";
  author_name: string | null;
  message: string;
  created_at: string;
}

const InvoicePortal = () => {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ matches: boolean; diff: number } | null>(null);
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [questionAuthor, setQuestionAuthor] = useState("");
  const [sendingQuestion, setSendingQuestion] = useState(false);

  const refresh = () => {
    fetch(`${FN_URL}?token=${token}`, { headers: { Authorization: AUTH } })
      .then((r) => r.json())
      .then((d) => {
        setInfo(d);
        setQuestions((d.questions ?? []) as PortalQuestion[]);
        setLoading(false);
      });
  };

  useEffect(() => {
    document.title = "Envio de Nota Fiscal";
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const sendQuestion = async () => {
    const message = questionDraft.trim();
    if (message.length < 5) {
      toast({ title: "Mensagem muito curta", description: "Descreva sua dúvida com mais detalhes.", variant: "destructive" });
      return;
    }
    setSendingQuestion(true);
    const r = await fetch(FN_URL, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ token, message, author_name: questionAuthor.trim() || null }),
    });
    const data = await r.json();
    setSendingQuestion(false);
    if (!r.ok) return toast({ title: "Erro", description: data.error, variant: "destructive" });
    setQuestionDraft("");
    toast({ title: "Mensagem enviada", description: "O analista vai retornar em breve." });
    refresh();
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
          <CardHeader>
            <CardTitle className="text-base">Pedido aprovado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm mb-4">
              Valor a ser emitido: <strong>{formatCurrency(inv.expected_amount)}</strong>
            </p>
            {done ? (
              <div className={`rounded-lg p-4 text-sm ${done.matches ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive"}`}>
                {done.matches ? "✓ Nota recebida e conciliada com sucesso!" : `⚠ Nota recebida mas com divergência de ${formatCurrency(done.diff)}. Entraremos em contato.`}
              </div>
            ) : expired ? (
              <p className="text-sm text-muted-foreground">Esta nota já foi enviada anteriormente.</p>
            ) : (
              <Tabs defaultValue="upload">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="upload">Enviar nota</TabsTrigger>
                  <TabsTrigger value="question">
                    <MessageCircleQuestion className="h-3.5 w-3.5 mr-1.5" /> Tenho uma dúvida
                    {questions.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-warning-soft text-warning-foreground text-[10px] px-1.5">
                        {questions.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="mt-4">
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-1.5"><Label>Número da NF</Label><Input name="invoice_number" required maxLength={50} /></div>
                    <div className="space-y-1.5"><Label>Valor bruto da nota (R$)</Label><Input name="received_amount" type="number" step="0.01" required /></div>
                    <div className="space-y-1.5"><Label>Arquivo (PDF/XML)</Label><Input name="file" type="file" accept=".pdf,.xml" required /></div>
                    <Button type="submit" disabled={submitting} className="w-full">{submitting ? "Enviando..." : "Enviar nota"}</Button>
                  </form>
                </TabsContent>
                <TabsContent value="question" className="mt-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Faltou algum item? Valor diferente? Envie sua dúvida para o analista antes de emitir a NF.
                  </p>
                  {questions.length > 0 && (
                    <ul className="space-y-2 max-h-60 overflow-auto pr-1">
                      {questions.map((q) => (
                        <li
                          key={q.id}
                          className={`rounded-lg border p-2.5 text-xs ${
                            q.author_type === "recebedor" ? "bg-warning-soft border-warning/30" : "bg-muted/40"
                          }`}
                        >
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            {q.author_type === "recebedor" ? "Você" : "Analista"}
                            {q.author_name ? ` · ${q.author_name}` : ""} · {formatDate(q.created_at)}
                          </p>
                          <p className="whitespace-pre-wrap break-words">{q.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="q-author">Seu nome (opcional)</Label>
                    <Input id="q-author" value={questionAuthor} onChange={(e) => setQuestionAuthor(e.target.value)} maxLength={120} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="q-msg">Sua dúvida</Label>
                    <Textarea id="q-msg" value={questionDraft} onChange={(e) => setQuestionDraft(e.target.value)} rows={4} maxLength={2000} />
                  </div>
                  <Button onClick={sendQuestion} disabled={sendingQuestion || questionDraft.trim().length < 5} className="w-full">
                    {sendingQuestion ? "Enviando..." : "Enviar dúvida"}
                  </Button>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
export default InvoicePortal;