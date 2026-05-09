import { describe, it, expect } from "vitest";
import {
  canEditBatch,
  canReimportBatch,
  canAssumeBatch,
  ANALYST_EDITABLE_STATUSES,
  REIMPORT_ALLOWED_STATUSES,
} from "./paymentFlow";
import type { PaymentStatus } from "./status";

const ALL_STATUSES: PaymentStatus[] = [
  "rascunho",
  "em_analise_ia",
  "aguardando_validacao",
  "devolvido_analista",
  "aguardando_aprovacao",
  "aprovado",
  "pedido_nf_enviado",
  "nf_recebida",
  "nf_conciliada",
  "nf_divergente",
  "pago",
  "rejeitado",
  "cancelado",
  "revisao_analista",
  "aprovado_com_ressalva",
  "nf_questionada",
];

// Matriz de papéis (excluindo combinações irreais — owner+role qualquer é válido).
type RoleFlags = {
  isOwner: boolean;
  isAnalista: boolean;
  isValidador: boolean;
  isDiretor: boolean;
};

const ROLES: Array<{ name: string; flags: RoleFlags }> = [
  { name: "anônimo (sem papel)", flags: { isOwner: false, isAnalista: false, isValidador: false, isDiretor: false } },
  { name: "analista dono", flags: { isOwner: true, isAnalista: true, isValidador: false, isDiretor: false } },
  { name: "analista não-dono", flags: { isOwner: false, isAnalista: true, isValidador: false, isDiretor: false } },
  { name: "validador dono", flags: { isOwner: true, isAnalista: false, isValidador: true, isDiretor: false } },
  { name: "validador não-dono", flags: { isOwner: false, isAnalista: false, isValidador: true, isDiretor: false } },
  { name: "diretor dono", flags: { isOwner: true, isAnalista: false, isValidador: false, isDiretor: true } },
  { name: "diretor não-dono", flags: { isOwner: false, isAnalista: false, isValidador: false, isDiretor: true } },
  { name: "admin (analista+diretor) não-dono", flags: { isOwner: false, isAnalista: true, isValidador: true, isDiretor: true } },
];

describe("canEditBatch", () => {
  for (const status of ALL_STATUSES) {
    const editable = ANALYST_EDITABLE_STATUSES.has(status);

    it(`status ${status}: nenhum papel pode editar fora dos editáveis`, () => {
      if (!editable) {
        for (const r of ROLES) {
          expect(
            canEditBatch(status, {
              isOwner: r.flags.isOwner,
              isAnalista: r.flags.isAnalista,
              isAdminOrDiretor: r.flags.isDiretor,
            }),
          ).toBe(false);
        }
      }
    });

    if (editable) {
      it(`status ${status}: analista dono pode editar`, () => {
        expect(canEditBatch(status, { isOwner: true, isAnalista: true, isAdminOrDiretor: false })).toBe(true);
      });
      it(`status ${status}: analista não-dono PODE editar`, () => {
        expect(canEditBatch(status, { isOwner: false, isAnalista: true, isAdminOrDiretor: false })).toBe(true);
      });
      it(`status ${status}: admin/diretor pode editar (override governado)`, () => {
        expect(canEditBatch(status, { isOwner: false, isAnalista: false, isAdminOrDiretor: true })).toBe(true);
      });
      it(`status ${status}: usuário sem papel NÃO pode editar`, () => {
        expect(canEditBatch(status, { isOwner: false, isAnalista: false, isAdminOrDiretor: false })).toBe(false);
      });
    }
  }
});

