
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { 
  analyzePaymentItems, 
  type ItemInput, 
  type RuleInput, 
  type PaymentContext 
} from "../_shared/rulesEngine.ts";

Deno.test("Motor de Regras: Deve suportar pagamentos mistos (CBHPM vs Totalizado) via configuração na regra", () => {
  // 1. Mock de Regras
  const rules: RuleInput[] = [
    {
      id: "rule-cbhpm",
      name: "Acordo CBHPM 1.5x",
      rule_text: "",
      active: true,
      scope: "especifica",
      target_type: "empresa",
      target_identifier: "12345678000199",
      procedure_codes: ["10101012"],
      calculation_type: "valor_fixo",
      fixed_amount: 100,
      force_totalized: false,
      sector: "procedimento",
      severity: "low",
      description: null,
      sectors: null,
      specialties: null,
      target_name: null,
      target_company_id: null,
      applies_payment_types: null,
      valid_from: null,
      valid_until: null,
      convenio_percentage: null,
      package_amount: null,
      extras_codes: null
    } as any,
    {
      id: "rule-totalizada",
      name: "Acordo Tabela Totalizada",
      rule_text: "",
      active: true,
      scope: "especifica",
      target_type: "empresa",
      target_identifier: "12345678000199",
      procedure_codes: ["20202024"],
      calculation_type: "valor_fixo",
      fixed_amount: 500,
      force_totalized: true,
      sector: "procedimento",
      severity: "low",
      description: null,
      sectors: null,
      specialties: null,
      target_name: null,
      target_company_id: null,
      applies_payment_types: null,
      valid_from: null,
      valid_until: null,
      convenio_percentage: null,
      package_amount: null,
      extras_codes: null
    } as any
  ];

  // 2. Mock de Itens
  const items: ItemInput[] = [
    {
      id: "item-1-cbhpm",
      company_document: "12345678000199",
      procedure_code: "10101012",
      procedure_name: "PROCEDIMENTO CBHPM",
      gross_amount: 300,
      quantity: 3,
      doctor_name: "DR TESTE",
      doctor_document: "123",
      company_name: "INSTITUTO VERTEBRA",
      company_id: "comp-1",
      procedure_amount: 100,
      description: null,
      access_route: null,
      doctor_role: null,
      attendance_number: null,
      patient_name: null,
      procedure_date: null
    } as any,
    {
      id: "item-2-totalizado",
      company_document: "12345678000199",
      procedure_code: "20202024",
      procedure_name: "PROCEDIMENTO TABELA PURA",
      gross_amount: 500,
      quantity: 2,
      doctor_name: "DR TESTE",
      doctor_document: "123",
      company_name: "INSTITUTO VERTEBRA",
      company_id: "comp-1",
      procedure_amount: 500,
      description: null,
      access_route: null,
      doctor_role: null,
      attendance_number: null,
      patient_name: null,
      procedure_date: null
    } as any
  ];

  const ctx: PaymentContext = {
    sectors: ["procedimento"],
    specialties: [],
    payment_type: "mensal",
    reference_date: "2026-05-12"
  };

  // 3. Execução
  const results = analyzePaymentItems(items, rules, ctx);

  // 4. Verificações
  const resCbhpm = results.find(r => r.item_id === "item-1-cbhpm")!;
  const resTotal = results.find(r => r.item_id === "item-2-totalizado")!;

  assertEquals(resCbhpm.expected_amount, 300, "CBHPM deveria multiplicar por quantidade");
  assertEquals(resCbhpm.status, "aprovado");

  assertEquals(resTotal.expected_amount, 500, "Tabela totalizada deveria ignorar quantidade");
  assertEquals(resTotal.status, "aprovado");
  
  console.log("Testes de pagamento misto concluídos com sucesso!");
});
