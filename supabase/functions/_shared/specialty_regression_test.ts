/**
 * TESTES DE REGRESSÃO — leitura de especialidade pelo motor.
 *
 * Reproduzem casos REAIS em que o motor falhou em cruzar regras específicas
 * porque o cálculo exigia `match_by_specialty=true` e a resolução de
 * especialidade devolvia null. Cada cenário aqui mapeia para um bug já
 * corrigido — mantê-los garante que o sistema continue cruzando as regras
 * específicas no futuro.
 *
 * Pipeline simulado:
 *   1) `makeResolveMedicalSpecialty` resolve a especialidade do item a partir
 *      de (raw_data → specialty persistido → cadastro do médico).
 *   2) O motor `analyzePaymentItems` consome `item.specialty` já resolvido e
 *      escolhe o cálculo correto da regra.
 *
 * Os cenários aqui isolam a etapa (1), que é onde o motor "deixava de ler"
 * a especialidade em produção.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  makeResolveMedicalSpecialty,
  normDocKey,
  sheetSpecialtyFromRaw,
} from "./specialtyResolver.ts";
import {
  analyzePaymentItems,
  type ItemInput,
  type PaymentContext,
  type RuleInput,
} from "./rulesEngine.ts";

const CTX: PaymentContext = {
  sectors: ["outro"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-01-15",
};

/* ------------------------------------------------------------------ */
/* Fixtures: regra master com cálculos exigindo match_by_specialty.   */
/* ------------------------------------------------------------------ */

function rule(): RuleInput {
  return {
    id: "r-consultas",
    name: "Regra Geral - Repasse 100% Convênio",
    rule_text: "Consultas por especialidade",
    description: null,
    active: true,
    severity: "aviso",
    scope: "master",
    sector: "outro",
    sectors: [],
    specialties: null,
    target_type: null,
    target_identifier: null,
    target_name: null,
    target_company_id: null,
    procedure_codes: null,
    valid_from: null,
    valid_until: null,
    calculation_type: "valor_fixo",
    convenio_percentage: null,
    fixed_amount: null,
    package_amount: null,
    extras_codes: null,
    calculations: [
      {
        id: "calc-masto",
        sort_order: 0,
        label: "Mastologia",
        calculation_type: "valor_fixo",
        fixed_amount: 220,
        specialties: ["Mastologia"],
        match_by_specialty: true,
        procedure_codes: ["10101012"],
        code_match_mode: "whitelist",
      },
      {
        id: "calc-cardio",
        sort_order: 1,
        label: "Cardiologia",
        calculation_type: "valor_fixo",
        fixed_amount: 180,
        specialties: ["Cardiologia"],
        match_by_specialty: true,
        procedure_codes: ["10101012"],
        code_match_mode: "whitelist",
      },
    ],
  } as any;
}

function item(overrides: Partial<ItemInput> & { raw_data?: any } = {}): any {
  return {
    id: "i",
    doctor_name: "Karimi Da Silva Botelho Do Amaral",
    doctor_document: "12345",
    company_name: "CRAVEIRO E AMARAL",
    company_id: null,
    company_document: null,
    procedure_code: "10101012",
    procedure_name: "Consulta em consultório",
    description: null,
    access_route: null,
    doctor_role: "Cirurgião",
    procedure_amount: 220,
    gross_amount: 220,
    attendance_number: "1",
    patient_name: "P",
    procedure_date: "2026-01-10T10:00:00",
    quantity: 1,
    agreement_name: null,
    specialty: null,
    raw_data: null,
    ...overrides,
  };
}

/* ================================================================== */
/* BUG #1 — caixa diferente entre planilha e cadastro do médico       */
/* ================================================================== */
Deno.test("REGRESSÃO/Karimi — nome do médico em Title Case na planilha casa cadastro em minúsculas", () => {
  // Em produção: planilha "Karimi Da Silva Botelho Do Amaral" não casava
  // cadastro "Karimi da Silva Botelho do Amaral" porque o lookup era
  // case-sensitive (.in() do PostgREST). Cálculo de Mastologia era rejeitado.
  const doctorSpecsByName: Record<string, string[]> = {
    [normDocKey("Karimi da Silva Botelho do Amaral")]: ["Mastologia"],
  };
  const resolve = makeResolveMedicalSpecialty(doctorSpecsByName);

  const it = item({ doctor_name: "Karimi Da Silva Botelho Do Amaral", specialty: null });
  const resolved = resolve(it);

  assertEquals(resolved.value, "Mastologia");
  assertEquals(resolved.source, "doctor");

  // Pipeline completo: motor aplica regra de Mastologia.
  it.specialty = resolved.value;
  const out = analyzePaymentItems([it as ItemInput], [rule()], CTX);
  assertEquals(out[0].matched_rule_id, "r-consultas");
  assertEquals(out[0].expected_amount, 220);
});

/* ================================================================== */
/* BUG #2 — campo specialty nulo, mas raw_data tem "Especialidade"    */
/* ================================================================== */
Deno.test("REGRESSÃO/raw_data — planilha tem 'Especialidade Médico' e specialty persistido é null", () => {
  // Em produção: importação antiga não preencheu payment_items.specialty,
  // mas raw_data tinha "Especialidade Médico" = "Mastologia". O motor
  // ignorava raw_data e tratava o item como sem especialidade.
  const resolve = makeResolveMedicalSpecialty({});
  const it = item({
    specialty: null,
    raw_data: { "Especialidade Médico": "Mastologia", "Outro": "x" },
  });
  const resolved = resolve(it);

  assertEquals(resolved.value, "Mastologia");
  assertEquals(resolved.source, "planilha");

  it.specialty = resolved.value;
  const out = analyzePaymentItems([it as ItemInput], [rule()], CTX);
  assertEquals(out[0].expected_amount, 220);
});

