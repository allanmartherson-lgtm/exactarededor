import { describe, it, expect } from "vitest";
import { summarizeUnresolvedDoctors } from "@/lib/unresolvedDoctorGate";

describe("summarizeUnresolvedDoctors", () => {
  it("acusa pendência quando há nome de médico mas doctor_id nulo", () => {
    const summary = summarizeUnresolvedDoctors([
      { doctor_name: "JAIRO DE BARROS", gross_amount: 1000, _resolution: { doctor_id: null } },
      { doctor_name: "jairo de barros", gross_amount: 500, _resolution: { doctor_id: null } },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.amount).toBe(1500);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0]).toMatchObject({ name: "JAIRO DE BARROS", count: 2, amount: 1500 });
  });

  it("não acusa pendência quando o médico resolveu (cadastro ou apelido)", () => {
    const summary = summarizeUnresolvedDoctors([
      { doctor_name: "ERICA FUKUSHIMA", gross_amount: 800, _resolution: { doctor_id: "uuid-1" } },
    ]);

    expect(summary.count).toBe(0);
    expect(summary.groups).toEqual([]);
  });

  it("ignora linhas sem nome de médico (ex.: linhas só de paciente)", () => {
    const summary = summarizeUnresolvedDoctors([
      { doctor_name: "   ", gross_amount: 300, _resolution: { doctor_id: null } },
      { doctor_name: null, gross_amount: 300, _resolution: { doctor_id: null } },
    ]);

    expect(summary.count).toBe(0);
  });

  it("ignora linhas ainda sem resolução calculada (cadastros carregando)", () => {
    const summary = summarizeUnresolvedDoctors([
      { doctor_name: "ALGUÉM", gross_amount: 100, _resolution: null },
      { doctor_name: "ALGUÉM", gross_amount: 100 },
    ]);

    expect(summary.count).toBe(0);
  });

  it("trata valor ausente ou inválido como zero, sem perder a contagem", () => {
    const summary = summarizeUnresolvedDoctors([
      { doctor_name: "SEM VALOR", gross_amount: null, _resolution: { doctor_id: null } },
      { doctor_name: "SEM VALOR", gross_amount: "-", _resolution: { doctor_id: null } },
      { doctor_name: "SEM VALOR", gross_amount: "250.5", _resolution: { doctor_id: null } },
    ]);

    expect(summary.count).toBe(3);
    expect(summary.amount).toBe(250.5);
  });

  it("ordena grupos por quantidade de linhas, do maior para o menor", () => {
    const summary = summarizeUnresolvedDoctors([
      { doctor_name: "A", gross_amount: 10, _resolution: { doctor_id: null } },
      { doctor_name: "B", gross_amount: 10, _resolution: { doctor_id: null } },
      { doctor_name: "B", gross_amount: 10, _resolution: { doctor_id: null } },
    ]);

    expect(summary.groups.map((g) => g.name)).toEqual(["B", "A"]);
  });
});
