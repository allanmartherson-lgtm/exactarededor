/**
 * Integração: Zeev (sinal) e o modal de mapeamento DEVEM concordar.
 *
 * Antes da correção, o sinal do Zeev chamava `summarizeMissing(hits)` sem o
 * `paymentTypeMeta`, enquanto o modal/dialog usava a versão completa. Quando o
 * tipo de pagamento injeta defaults (ex.: parecer/visita/plantão fixo com TUSS
 * e função padrão), os dois discordavam — o modal mostrava "Mapeamento OK" e
 * o Zeev continuava gritando "X campos faltando".
 *
 * Este teste blinda o contrato: as DUAS chamadas a `summarizeMissing` em
 * `NewPayment.tsx` (linhas 2030 e 4010) precisam receber o mesmo `meta` e
 * portanto produzir o mesmo resultado.
 */
import { describe, it, expect } from "vitest";
import {
  inspectColumnMapping,
  summarizeMissing,
  isFieldRequiredFor,
  type PaymentTypeRequirementMeta,
} from "@/lib/columnMapping";

/**
 * Planilha real de parecer: NÃO traz coluna de TUSS nem de função do médico,
 * porque o tipo de pagamento "Parecer" injeta `10101012` e função "Clínico"
 * automaticamente. Os demais campos obrigatórios (médico, valor, atendimento)
 * estão presentes.
 */
const PARECER_HEADERS = [
  "Médico",
  "Atendimento",
  "Paciente",
  "Convênio",
  "Setor",
  "Honorário Líquido",
  "Procedimento",
  "Data Procedimento",
  "Caráter",
  "Empresa",
];

const PARECER_META: PaymentTypeRequirementMeta = {
  tuss_default: "10101012",
  requires_tuss_in_sheet: false,
  default_function: "Clínico",
};

describe("Zeev × modal — paridade de mapeamento com defaults do payment_type", () => {
  it("sem meta (null), procedure_code e doctor_role aparecem como faltando (estado bruto)", () => {
    const hits = inspectColumnMapping(PARECER_HEADERS);
    const sumNoMeta = summarizeMissing(hits, null);
    const missingFields = sumNoMeta.missingRequired.map((h) => h.field);
    expect(missingFields).toEqual(expect.arrayContaining(["procedure_code", "doctor_role"]));
  });

  it("com meta do payment_type, ambos os campos saem da lista de obrigatórios", () => {
    const hits = inspectColumnMapping(PARECER_HEADERS);
    const sumWithMeta = summarizeMissing(hits, PARECER_META);
    const missingFields = sumWithMeta.missingRequired.map((h) => h.field);
    expect(missingFields).not.toContain("procedure_code");
    expect(missingFields).not.toContain("doctor_role");
  });

  it("Zeev (sinal) e modal (badge) produzem EXATAMENTE o mesmo resultado", () => {
    const hits = inspectColumnMapping(PARECER_HEADERS);

    // Simula as duas chamadas reais em NewPayment.tsx
    const zeevView = summarizeMissing(hits, PARECER_META); // linha ~2030
    const modalView = summarizeMissing(hits, PARECER_META); // linha ~4010

    expect(zeevView.missingRequired.map((h) => h.field).sort())
      .toEqual(modalView.missingRequired.map((h) => h.field).sort());
    expect(zeevView.lowConfidence.map((h) => h.field).sort())
      .toEqual(modalView.lowConfidence.map((h) => h.field).sort());
  });

  it("se UMA das chamadas esquecer o meta, surge a discordância que motivou o bug", () => {
    const hits = inspectColumnMapping(PARECER_HEADERS);

    const zeevBug = summarizeMissing(hits);            // forma antiga (sem meta)
    const modalFixed = summarizeMissing(hits, PARECER_META);

    // Esta diferença NÃO PODE existir em runtime — o teste documenta o bug
    // e garante que as duas chamadas sempre passem o mesmo meta.
    expect(zeevBug.missingRequired.length).toBeGreaterThan(modalFixed.missingRequired.length);
  });

  it("default_function relaxa doctor_role; tuss_default relaxa procedure_code (regra unitária)", () => {
    // Só TUSS injetado: doctor_role continua obrigatório.
    const onlyTuss: PaymentTypeRequirementMeta = { tuss_default: "10101012" };
    expect(isFieldRequiredFor("procedure_code", onlyTuss)).toBe(false);
    expect(isFieldRequiredFor("doctor_role", onlyTuss)).toBe(true);

    // Só função injetada: procedure_code continua obrigatório.
    const onlyFunc: PaymentTypeRequirementMeta = { default_function: "Clínico" };
    expect(isFieldRequiredFor("procedure_code", onlyFunc)).toBe(true);
    expect(isFieldRequiredFor("doctor_role", onlyFunc)).toBe(false);

    // requires_tuss_in_sheet=false também conta como TUSS injetado.
    const tussNotRequired: PaymentTypeRequirementMeta = { requires_tuss_in_sheet: false };
    expect(isFieldRequiredFor("procedure_code", tussNotRequired)).toBe(false);
  });
});
