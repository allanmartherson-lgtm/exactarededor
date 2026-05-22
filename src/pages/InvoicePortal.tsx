import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, MessageCircleQuestion, Clock, Paperclip, X, Download } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/status";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_SIZE_BYTES,
  formatBytes,
  validateAttachment,
} from "@/lib/questionAttachments";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-invoice`;
const AUTH = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

interface PortalQuestion {
  id: string;
  author_type: "recebedor" | "analista";
  author_name: string | null;
  message: string;
  created_at: string;
}

interface PortalAttachment {
  id: string;
  question_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  signed_url: string | null;
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
  const [questionAttachments, setQuestionAttachments] = useState<PortalAttachment[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [questionAuthor, setQuestionAuthor] = useState("");
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
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
        setQuestionAttachments((d.attachments ?? []) as PortalAttachment[]);
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

  const onPickQuestionFiles = (files: FileList | null) => {
    if (!files) return;
    const merged = [...questionFiles];
    for (const f of Array.from(files)) {
      if (merged.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        toast({ title: "Limite de anexos", description: `Máximo ${MAX_ATTACHMENTS_PER_MESSAGE} arquivos por mensagem.`, variant: "destructive" });
        break;
      }
      const err = validateAttachment(f);
      if (err) {
        toast({
          title: "Anexo recusado",
          description: err.reason === "size"
            ? `${f.name}: maior que ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)}.`
            : err.reason === "empty"
            ? `${f.name}: arquivo vazio.`
            : `${f.name}: tipo não permitido. Use PDF, imagem, planilha ou CSV.`,
          variant: "destructive",
        });
        continue;
      }
      merged.push(f);
    }
    setQuestionFiles(merged);
  };

  const sendQuestion = async () => {
    const message = questionDraft.trim();
    if (message.length < 5) {
      toast({ title: "Mensagem muito curta", description: "Descreva sua dúvida com mais detalhes.", variant: "destructive" });
      return;
    }
    setSendingQuestion(true);
    let r: Response;
    if (questionFiles.length > 0) {
      // Multipart pra suportar anexos do recebedor.
      const fd = new FormData();
      fd.append("token", token!);
      fd.append("action", "question");
      fd.append("message", message);
      if (questionAuthor.trim()) fd.append("author_name", questionAuthor.trim());
      for (const f of questionFiles) fd.append("attachments", f, f.name);
      r = await fetch(FN_URL, { method: "POST", body: fd, headers: { Authorization: AUTH } });
    } else {
      r = await fetch(FN_URL, {
        method: "POST",
        headers: { Authorization: AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ token, message, author_name: questionAuthor.trim() || null }),
      });
    }
    const data = await r.json();
    setSendingQuestion(false);
    if (!r.ok) return toast({ title: "Erro", description: data.error, variant: "destructive" });
    setQuestionDraft("");
    setQuestionFiles([]);
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

  if (loading) return <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground">Carregando...</div>;
  if (info?.error || !info?.invoice) return <div className="min-h-dvh flex items-center justify-center"><Card className="max-w-md"><CardContent className="p-8 text-center"><p className="font-medium">Link inválido ou expirado.</p></CardContent></Card></div>;

  const inv = info.invoice;
  const pay = info.payment ?? {};
  const expired = inv.status !== "aguardando";

  // Trava de UI: depois que o pagamento foi encaminhado pelo time fiscal,
  // não dá mais pra reabrir o envio. Mantém em sincronia com o backend.
  const lockedPaymentStatuses = new Set([
    "nf_conciliada",
    "aguardando_aprovacao",
    "aprovado",
    "aprovado_com_ressalva",
    "pago",
    "rejeitado",
    "cancelado",
  ]);
  const reuploadLocked = lockedPaymentStatuses.has(pay.status);

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
    <div className="min-h-dvh bg-gradient-soft p-4 flex items-center justify-center">
      <div className="w-full max-w-lg">
        <header className="text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand mb-3"><ShieldCheck className="h-6 w-6 text-primary-foreground" /></div>
          <h1 className="text-xl font-semibold">Envio de Nota Fiscal</h1>
          <p className="text-sm text-muted-foreground mt-1">{pay.reference}</p>
        </header>

        {/* Prazo fiscal: 30 dias após aprovação */}
        {!expired && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Prazo para emissão da NF</p>
              <p className="text-xs mt-0.5">
                Emita e envie a nota fiscal em até <strong>30 dias</strong> a partir da data de aprovação do pagamento. Atrasos podem impedir o processamento.
              </p>
            </div>
          </div>
        )}

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Pedido de Nota Fiscal</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Passos do processo */}
            {(() => {
              const steps = [
                { label: "Pedido enviado", done: true },
                { label: "NF recebida", done: inv.status !== "aguardando" },
                { label: "Conciliada", done: inv.status === "conciliada" },
              ];
              return (
                <div className="flex items-start justify-between mb-4 px-1">
                  {steps.map((s, i) => (
                    <div key={s.label} className="flex-1 flex flex-col items-center relative">
                      {i > 0 && (
                        <div
                          className={`absolute top-3 right-1/2 w-full h-0.5 ${steps[i - 1].done && s.done ? "bg-emerald-500" : "bg-muted"}`}
                          aria-hidden
                        />
                      )}
                      <div
                        className={`relative z-10 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${s.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}
                      >
                        {s.done ? "✓" : i + 1}
                      </div>
                      <span className={`mt-1.5 text-[11px] text-center ${s.done ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}

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
                    <p className="font-medium">⚠ Valor da NF diferente do pedido</p>
                    {(done.ai_amount != null || done.form_diff != null) && (
                      <div className="grid grid-cols-2 gap-2 rounded-md bg-background/40 p-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Você emitiu</p>
                          <p className="font-semibold text-foreground">
                            {done.ai_amount != null ? formatCurrency(done.ai_amount) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Valor solicitado</p>
                          <p className="font-semibold text-foreground">{formatCurrency(inv.expected_amount)}</p>
                        </div>
                      </div>
                    )}
                    {done.notes && <p className="text-xs whitespace-pre-wrap">{done.notes}</p>}
                    <p className="text-xs">
                      O valor que você emitiu é diferente do valor solicitado. Por favor, cancele a NF junto à sua contabilidade, emita uma nova com o valor correto e reenvie aqui.
                    </p>
                    {resetOpen ? resetForm : (
                      reuploadLocked ? (
                        <p className="text-xs italic">
                          Este pagamento já está em aprovação ou foi efetivado pelo time fiscal — não é mais possível reabrir o envio. Use a aba <strong>"Tenho uma dúvida"</strong> para falar com o analista.
                        </p>
                      ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        onClick={() => setResetOpen(true)}
                      >
                        Corrigir e enviar novamente
                      </Button>
                      )
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
                {inv.status === "divergente" && (
                  resetOpen ? resetForm : reuploadLocked ? (
                    <p className="text-xs text-muted-foreground italic">
                      Pagamento já encaminhado pelo time fiscal — reenvio bloqueado. Fale com o analista.
                    </p>
                  ) : (
                    <Button type="button" variant="outline" className="w-full" onClick={() => setResetOpen(true)}>
                      Corrigir e enviar novamente
                    </Button>
                  )
                )}
              </div>
            ) : (
              <Tabs defaultValue="upload">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="upload">Enviar nota</TabsTrigger>
                  <TabsTrigger value="question">
                    <MessageCircleQuestion className="h-3.5 w-3.5 mr-1.5" /> Falar com analista
                    {questions.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-warning-soft text-warning-foreground text-[10px] px-1.5">
                        {questions.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="mt-4">
                  <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-xs text-muted-foreground space-y-1 mb-3">
                    <p className="font-medium text-foreground">Como funciona:</p>
                    <p>1. Emita a NF com o valor exato indicado acima para o CNPJ do hospital.</p>
                    <p>2. Faça o upload do arquivo PDF ou XML da nota.</p>
                    <p>3. Após o envio, nosso sistema valida automaticamente o valor. Se conferir, o pagamento é liberado.</p>
                    <p className="text-warning font-medium">⚠ Qualquer diferença de valor resulta em rejeição automática.</p>
                  </div>
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
                      {questions.map((q) => {
                        const atts = questionAttachments.filter((a) => a.question_id === q.id);
                        return (
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
                          {atts.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5">
                              {atts.map((a) => (
                                <li key={a.id}>
                                  <a
                                    href={a.signed_url ?? "#"}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                                  >
                                    <Paperclip className="h-3 w-3" />
                                    <span className="truncate max-w-[160px]">{a.file_name}</span>
                                    <span className="text-muted-foreground">({formatBytes(Number(a.size_bytes))})</span>
                                    <Download className="h-3 w-3" />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );})}
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
                  {questionFiles.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {questionFiles.map((f, idx) => (
                        <li key={`${f.name}-${idx}`} className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-[11px]">
                          <Paperclip className="h-3 w-3" />
                          <span className="truncate max-w-[140px]">{f.name}</span>
                          <span className="text-muted-foreground">({formatBytes(f.size)})</span>
                          <button
                            type="button"
                            onClick={() => setQuestionFiles((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Remover anexo"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                      <Paperclip className="h-3.5 w-3.5" />
                      Anexar arquivo (opcional)
                      <input
                        type="file"
                        multiple
                        accept={ALLOWED_ATTACHMENT_EXTENSIONS}
                        className="hidden"
                        onChange={(e) => { onPickQuestionFiles(e.target.files); e.currentTarget.value = ""; }}
                      />
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      PDF, imagem, xlsx ou csv · máx {MAX_ATTACHMENTS_PER_MESSAGE} · {formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} cada
                    </span>
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