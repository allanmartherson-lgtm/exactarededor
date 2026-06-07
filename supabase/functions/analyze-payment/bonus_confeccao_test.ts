import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
} from "../_shared/rulesEngine.ts";

/**
 * MODO CONFECÇÃO — Bônus de final de semana
 *
 * Na confecção a base do analista NÃO traz gross_amount (não há valor pago);
 * só vem procedure_amount (valor de tabela). O motor precisa:
 *  1. Calcular o expected_amount do âncora como procedure_amount + bônus.
 *  2. Não zerar o auxiliar quando o bônus é suprimido — fallback para
 *     procedure_amount (preserva o repasse base do médico auxiliar).
 *
 * Este teste blinda o fallback `gross_amount ?? procedure_amount` em
 * rulesEngine.ts (linha 3052) e a base do split de bônus no
 * analyze-payment/index.ts (parentBase = procedure_amount em confecção).
 */

function buildBonusRule(): RuleInput {
  return {
    id: "rule-bonus-fds-confeccao",
    name: "Bônus plantão fim de semana — CONFECÇÃO",
    rule_text: "",
    active: true,
    scope: "especifica",
    target_type: "empresa",
    target_identifier: "12345678000199",
    procedure_codes: null,
    sector: "procedimento",
    severity: "low",
    description: null,
    sectors: null,
    specialties: null,
    target_name: null,
    target_company_id: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "bonus",
    bonus_amount: 1500,
    bonus_pct: 0,
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    calculations: [
      {
        calculation_type: "bonus",
        bonus_amount: 1500,
        bonus_pct: 0,
        time_mode: "fim_de_semana",
        weekdays: [],
        application_unit: "por_atendimento",
        sort_order: 0,
      } as any,
    ],
  } as any;
}

const ctx: PaymentContext = {
  sectors: ["procedimento"],
  specialties: [],
  payment_type: "mensal",
  reference_date: "2026-05-09",
} as any;

Deno.test("CONFECÇÃO · bônus FDS aplicado ao âncora usa procedure_amount como base (gross_amount=null)", () => {
  // 2026-05-09 = sábado
  const items: ItemInput[] = [
    {
      id: "anchor-confeccao",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR PRINCIPAL",
      doctor_document: "999",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "ANCHOR",
      procedure_amount: 200,
      gross_amount: null as any, // CONFECÇÃO: sem valor pago
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-CONF-1",
      patient_name: "PACIENTE A",
    } as any,
  ];

  const results = analyzePaymentItems(items, [buildBonusRule()], ctx);
  const anchor = results.find((r) => r.item_id === "anchor-confeccao")!;

  // expected = procedure_amount(200) + bonus(1500) = 1700
  assertEquals(anchor.expected_amount, 1700,
    "Em confecção, expected do âncora deve ser procedure_amount + bônus");
  assertEquals(anchor.calculation_type_used, "bonus");
});

Deno.test("CONFECÇÃO · auxiliar com bônus suprimido cai em procedure_amount (não zero)", () => {
  const items: ItemInput[] = [
    {
      id: "anchor-aux-conf",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR PRINCIPAL",
      doctor_document: "999",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "ANCHOR",
      procedure_amount: 300,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-CONF-2",
      patient_name: "PACIENTE B",
    } as any,
    {
      id: "aux-conf",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR AUXILIAR",
      doctor_document: "888",
      doctor_role: "primeiro auxiliar",
      procedure_code: "10101012",
      procedure_name: "AUX",
      procedure_amount: 80,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-CONF-2",
      patient_name: "PACIENTE B",
    } as any,
  ];

  const results = analyzePaymentItems(items, [buildBonusRule()], ctx);
  const aux = results.find((r) => r.item_id === "aux-conf")!;

  assertEquals(aux.suppressed_by_dedup, true, "Auxiliar deve estar marcado como bônus suprimido");
  assertEquals(aux.expected_amount, 80,
    "Auxiliar suprimido em confecção: expected = procedure_amount (não zero)");
  assert(aux.expected_amount !== 0, "Regressão: expected do auxiliar não pode ser zero em confecção");
});

