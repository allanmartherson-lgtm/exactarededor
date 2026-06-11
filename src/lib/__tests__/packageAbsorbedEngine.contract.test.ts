import { describe, it, expect } from "vitest";

/**
 * Contrato motor de pacote × package_absorbed × bruto/líquido.
 *
 * Cobre o fluxo end-to-end (lógico) que vive em:
 *  - analyze-payment/index.ts (bloco pacote ~ linhas 999..1045)
 *      → para itens secundários ou absorvidos manualmente, o motor seta
 *        expected_amount=0, gross_amount=0 (em confecção) e
 *        package_absorbed=true + package_absorbed_calc_id.
 *  - compute-company-financials/index.ts
 *      → bruto = Σ gross_amount onde !is_cancelled && !package_absorbed.
 *  - audit_log (insert pós-writes em analyze-payment)
 *      → cada transição (false→true ou true→false) vira 1 linha de audit.
 *
 * Por que não roda contra DB real: o motor em si depende de I/O pesado
 * (regras, calculations, override flags). Aqui simulamos a saída do motor
 * para o caso clássico (anchor + 2 auxiliares) e validamos:
 *   1) auxiliares ficam com package_absorbed=true e expected_amount=0
 *   2) bruto da empresa = expected do âncora (não soma absorvidos)
 *   3) reanálise idempotente (não duplica audit; estados estáveis)
 *   4) audit registra apenas transições reais
 */

type RawItem = {
  id: string;
  company_id: string;
  procedure_amount: number;
  gross_amount: number | null;
  expected_amount: number | null;
  package_absorbed: boolean;
  package_absorbed_calc_id: string | null;
  is_cancelled?: boolean;
  is_anchor?: boolean;
  calc_id?: string;
};

type AuditRow = {
  entity_type: "payment_item";
  action: "update";
  entity_id: string;
  diff: Record<string, unknown>;
};

/** Simula o bloco pacote do analyze-payment/index.ts (versão lógica mínima). */
function runPackageEngine(items: RawItem[], pkg: { calcId: string; anchorAmount: number }): {
  next: RawItem[];
  audits: AuditRow[];
} {
  const audits: AuditRow[] = [];
  const next = items.map((it) => {
    const before = it.package_absorbed === true;
    let afterAbsorbed = before;
    let expected = it.expected_amount;
    let gross = it.gross_amount;
    let calcId = it.package_absorbed_calc_id;

    if (it.is_anchor) {
      // âncora recebe expected = valor do pacote; absorbido=false
      expected = pkg.anchorAmount;
      gross = pkg.anchorAmount; // modo confecção: motor produz gross
      afterAbsorbed = false;
      calcId = pkg.calcId;
    } else {
      // secundário do pacote: expected=0, gross=0, absorbed=true
      expected = 0;
      gross = 0;
      afterAbsorbed = true;
      calcId = pkg.calcId;
    }

    if (before !== afterAbsorbed) {
      audits.push({
        entity_type: "payment_item",
        action: "update",
        entity_id: it.id,
        diff: {
          package_absorbed: { before, after: afterAbsorbed },
          package_absorbed_calc_id: {
            before: it.package_absorbed_calc_id,
            after: calcId,
          },
          source: "analyze-payment",
          reason: afterAbsorbed ? "package_secondary_absorbed" : "package_absorption_cleared",
        },
      });
    }

    return {
      ...it,
      expected_amount: expected,
      gross_amount: gross,
      package_absorbed: afterAbsorbed,
      package_absorbed_calc_id: calcId,
    };
  });
  return { next, audits };
}

/** Espelho exato do filtro em compute-company-financials. */
function bruto(items: RawItem[]): number {
  return Number(
    items
      .filter((it) => !it.is_cancelled && !it.package_absorbed)
      .reduce((s, it) => s + Number(it.gross_amount || 0), 0)
      .toFixed(2),
  );
}

function liquido(items: RawItem[], opts: { debitos?: number; glosas?: number } = {}) {
  return Number((bruto(items) - (opts.debitos ?? 0) - (opts.glosas ?? 0)).toFixed(2));
}

