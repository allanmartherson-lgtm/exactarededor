import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, MessageCircleQuestion, Clock } from "lucide-react";
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
  const [now, setNow] = useState<Date>(new Date());
  const [done, setDone] = useState<{
    matches: boolean;
    form_diff?: number;
    ai_amount?: number | null;
    ai_diff?: number | null;
    ai_error?: string | null;
    notes?: string;
  } | null>(null);
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [questionAuthor, setQuestionAuthor] = useState("");
  const [sendingQuestion, setSendingQuestion] = useState(false);
  // Estado do fluxo de "corrigir e enviar novamente": mostra textarea pra
  // justificar a divergência antes de descartar a NF anterior.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetJustification, setResetJustification] = useState("");
  const [resetAuthor, setResetAuthor] = useState("");

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

  // Relógio do momento do envio — exibido como informação travada (read-only).
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

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

  // Reabre o formulário após uma divergência: chama o backend pra apagar o
  // arquivo anterior e voltar a NF para "aguardando", depois limpa o estado local.
  // A justificativa entra no histórico do pagamento (e na thread, se preenchida).
  const resetUpload = async () => {
    setSubmitting(true);
    const r = await fetch(FN_URL, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        action: "reset",
        justification: resetJustification.trim() || null,
        author_name: resetAuthor.trim() || null,
      }),
    });
    const data = await r.json();
    setSubmitting(false);
    if (!r.ok) return toast({ title: "Erro", description: data.error, variant: "destructive" });
    setDone(null);
    setResetOpen(false);
    setResetJustification("");
    refresh();
    toast({ title: "Pronto", description: "Justificativa registrada — você já pode enviar a nota corrigida." });
  };

  // Bloco de justificativa renderizado inline (não como componente — evita
  // remontagem que tira o foco do textarea a cada keystroke).
  const resetForm = (
    <div className="space-y-3 rounded-lg border bg-background/60 p-3">
      <div className="space-y-1.5">
        <Label htmlFor="reset-author">Seu nome (opcional)</Label>
        <Input id="reset-author" value={resetAuthor} onChange={(e) => setResetAuthor(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reset-just">Justificativa / observação</Label>
        <Textarea
          id="reset-just"
          placeholder="Ex.: NF anterior emitida com valor errado por equívoco no sistema da contabilidade. Cancelada via inutilização nº…"
          value={resetJustification}
          onChange={(e) => setResetJustification(e.target.value)}
          rows={4}
          maxLength={2000}
        />
        <p className="text-[11px] text-muted-foreground">
          Esta observação fica registrada no histórico do pagamento e visível para o time fiscal.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={() => setResetOpen(false)} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="button" size="sm" className="flex-1" onClick={resetUpload} disabled={submitting}>
          {submitting ? "Aguarde..." : "Confirmar reenvio"}
        </Button>
      </div>
    </div>
  );

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  if (info?.error || !info?.invoice) return <div className="min-h-screen flex items-center justify-center"><Card className="max-w-md"><CardContent className="p-8 text-center"><p className="font-medium">Link inválido ou expirado.</p></CardContent></Card></div>;

  const inv = info.invoice;
  const pay = info.payment ?? {};
  const expired = inv.status !== "aguardando";

  // Competência: prefere o array (suporta múltiplos meses), cai para o singular.
  const competenceList: string[] = Array.isArray(pay.competence_months) && pay.competence_months.length > 0
    ? pay.competence_months
    : (pay.competence_month ? [pay.competence_month] : []);
  const competenceLabel = competenceList
    .map((d: string) => {
      const [y, m] = String(d).split("-");
      return m && y ? `${m}/${y}` : String(d);
    })
    .join(", ");

  const sectorsLabel = [
    ...(Array.isArray(pay.sectors) ? pay.sectors : []),
    ...(Array.isArray(pay.specialties) ? pay.specialties : []),
  ].join(", ");

  const itemLabel = pay.description || pay.payment_kind || pay.reference;

  const sentAtLabel = inv.received_at
    ? formatDate(inv.received_at)
    : now.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="min-h-screen bg-gradient-soft p-4 flex items-center justify-center">
      <div className="w-full max-w-lg">
        <header className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand mb-3"><ShieldCheck className="h-6 w-6 text-primary-foreground" /></div>
          <h1 className="text-xl font-semibold">Envio de Nota Fiscal</h1>
          <p className="text-sm text-muted-foreground mt-1">{pay.reference}</p>
        </header>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Pedido aprovado</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Cabeçalho com dados do pedido — ajuda o recebedor a confirmar
                que está no link correto antes de enviar a NF. */}
            <dl className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5 mb-4">
              {inv.company_name && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">PJ</dt>
                  <dd className="font-medium text-right">{inv.company_name}</dd>
                </div>
              )}
              {itemLabel && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Item de pagamento</dt>
                  <dd className="font-medium text-right">{itemLabel}</dd>
                </div>
              )}
              {sectorsLabel && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Setor / Especialidade</dt>
                  <dd className="font-medium text-right">{sectorsLabel}</dd>
                </div>
              )}
              {competenceLabel && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Competência</dt>
                  <dd className="font-medium text-right">{competenceLabel}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 pt-1.5 border-t">
                <dt className="text-muted-foreground">Valor a ser emitido</dt>
                <dd className="font-semibold text-right">{formatCurrency(inv.expected_amount)}</dd>
              </div>
            </dl>
            {done ? (
              <div className={`rounded-lg p-4 text-sm space-y-2 ${done.matches ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive"}`}>
                {done.matches ? (
                  <p>✓ Nota recebida e conciliada com sucesso! Valor confere com o pedido.</p>
                ) : (
                  <>
                    <p className="font-medium">⚠ Divergência detectada — a nota foi rejeitada.</p>
                    {done.notes && <p className="text-xs whitespace-pre-wrap">{done.notes}</p>}
                    <p className="text-xs">
                      Nosso time fiscal <strong>não aceita nenhuma diferença</strong> entre o pedido e a NF emitida.
                      Por favor, cancele a nota junto à sua contabilidade, emita uma nova com os dados corretos
                      e reenvie pelo botão abaixo.
                    </p>
                    {resetOpen ? resetForm : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        onClick={() => setResetOpen(true)}
                      >
                        Corrigir e enviar novamente
                      </Button>
                    )}
                  </>
                )}
              </div>
            ) : expired ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {inv.status === "divergente"
                    ? "Esta nota foi rejeitada por divergência com o pedido. Cancele a NF e emita uma nova com os dados corretos."
                    : inv.status === "conciliada"
                    ? "Esta nota já foi recebida e conciliada — nada mais a fazer por aqui."
                    : "Esta nota já foi enviada anteriormente."}
                </p>
                {inv.status === "divergente" && (resetOpen ? resetForm : (
                  <Button type="button" variant="outline" className="w-full" onClick={() => setResetOpen(true)}>
                    Corrigir e enviar novamente
                  </Button>
                ))}
              </div>
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
                    <div className="space-y-1.5"><Label>Arquivo (PDF/XML)</Label><Input name="file" type="file" accept=".pdf,.xml" required /></div>
                    {/* Data/hora do envio — somente leitura. Reforça para o
                        recebedor o instante em que a NF está sendo registrada. */}
                    <div className="space-y-1.5">
                      <Label>Data e hora do envio</Label>
                      <div className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 h-10 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{sentAtLabel}</span>
                      </div>
                    </div>
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