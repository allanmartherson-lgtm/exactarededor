import { useMemo, useState } from "react";
import { MessageCircle, Undo2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/status";
import type { GroupRow } from "@/hooks/usePaymentDetailData";

interface Props {
  paymentId: string;
  groups: GroupRow[];
  currentUserId: string;
  currentUserName: string;
  onDone: () => void | Promise<void>;
}

const PENDING_GROUP_STATUSES = new Set<string>(["em_questionamento", "devolvido_analista"]);
const ALREADY_DONE_STATUSES = new Set<string>(["aprovado", "rejeitado", "cancelado", "arquivado"]);

export function PaymentBatchActionsFooter({
  paymentId,
  groups,
  currentUserId,
  currentUserName,
  onDone,
}: Props) {
  const [questionOpen, setQuestionOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // ===== Question dialog state =====
  const [qSelected, setQSelected] = useState<Set<string>>(new Set());
  const [qMessage, setQMessage] = useState("");

  // ===== Return dialog state =====
  const [retMode, setRetMode] = useState<"completo" | "parcial">("completo");
  const [retSelected, setRetSelected] = useState<Set<string>>(new Set());
  const [retMessage, setRetMessage] = useState("");

  // ===== Approve dialog state =====
  const [approveNote, setApproveNote] = useState("");

  const approvable = useMemo(
    () => groups.filter((g) => !PENDING_GROUP_STATUSES.has(String(g.status)) && !ALREADY_DONE_STATUSES.has(String(g.status))),
    [groups],
  );
  const pending = useMemo(
    () => groups.filter((g) => PENDING_GROUP_STATUSES.has(String(g.status))),
    [groups],
  );

  const openQuestion = () => {
    setQSelected(new Set());
    setQMessage("");
    setQuestionOpen(true);
  };

  const openReturn = () => {
    setRetMode("completo");
    setRetMessage("");
    const preselect = new Set(
      groups.filter((g) => PENDING_GROUP_STATUSES.has(String(g.status))).map((g) => g.id),
    );
    setRetSelected(preselect);
    setReturnOpen(true);
  };

  const handleApproveClick = async () => {
    if (approvable.length === 0 && pending.length === 0) {
      toast({ title: "Lote já foi processado", variant: "destructive" });
      return;
    }
    if (approvable.length === 0 && pending.length > 0) {
      toast({ title: "Todas as empresas estão pendentes com o analista", variant: "destructive" });
      return;
    }
    if (pending.length === 0) {
      // Caso A — aprovação direta
      await doApprove(approvable.map((g) => g.id), null);
      return;
    }
    setApproveNote("");
    setApproveOpen(true);
  };

  const doApprove = async (groupIds: string[], note: string | null) => {
    if (groupIds.length === 0) return;
    setBusy(true);
    const { error } = await supabase.rpc("approve_payment", {
      p_payment_id: paymentId,
      p_group_ids: groupIds,
      p_author_id: currentUserId,
      p_author_name: currentUserName,
      p_note: note,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao aprovar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${groupIds.length} empresa(s) aprovada(s)` });
    setApproveOpen(false);
    await onDone();
  };

  const doQuestion = async () => {
    if (qMessage.trim().length < 10) {
      toast({ title: "Mensagem muito curta", description: "Mínimo de 10 caracteres.", variant: "destructive" });
      return;
    }
    if (qSelected.size === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    setBusy(true);
    const ids = Array.from(qSelected);
    const results = await Promise.all(
      ids.map((gid) =>
        supabase.rpc("question_company_group", {
          p_company_group_id: gid,
          p_author_id: currentUserId,
          p_author_name: currentUserName,
          p_message: qMessage.trim(),
        }),
      ),
    );
    setBusy(false);
    const failed = results.filter((r) => r.error);
    if (failed.length) {
      toast({
        title: `Falha em ${failed.length}/${ids.length} envios`,
        description: failed[0].error?.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: `Questionamento enviado a ${ids.length} empresa(s)` });
    setQuestionOpen(false);
    await onDone();
  };

  const doReturn = async () => {
    if (retMessage.trim().length < 10) {
      toast({ title: "Mensagem muito curta", description: "Mínimo de 10 caracteres.", variant: "destructive" });
      return;
    }
    const ids = retMode === "completo" ? groups.map((g) => g.id) : Array.from(retSelected);
    if (ids.length === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("return_groups_to_analyst", {
      p_payment_id: paymentId,
      p_group_ids: ids,
      p_author_id: currentUserId,
      p_author_name: currentUserName,
      p_message: retMessage.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao devolver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${ids.length} empresa(s) devolvida(s) ao analista` });
    setReturnOpen(false);
    await onDone();
  };

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  return (
    <>
      <Card className="shadow-card border-primary/30">
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-auto">
            Ações do lote — {approvable.length} aprovável(is), {pending.length} pendente(s).
          </span>
          <Button variant="outline" onClick={openQuestion} disabled={busy}>
            <MessageCircle className="h-4 w-4 mr-2" /> Questionar
          </Button>
          <Button variant="outline" onClick={openReturn} disabled={busy}>
            <Undo2 className="h-4 w-4 mr-2" /> Devolver
          </Button>
          <Button onClick={handleApproveClick} disabled={busy}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Aprovar
          </Button>
        </CardContent>
      </Card>

      {/* ============== Questionar ============== */}
      <Dialog open={questionOpen} onOpenChange={setQuestionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Questionar empresas</DialogTitle>
            <DialogDescription>
              Selecione as empresas a questionar e descreva o que precisa de esclarecimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-h-[280px] overflow-y-auto border rounded-md divide-y">
              {groups.map((g) => (
                <label
                  key={g.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={qSelected.has(g.id)}
                    onCheckedChange={() => toggle(qSelected, g.id, setQSelected)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{g.company_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.items_count} itens · {formatCurrency(Number(g.total_amount ?? 0))}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            <div>
              <Label className="text-xs">Mensagem (mín. 10 caracteres)</Label>
              <Textarea
                value={qMessage}
                onChange={(e) => setQMessage(e.target.value)}
                rows={4}
                placeholder="Descreva o questionamento..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuestionOpen(false)}>Cancelar</Button>
            <Button onClick={doQuestion} disabled={busy}>Enviar questionamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== Devolver ============== */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Devolver ao analista</DialogTitle>
            <DialogDescription>Devolver lote completo ou parcial?</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <RadioGroup value={retMode} onValueChange={(v) => setRetMode(v as "completo" | "parcial")} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ret-completo" value="completo" />
                <Label htmlFor="ret-completo">Completo</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ret-parcial" value="parcial" />
                <Label htmlFor="ret-parcial">Parcial</Label>
              </div>
            </RadioGroup>

            {retMode === "parcial" && (
              <div className="max-h-[260px] overflow-y-auto border rounded-md divide-y">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={retSelected.has(g.id)}
                      onCheckedChange={() => toggle(retSelected, g.id, setRetSelected)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.company_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.items_count} itens · {formatCurrency(Number(g.total_amount ?? 0))} · {String(g.status)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div>
              <Label className="text-xs">Observação (mín. 10 caracteres)</Label>
              <Textarea
                value={retMessage}
                onChange={(e) => setRetMessage(e.target.value)}
                rows={4}
                placeholder="Explique o motivo da devolução..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>Cancelar</Button>
            <Button onClick={doReturn} disabled={busy}>Confirmar devolução</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== Aprovar (parcial) ============== */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aprovação parcial</DialogTitle>
            <DialogDescription>
              {approvable.length} empresa(s) serão aprovadas agora. {pending.length} ficam pendentes com o analista.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium mb-1 text-success">Serão aprovadas ({approvable.length})</p>
              <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto border rounded p-2">
                {approvable.map((g) => (
                  <li key={g.id}>• {g.company_name} — {formatCurrency(Number(g.total_amount ?? 0))}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium mb-1 text-warning-foreground">Ficam pendentes ({pending.length})</p>
              <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto border rounded p-2">
                {pending.map((g) => (
                  <li key={g.id}>• {g.company_name} — {String(g.status)}</li>
                ))}
              </ul>
            </div>
            <div>
              <Label className="text-xs">Observação (opcional)</Label>
              <Textarea
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => doApprove(approvable.map((g) => g.id), approveNote.trim() || null)}
              disabled={busy}
            >
              Confirmar aprovação parcial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