/* ================================================================== */
/* BUG #3 — header alternativo (alias) da coluna de especialidade     */
/* ================================================================== */
Deno.test("REGRESSÃO/aliases — headers variantes ('Espec. Destino', 'Especialidade') são reconhecidos", () => {
  for (const header of ["Especialidade", "Espec. Destino", "ESPECIALIDADE MÉDICA"]) {
    const raw = { [header]: "Cardiologia" };
    assertEquals(
      sheetSpecialtyFromRaw(raw),
      "Cardiologia",
      `header '${header}' deveria ser reconhecido`,
    );
  }
});

/* ================================================================== */
/* BUG #4 — planilha vence cadastro quando ambos existem              */
/* ================================================================== */
Deno.test("REGRESSÃO/precedência — planilha vence cadastro (analista é fonte da verdade)", () => {
  const doctorSpecsByName: Record<string, string[]> = {
    [normDocKey("Dr. X")]: ["Cardiologia"],
  };
  const resolve = makeResolveMedicalSpecialty(doctorSpecsByName);
  const it = item({
    doctor_name: "Dr. X",
    specialty: null,
    raw_data: { Especialidade: "Mastologia" },
  });
  const resolved = resolve(it);
  // Planilha (Mastologia) deve vencer o cadastro (Cardiologia).
  assertEquals(resolved.value, "Mastologia");
  assertEquals(resolved.source, "planilha");
});

/* ================================================================== */
/* BUG #5 — médico com várias especialidades + planilha vazia         */
/* ================================================================== */
Deno.test("REGRESSÃO/ambiguidade — médico com múltiplas especialidades cadastradas e planilha vazia → null", () => {
  // Política: NÃO chutamos. Motor devolve null + alerta para o analista.
  const doctorSpecsByName: Record<string, string[]> = {
    [normDocKey("Dr. Multi")]: ["Mastologia", "Cardiologia"],
  };
  const resolve = makeResolveMedicalSpecialty(doctorSpecsByName);
  const it = item({ doctor_name: "Dr. Multi", specialty: null, raw_data: null });
  const resolved = resolve(it);
  assertEquals(resolved.value, null);
  assertEquals(resolved.source, "doctor_ambiguous");

  // Sem especialidade resolvida, nenhum cálculo casa → expected = null.
  it.specialty = null;
  const out = analyzePaymentItems([it as ItemInput], [rule()], CTX);
  assertEquals(out[0].expected_amount, null);
});

/* ================================================================== */
/* BUG #6 — sem cadastro e sem planilha → não inventa                 */
/* ================================================================== */
Deno.test("REGRESSÃO/sem chute — sem planilha e sem cadastro, resolver devolve null e cálculo não casa", () => {
  const resolve = makeResolveMedicalSpecialty({});
  const it = item({ doctor_name: "Dr. Desconhecido", specialty: null, raw_data: null });
  const resolved = resolve(it);
  assertEquals(resolved.value, null);
  assertEquals(resolved.source, "none");

  it.specialty = null;
  const out = analyzePaymentItems([it as ItemInput], [rule()], CTX);
  // Não pode inferir valor — produto exige null + alerta, nunca chute.
  assertEquals(out[0].expected_amount, null);
  const dump = JSON.stringify(out[0]);
  assert(/especialidade/i.test(dump), "trace deve mencionar 'especialidade'");
});

/* ================================================================== */
/* BUG #7 — lote real CRAVEIRO E AMARAL (Janeiro): 27 consultas Masto */
/* ================================================================== */
Deno.test("REGRESSÃO/lote real — 27 consultas Mastologia com nome em Title Case batem a regra", () => {
  // Mistura o caso do BUG #1 (caixa diferente) + volume típico do lote.
  // Antes da correção: todas caíam em sem_regra. Esperado: todas em
  // valor_fixo = 220.
  const doctorSpecsByName: Record<string, string[]> = {
    [normDocKey("Karimi da Silva Botelho do Amaral")]: ["Mastologia"],
  };
  const resolve = makeResolveMedicalSpecialty(doctorSpecsByName);
  const items: ItemInput[] = [];
  for (let i = 0; i < 27; i++) {
    const raw = item({
      id: `it-${i}`,
      doctor_name: "Karimi Da Silva Botelho Do Amaral",
      specialty: null,
      attendance_number: String(1000 + i),
    });
    raw.specialty = resolve(raw).value;
    items.push(raw as ItemInput);
  }
  const out = analyzePaymentItems(items, [rule()], CTX);
  assertEquals(out.length, 27);
  for (const r of out) {
    assertEquals(r.matched_rule_id, "r-consultas", `${r.item_id} sem regra`);
    assertEquals(r.expected_amount, 220, `${r.item_id} expected errado`);
    assert(String(r.status) !== "sem_regra", `${r.item_id} marcado sem_regra`);
  }
});

/* ================================================================== */
/* BUG #8 — toggle exige match: cálculo é descartado, fallback vence  */
/* ================================================================== */
Deno.test("REGRESSÃO/fallback — sem fallback na regra, item sem especialidade não pode receber valor", () => {
  // Garante que NÃO existe default escondido — confirma o invariante
  // do produto: "sem regra/match = sem valor, alerta para analista".
  const resolve = makeResolveMedicalSpecialty({});
  const it = item({ specialty: null, raw_data: null, doctor_name: "Anônimo" });
  it.specialty = resolve(it).value;
  const out = analyzePaymentItems([it as ItemInput], [rule()], CTX);
  assertEquals(out[0].expected_amount, null);
});
