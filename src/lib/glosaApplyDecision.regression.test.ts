import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideGlosaApplications } from "@/lib/glosaApplyDecision";

// Regressão dupla:
// 1) Guarda estática no fonte da edge — o gate "sem_producao" não pode voltar.
// 2) Guarda comportamental — a decisão pura nunca gera postponed por médico.
// Ver: mem://constraints/glosa-desconta-pj-nao-medico

const EDGE_PATH = resolve(
  __dirname,
  "../../supabase/functions/apply-company-deductions/index.ts",
);
const EDGE_SRC = readFileSync(EDGE_PATH, "utf8");

describe("REGRESSÃO — gate sem_producao NÃO pode voltar à edge apply-company-deductions", () => {
  it("edge não contém postpone_reason: 'sem_producao'", () => {
    // Aceitamos a string em comentários explicando o histórico, mas não como
    // valor de campo. Buscamos padrões de código que reinstalariam o gate.
    const padroesProibidos = [
      /postpone_reason\s*:\s*["']sem_producao["']/,
      /reason\s*:\s*["']sem_producao["']/,
      /"sem_producao"\s*[,}]/, // aparição em objeto/enum
    ];
    for (const rx of padroesProibidos) {
      expect(
        rx.test(EDGE_SRC),
        `Gate "sem_producao" reaparece no fonte da edge (padrão ${rx}). Ver mem://constraints/glosa-desconta-pj-nao-medico`,
      ).toBe(false);
    }
  });

  it("edge não filtra dívidas por doctorIdsComProducao (`.has(debt.doctor_id)`)", () => {
    // A construção que representava o gate:
    //   if (debt.doctor_id && !doctorIdsComProducao.has(debt.doctor_id)) { ... continue; }
    const rx = /doctorIdsComProducao\s*\.\s*has\s*\(/;
    expect(
      rx.test(EDGE_SRC),
      "Edge voltou a bifurcar por produção do médico. A glosa deve descontar da PJ.",
    ).toBe(false);
  });

  it("edge NÃO faz `.in('doctor_id', ...)` na query de glosa_debts", () => {
    // Impede o outro formato do bug: filtrar as próprias dívidas por médicos com produção.
    const rx = /from\(["']glosa_debts["']\)[\s\S]{0,400}\.in\(["']doctor_id["']/;
    expect(
      rx.test(EDGE_SRC),
      "Edge voltou a filtrar glosa_debts por doctor_id — quebra o invariante PJ.",
    ).toBe(false);
  });

  it("edge documenta explicitamente o invariante (comentário-âncora)", () => {
    // Guarda-chuva: se alguém remover o comentário, o teste pisca antes do bug voltar.
    expect(EDGE_SRC).toMatch(/NÃO bloqueamos por "médico sem produção no lote"/);
  });
});

describe("REGRESSÃO comportamental — decideGlosaApplications", () => {
  it("nenhum débito é bloqueado por ausência do médico, mesmo em lote sem produção nenhuma", () => {
    const debts = Array.from({ length: 25 }, (_, i) => ({
      id: `d${i}`,
      doctor_id: `medico-${i}`,
      total_debt: 1200,
      parcelas_default: 12,
    }));
    // capacidade suficiente pra tudo: 25 × 100 = 2500
    const { decisions } = decideGlosaApplications(debts, 2500, new Set());
    expect(decisions.every((d) => d.action === "proposto")).toBe(true);
  });

  it("mesmo com o Set vazio, todos os débitos concorrem à capacidade em vez de serem pulados", () => {
    const debts = [
      { id: "a", doctor_id: "m1", total_debt: 1200, parcelas_default: 12 },
      { id: "b", doctor_id: "m2", total_debt: 1200, parcelas_default: 12 },
      { id: "c", doctor_id: "m3", total_debt: 1200, parcelas_default: 12 },
    ];
    const { decisions } = decideGlosaApplications(debts, 250, new Set());
    // 100 + 100 + adiado (sem parcial) — nenhum "pulado por médico"
    expect(decisions.map((d) => d.action)).toEqual(["proposto", "proposto", "postponed"]);
  });

  it("passar médicos com produção NÃO altera o resultado (parâmetro é semanticamente inerte)", () => {
    const debts = [
      { id: "a", doctor_id: "m1", total_debt: 1200, parcelas_default: 12 },
      { id: "b", doctor_id: "m2", total_debt: 600,  parcelas_default: 6  },
    ];
    const sem = decideGlosaApplications(debts, 500, new Set());
    const com = decideGlosaApplications(debts, 500, new Set(["m1", "m2"]));
    const parcial = decideGlosaApplications(debts, 500, new Set(["m1"]));
    expect(sem).toEqual(com);
    expect(sem).toEqual(parcial);
  });
});
