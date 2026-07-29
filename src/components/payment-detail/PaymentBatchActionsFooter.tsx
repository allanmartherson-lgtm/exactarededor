import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Undo2, CheckCircle2, MailCheck, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RegisterExternalApprovalDialog } from "@/components/payment-detail/RegisterExternalApprovalDialog";
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
import { parseReconciliationBlock, type ReconciliationBlockPayload } from "@/lib/parseReconciliationBlock";
import { BatchReconciliationBlockDialog } from "./BatchReconciliationBlockDialog";

interface Props {
  paymentId: string;
  groups: GroupRow[];
  currentUserId: string;
  currentUserName: string;
  /** Papel efetivo do usuário nesta ação. Define se "Aprovar" encaminha ao
   *  diretor (validador) ou conclui a aprovação final (diretor). */
  actorRole: "validador" | "diretor";
  items?: Array<{
    ai_status: string;
    validation_findings?: unknown;
    company_id?: string | null;
    is_cancelled?: boolean | null;
    package_absorbed?: boolean | null;
  }>;
  onDone: () => void | Promise<void>;
  /** Chamado quando o usuário clica em "Revisar antes de enviar" no gate de
   *  pendências. O container ajusta filtros para exibir os itens sinalizados. */
  onReviewPendencias?: () => void;
}

const PENDING_GROUP_STATUSES = new Set<string>(["em_questionamento", "devolvido_analista"]);
const ALREADY_DONE_STATUSES = new Set<string>(["aprovado", "rejeitado", "cancelado", "arquivado", "revisao_pos_aprovacao", "pedido_nf_enviado", "nf_recebida", "nf_conciliada", "lancado", "pago"]);
const ROLE_APPROVABLE_STATUSES: Record<Props["actorRole"], Set<string>> = {
  validador: new Set(["aguardando_validacao", "em_questionamento", "devolvido_analista"]),
  diretor: new Set(["aguardando_aprovacao"]),
};

