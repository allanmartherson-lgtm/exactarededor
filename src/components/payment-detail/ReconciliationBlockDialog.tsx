/**
 * Dialog disparado quando a RPC de envio (bulk_send_groups_to_validation
 * ou forward_groups_to_director) é barrada pelo trigger de divergência
 * pedido × regra.
 *
 * Oferece três caminhos legítimos a partir do erro:
 *   1) Devolver ao analista com motivo automático (analista corrige)
 *   2) Liberar com justificativa (override auditado em
 *      payment_group_reconciliation_overrides)
 *   3) Abrir a empresa para inspeção visual
 *
 * Regras:
 *  - "Devolver" só faz sentido pro validador (analista é o destino).
 *    Quando o erro vem do envio analista→validador, escondemos o botão.
 *  - "Liberar com justificativa" foi ampliada para validador+diretor+admin
 *    (antes era só diretor/admin). Validador é o último guardião antes do
 *    diretor; ele assume a exceção quando aceita conscientemente.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Undo2, ShieldCheck, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ReleaseDivergenceDialog } from "./ReleaseDivergenceDialog";
import type { ReconciliationBlockPayload } from "@/lib/parseReconciliationBlock";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: ReconciliationBlockPayload | null;
  /** Papel de quem disparou o envio (define se "Devolver" aparece). */
  actorRole: "analista" | "validador" | "diretor";
  currentUserId: string;
  currentUserName: string;
  /** Recarrega o pagamento depois de uma ação concluída. */
  onResolved: () => void | Promise<void>;
  /**
   * Opcional. Quando informado, após a liberação com justificativa o dialog
   * re-executa a ação original (envio para validação / aprovação) em vez de
   * apenas registrar o override e fechar. Sem isso o override fica criado
   * mas o lote não avança de status.
   */
  retryAfterRelease?: () => Promise<void> | void;
}

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ReconciliationBlockDialog({
  open,
  onOpenChange,
  payload,
  actorRole,
  currentUserId,
  currentUserName,
  onResolved,
}: Props) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [busy, setBusy] = useState(false);
  const [returnMsg, setReturnMsg] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  if (!payload) return null;

  const defaultReturnMessage = `Divergência pedido × regra em ${payload.company_name}: bruto pedido ${fmt(payload.bruto_pedido)} vs bruto da regra ${fmt(payload.bruto_regra)} (${fmt(payload.diferenca)} / ${payload.diff_pct.toFixed(2)}%). Por favor revise o cálculo desta empresa antes de reenviar.`;

  // Validador devolve para o analista. Diretor também pode devolver (volta
  // pro validador/analista). Analista NÃO devolve pra si mesmo.
  const canReturn = actorRole !== "analista";
  // Liberação: validador, diretor e admin. Analista NÃO libera —
  // tem que corrigir na origem ou pedir liberação de quem está acima.
  const canRelease = hasRole("validador") || hasRole("diretor") || hasRole("admin");

  const doReturn = async () => {
    if (returnMsg.trim().length < 10) {
      toast({ title: "Mensagem muito curta", description: "Mínimo de 10 caracteres.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("return_groups_to_analyst", {
      p_payment_id: payload.payment_id,
      p_group_ids: [payload.group_id],
      p_author_id: currentUserId,
      p_author_name: currentUserName,
      p_message: returnMsg.trim(),
      p_lot_level: false,
    } as never);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao devolver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${payload.company_name} devolvida ao analista` });
    setReturnOpen(false);
    onOpenChange(false);
    await onResolved();
  };

  const openReturn = () => {
    setReturnMsg(defaultReturnMessage);
    setReturnOpen(true);
  };

  const openCompany = () => {
    // Hash navega para o accordion/aba da empresa no PaymentDetail.
    navigate(`/pagamentos/${payload.payment_id}#group-${payload.group_id}`);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open && !returnOpen && !releaseOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Aprovação bloqueada — divergência pedido × regra</DialogTitle>
            <DialogDescription>
              A empresa <strong>{payload.company_name}</strong> está com bruto do pedido
              diferente do bruto calculado pela regra. Antes de avançar, escolha como
              tratar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div>
              <div className="text-muted-foreground">Bruto pedido</div>
              <div className="font-medium">{fmt(payload.bruto_pedido)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Bruto regra</div>
              <div className="font-medium">{fmt(payload.bruto_regra)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Diferença</div>
              <div className="font-semibold text-destructive">
                {fmt(payload.diferenca)} ({payload.diff_pct.toFixed(2)}%)
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            {canReturn && (
              <Button variant="outline" onClick={openReturn} className="justify-start gap-2">
                <Undo2 className="h-4 w-4" />
                Devolver ao analista com motivo automático
              </Button>
            )}
            {canRelease && (
              <Button variant="outline" onClick={() => setReleaseOpen(true)} className="justify-start gap-2">
                <ShieldCheck className="h-4 w-4" />
                Liberar com justificativa (assume exceção)
              </Button>
            )}
            <Button variant="ghost" onClick={openCompany} className="justify-start gap-2">
              <ExternalLink className="h-4 w-4" />
              Abrir empresa para inspeção
            </Button>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-dialog: devolução com motivo pré-preenchido */}
      <Dialog open={returnOpen} onOpenChange={(v) => { if (!busy) setReturnOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver {payload.company_name} ao analista</DialogTitle>
            <DialogDescription>
              A mensagem abaixo já está preenchida com os valores da divergência.
              Você pode editar antes de enviar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ret-msg">Motivo</Label>
            <Textarea
              id="ret-msg"
              rows={6}
              value={returnMsg}
              onChange={(e) => setReturnMsg(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={doReturn} disabled={busy}>
              {busy ? "Devolvendo..." : "Devolver ao analista"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-dialog: liberação com justificativa (reaproveita o existente) */}
      <ReleaseDivergenceDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        groupId={payload.group_id}
        hospitalId={payload.hospital_id}
        brutoRegra={payload.bruto_regra}
        brutoPedido={payload.bruto_pedido}
        onReleased={() => {
          setReleaseOpen(false);
          onOpenChange(false);
          void onResolved();
        }}
      />
    </>
  );
}
