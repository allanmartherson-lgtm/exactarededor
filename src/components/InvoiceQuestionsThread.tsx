import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/status";
import { MessageCircleQuestion } from "lucide-react";

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
}: {
  invoiceId: string;
  paymentId: string;
  initial?: InvoiceQuestion[];
  onSent?: () => void;
}) => {
  const { user } = useAuth();
  const [items, setItems] = useState<InvoiceQuestion[]>(initial ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    supabase
      .from("invoice_questions")
      .select("id, author_type, author_name, message, created_at, read_at")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setItems((data ?? []) as InvoiceQuestion[]));
  }, [invoiceId, initial]);

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
    setBusy(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setItems((prev) => [...prev, data as InvoiceQuestion]);
    setDraft("");
    onSent?.();
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
            return (
              <li
                key={q.id}
                className={`rounded-lg border p-3 text-sm ${
                  isRecebedor ? "bg-warning-soft border-warning/30" : "bg-muted/40"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  {isRecebedor ? "Recebedor" : "Analista"}
                  {q.author_name ? ` · ${q.author_name}` : ""}
                  {" · "}{formatDate(q.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words">{q.message}</p>
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
        <div className="flex justify-end">
          <Button onClick={send} disabled={busy || draft.trim().length === 0} size="sm">
            {busy ? "Enviando..." : "Responder"}
          </Button>
        </div>
      </div>
    </div>
  );
};