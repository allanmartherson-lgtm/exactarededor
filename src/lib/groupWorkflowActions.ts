/**
 * Núcleo compartilhado da transição de status de um `payment_company_group`
 * (grupo/empresa dentro de um lote).
 *
 * Extraído de `transitionGroup` (PaymentDetail.tsx) e `transitionGroupStatus`
 * (CompanyAnalysis.tsx), que reimplementavam a mesma escrita com guardas
 * divergentes — a versão em CompanyAnalysis.tsx não chamava `canTransition`
 * nem a checagem de segregação de funções. Este módulo é a única fonte da
 * lógica de guarda + escrita; cada página injeta seus próprios efeitos de UI
 * (toast, navegação, notificação, modal de motivo manual) via os parâmetros
 * `on*`.
 *
 * IMPORTANTE: as mesmas guardas também existem no banco (trigger
 * `guard_group_workflow_transition` + RLS). Este módulo é defesa em
 * profundidade / feedback rápido na UI — nunca a única barreira.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PaymentStatus } from "@/lib/status";
import { canActAsValidatorOrDirector, canTransition, type ActorRole } from "@/lib/paymentFlow";
import { findItemsNeedingManualReason, type ManualReasonGateItem } from "@/lib/manualReasonGate";
import { recordObservation } from "@/lib/observations";

/** Formato mínimo de grupo exigido — cada página pode passar sua própria row, desde que tenha estes campos. */
export interface WorkflowGroupLike {
  id: string;
  status: PaymentStatus;
  company_id?: string | null;
  company_name?: string | null;
}

export interface TransitionGroupWorkflowParams {
  paymentId: string;
  paymentCreatedBy: string | null | undefined;
  group: WorkflowGroupLike;
  newStatus: PaymentStatus;
  authorType: ActorRole;
  userId: string;
  /** Texto livre do motivo/observação digitado pelo usuário para esta empresa. */
  message: string;
  /** Prefixo fixo da mensagem gravada no histórico (ex.: "Enviado para validação pelo analista"). */
  messagePrefix: string;
  /** Se true (default), bloqueia quando `message` está vazio. */
  requireMsg?: boolean;
  /**
   * Roda depois de todas as guardas passarem e antes do UPDATE — usado hoje
   * só por PaymentDetail.tsx para `autoClaim()` quando authorType === "analista".
   * Se omitido, nenhuma ação extra é executada (mantém o comportamento atual
   * do CompanyAnalysis.tsx, que não chama autoClaim aqui).
   */
  onBeforeWrite?: () => Promise<void> | void;
  /**
   * Chamado quando há itens pendentes de motivo de intervenção manual e a
   * transição é para aguardando_aprovacao/aprovado. Se omitido, essa
   * checagem é PULADA — hoje é o comportamento do CompanyAnalysis.tsx, que
   * não tem o modal correspondente. Passe este callback para habilitar o
   * gate (é o que PaymentDetail.tsx já faz).
   */
  onManualReasonGateNeeded?: (items: ManualReasonGateItem[]) => void;
}

export type TransitionGroupWorkflowResult =
  | { ok: true; reason?: undefined; message?: undefined }
  | {
      ok: false;
      reason:
        | "segregation_of_duties"
        | "invalid_transition"
        | "missing_message"
        | "manual_reason_gate"
        | "db_error";
      message: string;
    };

export async function transitionGroupWorkflow(
  params: TransitionGroupWorkflowParams,
): Promise<TransitionGroupWorkflowResult> {
  const {
    paymentId,
    paymentCreatedBy,
    group,
    newStatus,
    authorType,
    userId,
    message,
    messagePrefix,
    requireMsg = true,
    onBeforeWrite,
    onManualReasonGateNeeded,
  } = params;

  // Segregação de funções: quem cria o lote não pode validar nem aprovar.
  if (
    (authorType === "validador" || authorType === "diretor") &&
    !canActAsValidatorOrDirector(paymentCreatedBy, userId)
  ) {
    return {
      ok: false,
      reason: "segregation_of_duties",
      message: "Quem cria o lote não pode validar nem aprovar. Outro usuário precisa concluir esta etapa.",
    };
  }

  // Guarda de transição válida (espelha is_valid_status_transition do banco por papel).
  if (!canTransition(authorType, group.status, newStatus)) {
    return {
      ok: false,
      reason: "invalid_transition",
      message: `${authorType} não pode mover ${group.status} → ${newStatus}.`,
    };
  }

  const text = message.trim();
  if (requireMsg && !text) {
    return { ok: false, reason: "missing_message", message: "Adicione um motivo para esta empresa." };
  }

  if ((newStatus === "aguardando_aprovacao" || newStatus === "aprovado") && onManualReasonGateNeeded) {
    try {
      const pending = await findItemsNeedingManualReason(paymentId, group.company_id ?? null);
      if (pending.length > 0) {
        onManualReasonGateNeeded(pending);
        return {
          ok: false,
          reason: "manual_reason_gate",
          message: `${pending.length} ${pending.length === 1 ? "item exige" : "itens exigem"} motivo de intervenção.`,
        };
      }
    } catch (e) {
      // Não bloqueante — mesmo padrão já usado nas duas páginas originais.
      console.warn("[groupWorkflowActions] manualReasonGate falhou (não bloqueante):", e);
    }
  }

  if (onBeforeWrite) await onBeforeWrite();

  const updates: Record<string, unknown> = { status: newStatus };
  if (authorType === "validador" && newStatus === "aguardando_aprovacao") {
    updates.validated_by = userId;
    updates.validated_at = new Date().toISOString();
  }
  if (authorType === "diretor" && newStatus === "aprovado") {
    updates.approved_by = userId;
    updates.approved_at = new Date().toISOString();
  }
  if (authorType === "diretor" && newStatus === "rejeitado") {
    updates.rejected_by = userId;
    updates.rejected_at = new Date().toISOString();
    updates.rejection_reason = text || null;
  }

  const { error } = await supabase.from("payment_company_groups").update(updates as never).eq("id", group.id);
  if (error) {
    return { ok: false, reason: "db_error", message: error.message };
  }

  const obsRes = await recordObservation({
    payment_id: paymentId,
    author_type: authorType,
    author_id: userId,
    message: `[${group.company_name ?? ""}] ${messagePrefix}${text ? `: ${text}` : ""}`,
    status_from: group.status,
    status_to: newStatus,
  });
  if (!obsRes.ok) {
    // Não bloqueante — mesmo padrão já usado nas duas páginas originais
    // (o status já foi gravado; falha aqui só perde o registro de histórico).
    console.warn("[groupWorkflowActions] recordObservation falhou (não bloqueante):", obsRes.error);
  }

  return { ok: true };
}
