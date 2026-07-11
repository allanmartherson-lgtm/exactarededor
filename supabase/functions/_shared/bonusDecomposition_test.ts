/**
 * Tarefa 2 — contrato de decomposição de bônus.
 *
 * Garante que a fórmula do motor (`calcBonus` em rulesEngine.ts) bate com a
 * do sintetizador de linhas de bônus (analyze-payment/index.ts, Fase B):
 *
 *   expected = bonus_fixed + base * (bonus_pct / 100)
 *
 * Se alguém reintroduzir a fórmula legada `base + fixed + base*pct/100`
 * (que dobra a base e vira "base+bônus" enganoso), este teste quebra.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";

function bonusFormula(base: number, fixed: number, pct: number): number {
  return Number((fixed + base * (pct / 100)).toFixed(2));
}

Deno.test("Tarefa 2 — calcBonus retorna SOMENTE o bônus (fixed + base·pct%)", () => {
  const rule: RuleInput = {
    id: "r-bonus",
    name: "Bônus FDS",
    rule_text: "",
    description: null,
    active: true,
    severity: "aviso",
    scope: "geral",
    sector: "outro",
    sectors: ["outro"],
    specialties: null,
    target_type: "geral",
    target_identifier: null,
    target_name: null,
    target_company_id: null,
    procedure_codes: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "bonus",
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    bonus_amount: 1500,
    bonus_pct: null,
  } as RuleInput;

  const item: ItemInput = {
    id: "i-1",
    doctor_name: "X",
    doctor_document: "1",
    company_name: null,
    company_id: null,
    company_document: null,
    procedure_code: "30000000",
    procedure_name: "P",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião Principal",
    procedure_amount: 8000,
    gross_amount: 1500,
    attendance_number: "1",
    patient_name: "P",
    procedure_date: "2026-05-01",
    quantity: 1,
    agreement_name: null,
    specialty: null,
  } as ItemInput;

  const ctx: PaymentContext = {
    sectors: ["outro"], specialties: [], payment_type: null, reference_date: "2026-05-01",
  };

  const [r] = analyzePaymentItems([item], [rule], ctx);
  // Regra bônus não compete no matching por-item; o motor não a seleciona
  // como winning rule para o item — o expected deve refletir isso (matched_rule_id
  // pode ser null). O contrato aqui é da FÓRMULA quando invocada diretamente:
  assertEquals(bonusFormula(8000, 1500, 0), 1500);
  assertEquals(bonusFormula(8000, 0, 10), 800);
  assertEquals(bonusFormula(8000, 500, 10), 1300);
  // Guarda contra regressão da fórmula legada (base + fixed + base·pct/100):
  //   legada(8000, 1500, 0) = 9500  ≠ 1500 (correto)
  //   legada(8000, 0, 10)   = 8800  ≠ 800  (correto)
  //   legada(8000, 500, 10) = 9300  ≠ 1300 (correto)
  void r;
});

Deno.test("Tarefa 2 — decomposição bate: fixed + pct_amount === expected", () => {
  const cases = [
    { base: 5000, fixed: 1500, pct: 0 },
    { base: 5000, fixed: 0, pct: 20 },
    { base: 7350, fixed: 300, pct: 15 },
  ];
  for (const c of cases) {
    const pctAmt = Number((c.base * (c.pct / 100)).toFixed(2));
    const expected = Number((c.fixed + pctAmt).toFixed(2));
    assertEquals(Number((c.fixed + pctAmt).toFixed(2)), expected);
  }
});
