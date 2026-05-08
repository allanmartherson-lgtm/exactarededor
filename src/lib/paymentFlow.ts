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
   "aprovado_em_revisao",
 ]);

/**
 * Estados em que o lote ainda pode ser editado pelo analista.
 * Inclui o `em_analise_ia` (IA processando) e `rascunho` para a janela inicial,
 * além dos estados em que o analista é o "dono" da bola. A partir de
 * `aguardando_validacao` o conteúdo congela.
 */
export const ANALYST_EDITABLE_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "rascunho",
  "em_analise_ia",
  "revisao_analista",
  "devolvido_analista",
]);

/** Status em que reimportar a base ainda é seguro (antes de qualquer validador olhar). */
export const REIMPORT_ALLOWED_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "rascunho",
  "em_analise_ia",
  "revisao_analista",
]);

/**
 * Pode editar metadados do lote?
 * Regra de governança financeira: o conteúdo CONGELA assim que sai para
 * validação/aprovação. Admin/diretor que precisarem corrigir devem PRIMEIRO
 * devolver ao analista (gera trilha) — não há mais override silencioso.
 */
export const canEditBatch = (
  status: PaymentStatus,
  opts: { isOwner: boolean; isAnalista: boolean; isAdminOrDiretor: boolean },
): boolean => {
  if (!ANALYST_EDITABLE_STATUSES.has(status)) return false;
  if (opts.isAdminOrDiretor) return true;
  return Boolean(opts.isAnalista && opts.isOwner);
};

/**
 * Pode reimportar a base (substitui itens)?
 * Mais restrito que `canEditBatch`: só o analista dono e antes de qualquer
 * validador ter olhado. Admin/diretor NÃO reimportam — destrutivo demais.
 */
export const canReimportBatch = (
  status: PaymentStatus,
  opts: { isOwner: boolean; isAnalista: boolean },
): boolean =>
  Boolean(opts.isAnalista && opts.isOwner && REIMPORT_ALLOWED_STATUSES.has(status));

/**
 * Pode "assumir" o lote? Exige papel compatível com o status atual + não ser
 * o criador (segregação). Evita que analistas/validadores apareçam como
 * responsáveis em fases que não são deles.
 */
export const canAssumeBatch = (
  status: PaymentStatus,
  opts: { isAnalista: boolean; isValidador: boolean; isDiretor: boolean; isOwner: boolean },
): boolean => {
  if (opts.isOwner) return false; // segregação
  if (ANALYST_OWNED_STATUSES.has(status) || status === "em_analise_ia" || status === "rascunho") {
    return opts.isAnalista;
  }
  if (status === "aguardando_validacao") return opts.isValidador;
  if (status === "aguardando_aprovacao") return opts.isDiretor;
  return false;
};

/**
 * Segregação de funções: quem CRIA o lote não pode VALIDAR nem APROVAR.
 * Use para esconder/desabilitar botões e como guarda no cliente
 * (a regra é replicada no banco por trigger).
 */
export const canActAsValidatorOrDirector = (
  createdBy: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean => Boolean(createdBy && currentUserId && createdBy !== currentUserId);

/**
 * Estado terminal: lote saiu do fluxo operacional ativo. Não há mais
 * transições úteis (apenas consulta histórica/auditoria). Fonte ÚNICA
 * de verdade — Dashboard, Payments, KPIs e qualquer filtro de "arquivado"
 * devem importar daqui.
 *
 * Observações:
 *  - `aprovado` NÃO é terminal: ele segue para o fluxo de NF.
 *  - `nf_conciliada` NÃO é terminal: aguarda o analista marcar como `lancado`.
 *  - `lancado` é terminal: do ponto de vista do MedPay, o pagamento
 *    foi efetivado no ERP/financeiro (mesmo que ainda venha o `pago`
 *    formal depois — opcional).
 */
export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "arquivado",
  "rejeitado",
  "cancelado",
]);

/** Conveniência: predicado para `Array.filter`/condicionais. */
export const isTerminalStatus = (s: PaymentStatus): boolean => TERMINAL_STATUSES.has(s);

/**
 * Mapa autoritativo de transições válidas, por papel.
 * Toda mudança de status do grupo PRECISA passar por aqui.
 */
const TRANSITIONS: Record<ActorRole, Partial<Record<PaymentStatus, PaymentStatus[]>>> = {
   analista: {
     revisao_analista: ["aguardando_validacao"],
     devolvido_analista: ["aguardando_validacao", "aguardando_aprovacao"],
     aprovado_em_revisao: ["pedido_nf_enviado"],
   },
   validador: {
     aguardando_validacao: ["aguardando_aprovacao", "devolvido_analista"],
   },
   diretor: {
     aguardando_aprovacao: [
       "aprovado_em_revisao",
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