describe("canReimportBatch", () => {
  for (const status of ALL_STATUSES) {
    const allowed = REIMPORT_ALLOWED_STATUSES.has(status);

    it(`status ${status}: analista dono em status permitido`, () => {
      expect(canReimportBatch(status, { isOwner: true, isAnalista: true })).toBe(allowed);
    });

    it(`status ${status}: analista não-dono PODE reimportar se permitido`, () => {
      expect(canReimportBatch(status, { isOwner: false, isAnalista: true })).toBe(allowed);
    });

    it(`status ${status}: dono sem ser analista nunca reimporta`, () => {
      expect(canReimportBatch(status, { isOwner: true, isAnalista: false })).toBe(false);
    });

    it(`status ${status}: sem papel nunca reimporta`, () => {
      expect(canReimportBatch(status, { isOwner: false, isAnalista: false })).toBe(false);
    });
  }

  it("status fora da lista: ninguém reimporta", () => {
    const blocked: PaymentStatus[] = [
      "aguardando_validacao",
      "aguardando_aprovacao",
      "aprovado",
      "pago",
      "cancelado",
      "rejeitado",
    ];
    for (const s of blocked) {
      expect(canReimportBatch(s, { isOwner: true, isAnalista: true })).toBe(false);
      expect(canReimportBatch(s, { isOwner: false, isAnalista: true })).toBe(false);
    }
  });
});

describe("canAssumeBatch — segregação", () => {
  it("dono nunca assume (segregação de funções) em qualquer status/papel", () => {
    for (const status of ALL_STATUSES) {
      expect(
        canAssumeBatch(status, { isAnalista: true, isValidador: true, isDiretor: true, isOwner: true }),
      ).toBe(false);
    }
  });

  it("status do analista (rascunho/em_analise_ia/revisao_analista/devolvido_analista): só analista não-dono assume", () => {
    const analystStatuses: PaymentStatus[] = [
      "rascunho",
      "em_analise_ia",
      "revisao_analista",
      "devolvido_analista",
    ];
    for (const s of analystStatuses) {
      expect(canAssumeBatch(s, { isAnalista: true, isValidador: false, isDiretor: false, isOwner: false })).toBe(true);
      expect(canAssumeBatch(s, { isAnalista: false, isValidador: true, isDiretor: false, isOwner: false })).toBe(false);
      expect(canAssumeBatch(s, { isAnalista: false, isValidador: false, isDiretor: true, isOwner: false })).toBe(false);
    }
  });

  it("aguardando_validacao: só validador não-dono assume", () => {
    for (const s of ["aguardando_validacao"] as PaymentStatus[]) {
      expect(canAssumeBatch(s, { isAnalista: false, isValidador: true, isDiretor: false, isOwner: false })).toBe(true);
      expect(canAssumeBatch(s, { isAnalista: true, isValidador: false, isDiretor: false, isOwner: false })).toBe(false);
      expect(canAssumeBatch(s, { isAnalista: false, isValidador: false, isDiretor: true, isOwner: false })).toBe(false);
    }
  });

  it("aguardando_aprovacao: só diretor não-dono assume", () => {
    expect(canAssumeBatch("aguardando_aprovacao", { isAnalista: false, isValidador: false, isDiretor: true, isOwner: false })).toBe(true);
    expect(canAssumeBatch("aguardando_aprovacao", { isAnalista: true, isValidador: false, isDiretor: false, isOwner: false })).toBe(false);
    expect(canAssumeBatch("aguardando_aprovacao", { isAnalista: false, isValidador: true, isDiretor: false, isOwner: false })).toBe(false);
  });

  it("estados terminais/pós-aprovação: ninguém assume", () => {
    const terminal: PaymentStatus[] = [
      "aprovado",
      "aprovado_com_ressalva",
      "pedido_nf_enviado",
      "nf_recebida",
      "nf_conciliada",
      "nf_divergente",
      "nf_questionada",
      "pago",
      "rejeitado",
      "cancelado",
    ];
    for (const s of terminal) {
      for (const r of ROLES) {
        expect(canAssumeBatch(s, { ...r.flags })).toBe(false);
      }
    }
  });

  it("usuário sem papel nunca assume", () => {
    for (const s of ALL_STATUSES) {
      expect(canAssumeBatch(s, { isAnalista: false, isValidador: false, isDiretor: false, isOwner: false })).toBe(false);
    }
  });
});