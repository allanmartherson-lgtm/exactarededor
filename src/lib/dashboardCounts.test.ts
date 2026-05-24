import { describe, it, expect } from "vitest";
import {
  computeDashboardCounts,
  ownerRoleFor,
  ANALISTA_PENDING_STATUSES,
  type PaymentInput,
} from "./dashboardCounts";
import type { PaymentStatus } from "./status";

const UID = "user-uid-1";
const OTHER = "user-uid-other";

const make = (
  id: string,
  status: PaymentStatus,
  created_by: string | null = OTHER,
): PaymentInput => ({ id, status, created_by, validated_by: null });

describe("ownerRoleFor", () => {
  it("mapeia status para o papel responsável", () => {
    expect(ownerRoleFor("em_analise_ia")).toBe("analista");
    expect(ownerRoleFor("revisao_analista")).toBe("analista");
    expect(ownerRoleFor("devolvido_analista")).toBe("analista");
    expect(ownerRoleFor("aprovado_em_revisao")).toBe("analista");
    expect(ownerRoleFor("aguardando_validacao")).toBe("validador");
    expect(ownerRoleFor("aguardando_aprovacao")).toBe("diretor");
    expect(ownerRoleFor("pago")).toBe("—");
  });
});

describe("computeDashboardCounts — mineDiretor", () => {
  it("conta lote em aguardando_aprovacao independente de o usuário ser dono", () => {
    const r = computeDashboardCounts({
      payments: [make("p1", "aguardando_aprovacao", OTHER)],
      groupsByPayment: {},
      companiesByPayment: { p1: ["c1"] },
      uid: UID,
      roles: ["diretor"],
    });
    expect(r.mineDiretor).toBe(1);
    expect(r.mineDiretorCompanies).toBe(1);
    expect(r.teamAprovacao).toBe(1);
    expect(r.pipeAprovacao).toBe(1);
  });

  it("conta lote misto: status do lote != aguardando_aprovacao mas tem grupo em aguardando_aprovacao", () => {
    const r = computeDashboardCounts({
      payments: [make("p1", "revisao_analista", OTHER)],
      groupsByPayment: { p1: ["aguardando_aprovacao", "revisao_analista"] },
      companiesByPayment: { p1: ["c1", "c2"] },
      uid: UID,
      roles: ["diretor"],
    });
    expect(r.mineDiretor).toBe(1);
    expect(r.mineDiretorCompanies).toBe(2);
    // pipeAprovacao incrementa via grupo misto
    expect(r.pipeAprovacao).toBe(1);
  });

  it("não conta lotes fora de aguardando_aprovacao", () => {
    const r = computeDashboardCounts({
      payments: [
        make("p1", "aguardando_validacao"),
        make("p2", "aprovado"),
        make("p3", "pago"),
      ],
      groupsByPayment: {},
      companiesByPayment: {},
      uid: UID,
      roles: ["diretor"],
    });
    expect(r.mineDiretor).toBe(0);
    expect(r.mineDiretorCompanies).toBe(0);
  });

  it("deduplica empresas entre múltiplos lotes em aprovação", () => {
    const r = computeDashboardCounts({
      payments: [
        make("p1", "aguardando_aprovacao"),
        make("p2", "aguardando_aprovacao"),
      ],
      groupsByPayment: {},
      companiesByPayment: { p1: ["c1", "c2"], p2: ["c2", "c3"] },
      uid: UID,
      roles: ["diretor"],
    });
    expect(r.mineDiretor).toBe(2);
    expect(r.mineDiretorCompanies).toBe(3);
  });

  it("requer uid para somar empresas (anônimo zera o set)", () => {
    const r = computeDashboardCounts({
      payments: [make("p1", "aguardando_aprovacao")],
      groupsByPayment: {},
      companiesByPayment: { p1: ["c1"] },
      uid: null,
      roles: ["diretor"],
    });
    // mineDiretor é incrementado de qualquer forma (regra global por status)
    expect(r.mineDiretor).toBe(1);
    // mas o set de empresas só é alimentado quando isMineRow=true (uid presente)
    expect(r.mineDiretorCompanies).toBe(0);
  });
});

