import { describe, it, expect } from "vitest";
import { buildReclassifyPatch } from "@/lib/reclassifyItemType";

// IDs sintéticos baseados no catálogo real de item_types
const CONSULTA = { id: "consulta-id", label: "Consulta", tuss_default: "10101012" };
const PARECER = { id: "parecer-id", label: "Parecer Adulto", tuss_default: "10102019" };
const VISITA = { id: "visita-id", label: "Visita", tuss_default: "10102019" };
const PROCEDIMENTO = { id: "proc-id", label: "Procedimento", tuss_default: null };
const SADT = { id: "sadt-id", label: "Exames SADT", tuss_default: null };
const CIRURGIA = { id: "cir-id", label: "Cirurgia", tuss_default: null };

// raw_data espelha exatamente o que o parser grava: colunas originais da
// planilha + flags __tuss_default_applied / __procedure_name_defaulted quando
// o tipo do lote (ex: Consulta) sobrescreveu procedure_code/name.
const rawConsultaImputada = {
  Atendimento: 8867694,
  "Código TUSS": 40601137,
  Produto: "Procedimento Diagnóstico Em Citopatologia Cérvico-Vaginal Oncótica",
  "Especialidade Médico": "Ginecologia e Obstetrícia",
  __tuss_default_applied: "10101012",
  __procedure_name_defaulted: "Consulta - Ginecologia e Obstetrícia",
};

const itemConsultaImputada = {
  id: "item-1",
  raw_data: rawConsultaImputada,
};

describe("buildReclassifyPatch — Consulta imputada → tipo dinâmico", () => {
  it("restaura procedure_code original da planilha ao virar Procedimento", () => {
    const patch = buildReclassifyPatch(itemConsultaImputada, PROCEDIMENTO, "Procedimento");
    expect(patch.procedure_code).toBe("40601137");
    expect(patch.procedure_code).not.toBe("10101012"); // não pode voltar Consulta
  });

  it("restaura procedure_name original da planilha (campo Produto)", () => {
    const patch = buildReclassifyPatch(itemConsultaImputada, PROCEDIMENTO, "Procedimento");
    expect(patch.procedure_name).toBe(
      "Procedimento Diagnóstico Em Citopatologia Cérvico-Vaginal Oncótica",
    );
    expect(patch.procedure_name).not.toMatch(/^Consulta/);
  });

  it("também restaura ao virar SADT ou Cirurgia (tipos dinâmicos sem tuss_default)", () => {
    for (const target of [SADT, CIRURGIA]) {
      const patch = buildReclassifyPatch(itemConsultaImputada, target, target.label);
      expect(patch.procedure_code).toBe("40601137");
      expect(patch.procedure_name).toBe(
        "Procedimento Diagnóstico Em Citopatologia Cérvico-Vaginal Oncótica",
      );
    }
  });

  it("seta item_type_id, item_type_source=manual e reseta estado de IA", () => {
    const patch = buildReclassifyPatch(itemConsultaImputada, PROCEDIMENTO, "Procedimento");
    expect(patch.item_type_id).toBe(PROCEDIMENTO.id);
    expect(patch.item_type_source).toBe("manual");
    expect(patch.ai_status).toBe("pendente");
    expect(patch.ai_findings).toBeNull();
    expect(patch.package_absorbed).toBe(false);
    expect(patch.package_absorbed_calc_id).toBeNull();
  });
});

describe("buildReclassifyPatch — tipo dinâmico sem flags de imputação", () => {
  it("não sobrescreve procedure_code/name quando raw_data não foi imputado", () => {
    const item = {
      id: "item-2",
      raw_data: {
        "Código TUSS": "40601137",
        Produto: "Procedimento Diagnóstico Em Citopatologia",
        // sem __tuss_default_applied / __procedure_name_defaulted
      },
    };
    const patch = buildReclassifyPatch(item, PROCEDIMENTO, "Procedimento");
    expect(patch.procedure_code).toBeUndefined();
    expect(patch.procedure_name).toBeUndefined();
  });

  it("lida com raw_data ausente sem quebrar", () => {
    const patch = buildReclassifyPatch({ id: "x" }, PROCEDIMENTO, "Procedimento");
    expect(patch.item_type_id).toBe(PROCEDIMENTO.id);
    expect(patch.procedure_code).toBeUndefined();
    expect(patch.procedure_name).toBeUndefined();
  });
});

describe("buildReclassifyPatch — tipos fixos forçam tuss_default", () => {
  it("ao virar Consulta, força procedure_code = tuss_default da Consulta", () => {
    const item = {
      id: "item-3",
      raw_data: {
        "Código TUSS": "40601137",
        Produto: "Algo qualquer",
        "Especialidade Médico": "Cardiologia",
      },
    };
    const patch = buildReclassifyPatch(item, CONSULTA, "Consulta");
    expect(patch.procedure_code).toBe("10101012");
    expect(patch.procedure_name).toBe("Consulta - Cardiologia");
  });

  it("ao virar Visita, marca reclassified_from_parecer e injeta nota", () => {
    const patch = buildReclassifyPatch(itemConsultaImputada, VISITA, "Visita");
    expect(patch.reclassified_from_parecer).toBe(true);
    expect(patch.manual_intervention_notes).toMatch(/Visita/);
    expect(patch.procedure_code).toBe("10102019");
  });

  it("Parecer Adulto usa label como prefixo do procedure_name", () => {
    const item = {
      id: "item-4",
      raw_data: { "Especialidade Médico": "Pediatria" },
    };
    const patch = buildReclassifyPatch(item, PARECER, "Parecer Adulto");
    expect(patch.procedure_code).toBe("10102019");
    expect(patch.procedure_name).toBe("Parecer Adulto - Pediatria");
  });

  it("sem coluna de especialidade, procedure_name vira só o label", () => {
    const patch = buildReclassifyPatch({ id: "x", raw_data: {} }, CONSULTA, "Consulta");
    expect(patch.procedure_name).toBe("Consulta");
  });
});

describe("buildReclassifyPatch — variações de chaves no raw_data", () => {
  it("aceita 'codigo tuss' sem acento e 'Descrição' como fallback", () => {
    const item = {
      id: "item-5",
      raw_data: {
        "codigo tuss": "30912014",
        "Descrição": "Tomografia computadorizada",
        __tuss_default_applied: "10101012",
      },
    };
    const patch = buildReclassifyPatch(item, PROCEDIMENTO, "Procedimento");
    expect(patch.procedure_code).toBe("30912014");
    expect(patch.procedure_name).toBe("Tomografia computadorizada");
  });

  it("ignora valores vazios e segue procurando", () => {
    const item = {
      id: "item-6",
      raw_data: {
        "Código TUSS": "   ",
        tuss: "40601137",
        Produto: "",
        Descrição: "Citopatologia",
        __procedure_name_defaulted: "Consulta - X",
      },
    };
    const patch = buildReclassifyPatch(item, SADT, "Exames SADT");
    expect(patch.procedure_code).toBe("40601137");
    expect(patch.procedure_name).toBe("Citopatologia");
  });
});
