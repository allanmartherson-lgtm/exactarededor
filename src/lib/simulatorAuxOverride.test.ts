import { describe, it, expect } from "vitest";
import {
  applyHistoricalAuxOverride,
  isAuxRole,
  isPrincipalRole,
  type OverrideItem,
  type SimPerItemMinimal,
} from "./simulatorAuxOverride";

// ---------------------------------------------------------------------------
// Regressão do bug encontrado no atendimento 9147517 (planilha exportada):
// "Primeiro Aux", "Segundo Aux", "Terceiro Aux" NÃO eram reconhecidos como
// auxiliares (regex antiga `/auxili/` exigia "auxili"), então o override
// histórico nunca disparava e o simulado dos auxiliares ficava igual ao do
// cirurgião principal.
// ---------------------------------------------------------------------------

describe("normalização de funções (roles)", () => {
  it("reconhece 'Cirurgião Principal' e variantes", () => {
    expect(isPrincipalRole("Cirurgião Principal")).toBe(true);
    expect(isPrincipalRole("Cirurgião")).toBe(true);
    expect(isPrincipalRole("Cirurgião Único")).toBe(true);
    expect(isPrincipalRole("CIRURGIAO UNICO")).toBe(true);
    expect(isPrincipalRole("Cirurgiao")).toBe(true);
  });

  it("reconhece formas curtas de auxiliar do Tasy (bug 9147517)", () => {
    expect(isAuxRole("Primeiro Aux")).toBe(true);
    expect(isAuxRole("Segundo Aux")).toBe(true);
    expect(isAuxRole("Terceiro Aux")).toBe(true);
    expect(isAuxRole("Quarto Aux")).toBe(true);
    expect(isAuxRole("Aux")).toBe(true);
  });

  it("reconhece formas completas de auxiliar", () => {
    expect(isAuxRole("Primeiro Auxiliar")).toBe(true);
    expect(isAuxRole("Auxiliar")).toBe(true);
    expect(isAuxRole("AUXILIARES")).toBe(true);
  });

  it("reconhece instrumentador como auxiliar (não recebe 100%)", () => {
    expect(isAuxRole("Instrumentador")).toBe(true);
    expect(isAuxRole("INSTRUMENTADORA")).toBe(true);
  });

  it("principal e aux são mutuamente exclusivos", () => {
    expect(isPrincipalRole("Primeiro Aux")).toBe(false);
    expect(isPrincipalRole("Primeiro Auxiliar")).toBe(false);
    expect(isPrincipalRole("Instrumentador")).toBe(false);
    expect(isAuxRole("Cirurgião Principal")).toBe(false);
    expect(isAuxRole("Cirurgião Único")).toBe(false);
  });

  it("papéis desconhecidos ou vazios não classificam", () => {
    expect(isPrincipalRole(null)).toBe(false);
    expect(isPrincipalRole("")).toBe(false);
    expect(isAuxRole(null)).toBe(false);
    expect(isAuxRole("Anestesista")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cenário real: atendimento 9147517 — Dr. Abner (principal) + auxiliares.
// Fonte: planilha exportada pelo usuário (simulador_Abner_Walysson_Alberti_
// 2026-2.xlsx) que expôs o bug de valor idêntico ao principal.
// ---------------------------------------------------------------------------

/** Helper para montar perItem antes do override — todos com o valor do principal
 *  (é exatamente o que o motor real devolve hoje com a regra sintética). */
function seedPerItemFromPrincipal(
  items: OverrideItem[],
  simPrincipalByGroup: Record<string, number>,
): Record<string, SimPerItemMinimal> {
  const out: Record<string, SimPerItemMinimal> = {};
  for (const it of items) {
    const key = `${it.attendance_number ?? ""}|${it.procedure_code ?? ""}`;
    out[it.id] = {
      expected_amount: simPrincipalByGroup[key] ?? 0,
      matched: true,
      calculation_type_used: "tabela_diferenciada",
      alerts: [],
    };
  }
  return out;
}

describe("applyHistoricalAuxOverride — atendimento 9147517", () => {
  it("Dr. Diogo (1º Aux, TUSS 30724058) recebe 30% do simulado do principal", () => {
    const items: OverrideItem[] = [
      {
        id: "abner-058",
        attendance_number: "9147517",
        procedure_code: "30724058",
        doctor_role: "Cirurgião Principal",
        gross_amount: 3257.58,
      },
      {
        id: "diogo-058",
        attendance_number: "9147517",
        procedure_code: "30724058",
        doctor_role: "Primeiro Aux",
        gross_amount: 977.27,
      },
      {
        id: "eduardo-058",
        attendance_number: "9147517",
        procedure_code: "30724058",
        doctor_role: "Terceiro Aux",
        gross_amount: 651.52,
      },
    ];
    // Motor real devolve 3257.58 para TODOS os itens do grupo (bug conhecido).
    const perItem = seedPerItemFromPrincipal(items, { "9147517|30724058": 3257.58 });

    const ajustes = applyHistoricalAuxOverride(items, perItem);

    expect(ajustes).toHaveLength(2);
    // Ratio Diogo = 977.27 / 3257.58 ≈ 0.30
    expect(perItem["diogo-058"].expected_amount).toBeCloseTo(977.27, 2);
    // Ratio Eduardo = 651.52 / 3257.58 ≈ 0.20
    expect(perItem["eduardo-058"].expected_amount).toBeCloseTo(651.52, 2);
    // Principal NÃO é ajustado.
    expect(perItem["abner-058"].expected_amount).toBeCloseTo(3257.58, 2);
    // Alerta anexado.
    expect(perItem["diogo-058"].alerts.some((a) => a.includes("30.0%"))).toBe(true);
    expect(perItem["eduardo-058"].alerts.some((a) => a.includes("20.0%"))).toBe(true);
  });

  it("Willdenberg (Segundo Aux, TUSS 30724236) recebe ~15% do simulado do principal", () => {
    // Principal Abner: gross 1337.13 | sim 1337.13
    // Aux Willdenberg: gross 200.69 → ratio ≈ 0.1501
    const items: OverrideItem[] = [
      {
        id: "abner-236",
        attendance_number: "9147517",
        procedure_code: "30724236",
        doctor_role: "Cirurgião Principal",
        gross_amount: 1337.13,
      },
      {
        id: "will-236",
        attendance_number: "9147517",
        procedure_code: "30724236",
        doctor_role: "Segundo Aux",
        gross_amount: 200.69,
      },
    ];
    const perItem = seedPerItemFromPrincipal(items, { "9147517|30724236": 1337.13 });
    applyHistoricalAuxOverride(items, perItem);
    const expected = (200.69 / 1337.13) * 1337.13;
    expect(perItem["will-236"].expected_amount).toBeCloseTo(expected, 2);
    expect(perItem["will-236"].expected_amount).toBeCloseTo(200.69, 2);
  });

  it("aux sem principal no grupo não é ajustado (mantém motor)", () => {
    const items: OverrideItem[] = [
      {
        id: "diogo-orphan",
        attendance_number: "9999999",
        procedure_code: "31403123",
        doctor_role: "Primeiro Aux",
        gross_amount: 120.9,
      },
    ];
    const perItem: Record<string, SimPerItemMinimal> = {
      "diogo-orphan": {
        expected_amount: 402.99,
        matched: true,
        calculation_type_used: "tabela_diferenciada",
        alerts: [],
      },
    };
    const ajustes = applyHistoricalAuxOverride(items, perItem);
    expect(ajustes).toHaveLength(0);
    expect(perItem["diogo-orphan"].expected_amount).toBeCloseTo(402.99, 2);
  });

  it("ratio implausível (aux pago mais que principal) mantém valor do motor", () => {
    const items: OverrideItem[] = [
      {
        id: "p",
        attendance_number: "A",
        procedure_code: "X",
        doctor_role: "Cirurgião Principal",
        gross_amount: 100,
      },
      {
        id: "a",
        attendance_number: "A",
        procedure_code: "X",
        doctor_role: "Primeiro Aux",
        gross_amount: 500, // > principal (dado sujo)
      },
    ];
    const perItem = seedPerItemFromPrincipal(items, { "A|X": 100 });
    const ajustes = applyHistoricalAuxOverride(items, perItem);
    expect(ajustes).toHaveLength(0);
    expect(perItem["a"].expected_amount).toBeCloseTo(100, 2); // motor mantido
  });

  it("principal com gross zero (sem histórico útil) — não ajusta auxiliares", () => {
    const items: OverrideItem[] = [
      {
        id: "p",
        attendance_number: "A",
        procedure_code: "X",
        doctor_role: "Cirurgião Principal",
        gross_amount: 0,
      },
      {
        id: "a",
        attendance_number: "A",
        procedure_code: "X",
        doctor_role: "Primeiro Aux",
        gross_amount: 30,
      },
    ];
    const perItem = seedPerItemFromPrincipal(items, { "A|X": 1000 });
    const ajustes = applyHistoricalAuxOverride(items, perItem);
    expect(ajustes).toHaveLength(0);
  });

  it("cenário completo do 9147517 — 3 TUSS, 5 auxiliares corrigidos", () => {
    // Snapshot fiel da planilha exportada:
    //   TUSS 30724058 — Abner (P) 3257.58 | Diogo (1º Aux) 977.27 | Eduardo (3º Aux) 651.52
    //   TUSS 30724236 — Abner (P) 1337.13 | Willdenberg (2º Aux) 200.69
    //   TUSS 30724244 — Abner (P) 1405.52 | Diogo (1º Aux) 421.66 | Willdenberg (2º Aux) 201.65
    const items: OverrideItem[] = [
      { id: "058-p", attendance_number: "9147517", procedure_code: "30724058", doctor_role: "Cirurgião Principal", gross_amount: 3257.58 },
      { id: "058-a1", attendance_number: "9147517", procedure_code: "30724058", doctor_role: "Primeiro Aux", gross_amount: 977.27 },
      { id: "058-a3", attendance_number: "9147517", procedure_code: "30724058", doctor_role: "Terceiro Aux", gross_amount: 651.52 },
      { id: "236-p", attendance_number: "9147517", procedure_code: "30724236", doctor_role: "Cirurgião Principal", gross_amount: 1337.13 },
      { id: "236-a2", attendance_number: "9147517", procedure_code: "30724236", doctor_role: "Segundo Aux", gross_amount: 200.69 },
      { id: "244-p", attendance_number: "9147517", procedure_code: "30724244", doctor_role: "Cirurgião Principal", gross_amount: 1405.52 },
      { id: "244-a1", attendance_number: "9147517", procedure_code: "30724244", doctor_role: "Primeiro Aux", gross_amount: 421.66 },
      { id: "244-a2", attendance_number: "9147517", procedure_code: "30724244", doctor_role: "Segundo Aux", gross_amount: 201.65 },
    ];
    const perItem = seedPerItemFromPrincipal(items, {
      "9147517|30724058": 3257.58,
      "9147517|30724236": 1337.13,
      "9147517|30724244": 1405.52,
    });
    const ajustes = applyHistoricalAuxOverride(items, perItem);
    // 5 auxiliares corrigidos, 3 principais intactos.
    expect(ajustes).toHaveLength(5);
    // Cada auxiliar deve casar EXATAMENTE seu gross histórico (ratio × principalSim onde principalSim == principalReal).
    expect(perItem["058-a1"].expected_amount).toBeCloseTo(977.27, 2);
    expect(perItem["058-a3"].expected_amount).toBeCloseTo(651.52, 2);
    expect(perItem["236-a2"].expected_amount).toBeCloseTo(200.69, 2);
    expect(perItem["244-a1"].expected_amount).toBeCloseTo(421.66, 2);
    expect(perItem["244-a2"].expected_amount).toBeCloseTo(201.65, 2);
    expect(perItem["058-p"].expected_amount).toBeCloseTo(3257.58, 2);
    expect(perItem["236-p"].expected_amount).toBeCloseTo(1337.13, 2);
    expect(perItem["244-p"].expected_amount).toBeCloseTo(1405.52, 2);
  });
});
