/**
 * Port TypeScript da função SQL `public.recompute_payment_status_from_groups`.
 *
 * MOTIVO: garantir que o cálculo de status do lote permaneça consistente entre
 * analista e validador (mesma resposta, sem precisar de refresh manual). Este
 * módulo é a referência canônica testada — qualquer mudança na função SQL
 * precisa refletir aqui e passar nos testes em `recomputePaymentStatus.test.ts`.
 *
 * Escopo: modo `padrao`. Modo `confeccao` controla apenas `confeccao_status`
 * e está coberto por outros contratos.
 */
import type { PaymentStatus } from "./status";

export type GroupStatus =
  | "aprovado"
  | "rejeitado"
  | "cancelado"
  | "em_analise_ia"
  | "revisao_analista"
  | "concluida_analista"
  | "devolvido_analista"
  | "aguardando_validacao"
  | "aguardando_aprovacao"
  | "aprovado_em_revisao"
  | "arquivado"
  | "em_questionamento"
  | "revisao_pos_aprovacao"
  | "pedido_nf_enviado"
  | "nf_recebida"
  | "nf_conciliada"
  | "lancado"
  | "pago"
  | "concluido_validacao";

export interface RecomputeInput {
  /** Lista bruta dos status dos `payment_company_groups` do lote. */
  groupStatuses: GroupStatus[];
  /** Status atual do `payments.status`. */
  currentStatus: PaymentStatus;
  /** Existe job `payment_processing_jobs` em andamento? */
  hasActiveJob?: boolean;
}

export function recomputePaymentStatus(input: RecomputeInput): PaymentStatus | null {
  const { groupStatuses, currentStatus, hasActiveJob = false } = input;
  const total = groupStatuses.length;
  if (total === 0) return null;

  const c = (s: GroupStatus) => groupStatuses.filter((g) => g === s).length;
  const s_aprovado = c("aprovado");
  const s_rejeitado = c("rejeitado");
  const s_cancelado = c("cancelado");
  const s_em_analise = c("em_analise_ia");
  const s_revisao = c("revisao_analista");
  const s_concluida = c("concluida_analista");
  const s_dev_analista = c("devolvido_analista");
  const s_aguard_val = c("aguardando_validacao");
  const s_aguard_apr = c("aguardando_aprovacao");
  const s_apr_revisao = c("aprovado_em_revisao");
  const s_arquivado = c("arquivado");
  const s_questionado = c("em_questionamento");
  const s_rev_pos_apr = c("revisao_pos_aprovacao");
  const s_pedido_nf = c("pedido_nf_enviado");
  const s_nf_recebida = c("nf_recebida");
  const s_nf_concil = c("nf_conciliada");
  const s_lancado = c("lancado");
  const s_pago = c("pago");
  const s_concl_valid = c("concluido_validacao");

  if (
    hasActiveJob &&
    (currentStatus === "rascunho" ||
      currentStatus === "em_analise_ia" ||
      currentStatus === "revisao_analista" ||
      currentStatus === "devolvido_analista")
  ) {
    return "em_analise_ia";
  }
  if (s_em_analise > 0) return "em_analise_ia";
  // 'concluida_analista' NÃO trava o lote em revisão; só 'revisao_analista'.
  if (s_revisao > 0) return "revisao_analista";
  if (s_dev_analista > 0) return "devolvido_analista";
  // Grupos concluídos pelo analista contam como aguardando validação.
  if (s_aguard_val > 0 || s_concluida > 0) return "aguardando_validacao";
  if (s_aguard_apr > 0 || s_questionado > 0) return "aguardando_aprovacao";
  if (s_apr_revisao > 0 || s_rev_pos_apr > 0) return "revisao_pos_aprovacao";
  // Desfecho do módulo "validação" (hospitais sem etapa de diretor) — mesmo
  // degrau de prioridade de revisao_pos_aprovacao, rótulo próprio.
  if (s_concl_valid > 0) return "concluido_validacao";
  if (s_pedido_nf > 0 || s_nf_recebida > 0) return "pedido_nf_enviado";
  if (s_arquivado === total) return "arquivado";
  if (
    s_nf_concil > 0 &&
    s_nf_concil + s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado + s_questionado === total
  ) {
    return "nf_conciliada";
  }
  if (s_pago === total) return "pago";
  if (
    s_lancado + s_pago > 0 &&
    s_lancado + s_pago + s_rejeitado + s_cancelado + s_arquivado === total
  ) {
    return "lancado";
  }
  // Suprime variável não usada (mantida para clareza da paridade com SQL).
  void s_aprovado;
  return "aguardando_aprovacao";
}
