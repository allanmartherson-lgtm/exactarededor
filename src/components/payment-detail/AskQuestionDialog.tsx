import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircleQuestion } from "lucide-react";
import type { ObservationAuthorType } from "@/lib/observations";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentStatus: string | null;
  authorId: string;
  authorName?: string | null;
  authorRole: ObservationAuthorType; // analista | validador | diretor | admin
  /** Quando o questionamento é sobre uma empresa específica do lote. */
  companyGroupId?: string | null;
  companyName?: string | null;
  onCreated?: () => void;
};

/**
 * Abre um novo "thread" de questionamento interno (payment_questions, parent_id=null).
 * O status é mantido pelo trigger payment_questions_update_status — começa em 'pendente'.
 * Respostas e fechamento ficam no painel de threads.
 */
export function AskQuestionDialog({
  open,
  onOpenChange,
  paymentId,
  paymentStatus,
  authorId,
  authorName,
  authorRole,
  companyGroupId,
  companyName,
  onCreated,
}: Props) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const recipientLabel = useMemo(() => {
    if ((authorRole as string) === "diretor" || (authorRole as string) === "admin") return "Analista e Supervisor";
    if (authorRole === "validador") return "Analista";
    if (paymentStatus === "aguardando_aprovacao" || paymentStatus === "aprovado_em_revisao") return "Diretor";
    return "Supervisor";
  }, [authorRole, paymentStatus]);

  const reset = () => setMessage("");

  const submit = async () => {
    const text = message.trim();
    if (text.length < 10) {
      toast({ title: "Descreva o questionamento (mín. 10 caracteres)", variant: "destructive" });
      return;
    }
    setBusy(true);
    const roleTag = `[${authorRole}]`;
    const body = `${roleTag} ${text}`;
    const { error } = await supabase.from("payment_questions").insert({
      payment_id: paymentId,
      company_group_id: companyGroupId ?? null,
      author_id: authorId,
      author_name: authorName || "Equipe interna",
      author_type: "interno",
      message: body,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao abrir questionamento", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Questionamento aberto",
      description: `Roteado para ${recipientLabel}. Acompanhe e responda no painel de conversas.`,
    });
    reset();
    onOpenChange(false);
    onCreated?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
            Novo questionamento
            {companyName && (
              <span className="text-sm font-normal text-muted-foreground truncate">— {companyName}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            Vai abrir uma conversa para <strong>{recipientLabel}</strong> responder. Você acompanha o status no painel de conversas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Mensagem</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Descreva o que você precisa esclarecer..."
            className="text-base md:text-sm"
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            A conversa fica aberta até alguém marcar como encerrada.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Abrindo..." : "Abrir questionamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