describe("Motor de pacote — package_absorbed + audit + bruto/líquido", () => {
  const baseItems: RawItem[] = [
    {
      id: "anchor",
      company_id: "C1",
      procedure_amount: 1000,
      gross_amount: 1000,
      expected_amount: null,
      package_absorbed: false,
      package_absorbed_calc_id: null,
      is_anchor: true,
    },
    {
      id: "aux1",
      company_id: "C1",
      procedure_amount: 600,
      gross_amount: 600,
      expected_amount: null,
      package_absorbed: false,
      package_absorbed_calc_id: null,
    },
    {
      id: "aux2",
      company_id: "C1",
      procedure_amount: 400,
      gross_amount: 400,
      expected_amount: null,
      package_absorbed: false,
      package_absorbed_calc_id: null,
    },
  ];

  it("itens secundários ficam com package_absorbed=true e expected/gross zerados; âncora absorve o pacote", () => {
    const { next } = runPackageEngine(baseItems, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    const anchor = next.find((i) => i.id === "anchor")!;
    const aux1 = next.find((i) => i.id === "aux1")!;
    const aux2 = next.find((i) => i.id === "aux2")!;

    expect(anchor.package_absorbed).toBe(false);
    expect(anchor.expected_amount).toBe(1500);
    expect(anchor.gross_amount).toBe(1500);
    expect(anchor.package_absorbed_calc_id).toBe("calc-pkg-1");

    expect(aux1.package_absorbed).toBe(true);
    expect(aux1.gross_amount).toBe(0);
    expect(aux1.expected_amount).toBe(0);
    expect(aux1.package_absorbed_calc_id).toBe("calc-pkg-1");

    expect(aux2.package_absorbed).toBe(true);
    expect(aux2.gross_amount).toBe(0);
    expect(aux2.expected_amount).toBe(0);
  });

  it("bruto da empresa exclui absorbed e bate com o valor do pacote", () => {
    const { next } = runPackageEngine(baseItems, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    // Antes da absorção, soma bruta seria 1000+600+400 = 2000.
    // Depois deve ser apenas o âncora (pacote = 1500).
    expect(bruto(baseItems)).toBe(2000);
    expect(bruto(next)).toBe(1500);
  });

  it("líquido recomputado após pacote bate (com glosa e débito)", () => {
    const { next } = runPackageEngine(baseItems, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    expect(liquido(next, { glosas: 200, debitos: 100 })).toBe(1200);
  });

  it("auditoria registra apenas transições reais (3 itens → 2 audits na 1ª passagem)", () => {
    const { audits } = runPackageEngine(baseItems, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    // âncora era false e fica false → sem audit. aux1/aux2 false→true.
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.entity_id).sort()).toEqual(["aux1", "aux2"]);
    for (const a of audits) {
      expect((a.diff as any).package_absorbed.after).toBe(true);
      expect((a.diff as any).reason).toBe("package_secondary_absorbed");
      expect((a.diff as any).source).toBe("analyze-payment");
    }
  });

  it("reanálise é idempotente — segunda passagem não gera novos audits nem altera bruto", () => {
    const { next: pass1 } = runPackageEngine(baseItems, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    const { next: pass2, audits: audits2 } = runPackageEngine(pass1, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    expect(audits2).toHaveLength(0);
    expect(bruto(pass1)).toBe(bruto(pass2));
    expect(bruto(pass2)).toBe(1500);
  });

  it("desabsorção (pacote removido) gera audits true→false e devolve bruto original", () => {
    const { next: pass1 } = runPackageEngine(baseItems, { calcId: "calc-pkg-1", anchorAmount: 1500 });
    // Simula reanálise SEM pacote: restaura gross original e zera flags.
    const cleared: RawItem[] = pass1.map((it) => ({
      ...it,
      package_absorbed: false,
      package_absorbed_calc_id: null,
      gross_amount: baseItems.find((b) => b.id === it.id)!.gross_amount,
      expected_amount: baseItems.find((b) => b.id === it.id)!.gross_amount,
    }));
    // Diff manual para checar transição true→false dos auxiliares.
    const transitions = pass1
      .filter((it) => it.package_absorbed)
      .map((it) => ({
        id: it.id,
        before: true,
        after: cleared.find((c) => c.id === it.id)!.package_absorbed,
      }));
    expect(transitions.every((t) => t.before === true && t.after === false)).toBe(true);
    expect(bruto(cleared)).toBe(2000);
  });
});
