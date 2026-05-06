import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, TONE_CLASSES } from "@/lib/status";
import { MessageCircleQuestion, Pencil, Save, User as UserIcon, X } from "lucide-react";
import type { ObservationRow, PaymentItemRow, InvoiceRow } from "@/hooks/usePaymentDetailData";
import { authorRoleLabel } from "@/lib/observations";

/**
 * Helper de cor por autor — mantido aqui por ser exclusivo da timeline.
 * Se outro lugar precisar do mesmo mapeamento, mover para `lib/status.ts`.
 */
const authorBadgeClass = (t: string) =>
  t === "ia" ? TONE_CLASSES.info
    : t === "validador" ? TONE_CLASSES.warning
    : t === "diretor" ? TONE_CLASSES.success
    : TONE_CLASSES.muted;

export type PaymentTimelineProps = {
  /** Observações já filtradas pelo histórico (item/payment/all). */
  observations: ObservationRow[];
  /** Itens do pagamento — usados para resolver invoice relacionada e label do item. */
  items: PaymentItemRow[];
  /** Invoices do pagamento — usadas para o botão "Responder na NF". */
  invoices: InvoiceRow[];
  /** id->nome dos perfis dos autores. */
  profiles: Record<string, string>;
  /** Texto curto descrevendo o item (ex.: "Dr. Fulano · atend. 123"). */
  itemLabel: (itemId: string | null | undefined) => string | null;
  /** Abre o sheet de questionamentos para a NF informada (handler do parent). */
  onOpenQuestionInvoice: (invoiceId: string) => void;
  /** Recarrega dados após editar uma observação (handler do parent). */
  onChanged: () => void | Promise<void>;
};

/**
 * Timeline de observações do pagamento.
 *
 * - Mantém o estado de edição localmente (rascunho + flag), evitando poluir o
 *   PaymentDetail com mais 2 useState e os 3 handlers correspondentes.
 * - O update no Supabase fica aqui mesmo: é a única ação de escrita do bloco
 *   e não vale a pena criar um hook só para isso.
 * - Detecta visualmente questionamentos do recebedor (badge/cor) e — quando
 *   possível — oferece atalho para responder a NF correlata.
 */
export const PaymentTimeline = ({
  observations,
  items,
  invoices,
  profiles,
  itemLabel,
  onOpenQuestionInvoice,
  onChanged,
}: PaymentTimelineProps) => {
  const { user } = useAuth();
  const [editingObsId, setEditingObsId] = useState<string | null>(null);
  const [editingObsDraft, setEditingObsDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const startEditObs = (o: ObservationRow) => {
    setEditingObsId(o.id);
    setEditingObsDraft(o.message ?? "");
  };
  const cancelEditObs = () => {
    setEditingObsId(null);
    setEditingObsDraft("");
  };
  const saveEditObs = async () => {
    if (!editingObsId) return;
    const text = editingObsDraft.trim();
    if (!text) {
      toast({ title: "A observação não pode ficar vazia", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("payment_observations")
      .update({ message: text, edited_at: new Date().toISOString() })
      .eq("id", editingObsId);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao salvar edição", description: error.message, variant: "destructive" });
      return;
    }
    cancelEditObs();
    await onChanged();
    toast({ title: "Observação atualizada" });
  };

  if (observations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        Sem observações para o filtro selecionado.
      </p>
    );
  }

  return (
    <ol className="relative border-l border-border pl-4 space-y-3 max-h-[600px] overflow-y-auto">
      {observations.map((o) => {
        const canEdit = !!user && o.author_id === user.id;
        const isEditing = editingObsId === o.id;
        // Destaca visualmente questionamentos do recebedor — são críticos.
        const isQuestion =
          o.status_to === "nf_questionada" ||
          (typeof o.message === "string" &&
            o.message.startsWith("Recebedor da NF enviou um questionamento"));
        // Tenta resolver a invoice correspondente para permitir responder
        // direto da timeline. Estratégia:
        // 1) Se a observação tem item_id, casa pela company do item.
        // 2) Senão, se houver apenas uma invoice no payment, usa essa.
        let relatedInvoiceId: string | null = null;
        if (o.item_id) {
          const it = items.find((x) => x.id === o.item_id);
          if (it?.company_id) {
            const inv = invoices.find((iv) => iv.company_id === it.company_id);
            if (inv) relatedInvoiceId = inv.id;
          }
        }
        if (!relatedInvoiceId && isQuestion && invoices.length === 1) {
          relatedInvoiceId = invoices[0].id;
        }
        return (
          <li
            key={o.id}
            className={`ml-1 ${
              isQuestion ? "rounded-md border border-warning/40 bg-warning-soft/40 p-2 -ml-1" : ""
            }`}
          >
            <span
              className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${
                isQuestion ? "bg-warning" : "bg-primary"
              }`}
            />
            <div className="flex items-center gap-2 flex-wrap text-xs mb-1">
              {isQuestion && (
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-warning-foreground uppercase tracking-wide text-[10px] font-semibold">
                  <MessageCircleQuestion className="h-3 w-3" /> Questionamento
                </span>
              )}
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 uppercase tracking-wide ${authorBadgeClass(
                  o.author_type,
                )}`}
              >
                {authorRoleLabel(o.author_type)}
              </span>
              <span
                className="inline-flex items-center gap-1 font-medium text-foreground"
                title={o.author_id ? `ID: ${o.author_id}` : "Autor não identificado"}
              >
                <UserIcon className="h-3 w-3 text-muted-foreground" />
                {o.author_id
                  ? (profiles[o.author_id] ?? `Usuário ${o.author_id.slice(0, 8)}`)
                  : o.author_type === "sistema" || o.author_type === "ia"
                    ? "Sistema"
                    : "Usuário desconhecido"}
                <span className="text-muted-foreground font-normal">
                  ({authorRoleLabel(o.author_type)})
                </span>
              </span>
              {o.item_id && (
                <span className="text-muted-foreground">· {itemLabel(o.item_id)}</span>
              )}
              {(o.status_from || o.status_to) && (
                <span className="text-muted-foreground">
                  · {o.status_from ?? "—"} → {o.status_to ?? "—"}
                </span>
              )}
              <span className="text-muted-foreground ml-auto">{formatDate(o.created_at)}</span>
              {o.edited_at && (
                <span className="text-muted-foreground italic">
                  · editado {formatDate(o.edited_at)}
                </span>
              )}
              {canEdit && !isEditing && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  onClick={() => startEditObs(o)}
                  aria-label="Editar observação"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  rows={3}
                  value={editingObsDraft}
                  onChange={(e) => setEditingObsDraft(e.target.value)}
                />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={cancelEditObs} disabled={busy}>
                    <X className="h-3.5 w-3.5 mr-1" /> Cancelar
                  </Button>
                  <Button size="sm" onClick={saveEditObs} disabled={busy}>
                    <Save className="h-3.5 w-3.5 mr-1" /> Salvar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap">{o.message}</p>
                {isQuestion && relatedInvoiceId && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-warning/60 bg-warning-soft text-warning-foreground hover:bg-warning-soft/80"
                      onClick={() => onOpenQuestionInvoice(relatedInvoiceId!)}
                    >
                      <MessageCircleQuestion className="h-3.5 w-3.5 mr-1.5" />
                      Responder na NF
                    </Button>
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
};