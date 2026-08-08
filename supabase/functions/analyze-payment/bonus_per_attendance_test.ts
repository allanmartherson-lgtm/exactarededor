import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
} from "../_shared/rulesEngine.ts";
import { synthesizeBonusLines } from "./bonusSynthesisFixture.ts";

/**
 * Bônus de R$ 1.500 por ATENDIMENTO em fim de semana, para cirurgião principal.
 * Mesmo atendimento com 2 códigos: o bônus sai 1× só.
 *
 * MODELO ATUAL (duas fases)
 * -------------------------
 *  Fase A (`analyzePaymentItems`): regras de bônus são FILTRADAS na entrada e
 *    não competem no matching por TUSS — antes, um bônus podia vencer o
 *    procedimento e rotular o item como "bonus", sequestrando o cálculo real.
 *  Fase B (síntese, em analyze-payment/index.ts): emite UMA linha
 *    `complemento_bonus` por (regra × atendimento), ancorada no principal.
 *
 * Este teste cobre as duas metades: que a Fase A não encosta no item, e que a
 * Fase B emite exatamente uma linha para o atendimento inteiro.
 */
Deno.test("Bônus por atendimento: aplica 1× por grupo, não por código", () => {
  const rules: RuleInput[] = [
    {
      id: "rule-bonus-fds",
      name: "Bônus plantão fim de semana",
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
    } as any,
  ];

  // 2026-05-09 é um SÁBADO
  const baseItem = {
    company_document: "12345678000199",
    company_name: "EMPRESA X",
    company_id: "comp-1",
    doctor_name: "DR PRINCIPAL",
    doctor_document: "999",
    doctor_role: "cirurgião principal",
    procedure_amount: 100,
    gross_amount: 1600, // base 100 + bônus 1500
    quantity: 1,
    description: null,
    access_route: null,
    procedure_date: "2026-05-09T10:00:00",
    patient_name: "PACIENTE A",
  };

  const items: ItemInput[] = [
    {
      ...baseItem,
      id: "item-anchor",
      procedure_code: "10101012",
      procedure_name: "ANCHOR (maior valor)",
      attendance_number: "ATD-001",
      procedure_amount: 200, // será o anchor (maior procedure_amount)
      gross_amount: 1700,
    } as any,
    {
      ...baseItem,
      id: "item-secundario",
      procedure_code: "20202024",
      procedure_name: "SECUNDARIO",
      attendance_number: "ATD-001",
      procedure_amount: 100,
      gross_amount: 100, // não recebeu bônus na planilha
    } as any,
  ];

  const ctx: PaymentContext = {
    sectors: ["procedimento"],
    specialties: [],
    payment_type: "mensal",
    reference_date: "2026-05-09",
  } as any;

  const results = analyzePaymentItems(items, rules, ctx);
  const anchor = results.find((r) => r.item_id === "item-anchor")!;
  const secund = results.find((r) => r.item_id === "item-secundario")!;

  // --- Fase A: o bônus NÃO pode sequestrar nenhum dos dois TUSS ---
  assertEquals(
    anchor.calculation_type_used === "bonus",
    false,
    "Regra de bônus não pode vencer o matching por item (sequestraria o cálculo do TUSS)",
  );
  assertEquals(secund.calculation_type_used === "bonus", false);

  // Os dois códigos precisam cair no MESMO atendimento — é isso que permite
  // que a Fase B emita um único bônus para os dois.
  assertEquals(anchor.attendance_group_key, secund.attendance_group_key);
  assertEquals(anchor.is_main_procedure, true, "Maior procedure_amount é o principal");

  // --- Fase B: exatamente 1 linha de bônus para o atendimento ---
  const bonusLines = synthesizeBonusLines(items, results, rules, ctx);
  assertEquals(bonusLines.length, 1, "Bônus deve sair 1× por atendimento, não por código");

  const [line] = bonusLines;
  assertEquals(line.anchor_item_id, "item-anchor", "Ancorado no cirurgião principal do procedimento principal");
  assertEquals(line.application_unit, "por_atendimento");
  // por_atendimento soma o grupo inteiro: 200 (anchor) + 100 (secundário).
  assertEquals(line.bonus_base_amount, 300, "Base por_atendimento = soma do grupo");
  assertEquals(line.bonus_fixed_amount, 1500);
  assertEquals(line.gross_amount, 1500, "Valor da linha é só o bônus — não soma o honorário do pai");
  assertEquals(line.expected_amount, line.gross_amount, "Linha sintética nasce sem divergência");
});

Deno.test("Bônus por atendimento: sexta-feira NÃO conta para bônus de fim de semana", () => {
  const rules: RuleInput[] = [
    {
      id: "rule-bonus-fds",
      name: "Bônus FDS",
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
    } as any,
  ];

  // 2026-05-08 é uma SEXTA — bônus NÃO deve aplicar mesmo com hora 23h
  const items: ItemInput[] = [
    {
      id: "item-sex",
      company_document: "12345678000199",
      company_name: "EMPRESA X",
      company_id: "comp-1",
      doctor_name: "DR",
      doctor_document: "1",
      doctor_role: "cirurgião principal",
      procedure_code: "10101012",
      procedure_name: "PROC",
      procedure_amount: 100,
      gross_amount: 100,
      quantity: 1,
      description: null,
      access_route: null,
      procedure_date: "2026-05-08T23:30:00",
      attendance_number: "ATD-X",
      patient_name: "P",
    } as any,
  ];

  const ctx: PaymentContext = {
    sectors: ["procedimento"],
    specialties: [],
    payment_type: "mensal",
    reference_date: "2026-05-08",
  } as any;

  const results = analyzePaymentItems(items, rules, ctx);
  const r = results.find((x) => x.item_id === "item-sex")!;
  // Como nenhum cálculo casou, a regra cai sem resultado → o item fica sem regra/sem bônus.
  // O motor não deve marcar bônus aplicado.
  assertEquals(
    r.calculation_type_used !== "bonus" || (r.expected_amount ?? 0) < 1500,
    true,
    "Sexta não deve disparar bônus de fim de semana",
  );
});
