
import { 
  analyzePaymentItems, 
  type ItemInput, 
  type RuleInput, 
  type PaymentContext 
} from "./_shared/rulesEngine.ts";

const item: ItemInput = {
  id: "test-item",
  doctor_name: "Victor Hugo Espindola Soares Ala",
  doctor_document: "",
  company_name: "DF NEURO LTDA",
  company_id: "cec344d9-37ed-4466-bcaa-39599afa2161",
  procedure_code: "40812057",
  procedure_name: "Teste",
  description: "Teste",
  access_route: "Via de acesso diferente",
  doctor_role: "Cirurgião Principal",
  procedure_amount: 1000,
  gross_amount: 2000,
  procedure_date: "2026-03-23T00:00:00Z",
  sector: "hemodinamica"
};

const rule: RuleInput = {
  id: "3755c64c-79d6-49dc-9c36-59b3c8dc5264",
  name: "Neurovascular - Repasse 200% Procedimentos Hemodinâmica",
  rule_text: "",
  description: "",
  active: true,
  severity: "bloqueio",
  scope: "grupo",
  sectors: null,
  specialties: null,
  target_type: null,
  target_identifier: null,
  target_name: null,
  target_company_id: null,
  procedure_codes: null,
  valid_from: "2026-01-01",
  valid_until: null,
  calculation_type: "valor_fixo",
  convenio_percentage: null,
  fixed_amount: null,
  package_amount: null,
  extras_codes: null,
  group_company_links: [
    { 
      company_id: "cec344d9-37ed-4466-bcaa-39599afa2161", 
      doctors: [{ name: "Victor Hugo Espindola Soares Ala", crm: "" }] 
    }
  ],
  group_doctors: [],
  calculations: [
    {
      id: "86bd31a3-271b-4f00-a8b1-03b41b149cba",
      label: "Regra Dobra",
      calculation_type: "percentual_sobre_convenio",
      procedure_codes: ["40812057"],
      sectors: ["Hemodinâmica", "Cirurgia"],
      elective_mode: "qualquer"
    }
  ]
};

const ctx: PaymentContext = {
  sectors: ["hemodinamica"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-05-14"
};

const results = analyzePaymentItems([item], [rule], ctx);
console.log(JSON.stringify(results, null, 2));
