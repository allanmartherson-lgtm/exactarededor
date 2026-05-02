import type { PaymentStatus, ItemAiStatus } from "@/lib/status";

/**
 * Regras de transição do fluxo de aprovação de pagamento (por empresa/grupo).
 *
 * Princípios:
 *  1. O analista é o "hub" do fluxo. Toda devolução volta para ele — nunca para o
 *     ator anterior. Isso evita ping-pong entre validador e diretor.
 *  2. Quando o analista corrige um item devolvido, ele reencaminha direto a quem
 *     devolveu (validador ou diretor), pulando a fila.
 *  3. A IA deixa de ser "alarmante" assim que o analista encaminha o grupo
 *     adiante — o validador e o diretor confiam que o analista já tratou os
 *     alertas. O parecer original fica disponível como informativo.
 */

export type ActorRole = "analista" | "validador" | "diretor";

/** Estados em que o analista já concluiu a triagem deste grupo. */
export const ANALYST_DONE_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "aguardando_validacao",
  "aguardando_aprovacao",
  "aprovado",
  "pedido_nf_enviado",
  "nf_recebida",
  "nf_conciliada",
  "nf_divergente",
  "pago",
]);

/** Estados em que o grupo está com o analista (precisa de ação dele). */
export const ANALYST_OWNED_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "revisao_analista",
  "devolvido_analista",
]);

/** Estado terminal? (não há mais transições úteis) */
export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "aprovado",
  "pago",
  "rejeitado",
  "cancelado",
]);

/**
 * Mapa autoritativo de transições válidas, por papel.
 * Toda mudança de status do grupo PRECISA passar por aqui.
 */
const TRANSITIONS: Record<ActorRole, Partial<Record<PaymentStatus, PaymentStatus[]>>> = {
  analista: {
    revisao_analista: ["aguardando_validacao"],
    // Reencaminhamento direto (a quem devolveu) é tratado em `resolveResendTarget`,
    // mas mantemos o envio "padrão" como fallback.
    devolvido_analista: ["aguardando_validacao", "aguardando_aprovacao"],
  },
  validador: {
    aguardando_validacao: ["aguardando_aprovacao", "devolvido_analista"],
  },
  diretor: {
    aguardando_aprovacao: [
      "aprovado",
      // Devolução SEMPRE ao analista (regra do negócio). Nunca ao validador.
      "devolvido_analista",
      "rejeitado",
    ],
  },
};

export const canTransition = (
  role: ActorRole,
  from: PaymentStatus,
  to: PaymentStatus,
): boolean => Boolean(TRANSITIONS[role][from]?.includes(to));

export const allowedTransitions = (
  role: ActorRole,
  from: PaymentStatus,
): PaymentStatus[] => TRANSITIONS[role][from] ?? [];

/**
 * Status efetivo de IA para exibição. Quando o analista já encaminhou o grupo,
 * "reprovado"/"alerta" da IA viram "seguido" — o ator humano confirmou.
 */
export type EffectiveAiStatus = ItemAiStatus | "seguido";

export const effectiveItemAiStatus = (
  rawAi: ItemAiStatus | null | undefined,
  groupStatus: PaymentStatus,
): EffectiveAiStatus => {
  const raw = (rawAi ?? "pendente") as ItemAiStatus;
  if (ANALYST_DONE_STATUSES.has(groupStatus) && (raw === "reprovado" || raw === "alerta")) {
    return "seguido";
  }
  return raw;
};

/**
 * Dada a lista de observações do pagamento, descobre quem foi o último a
 * devolver este grupo ao analista — para o analista reencaminhar diretamente.
 */
type ObservationLite = {
  status_to: PaymentStatus | null;
  message: string | null;
  author_type: string | null;
  created_at: string;
};

export const resolveResendTarget = (
  observations: ObservationLite[],
  companyName: string,
): { role: "validador" | "diretor"; nextStatus: PaymentStatus } | null => {
  const prefix = `[${companyName}]`;
  const last = observations
    .filter(
      (o) =>
        o.status_to === "devolvido_analista" &&
        typeof o.message === "string" &&
        o.message.startsWith(prefix),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  if (!last) return null;
  if (last.author_type === "diretor") return { role: "diretor", nextStatus: "aguardando_aprovacao" };
  if (last.author_type === "validador") return { role: "validador", nextStatus: "aguardando_validacao" };
  return null;
};