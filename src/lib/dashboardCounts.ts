import type { PaymentStatus } from "./status";

export type OwnerRole = "analista" | "validador" | "diretor" | "—";

export const ownerRoleFor = (status: PaymentStatus): OwnerRole => {
  switch (status) {
    case "rascunho":
    case "em_analise_ia":
    case "revisao_analista":
    case "devolvido_analista":
    case "aprovado_em_revisao":
      return "analista";
    case "aguardando_validacao":
      return "validador";
    case "aguardando_aprovacao":
      return "diretor";
    default:
      return "—";
  }
};

export const ANALISTA_PENDING_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "em_analise_ia",
  "revisao_analista",
  "devolvido_analista",
  "nf_questionada",
]);

export interface DashboardCounts {
  mineAnalista: number;
  mineAnalistaCompanies: number;
  mineValidador: number;
  mineValidadorCompanies: number;
  mineDiretor: number;
  mineDiretorCompanies: number;
  mineInvoicesDivergentes: number;
  mineInvoicesQuestionadas: number;
  mineRessalvas: number;
  teamAnalise: number;
  teamValidacao: number;
  teamAprovacao: number;
  teamInvoicesDivergentes: number;
  pipeAnaliseIA: number;
  pipeValidacao: number;
  pipeAprovacao: number;
  pipeAguardandoEnvio: number;
  pipeNFSolicitada: number;
  pipeNFRecebida: number;
  pipeNFConciliada: number;
  pipePago: number;
  pipeDivergente: number;
  attDevolvidoAnalista: number;
  attRessalvas: number;
  attNFQuestionada: number;
  attNFDivergente: number;
  attRejeitados: number;
  diretorAprovadoEmRevisao: number;
}

export const initialDashboardCounts = (): DashboardCounts => ({
  mineAnalista: 0,
  mineAnalistaCompanies: 0,
  mineValidador: 0,
  mineValidadorCompanies: 0,
  mineDiretor: 0,
  mineDiretorCompanies: 0,
  mineInvoicesDivergentes: 0,
  mineInvoicesQuestionadas: 0,
  mineRessalvas: 0,
  teamAnalise: 0,
  teamValidacao: 0,
  teamAprovacao: 0,
  teamInvoicesDivergentes: 0,
  pipeAnaliseIA: 0,
  pipeValidacao: 0,
  pipeAprovacao: 0,
  pipeAguardandoEnvio: 0,
  pipeNFSolicitada: 0,
  pipeNFRecebida: 0,
  pipeNFConciliada: 0,
  pipePago: 0,
  pipeDivergente: 0,
  attDevolvidoAnalista: 0,
  attRessalvas: 0,
  attNFQuestionada: 0,
  attNFDivergente: 0,
  attRejeitados: 0,
  diretorAprovadoEmRevisao: 0,
});

export interface PaymentInput {
  id: string;
  status: PaymentStatus;
  created_by: string | null;
  validated_by: string | null;
}

export interface ComputeCountsInput {
  payments: PaymentInput[];
  /** payment_id -> lista de status dos payment_company_groups */
  groupsByPayment: Record<string, PaymentStatus[]>;
  /** payment_id -> lista de company_ids */
  companiesByPayment: Record<string, string[]>;
  /** rows de NF divergente (status=nf_divergente). created_by é do payment dono. */
  invoiceDivergent?: Array<{ payment_created_by: string | null }>;
  uid: string | null;
  roles: string[];
}

/**
 * Pura: replica fielmente a lógica do load() do Dashboard que popula
 * DashboardCounts a partir do forEach de pagamentos. Extraída para
 * permitir testes unitários determinísticos das regras de
 * "mineDiretor", "mineValidador", "mineAnalista" e contadores de
 * pipeline/equipe por status.
 */