export function PaymentBatchActionsFooter({
  paymentId,
  groups,
  currentUserId,
  currentUserName,
  actorRole,
  items,
  onDone,
  onReviewPendencias,
}: Props) {
  const navigate = useNavigate();
  const [questionOpen, setQuestionOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reconBlock, setReconBlock] = useState<ReconciliationBlockPayload | null>(null);
  const [reconTargets, setReconTargets] = useState<string[]>([]);
  const [pendingRetry, setPendingRetry] = useState<{ groupIds: string[]; note: string | null } | null>(null);

  // ===== Origem da análise (validador que também criou o lote) =====
  const [paymentMeta, setPaymentMeta] = useState<{
    created_by: string | null;
    analysis_source: string | null;
  } | null>(null);
  const [originOpen, setOriginOpen] = useState(false);
  const [originSource, setOriginSource] = useState<"email" | "whatsapp" | "outro">("email");
  const [originPerson, setOriginPerson] = useState("");
  const [originNote, setOriginNote] = useState("");
  

  useEffect(() => {
    if (actorRole !== "validador") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("created_by, analysis_source")
        .eq("id", paymentId)
        .maybeSingle();
      if (cancelled) return;
      setPaymentMeta((data as { created_by: string | null; analysis_source: string | null } | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [actorRole, paymentId]);

  // Segregação de funções: só precisa declarar origem externa quando o
  // próprio validador foi quem criou o lote E a análise ainda consta como
  // feita dentro do sistema. Caso contrário, o fluxo padrão vale.
  const needsAnalysisOrigin =
    actorRole === "validador" &&
    !!paymentMeta &&
    paymentMeta.created_by === currentUserId &&
    (paymentMeta.analysis_source ?? "system") === "system";

  const pendencias = useMemo(() => {
    // Só contam pendências que realmente bloqueariam o envio atual: itens
    // pertencentes a empresas que este ator vai enviar agora, ignorando
    // cancelados, absorvidos por pacote e itens já acatados.
    const approvableCompanies = new Set(
      groups
        .filter((g) => ROLE_APPROVABLE_STATUSES[actorRole].has(String(g.status)))
        .map((g) => String(g.company_id ?? "")),
    );
    const list = (items ?? []).filter((i) => {
      if (i.is_cancelled) return false;
      if (i.package_absorbed) return false;
      if (approvableCompanies.size === 0) return true;
      return approvableCompanies.has(String(i.company_id ?? ""));
    });
    const reprovados = list.filter((i) => i.ai_status === "reprovado").length;
    const alertas = list.filter((i) => i.ai_status === "alerta").length;
    const pendentes = list.filter((i) => i.ai_status === "pendente").length;
    return { reprovados, alertas, pendentes, temPendencias: reprovados + alertas + pendentes > 0 };
  }, [items, groups, actorRole]);

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
    () => groups.filter((g) => ROLE_APPROVABLE_STATUSES[actorRole].has(String(g.status))),
    [actorRole, groups],
  );
  const pending = useMemo(
    () => groups.filter((g) => !ROLE_APPROVABLE_STATUSES[actorRole].has(String(g.status)) && !ALREADY_DONE_STATUSES.has(String(g.status))),
    [actorRole, groups],
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

  const proceedApprove = async () => {
    if (groups.length === 0) {
      // Estado de carregamento/refresh — não tem como aprovar nada ainda.
      toast({
        title: "Aguarde — empresas ainda carregando",
        description: "Tente novamente em alguns segundos.",
      });
      return;
    }
    if (approvable.length === 0 && pending.length === 0) {
      // Todos os grupos já estão em status terminal (aprovado/pago/...).
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

  const handleApproveClick = async () => {
    if (actorRole === "validador" && pendencias.temPendencias) {
      setGateOpen(true);
      return;
    }
    if (needsAnalysisOrigin) {
      // Validador é também o criador do lote e a análise ainda está marcada
      // como 'system'. O trigger de segregação de funções vai bloquear —
      // exige declarar a origem externa da análise antes de prosseguir.
      setOriginSource("email");
      setOriginPerson("");
      setOriginNote("");
      setOriginOpen(true);
      return;
    }
    await proceedApprove();
  };

  const saveAnalysisOriginAndContinue = async () => {
    if (originPerson.trim().length < 3) {
      toast({
        title: "Informe quem fez a análise",
        description: "Nome do analista corporativo que enviou a análise por fora do sistema.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("payments")
      .update({
        analysis_source: originSource,
        analysis_on_behalf_of: originPerson.trim(),
        analysis_note: originNote.trim() || null,
        analysis_registered_by: currentUserId,
      })
      .eq("id", paymentId);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao registrar origem da análise", description: error.message, variant: "destructive" });
      return;
    }
    // Atualiza o estado local para não pedir de novo nesta sessão.
    setPaymentMeta((prev) => ({
      created_by: prev?.created_by ?? null,
      analysis_source: originSource,
    }));
    setOriginOpen(false);
    toast({ title: "Origem da análise registrada", description: `Em nome de ${originPerson.trim()} (${originSource}).` });
    await proceedApprove();
  };


  const doApprove = async (groupIds: string[], note: string | null) => {
    if (groupIds.length === 0) return;
    setBusy(true);
    const rpcName = actorRole === "diretor" ? "approve_payment" : "forward_groups_to_director";
    const { error } = await supabase.rpc(rpcName as "approve_payment", {
      p_payment_id: paymentId,
      p_group_ids: groupIds,
      p_author_id: currentUserId,
      p_author_name: currentUserName,
      p_note: note,
    });
    setBusy(false);
    if (error) {
      // Trata especificamente o bloqueio do trigger de divergência:
      // abre o ReconciliationBlockDialog com ações diretas (devolver,
      // liberar, abrir empresa) em vez de só toast. Guarda também os
      // groupIds/note pra que a opção "Liberar com justificativa" possa
      // re-disparar este mesmo envio depois do override ser registrado.
      const block = parseReconciliationBlock(error);
      if (block) {
        setReconBlock(block);
        setReconTargets(groupIds);
        setPendingRetry({ groupIds, note });
        return;
      }
      toast({
        title: actorRole === "diretor" ? "Falha ao aprovar" : "Falha ao encaminhar ao diretor",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: actorRole === "diretor"
        ? `${groupIds.length} empresa(s) aprovada(s)`
        : `${groupIds.length} empresa(s) encaminhada(s) ao diretor`,
    });
    setApproveOpen(false);
    await onDone();
    // Handoff: depois de aprovar/encaminhar o lote, este perfil não tem mais
    // ação a tomar aqui — volta para a lista de pagamentos.
    navigate("/pagamentos");
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
    // Devolução completa → registra UMA observação no nível do lote (evita
    // poluir a caixa de Conversas com a mesma mensagem em 100+ threads).
    // Parcial → uma observação por empresa, pois cada caso é independente.
    const { error } = await supabase.rpc("return_groups_to_analyst", {
      p_payment_id: paymentId,
      p_group_ids: ids,
      p_author_id: currentUserId,
      p_author_name: currentUserName,
      p_message: retMessage.trim(),
      p_lot_level: retMode === "completo",
    } as never);
    setBusy(false);
    if (error) {
      toast({ title: "Falha ao devolver", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${ids.length} empresa(s) devolvida(s) ao analista` });
    setReturnOpen(false);
    await onDone();
    // Handoff: devolução é uma ação terminal para validador/diretor — o lote
    // volta para o analista, então este perfil sai da tela.
    navigate("/pagamentos");
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
        <CardContent className="p-3 md:p-4 flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
          <span className="text-xs md:text-sm text-muted-foreground md:mr-auto">
            {groups.length === 0
              ? "Carregando empresas do lote…"
              : `Ações do lote — ${approvable.length} aprovável(is), ${pending.length} pendente(s).`}
          </span>
          <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
            <Button variant="outline" onClick={openQuestion} disabled={busy || groups.length === 0} className="w-full md:w-auto min-h-[44px] md:min-h-0 justify-center whitespace-normal text-center leading-tight">
              <MessageCircle className="h-4 w-4 mr-2 shrink-0" /> Questionar
            </Button>
            <Button variant="outline" onClick={openReturn} disabled={busy || groups.length === 0} className="w-full md:w-auto min-h-[44px] md:min-h-0 justify-center whitespace-normal text-center leading-tight">
              <Undo2 className="h-4 w-4 mr-2 shrink-0" /> Devolver
            </Button>
            <Button onClick={handleApproveClick} disabled={busy || groups.length === 0} className="w-full md:w-auto min-h-[44px] md:min-h-0 justify-center whitespace-normal text-center leading-tight px-3">
              <CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />
              {actorRole === "diretor" ? "Aprovar" : "Enviar p/ aprovação do diretor"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExternalOpen(true)}
              disabled={busy}
              className="w-full md:w-auto min-h-[44px] md:min-h-0 text-xs text-muted-foreground hover:text-foreground justify-center whitespace-normal text-center leading-tight"
              title={`Use quando a ${actorRole === "diretor" ? "aprovação" : "validação"} aconteceu fora do sistema (e-mail, WhatsApp).`}
            >
              <MailCheck className="h-4 w-4 mr-2 shrink-0" />
              Registrar {actorRole === "diretor" ? "aprovação" : "validação"} externa
            </Button>
          </div>
        </CardContent>
      </Card>

      <RegisterExternalApprovalDialog
        open={externalOpen}
        onOpenChange={setExternalOpen}
        paymentId={paymentId}
        groups={groups}
        stage={actorRole === "diretor" ? "approval" : "validation"}
        registeredById={currentUserId}
        onDone={onDone}
      />

      <BatchReconciliationBlockDialog
        open={reconBlock !== null && reconTargets.length > 0}
        onOpenChange={(v) => { if (!v) { setReconBlock(null); setReconTargets([]); setPendingRetry(null); } }}
        paymentId={paymentId}
        targetGroupIds={reconTargets}
        actorRole={actorRole}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        onResolved={async () => { setReconBlock(null); setReconTargets([]); setPendingRetry(null); await onDone(); }}
        retryAfterRelease={async () => {
          const retry = pendingRetry;
          setPendingRetry(null);
          if (retry) await doApprove(retry.groupIds, retry.note);
        }}
      />

      {/* sentinel-removed-card-close-was-here */}

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
                className="text-base md:text-sm"
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
                className="text-base md:text-sm"
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
            <DialogTitle>
              {actorRole === "diretor" ? "Aprovação parcial" : "Encaminhar para o diretor"}
            </DialogTitle>
            <DialogDescription>
              {actorRole === "diretor"
                ? `${approvable.length} empresa(s) serão aprovadas agora. ${pending.length} ficam pendentes com o analista.`
                : `${approvable.length} empresa(s) serão enviadas ao diretor para aprovação final. ${pending.length} ficam pendentes com o analista.`}
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
              <p className="font-medium mb-1 text-warning-text">Ficam pendentes ({pending.length})</p>
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
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => doApprove(approvable.map((g) => g.id), approveNote.trim() || null)}
              disabled={busy}
            >
              {actorRole === "diretor" ? "Confirmar aprovação parcial" : "Confirmar envio parcial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== Gate de pendências (validador) ============== */}
      <Dialog open={gateOpen} onOpenChange={setGateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verificar antes de enviar</DialogTitle>
            <DialogDescription>
              Há pendências neste lote. Revise antes de encaminhar ao diretor.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {pendencias.reprovados > 0 && (
              <li>🔴 {pendencias.reprovados} item(ns) reprovado(s) pela IA sem justificativa</li>
            )}
            {pendencias.alertas > 0 && (
              <li>🟡 {pendencias.alertas} item(ns) com alerta ativo</li>
            )}
            {pendencias.pendentes > 0 && (
              <li>⏳ {pendencias.pendentes} item(ns) ainda aguardando análise da IA</li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            Clique em <strong>Revisar itens sinalizados</strong> para filtrar o lote e ver exatamente quais itens precisam de atenção antes de enviar.
          </p>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                setGateOpen(false);
                await proceedApprove();
              }}
              className="w-full sm:w-auto"
            >
              Enviar mesmo assim
            </Button>
            <Button
              onClick={() => {
                setGateOpen(false);
                onReviewPendencias?.();
              }}
              className="w-full sm:w-auto"
            >
              Revisar itens sinalizados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
