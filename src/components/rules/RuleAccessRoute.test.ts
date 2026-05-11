import { describe, it, expect } from "vitest";
import { _test_only } from "../../supabase/functions/_shared/rulesEngine";

const { normAccessRoute } = _test_only;

describe("Normalização de Vias de Acesso", () => {
  it("deve normalizar 'Única ou Principal' e suas variações", () => {
    const variations = [
      "Única ou principal",
      "unica ou principal",
      "unica/principal",
      "1a via",
      "1ª via",
      "1 via",
      "1.a via",
      "unica",
      "principal",
      "PRIMEIRA VIA",
      "Unica / Principal"
    ];

    variations.forEach(v => {
      expect(normAccessRoute(v)).toBe("unica_principal");
    });
  });

  it("deve normalizar 'Mesma Via' e suas variações", () => {
    const variations = [
      "Mesma via de acesso",
      "mesma via",
      "mesma",
      "MESMA VIA",
      "repetida"
    ];

    variations.forEach(v => {
      expect(normAccessRoute(v)).toBe("mesma_via");
    });
  });

  it("deve normalizar 'Outra Via' e suas variações", () => {
    const variations = [
      "Via de acesso diferente",
      "outra via",
      "diferente",
      "OUTRA VIA",
      "via diferente",
      "2a via",
      "segunda via"
    ];

    variations.forEach(v => {
      expect(normAccessRoute(v)).toBe("outra_via");
    });
  });

  it("deve normalizar 'Sem Via' (Bônus/Complemento) e suas variações", () => {
    const variations = [
      "Sem via",
      "bonus",
      "complemento",
      "n/a",
      "nao se aplica",
      "null"
    ];

    variations.forEach(v => {
      expect(normAccessRoute(v)).toBe("sem_via");
    });
  });

  it("deve lidar com valores nulos ou vazios", () => {
    expect(normAccessRoute(null)).toBe("");
    expect(normAccessRoute(undefined)).toBe("");
    expect(normAccessRoute("")).toBe("");
  });
});
