
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
      active: true,
      scope: "especifica",
      target_type: "empresa",
      target_identifier: "12345678000199",
      procedure_codes: ["10101012"], // Código exemplo para CBHPM
      calculation_type: "valor_fixo",
      fixed_amount: 100, // R$ 100,00 base
      force_totalized: false, // DEVE multiplicar por quantidade
      sector: "procedimento",
      severity: "low"
    },
    {
      id: "rule-totalizada",
      name: "Acordo Tabela Totalizada",
      active: true,
      scope: "especifica",
      target_type: "empresa",
      target_identifier: "12345678000199",
      procedure_codes: ["20202024"], // Código exemplo para Tabela Pura
      calculation_type: "valor_fixo",
      fixed_amount: 500, // R$ 500,00 fixo (já contempla qtd)
      force_totalized: true, // DEVE IGNORAR quantidade
      sector: "procedimento",
      severity: "low"
    }
  ];

  // 2. Mock de Itens (Mesma empresa, lógicas diferentes)
  const items: ItemInput[] = [
    {
      id: "item-1-cbhpm",
      company_document: "12345678000199",
      procedure_code: "10101012",
      procedure_name: "PROCEDIMENTO CBHPM",
      gross_amount: 300, // Pago 300 (Esperado: 100 * 3 = 300)
      quantity: 3,
      doctor_name: "DR TESTE",
      doctor_document: "123",
      company_name: "INSTITUTO VERTEBRA",
      company_id: "comp-1",
      procedure_amount: 100
    },
    {
      id: "item-2-totalizado",
      company_document: "12345678000199",
      procedure_code: "20202024",
      procedure_name: "PROCEDIMENTO TABELA PURA",
      gross_amount: 500, // Pago 500 (Esperado: 500 fixo, ignorando qtd 2)
      quantity: 2,
      doctor_name: "DR TESTE",
      doctor_document: "123",
      company_name: "INSTITUTO VERTEBRA",
      company_id: "comp-1",
      procedure_amount: 500
    }
  ];

  const ctx: PaymentContext = {
    sectors: ["procedimento"],
    specialties: [],
    payment_type: "mensal",
    reference_date: "2026-05-12"
  };

  // 3. Execução: NOTA que convenio_value_totalized NÃO é passado (ou é false)
  const results = analyzePaymentItems(items, rules, ctx);

  // 4. Verificações
  const resCbhpm = results.find(r => r.item_id === "item-1-cbhpm")!;
  const resTotal = results.find(r => r.item_id === "item-2-totalizado")!;

  // Item 1: 100 * 3 = 300
  assertEquals(resCbhpm.expected_amount, 300, "CBHPM deveria multiplicar por quantidade");
  assertEquals(resCbhpm.status, "aprovado");

  // Item 2: 500 (fixo) ignorando qtd 2
  assertEquals(resTotal.expected_amount, 500, "Tabela totalizada deveria ignorar quantidade");
  assertEquals(resTotal.status, "aprovado");
  
  console.log("Testes de pagamento misto concluídos com sucesso!");
});
