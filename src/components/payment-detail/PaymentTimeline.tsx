import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/status";
import { CheckCircle2, MessageCircleQuestion, Pencil, RotateCcw, Save, Send, User as UserIcon, X, Filter, LayoutList, History as HistoryIcon } from "lucide-react";
import type { ObservationRow, PaymentItemRow, InvoiceRow } from "@/hooks/usePaymentDetailData";
import { authorRoleLabel, getRoleVisual, recordObservation, resolveQuestion, reopenQuestion } from "@/lib/observations";

const ROLE_FILTER_OPTIONS = ["analista", "validador", "diretor", "admin", "sistema", "ia"] as const;

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
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"linear" | "phases">("phases");
  // Drafts da resposta inline a uma pergunta interna (por questionId).
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null);

  const myRole: "analista" | "validador" | "diretor" | null = useMemo(() => {
    // O autor_type da resposta usa o papel do autor da pergunta original;
    // como aqui o usuário pode ter múltiplos papéis, escolhemos o "mais alto"
    // disponível com base nas observações que ele já fez. Fallback: analista.
    return null;
  }, []);
  void myRole;

  // Lista os papéis efetivamente presentes nas observações para evitar
  // exibir opções vazias no Select.
  const availableRoles = useMemo(() => {
    const set = new Set<string>();
    observations.forEach((o) => o.author_type && set.add(o.author_type));
    return ROLE_FILTER_OPTIONS.filter((r) => set.has(r));
  }, [observations]);

  const filtered = useMemo(() => {
    if (roleFilter === "all") return observations;
    return observations.filter((o) => o.author_type === roleFilter);
  }, [observations, roleFilter]);

  const phases = useMemo(() => {
    const p = {
      ia: observations.filter((o) => (o.author_type as string) === "ia" || (o.author_type as string) === "sistema"),
      analista: observations.filter((o) => (o.author_type as string) === "analista"),
      validador: observations.filter((o) => (o.author_type as string) === "validador"),
      diretor: observations.filter((o) => (o.author_type as string) === "diretor" || (o.author_type as string) === "admin"),
    };
    return p;
  }, [observations]);

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

  const FilterBar = (
    <div className="flex items-center gap-2 mb-3 text-xs">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Papel:</span>
      <Select value={roleFilter} onValueChange={setRoleFilter}>
        <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os papéis</SelectItem>
          {availableRoles.map((r) => {
            const v = getRoleVisual(r);
            const RoleIcon = v.Icon;
            return (
              <SelectItem key={r} value={r}>
                <span className="inline-flex items-center gap-2">
                  <RoleIcon className="h-3.5 w-3.5" />
                  {authorRoleLabel(r)}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground ml-auto tabular-nums">
        {filtered.length} de {observations.length}
      </span>
    </div>
  );

  if (observations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        Sem observações para o filtro selecionado.
      </p>
    );
  }

  return (
    <div>
      {FilterBar}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          Nenhuma observação do papel selecionado.
        </p>
      ) : (
        <ol className="relative border-l border-border pl-4 space-y-3 max-h-[600px] overflow-y-auto">
          {filtered.map((o) => {
        const canEdit = !!user && o.author_id === user.id;
        const isEditing = editingObsId === o.id;
        const oExt = o as ObservationRow & {
          is_question?: boolean | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          answered_by_observation_id?: string | null;
        };
        // Pergunta interna (nova feature) — distinta do antigo questionamento de NF.
        const isInternalQuestion = !!oExt.is_question;
        const isResolved = isInternalQuestion && !!oExt.resolved_at;
        // Mantém destaque do antigo "questionamento do recebedor" (NF) só pra
        // exibir o atalho "Responder na NF" — não conta como pergunta interna.
        const isNfQuestion =
          !isInternalQuestion &&
          (o.status_to === "nf_questionada" ||
            (typeof o.message === "string" &&
              o.message.startsWith("Recebedor da NF enviou um questionamento")));
        let relatedInvoiceId: string | null = null;
        if (o.item_id) {
          const it = items.find((x) => x.id === o.item_id);
          if (it?.company_id) {
            const inv = invoices.find((iv) => iv.company_id === it.company_id);
            if (inv) relatedInvoiceId = inv.id;
          }
        }
        if (!relatedInvoiceId && isNfQuestion && invoices.length === 1) {
          relatedInvoiceId = invoices[0].id;
        }
        const visual = getRoleVisual(o.author_type);
        const RoleIcon = visual.Icon;
        const containerCls = isInternalQuestion && !isResolved
          ? "rounded-md border border-info/40 bg-info-soft/40 p-2 -ml-1"
          : isInternalQuestion && isResolved
          ? "rounded-md border border-border bg-muted/40 p-2 -ml-1"
          : isNfQuestion
          ? "rounded-md border border-warning/40 bg-warning-soft/40 p-2 -ml-1"
          : "";
        const dotCls = isInternalQuestion ? (isResolved ? "bg-muted-foreground" : "bg-info") : isNfQuestion ? "bg-warning" : visual.dotClass;
        return (
          <li key={o.id} className={`ml-1 ${containerCls}`}>
            <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${dotCls}`} />
            <div className="flex items-center gap-2 flex-wrap text-xs mb-1">
              {isInternalQuestion && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 uppercase tracking-wide text-[10px] font-semibold ${
                    isResolved
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-info/40 bg-info-soft text-info"
                  }`}
                  title={isResolved ? `Respondida em ${formatDate(oExt.resolved_at!)}` : "Aguardando resposta"}
                >
                  <MessageCircleQuestion className="h-3 w-3" />
                  {isResolved ? "Pergunta respondida" : "Pergunta aberta"}
                </span>
              )}
              {isNfQuestion && (
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-warning-foreground uppercase tracking-wide text-[10px] font-semibold">
                  <MessageCircleQuestion className="h-3 w-3" /> Questionamento NF
                </span>
              )}
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 uppercase tracking-wide ${visual.badgeClass}`}>
                <RoleIcon className="h-3 w-3" />
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
              </span>
              {o.item_id && <span className="text-muted-foreground">· {itemLabel(o.item_id)}</span>}
              {(o.status_from || o.status_to) && (
                <span className="text-muted-foreground">· {o.status_from ?? "—"} → {o.status_to ?? "—"}</span>
              )}
              <span className="text-muted-foreground ml-auto">{formatDate(o.created_at)}</span>
              {oExt.resolved_at && (
                <span className="text-muted-foreground italic">
                  · respondida {formatDate(oExt.resolved_at)}
                  {oExt.resolved_by && profiles[oExt.resolved_by] ? ` por ${profiles[oExt.resolved_by]}` : ""}
                </span>
              )}
              {o.edited_at && (
                <span className="text-muted-foreground italic">· editado {formatDate(o.edited_at)}</span>
              )}
              {canEdit && !isEditing && (
                <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => startEditObs(o)} aria-label="Editar observação">
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <Textarea rows={3} value={editingObsDraft} onChange={(e) => setEditingObsDraft(e.target.value)} />
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
                {isNfQuestion && relatedInvoiceId && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-warning/60 bg-warning-soft text-warning-foreground hover:bg-warning-soft/80"
                      onClick={() => onOpenQuestionInvoice(relatedInvoiceId!)}
                    >
                      <MessageCircleQuestion className="h-3.5 w-3.5 mr-1.5" /> Responder na NF
                    </Button>
                  </div>
                )}
                {isInternalQuestion && !isResolved && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReplyOpenFor((cur) => (cur === o.id ? null : o.id))}
                      >
                        <Send className="h-3.5 w-3.5 mr-1.5" /> Responder
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !user}
                        onClick={async () => {
                          if (!user) return;
                          setBusy(true);
                          const r = await resolveQuestion(o.id, user.id, null, o.author_type);
                          setBusy(false);
                          if (!r.ok) {
                            toast({ title: "Falha ao marcar como respondida", description: r.error, variant: "destructive" });
                            return;
                          }
                          await onChanged();
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Marcar como respondida
                      </Button>
                    </div>
                    {replyOpenFor === o.id && (
                      <div className="space-y-2">
                        <Textarea
                          rows={3}
                          placeholder="Sua resposta…"
                          value={replyDraft[o.id] ?? ""}
                          onChange={(e) => setReplyDraft((m) => ({ ...m, [o.id]: e.target.value }))}
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setReplyOpenFor(null)} disabled={busy}>Cancelar</Button>
                          <Button
                            size="sm"
                            disabled={busy || !user || !(replyDraft[o.id] ?? "").trim()}
                            onClick={async () => {
                              if (!user) return;
                              const text = (replyDraft[o.id] ?? "").trim();
                              if (!text) return;
                              setBusy(true);
                              // O author_type da resposta segue o do autor desta tela
                              // — usamos o do registro original como fallback razoável.
                              const res = await recordObservation({
                                payment_id: o.payment_id,
                                author_type: o.author_type,
                                author_id: user.id,
                                message: text,
                                item_id: o.item_id ?? null,
                                answers_question_id: o.id,
                              });
                              setBusy(false);
                              if (!res.ok) {
                                toast({ title: "Falha ao responder", description: res.error, variant: "destructive" });
                                return;
                              }
                              setReplyDraft((m) => ({ ...m, [o.id]: "" }));
                              setReplyOpenFor(null);
                              await onChanged();
                            }}
                          >
                            <Send className="h-3.5 w-3.5 mr-1.5" /> Enviar resposta
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {isInternalQuestion && isResolved && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const r = await reopenQuestion(o.id);
                        setBusy(false);
                        if (!r.ok) {
                          toast({ title: "Falha ao reabrir", description: r.error, variant: "destructive" });
                          return;
                        }
                        await onChanged();
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reabrir pergunta
                    </Button>
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
        </ol>
      )}
    </div>
  );
};
