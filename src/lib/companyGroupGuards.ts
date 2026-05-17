import type { PaymentStatus } from "@/lib/status";

/**
 * Governança da análise por empresa dentro de um lote.
 *
 * O analista pode editar uma empresa somente enquanto ela estiver em
 * `revisao_analista` ou `devolvido_analista`. Em qualquer outro status
 * (concluida_analista, aguardando_validacao, aprovado, pago, etc.) o
 * conteúdo congela — para alterar é preciso REABRIR a análise (registra
 * trilha em audit_log).
 */
export const EDITABLE_COMPANY_GROUP_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "revisao_analista",
  "devolvido_analista",
]);

/** Status em que o analista pode reabrir a análise da empresa. */
export const REOPENABLE_COMPANY_GROUP_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "concluida_analista",
  "aguardando_validacao",
  "devolvido_analista",
]);

export function isCompanyGroupEditable(status: PaymentStatus | string | null | undefined): boolean {
  if (!status) return false;
  return EDITABLE_COMPANY_GROUP_STATUSES.has(status as PaymentStatus);
}

export function isCompanyGroupReopenable(status: PaymentStatus | string | null | undefined): boolean {
  if (!status) return false;
  return REOPENABLE_COMPANY_GROUP_STATUSES.has(status as PaymentStatus);
}

/** Mensagem padrão a exibir em tooltips/avisos quando a edição está bloqueada. */
export const COMPANY_GROUP_LOCKED_TOOLTIP =
  "Empresa concluída — reabra a análise para editar.";

/** Versão humanizada de um status de empresa, para mensagens de UI. */
export function humanizeCompanyGroupStatus(status: string | null | undefined): string {
  switch (status) {
    case "rascunho": return "Rascunho";
    case "em_analise_ia": return "Em análise da IA";
    case "revisao_analista": return "Em revisão do analista";
    case "concluida_analista": return "Concluída pelo analista";
    case "aguardando_validacao": return "Aguardando validação";
    case "aguardando_aprovacao": return "Aguardando aprovação";
    case "devolvido_analista": return "Devolvida ao analista";
    case "aprovado_em_revisao": return "Aprovada em revisão";
    case "aprovado": return "Aprovada";
    case "rejeitado": return "Rejeitada";
    case "cancelado": return "Cancelada";
    case "pago": return "Paga";
    case "pedido_nf_enviado": return "Pedido de NF enviado";
    case "nf_recebida": return "NF recebida";
    case "nf_conciliada": return "NF conciliada";
    case "nf_divergente": return "NF divergente";
    case "lancado": return "Lançado";
    case "arquivado": return "Arquivado";
    default: return status ?? "—";
  }
}
