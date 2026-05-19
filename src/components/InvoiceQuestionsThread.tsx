import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/status";
import { MessageCircleQuestion, Paperclip, X, Download } from "lucide-react";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_SIZE_BYTES,
  formatBytes,
  validateAttachment,
  type QuestionAttachment,
} from "@/lib/questionAttachments";

export interface InvoiceQuestion {
  id: string;
  author_type: "recebedor" | "analista";
  author_name: string | null;
  message: string;
  created_at: string;
  read_at?: string | null;
}

/**
 * Thread de questionamentos sobre o pedido de NF.
 * Reusada no PaymentDetail / Invoices (analista responde) e exposta
 * de forma análoga no InvoicePortal (que usa edge function para inserir).
 */
export const InvoiceQuestionsThread = ({
  invoiceId,
  paymentId,
  initial,
  onSent,
  notifyOnReply = true,
}: {
  invoiceId: string;
  paymentId: string;
  initial?: InvoiceQuestion[];
  onSent?: () => void;
  /** Dispara a edge `notify-question-reply` para avisar o recebedor por e-mail. */
  notifyOnReply?: boolean;
}) => {
  const { user } = useAuth();
  const [items, setItems] = useState<InvoiceQuestion[]>(initial ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  // Mapa question_id -> anexos (com signed URL pra download) carregados sob demanda.
  const [attMap, setAttMap] = useState<Record<string, (QuestionAttachment & { signed_url?: string | null })[]>>({});

  const loadAttachments = async (questionIds: string[]) => {
    if (questionIds.length === 0) return;
    const { data } = await supabase
      .from("invoice_question_attachments")
      .select("id, question_id, file_name, storage_path, mime_type, size_bytes")
      .in("question_id", questionIds);
    const grouped: Record<string, QuestionAttachment[]> = {};
    for (const a of (data ?? []) as QuestionAttachment[]) {
      (grouped[a.question_id] ||= []).push(a);
    }
    // Gera signed URLs (1h) — bucket é privado.
    const out: Record<string, (QuestionAttachment & { signed_url?: string | null })[]> = {};
    for (const [qid, list] of Object.entries(grouped)) {
      out[qid] = await Promise.all(
        list.map(async (a) => {
          const { data: signed } = await supabase.storage
            .from("invoice-question-attachments")
            .createSignedUrl(a.storage_path, 60 * 60);
          return { ...a, signed_url: signed?.signedUrl ?? null };
        }),
      );
    }
    setAttMap(out);
  };

  useEffect(() => {
    if (initial) {
      loadAttachments(initial.map((q) => q.id));
      return;
    }
    supabase
      .from("invoice_questions")
      .select("id, author_type, author_name, message, created_at, read_at")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as InvoiceQuestion[];
        setItems(list);
        loadAttachments(list.map((q) => q.id));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, initial]);

  const onPickFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    const merged = [...attachments];
    for (const f of incoming) {
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
            : `${f.name}: tipo de arquivo não permitido. Use PDF, imagem, planilha ou CSV.`,
          variant: "destructive",
        });
        continue;
      }
      merged.push(f);
    }
    setAttachments(merged);
  };

  const send = async () => {
    const message = draft.trim();
    if (message.length < 1 || message.length > 2000) {
      toast({ title: "Mensagem inválida", description: "Entre 1 e 2000 caracteres.", variant: "destructive" });
      return;
    }
    if (!user) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("invoice_questions")
      .insert({
        invoice_id: invoiceId,
        payment_id: paymentId,
        author_type: "analista",
        author_id: user.id,
        author_name: user.user_metadata?.full_name ?? user.email ?? null,
        message,
      })
      .select("id, author_type, author_name, message, created_at, read_at")
      .single();
    if (error) {
      setBusy(false);
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    const questionId = (data as InvoiceQuestion).id;
    // Sobe os anexos (se houver) e registra na tabela.
    const uploaded: QuestionAttachment[] = [];
    for (const f of attachments) {
      const ext = f.name.split(".").pop() ?? "bin";
      const path = `${invoiceId}/${questionId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("invoice-question-attachments")
        .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
      if (upErr) {
        toast({ title: "Falha ao subir anexo", description: `${f.name}: ${upErr.message}`, variant: "destructive" });
        continue;
      }
      const { data: insAtt, error: insAttErr } = await supabase
        .from("invoice_question_attachments")
        .insert({
          question_id: questionId,
          invoice_id: invoiceId,
          payment_id: paymentId,
          author_type: "analista",
          author_id: user.id,
          file_name: f.name.slice(0, 120),
          storage_path: path,
          mime_type: f.type || "application/octet-stream",
          size_bytes: f.size,
        })
        .select("id, question_id, file_name, storage_path, mime_type, size_bytes")
        .single();
      if (!insAttErr && insAtt) uploaded.push(insAtt as QuestionAttachment);
    }
    setBusy(false);
    setItems((prev) => [...prev, data as InvoiceQuestion]);
    if (uploaded.length > 0) {
      const signed = await Promise.all(uploaded.map(async (a) => {
        const { data: s } = await supabase.storage.from("invoice-question-attachments").createSignedUrl(a.storage_path, 60 * 60);
        return { ...a, signed_url: s?.signedUrl ?? null };
      }));
      setAttMap((prev) => ({ ...prev, [questionId]: signed }));
    }
    setDraft("");
    setAttachments([]);
    onSent?.();
    if (notifyOnReply) {
      // Best-effort: não bloqueia a UI se o provedor de e-mail estiver indisponível.
      void supabase.functions
        .invoke("notify-question-reply", {
          body: {
            invoice_id: invoiceId,
            question_id: questionId,
            message,
            author_name: user.user_metadata?.full_name ?? user.email ?? null,
          },
        })
        .then(({ error: e }) => {
          if (e) console.warn("[InvoiceQuestionsThread] notify falhou:", e.message);
        });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
        Conversa com o recebedor
        <span className="text-xs text-muted-foreground">({items.length} mensagem{items.length === 1 ? "" : "s"})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem mensagens ainda.</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-auto pr-1">
          {items.map((q) => {
            const isRecebedor = q.author_type === "recebedor";
            const atts = attMap[q.id] ?? [];
            return (
              <li
                key={q.id}
                className={`rounded-lg border p-3 text-sm ${
                  isRecebedor ? "bg-warning-soft border-warning/30" : "bg-muted/40"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wider text-foreground/60 mb-1">
                  {isRecebedor ? "Recebedor" : "Analista"}
                  {q.author_name ? ` · ${q.author_name}` : ""}
                  {" · "}{formatDate(q.created_at)}
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
                          <span className="truncate max-w-[180px]">{a.file_name}</span>
                          <span className="text-muted-foreground">({formatBytes(Number(a.size_bytes))})</span>
                          <Download className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escrever resposta ao recebedor (máx. 2000 caracteres)…"
          rows={3}
          maxLength={2000}
        />
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {attachments.map((f, idx) => (
              <li key={`${f.name}-${idx}`} className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-[11px]">
                <Paperclip className="h-3 w-3" />
                <span className="truncate max-w-[160px]">{f.name}</span>
                <span className="text-muted-foreground">({formatBytes(f.size)})</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
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
            Anexar arquivo
            <input
              type="file"
              multiple
              accept={ALLOWED_ATTACHMENT_EXTENSIONS}
              className="hidden"
              onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }}
            />
          </label>
          <Button onClick={send} disabled={busy || draft.trim().length === 0} size="sm">
            {busy ? "Enviando..." : "Responder"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          PDF, imagem, planilha (xlsx/csv). Máx {MAX_ATTACHMENTS_PER_MESSAGE} arquivos · {formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} cada.
        </p>
      </div>
    </div>
  );
};