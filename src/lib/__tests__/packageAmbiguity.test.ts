import { describe, it, expect } from "vitest";
import {
  rankAnchorsByAccessRoute,
  findPackagesWithoutAnchor,
  type AnchorCandidate,
  type PkgCalc,
} from "../../../supabase/functions/_shared/packagePicker";

function calc(over: { id: string; main: string[]; included?: string[]; scope?: string; companies?: string[] }): PkgCalc {
  return {
    rule_id: `rule-${over.id}`,
    rule_name: `Regra ${over.id}`,
    calc_id: over.id,
    package_main_codes: over.main,
    package_included_codes: over.included ?? [],
    package_amount: 10000,
    package_roles_distribution: null,
    rule_company_ids: new Set(over.companies ?? []),
    rule_scope: over.scope ?? "master",
  };
}

function cand(id: string, code: string, routeKey: string): AnchorCandidate {
  return { calc: calc({ id, main: [code] }), triggerCode: code, includedFound: [], routeKey };
}

describe("rankAnchorsByAccessRoute — caso THORAX", () => {
  it("candidato único sempre vence", () => {
    const r = rankAnchorsByAccessRoute([cand("a", "30803217", "mesma_via")]);
    expect(r.winner?.triggerCode).toBe("30803217");
    expect(r.ambiguous).toHaveLength(0);
  });

  it("Única/principal prevalece sobre Mesma via; o perdedor vira ambíguo", () => {
    const r = rankAnchorsByAccessRoute([
      cand("a", "30803233", "mesma_via"),
      cand("b", "30803217", "unica_principal"),
    ]);
    expect(r.winner?.triggerCode).toBe("30803217");
    expect(r.ambiguous.map((c) => c.triggerCode)).toEqual(["30803233"]);
  });

  it("outra_via prevalece sobre mesma_via e sem_via", () => {
    const r = rankAnchorsByAccessRoute([
      cand("a", "111", "sem_via"),
      cand("b", "222", "mesma_via"),
      cand("c", "333", "outra_via"),
    ]);
    expect(r.winner?.triggerCode).toBe("333");
    expect(r.ambiguous).toHaveLength(2);
  });

  it("empate real na prioridade máxima → ninguém aplica, todos ambíguos", () => {
    const r = rankAnchorsByAccessRoute([
      cand("a", "111", "unica_principal"),
      cand("b", "222", "unica_principal"),
    ]);
    expect(r.winner).toBeNull();
    expect(r.ambiguous).toHaveLength(2);
  });

  it("via ausente ('') é tratada como sem_via", () => {
    const r = rankAnchorsByAccessRoute([cand("a", "111", ""), cand("b", "222", "mesma_via")]);
    expect(r.winner?.triggerCode).toBe("222");
  });
});

describe("findPackagesWithoutAnchor — caso AGATHA", () => {
  const pkgMasto = calc({ id: "masto", main: ["40000"], included: ["30001", "30002"] });
  const pkgOutro = calc({ id: "outro", main: ["50000"], included: ["30002"] });

  it("sugere pacote quando só códigos secundários estão presentes", () => {
    const out = findPackagesWithoutAnchor([pkgMasto, pkgOutro], new Set(["30001", "30002"]), new Set(["C1"]));
    expect(out).toHaveLength(2);
    expect(out[0].calc.calc_id).toBe("masto");
    expect(out[0].matchedIncluded).toEqual(["30001", "30002"]);
  });

  it("não sugere quando o código-alavanca está presente (motor já resolve)", () => {
    const out = findPackagesWithoutAnchor([pkgMasto], new Set(["40000", "30001"]), new Set(["C1"]));
    expect(out).toHaveLength(0);
  });

  it("respeita escopo de grupo (empresa fora do vínculo não recebe sugestão)", () => {
    const restrito = calc({ id: "r", main: ["40000"], included: ["30001"], scope: "grupo", companies: ["C9"] });
    expect(findPackagesWithoutAnchor([restrito], new Set(["30001"]), new Set(["C1"]))).toHaveLength(0);
    expect(findPackagesWithoutAnchor([restrito], new Set(["30001"]), new Set(["C9"]))).toHaveLength(1);
  });

  it("limita a N sugestões", () => {
    const many = ["a", "b", "c", "d"].map((id) => calc({ id, main: ["9" + id], included: ["30001"] }));
    expect(findPackagesWithoutAnchor(many, new Set(["30001"]), new Set(["C1"]), 3)).toHaveLength(3);
  });
});
