import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { recordObservation, type ObservationAuthorType } from "@/lib/observations";
import { MessageCircleQuestion } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  paymentStatus: string | null;
  authorId: string;
  authorRole: ObservationAuthorType; // analista | validador | diretor | admin
  /** Quando o questionamento é sobre uma empresa específica do lote. */
  companyGroupId?: string | null;
  companyName?: string | null;
  /** Opcional: linkar à linha (payment_item) específica. */
  itemId?: string | null;
  onCreated?: () => void;
};

/**
 * Diálogo único para "Fazer questionamento" interno dentro do lote.
 * Usa a infra existente de payment_observations(is_question=true), que dispara
 * notify-internal-question com o roteamento por papel:
 *   - analista  → validador (em validação) ou diretor (em aprovação)
 *   - validador → analista
 *   - diretor   → analista + validador
 */
export function AskQuestionDialog({
  open,
  onOpenChange,
  paymentId,
  paymentStatus,
  authorId,
  authorRole,
  companyGroupId,
  companyName,
  itemId,
  onCreated,
}: Props) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const recipientLabel = useMemo(() => {
    if ((authorRole as string) === "diretor" || (authorRole as string) === "admin") return "Analista e Supervisor";
    if (authorRole === "validador") return "Analista";
    // analista
    if (paymentStatus === "aguardando_aprovacao" || paymentStatus === "aprovado_em_revisao") return "Diretor";
    return "Supervisor";
  }, [authorRole, paymentStatus]);

  const reset = () => {
    setMessage("");
  };

  const submit = async () => {
    const text = message.trim();
    if (text.length < 10) {
      toast({ title: "Descreva o questionamento (mín. 10 caracteres)", variant: "destructive" });
      return;
    }
    setBusy(true);
    // Prefixo identifica empresa no histórico (não há coluna company_group_id em
    // payment_observations; mantemos contexto no corpo da mensagem).
    const prefix = companyName ? `[${companyName}] ` : "";
    const res = await recordObservation({
      payment_id: paymentId,
      author_type: authorRole,
      author_id: authorId,
      message: `${prefix}${text}`,
      item_id: itemId ?? null,
      is_question: true,
      observation_type: "informativo",
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Falha ao enviar questionamento", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Questionamento enviado",
      description: `Roteado para ${recipientLabel}. Vai aparecer na fila e no sino de notificações.`,
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
            Fazer questionamento
            {companyName && (
              <span className="text-sm font-normal text-muted-foreground truncate">— {companyName}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            Vai cair na fila de <strong>{recipientLabel}</strong> para resposta.
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
            A resposta aparece como observação ligada ao lote{companyName ? " e à empresa selecionada" : ""}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Enviando..." : "Enviar questionamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
