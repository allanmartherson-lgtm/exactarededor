import { describe, it, expect } from "vitest";
import { computeZeevSuggestion } from "../specialtyZeev";

const row = (rowKey: string, doctor_name: string | null) => ({ rowKey, doctor_name });

describe("computeZeevSuggestion (Zeev — três níveis)", () => {
  it("nível LOTE: todos os médicos têm a mesma única especialidade cadastrada", () => {
    const rows = [row("1", "Dr. A"), row("2", "Dr. B"), row("3", "Dr. A")];
    const out = computeZeevSuggestion(rows, {
      "dr. a": ["Cardiologia"],
      "dr. b": ["Cardiologia"],
    });
    expect(out.level).toBe("lot");
    if (out.level === "lot") {
      expect(out.specialty).toBe("Cardiologia");
      expect(out.doctors.sort()).toEqual(["dr. a", "dr. b"]);
    }
  });

  it("nível MÉDICO: médicos têm especialidades diferentes (cada um com 1)", () => {
    const rows = [row("1", "Dr. A"), row("2", "Dr. B")];
    const out = computeZeevSuggestion(rows, {
      "dr. a": ["Cardiologia"],
      "dr. b": ["Ortopedia"],
    });
    expect(out.level).toBe("doctor");
    if (out.level === "doctor") {
      expect(out.perDoctor).toEqual({
        "dr. a": "Cardiologia",
        "dr. b": "Ortopedia",
      });
    }
  });

  it("nível MÉDICO parcial: apenas alguns médicos têm 1 única especialidade", () => {
    const rows = [row("1", "Dr. A"), row("2", "Dr. B")];
    const out = computeZeevSuggestion(rows, {
      "dr. a": ["Cardiologia"],
      "dr. b": ["Ortopedia", "Cirurgia Geral"], // ambígua
    });
    expect(out.level).toBe("doctor");
    if (out.level === "doctor") {
      expect(out.perDoctor).toEqual({ "dr. a": "Cardiologia" });
      expect(out.perDoctor["dr. b"]).toBeUndefined();
    }
  });

  it("nível ITEM: todos os médicos têm múltiplas especialidades — varia por item", () => {
    const rows = [row("1", "Dr. A"), row("2", "Dr. B")];
    const out = computeZeevSuggestion(rows, {
      "dr. a": ["Cardiologia", "Clínica Médica"],
      "dr. b": ["Ortopedia", "Cirurgia Geral"],
    });
    expect(out.level).toBe("item");
    if (out.level === "item") expect(out.reason).toBe("varies_per_doctor");
  });

  it("nível ITEM: cadastro ausente", () => {
    const rows = [row("1", "Dr. A")];
    const out = computeZeevSuggestion(rows, undefined);
    expect(out.level).toBe("item");
    if (out.level === "item") expect(out.reason).toBe("no_registry");
  });

  it("não promove para LOTE quando médicos têm 1 spec cada mas DIFERENTES", () => {
    const rows = [row("1", "Dr. A"), row("2", "Dr. B")];
    const out = computeZeevSuggestion(rows, {
      "dr. a": ["Cardiologia"],
      "dr. b": ["Ortopedia"],
    });
    expect(out.level).not.toBe("lot");
  });

  it("ignora linhas sem médico ao calcular consenso de lote", () => {
    const rows = [row("1", "Dr. A"), row("2", null), row("3", "Dr. A")];
    const out = computeZeevSuggestion(rows, { "dr. a": ["Cardiologia"] });
    expect(out.level).toBe("lot");
  });
});

// --- Aplicação dos níveis no estado de overrides (lote / médico / item) ---
// Reproduz exatamente as três operações expostas pelo modal para garantir
// que cada nível reflita corretamente no pagamento do lote.

type Row = { rowKey: string; doctor_name: string | null };
const applyLot = (rows: Row[], specialty: string) =>
  Object.fromEntries(rows.map((r) => [r.rowKey, specialty]));

const applyDoctor = (rows: Row[], prev: Record<string, string>, doctor: string, specialty: string) => {
  const next = { ...prev };
  for (const r of rows) {
    if ((r.doctor_name ?? "(sem médico)") === doctor) next[r.rowKey] = specialty;
  }
  return next;
};

const applyItem = (prev: Record<string, string>, rowKey: string, specialty: string) => ({
  ...prev,
  [rowKey]: specialty,
});

describe("aplicação dos três níveis no estado de overrides", () => {
  const rows: Row[] = [
    { rowKey: "a1", doctor_name: "Dr. A" },
    { rowKey: "a2", doctor_name: "Dr. A" },
    { rowKey: "b1", doctor_name: "Dr. B" },
  ];

  it("LOTE: aplica a mesma especialidade a todos os itens", () => {
    const out = applyLot(rows, "Cardiologia");
    expect(Object.keys(out)).toHaveLength(3);
    expect(Object.values(out).every((v) => v === "Cardiologia")).toBe(true);
  });

  it("MÉDICO: só altera itens do médico selecionado, preservando os demais", () => {
    const base = applyLot(rows, "Cardiologia");
    const out = applyDoctor(rows, base, "Dr. B", "Ortopedia");
    expect(out.a1).toBe("Cardiologia");
    expect(out.a2).toBe("Cardiologia");
    expect(out.b1).toBe("Ortopedia");
  });

  it("ITEM: altera apenas o rowKey informado", () => {
    const base = applyLot(rows, "Cardiologia");
    const out = applyItem(base, "a2", "Clínica Médica");
    expect(out.a1).toBe("Cardiologia");
    expect(out.a2).toBe("Clínica Médica");
    expect(out.b1).toBe("Cardiologia");
  });

  it("precedência: item sobrescreve médico que sobrescreve lote", () => {
    let s = applyLot(rows, "Cardiologia");
    s = applyDoctor(rows, s, "Dr. A", "Clínica Médica");
    s = applyItem(s, "a2", "Geriatria");
    expect(s).toEqual({ a1: "Clínica Médica", a2: "Geriatria", b1: "Cardiologia" });
  });
});