export function computeDashboardCounts(input: ComputeCountsInput): DashboardCounts {
  const {
    payments,
    groupsByPayment,
    companiesByPayment,
    invoiceDivergent = [],
    uid,
    roles,
  } = input;
  const c = initialDashboardCounts();

  const mineAnalistaCompaniesSet = new Set<string>();
  const mineValidadorCompaniesSet = new Set<string>();
  const mineDiretorCompaniesSet = new Set<string>();

  const isValidadorRole = roles.includes("validador") || roles.includes("admin");

  payments.forEach((p) => {
    const owner = ownerRoleFor(p.status);
    const groupStatuses = groupsByPayment[p.id] ?? [];
    const hasGroupInValidacao = groupStatuses.some((s) => s === "aguardando_validacao");
    const hasGroupInAprovacao = groupStatuses.some((s) => s === "aguardando_aprovacao");

    const isMineRow =
      !!uid &&
      ((owner === "analista" &&
        ANALISTA_PENDING_STATUSES.has(p.status) &&
        p.created_by === uid) ||
        hasGroupInValidacao ||
        p.status === "aguardando_aprovacao" ||
        hasGroupInAprovacao);

    if (isMineRow) {
      const companies = companiesByPayment[p.id] ?? [];
      if (
        owner === "analista" &&
        ANALISTA_PENDING_STATUSES.has(p.status) &&
        p.created_by === uid
      ) {
        companies.forEach((id) => mineAnalistaCompaniesSet.add(id));
      }
      if (isValidadorRole && hasGroupInValidacao) {
        companies.forEach((id) => mineValidadorCompaniesSet.add(id));
      }
      if (p.status === "aguardando_aprovacao" || hasGroupInAprovacao) {
        companies.forEach((id) => mineDiretorCompaniesSet.add(id));
      }
    }

    if (owner === "analista") {
      c.teamAnalise++;
      if (ANALISTA_PENDING_STATUSES.has(p.status) && p.created_by === uid) c.mineAnalista++;
    } else if (owner === "validador") {
      c.teamValidacao++;
    } else if (owner === "diretor") {
      c.teamAprovacao++;
    }
    if (p.status === "aguardando_aprovacao" || hasGroupInAprovacao) {
      c.mineDiretor++;
    }

    if (hasGroupInValidacao) {
      c.mineValidador++;
      if (owner !== "validador") c.teamValidacao++;
    }

    switch (p.status) {
      case "em_analise_ia":
      case "revisao_analista":
        c.pipeAnaliseIA++;
        break;
      case "aguardando_validacao":
        c.pipeValidacao++;
        break;
      case "aguardando_aprovacao":
        c.pipeAprovacao++;
        break;
      case "aprovado":
      case "aprovado_em_revisao":
        c.pipeAguardandoEnvio++;
        break;
      case "pedido_nf_enviado":
        c.pipeNFSolicitada++;
        break;
      case "nf_recebida":
        c.pipeNFRecebida++;
        break;
      case "nf_conciliada":
        c.pipeNFConciliada++;
        break;
      case "pago":
        c.pipePago++;
        break;
      case "nf_questionada":
        c.pipeDivergente++;
        break;
    }
    if (p.status !== "aguardando_validacao" && hasGroupInValidacao) c.pipeValidacao++;
    if (p.status !== "aguardando_aprovacao" && hasGroupInAprovacao) c.pipeAprovacao++;

    if (p.status === "devolvido_analista") c.attDevolvidoAnalista++;
    if (p.status === "aprovado_com_ressalva") {
      c.attRessalvas++;
      if (isMineRow) c.mineRessalvas++;
    }
    if (p.status === "nf_questionada") {
      c.attNFQuestionada++;
      if (isMineRow) c.mineInvoicesQuestionadas++;
    }
    if (p.status === "rejeitado") c.attRejeitados++;
    if (p.status === "aprovado_em_revisao") c.diretorAprovadoEmRevisao++;
  });

  c.mineAnalistaCompanies = mineAnalistaCompaniesSet.size;
  c.mineValidadorCompanies = mineValidadorCompaniesSet.size;
  c.mineDiretorCompanies = mineDiretorCompaniesSet.size;

  invoiceDivergent.forEach((row) => {
    c.teamInvoicesDivergentes++;
    c.attNFDivergente++;
    if (uid && row.payment_created_by === uid) c.mineInvoicesDivergentes++;
  });

  return c;
}