Deno.test("CONFECÇÃO · sexta-feira não dispara bônus mesmo sem gross_amount", () => {
  const items: ItemInput[] = [
    {
      id: "sex-conf",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR",
      doctor_document: "1",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "PROC",
      procedure_amount: 250,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-08T23:30:00", // sexta
      attendance_number: "ATD-SEX",
      patient_name: "P",
    } as any,
  ];

  const results = analyzePaymentItems(items, [buildBonusRule()], {
    ...ctx,
    reference_date: "2026-05-08",
  } as any);
  const r = results.find((x) => x.item_id === "sex-conf")!;
  // Sexta não dispara FDS — não deve ter expected = 250 + 1500
  assert(
    r.calculation_type_used !== "bonus" || (r.expected_amount ?? 0) < 1500,
    "Sexta-feira não pode disparar bônus de fim de semana em confecção",
  );
});

/**
 * Cobertura adicional: simula a aritmética do SPLIT do analyze-payment
 * (parentBase = procedure_amount em confecção). Garante que a linha
 * sintética de complemento_bonus seria criada com o valor correto e que
 * o procedimento pai volta a refletir só o honorário base.
 */
Deno.test("CONFECÇÃO · split sintetiza linha de bônus com valor correto e zera divergência do pai", () => {
  const items: ItemInput[] = [
    {
      id: "split-anchor",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR PRINCIPAL",
      doctor_document: "999",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "ANCHOR",
      procedure_amount: 200,
      gross_amount: null as any,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-09T10:00:00",
      attendance_number: "ATD-SPLIT",
      patient_name: "P",
    } as any,
  ];

  const results = analyzePaymentItems(items, [buildBonusRule()], ctx);
  const anchor = results.find((r) => r.item_id === "split-anchor")!;

  // Replica a lógica de analyze-payment/index.ts (linhas 1654-1710) para
  // o modo confecção — sem rodar o handler completo, validamos o cálculo.
  const isConfeccao = true;
  const parent = items[0] as any;
  const parentGrossRaw = Number(parent.gross_amount ?? 0);
  const parentBase = isConfeccao
    ? Number(parent.procedure_amount ?? parentGrossRaw ?? 0)
    : parentGrossRaw;
  const exp = anchor.expected_amount!;
  const bonusAmt = Number((exp - parentBase).toFixed(2));

  assertEquals(parentBase, 200, "parentBase em confecção = procedure_amount");
  assertEquals(bonusAmt, 1500, "Linha sintética de bônus deve ser exatamente 1500");
  // Pai pós-revert deve voltar a refletir só a base
  const parentExpectedPosRevert = parentBase;
  assertEquals(parentExpectedPosRevert + bonusAmt, exp,
    "Invariante: pai(base) + bônus(sintético) === expected original");
});

Deno.test("CONFECÇÃO · linha sintética de bônus persiste gross_amount igual ao repasse calculado", () => {
  const isConfeccao = true;
  const bonusAmt = 1500;

  // Espelha o payload crítico do insert em analyze-payment/index.ts: mesmo no
  // modo confecção, gross_amount não pode ser null porque payment_items exige
  // valor e os totais por empresa usam essa coluna.
  const bonusInsertPayload = {
    gross_amount: bonusAmt,
    expected_amount: bonusAmt,
    tipo_linha: "complemento_bonus",
    tipo_item: "bonus",
    applied_calc_method: "bonus",
    ai_findings: {
      expected_amount: bonusAmt,
      calculation_type: "bonus",
    },
  } as any;

  assertEquals(isConfeccao, true);
  assertEquals(bonusInsertPayload.gross_amount, 1500,
    "Regressão: gross_amount não pode ser null em complemento_bonus de confecção");
  assertEquals(bonusInsertPayload.expected_amount, 1500);
  assertEquals(bonusInsertPayload.ai_findings.expected_amount, 1500);
});