describe("computeDashboardCounts — mineAnalista", () => {
  it("só conta lotes pendentes do analista criados por ele (owner === analista)", () => {
    const r = computeDashboardCounts({
      payments: [
        make("p1", "revisao_analista", UID),
        make("p2", "revisao_analista", OTHER),
        make("p3", "em_analise_ia", UID),
        make("p4", "nf_questionada", UID), // owner === "—" → não conta em mineAnalista
        make("p5", "aprovado_em_revisao", UID), // owner=analista mas não pending
      ],
      groupsByPayment: {},
      companiesByPayment: {
        p1: ["c1"],
        p3: ["c1", "c2"],
        p4: ["c3"],
      },
      uid: UID,
      roles: ["analista"],
    });
    expect(r.mineAnalista).toBe(2); // p1 + p3
    expect(r.mineAnalistaCompanies).toBe(2); // {c1, c2}
  });

});

describe("computeDashboardCounts — mineValidador", () => {
  it("conta lotes com qualquer grupo em aguardando_validacao", () => {
    const r = computeDashboardCounts({
      payments: [
        make("p1", "aguardando_validacao"),
        make("p2", "revisao_analista"), // misto
        make("p3", "aprovado"),
      ],
      groupsByPayment: {
        p1: ["aguardando_validacao"],
        p2: ["aguardando_validacao", "revisao_analista"],
      },
      companiesByPayment: { p1: ["c1"], p2: ["c1", "c2"] },
      uid: UID,
      roles: ["validador"],
    });
    expect(r.mineValidador).toBe(2);
    expect(r.mineValidadorCompanies).toBe(2);
    // pipeValidacao: p1 (status) + p2 (grupo misto)
    expect(r.pipeValidacao).toBe(2);
    // teamValidacao: p1 (owner) + p2 (grupo misto, owner != validador)
    expect(r.teamValidacao).toBe(2);
  });
});

describe("computeDashboardCounts — pipeline e contadores por status", () => {
  it("agrega corretamente cada status no pipeline", () => {
    const statuses: PaymentStatus[] = [
      "em_analise_ia",
      "revisao_analista",
      "aguardando_validacao",
      "aguardando_aprovacao",
      "aprovado",
      "aprovado_em_revisao",
      "pedido_nf_enviado",
      "nf_recebida",
      "nf_conciliada",
      "pago",
      "nf_questionada",
      "devolvido_analista",
      "aprovado_com_ressalva",
      "rejeitado",
    ];
    const payments = statuses.map((s, i) => make(`p${i}`, s));
    const r = computeDashboardCounts({
      payments,
      groupsByPayment: {},
      companiesByPayment: {},
      uid: UID,
      roles: ["admin"],
    });
    expect(r.pipeAnaliseIA).toBe(2); // em_analise_ia + revisao_analista
    expect(r.pipeValidacao).toBe(1);
    expect(r.pipeAprovacao).toBe(1);
    expect(r.pipeAguardandoEnvio).toBe(2); // aprovado + aprovado_em_revisao
    expect(r.pipeNFSolicitada).toBe(1);
    expect(r.pipeNFRecebida).toBe(1);
    expect(r.pipeNFConciliada).toBe(1);
    expect(r.pipePago).toBe(1);
    expect(r.pipeDivergente).toBe(1);
    expect(r.attDevolvidoAnalista).toBe(1);
    expect(r.attRessalvas).toBe(1);
    expect(r.attNFQuestionada).toBe(1);
    expect(r.attRejeitados).toBe(1);
    expect(r.diretorAprovadoEmRevisao).toBe(1);
  });
});

describe("computeDashboardCounts — NF divergente", () => {
  it("incrementa team e mine apenas quando o pagamento é do usuário", () => {
    const r = computeDashboardCounts({
      payments: [],
      groupsByPayment: {},
      companiesByPayment: {},
      invoiceDivergent: [
        { payment_created_by: UID },
        { payment_created_by: OTHER },
        { payment_created_by: null },
      ],
      uid: UID,
      roles: ["analista"],
    });
    expect(r.teamInvoicesDivergentes).toBe(3);
    expect(r.attNFDivergente).toBe(3);
    expect(r.mineInvoicesDivergentes).toBe(1);
  });
});

describe("ANALISTA_PENDING_STATUSES", () => {
  it("contém os status corretos", () => {
    expect(ANALISTA_PENDING_STATUSES.has("em_analise_ia")).toBe(true);
    expect(ANALISTA_PENDING_STATUSES.has("revisao_analista")).toBe(true);
    expect(ANALISTA_PENDING_STATUSES.has("devolvido_analista")).toBe(true);
    expect(ANALISTA_PENDING_STATUSES.has("nf_questionada")).toBe(true);
    expect(ANALISTA_PENDING_STATUSES.has("aprovado")).toBe(false);
    expect(ANALISTA_PENDING_STATUSES.has("aprovado_em_revisao")).toBe(false);
  });
});
