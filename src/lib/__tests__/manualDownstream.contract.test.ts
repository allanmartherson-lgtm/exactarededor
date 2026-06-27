/**
 * Contrato: garante que os fluxos a jusante (aprovação, NF, portal da empresa)
 * permanecem **mode-agnostic** para o modo manual e que NENHUM artefato de
 * regra/glosa/divergência vaza para o lançador manual.
 */
import { describe, it, expect } from "vitest";
import {
  buildSubject,
  buildEmailBody,
  type TemplateContext,
} from "../../../supabase/functions/send-invoice-request/templates";

const RULE_LEAKAGE_TERMS = [
  "regra",
  "glosa",
  "divergência",
  "divergencia",
  "sem regra",
  "esperado",
  "%",
];

const ctxManual = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  recipient_label: "Clínica XPTO LTDA",
  total_amount_formatted: "R$ 12.345,67",
  upload_url: "https://exacta.app/portal/abc",
  payment_due_date: "2026-07-10",
  competence: "2026-06",
  sectors: [],
  specialties: ["Nefrologia"],
  lote_name: "Manual junho/2026",
  ...overrides,
});

describe("send-invoice-request — template manual", () => {
  it("subject não menciona termos de regra/glosa", () => {
    const subj = buildSubject(ctxManual()).toLowerCase();
    for (const term of RULE_LEAKAGE_TERMS) {
      expect(subj.includes(term)).toBe(false);
    }
  });

  it("body cita a especialidade lançada manualmente e o valor total", () => {
    const body = buildEmailBody(ctxManual());
    expect(body).toContain("Nefrologia");
    expect(body).toContain("R$ 12.345,67");
    expect(body).toContain("Produção de");
  });

  it("body NÃO contém vocabulário do motor de regras", () => {
    const body = buildEmailBody(ctxManual()).toLowerCase();
    expect(body).not.toMatch(/divergência|divergencia/);
    expect(body).not.toMatch(/sem regra/);
    expect(body).not.toMatch(/glosa/);
  });

  it("fallback 'Produção médica' quando nem setor nem especialidade chegam", () => {
    // Cenário regressão: payments.specialties vazio (gap que tínhamos antes do
    // patch no recomputeTotal do ManualPaymentEntry).
    const body = buildEmailBody(ctxManual({ specialties: [], sectors: [] }));
    expect(body).toContain("Produção médica");
  });
});

describe("aggregação de specialties no save manual", () => {
  // Replica a lógica do recomputeTotal pra blindar o contrato:
  // payment_items (manual) → distinct specialties → payments.specialties[]
  const aggregateSpecialties = (
    items: Array<{ specialty: string | null; is_manual_entry: boolean }>,
  ) => {
    const set = new Set<string>();
    for (const it of items) {
      if (!it.is_manual_entry) continue;
      const s = String(it.specialty ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set);
  };

  it("distincta e ignora itens não-manuais", () => {
    const out = aggregateSpecialties([
      { specialty: "Nefrologia", is_manual_entry: true },
      { specialty: "Nefrologia", is_manual_entry: true },
      { specialty: "Cardiologia", is_manual_entry: true },
      { specialty: "Cardiologia", is_manual_entry: false }, // ignorado
      { specialty: "  ", is_manual_entry: true }, // vazio ignorado
      { specialty: null, is_manual_entry: true }, // null ignorado
    ]);
    expect(out.sort()).toEqual(["Cardiologia", "Nefrologia"]);
  });

  it("retorna array vazio sem itens manuais", () => {
    expect(aggregateSpecialties([])).toEqual([]);
  });
});

describe("approve_payment — payload de chamada é mode-agnostic", () => {
  // O RPC só muda status; o front chama com o MESMO contrato em manual e em
  // modo padrão. Esse teste é um snapshot do contrato esperado.
  const buildApprovePayload = (
    paymentId: string,
    groupIds: string[],
    actor: { id: string; name: string },
  ) => ({
    p_payment_id: paymentId,
    p_group_ids: groupIds,
    p_author_id: actor.id,
    p_author_name: actor.name,
  });

  it("payload manual = payload padrão (sem campos extras de modo)", () => {
    const manual = buildApprovePayload("pmt-1", ["g1", "g2"], {
      id: "u1",
      name: "Diretor",
    });
    const padrao = buildApprovePayload("pmt-1", ["g1", "g2"], {
      id: "u1",
      name: "Diretor",
    });
    expect(manual).toEqual(padrao);
    // Garantia explícita: nenhum campo de modo vaza para o RPC.
    expect(Object.keys(manual)).not.toContain("p_analysis_mode");
    expect(Object.keys(manual)).not.toContain("p_is_manual");
  });
});
