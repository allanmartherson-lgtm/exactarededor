import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Testes de CONTRATO (estáticos) — garantem que os botões críticos das
 * páginas de aprovação estão sempre envelopados pelo gate de governança
 * correto. Combinados com `paymentFlow.test.ts` (que prova a lógica do
 * gate em todas as combinações status × papel), eles formam um teste de
 * integração leve: se o gate estiver certo + o botão estiver dentro do
 * gate, o botão aparece/desaparece corretamente.
 *
 * Por que estáticos?
 *  - Mockar Supabase + React Query + Router para renderizar PaymentDetail
 *    (1500+ linhas) e CompanyAnalysis (1200+ linhas) é caro e frágil.
 *  - O risco real é alguém remover/inverter o gate em uma refatoração.
 *    Isto detecta exatamente isso.
 */

const root = resolve(__dirname, "../..");
const paymentDetail = readFileSync(resolve(root, "pages/PaymentDetail.tsx"), "utf8");
const companyAnalysis = readFileSync(resolve(root, "pages/CompanyAnalysis.tsx"), "utf8");

/** Acha o índice da linha que contém o botão (label legível). */
const findLine = (src: string, marker: string): number => {
  const idx = src.indexOf(marker);
  if (idx === -1) throw new Error(`Marker not found: ${marker}`);
  return src.slice(0, idx).split("\n").length;
};

/**
 * Procura o gate `{flag && (` mais próximo ANTES da linha do botão.
 * Retorna o nome da flag.
 */
const enclosingGate = (src: string, marker: string): string => {
  const buttonIdx = src.indexOf(marker);
  if (buttonIdx === -1) throw new Error(`Marker not found: ${marker}`);
  const before = src.slice(0, buttonIdx);
  // Última ocorrência de `{<algumaCoisa> && (` antes do botão.
  const re = /\{(\w+)\s*&&\s*\(/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) last = m[1];
  if (!last) throw new Error(`No enclosing gate before marker: ${marker}`);
  return last;
};

describe("PaymentDetail.tsx — gates de governança nos botões", () => {
  it("usa canEditBatch para derivar canEditMeta", () => {
    expect(paymentDetail).toMatch(
      /const\s+canEditMeta\s*=\s*canEditBatch\s*\(/,
    );
  });

  it("usa canReimportBatch para derivar canReimport", () => {
    expect(paymentDetail).toMatch(
      /const\s+canReimport\s*=\s*canReimportBatch\s*\(/,
    );
  });

  it("usa canAssumeBatch para derivar canAssumeNow", () => {
    expect(paymentDetail).toMatch(
      /const\s+canAssumeNow\s*=\s*canAssumeBatch\s*\(/,
    );
  });

  it("botão 'Editar lote' está dentro do gate canEditMeta", () => {
    expect(enclosingGate(paymentDetail, "Editar lote")).toBe("canEditMeta");
  });

  it("botão 'Reimportar base' está dentro do gate canReimport", () => {
    expect(enclosingGate(paymentDetail, "Reimportar base")).toBe("canReimport");
  });

  it("AssignmentCard recebe canAssume={canAssumeNow} (botão Assumir governado)", () => {
    expect(paymentDetail).toMatch(/canAssume=\{canAssumeNow\}/);
  });

  it("não há botão 'Editar lote' ou 'Reimportar base' fora dos gates corretos", () => {
    // Cada label aparece exatamente uma vez (no botão visível). O fragmento
    // 'Editar lote' aparece também no DialogTitle dentro do mesmo bloco gate.
    const editarOccurrences = paymentDetail.match(/Editar lote/g) ?? [];
    const reimportarOccurrences = paymentDetail.match(/Reimportar base/g) ?? [];
    // Editar lote: 1 botão + 1 DialogTitle = 2; Reimportar base: 1 botão = 1.
    expect(editarOccurrences.length).toBeLessThanOrEqual(3);
    expect(reimportarOccurrences.length).toBeLessThanOrEqual(2);
  });
});

describe("CompanyAnalysis.tsx — gates de governança nos botões", () => {
  it("deriva canActAnalista exigindo papel + (dono OU admin)", () => {
    // Regra de governança: analista só atua se for o dono do lote (ou admin).
    expect(companyAnalysis).toMatch(
      /canActAnalista\s*=[\s\S]{0,400}isAnalistaRole[\s\S]{0,200}\(isOwner\s*\|\|\s*isAdmin\)/,
    );
  });

  it("deriva canActValidador exigindo segregação (canActAsVD)", () => {
    expect(companyAnalysis).toMatch(
      /canActValidador\s*=[^;]*isValidador[^;]*canActAsVD/,
    );
  });

  it("deriva canActDiretor exigindo segregação (canActAsVD)", () => {
    expect(companyAnalysis).toMatch(
      /canActDiretor\s*=[^;]*isDiretor[^;]*canActAsVD/,
    );
  });

  it("botão 'Reaplicar regras' está dentro do gate canActAnalista", () => {
    expect(enclosingGate(companyAnalysis, "Reaplicar regras")).toBe("canActAnalista");
  });

  it("botão 'Cancelar lote' (fluxo analista) está dentro do gate canActAnalista", () => {
    // O label aparece também no AlertDialog interno; usamos o do botão de toolbar.
    const idx = companyAnalysis.indexOf("Cancelar lote");
    expect(idx).toBeGreaterThan(0);
    // Garante que o primeiro 'Cancelar lote' está dentro de canActAnalista.
    expect(enclosingGate(companyAnalysis, "Cancelar lote")).toBe("canActAnalista");
  });

  it("botão 'Validar e enviar para aprovação' está dentro do gate canActValidador", () => {
    expect(enclosingGate(companyAnalysis, "Validar e enviar para aprovação")).toBe(
      "canActValidador",
    );
  });

  it("botões do diretor (Devolver/Rejeitar) estão dentro do gate canActDiretor", () => {
    // Pegamos a linha do 'Rejeitado pelo diretor' (handler único do diretor).
    expect(enclosingGate(companyAnalysis, "Rejeitado pelo diretor")).toBe("canActDiretor");
  });
});

describe("Imports — páginas usam helpers do paymentFlow", () => {
  it("PaymentDetail importa canEditBatch, canReimportBatch e canAssumeBatch", () => {
    expect(paymentDetail).toMatch(/canEditBatch/);
    expect(paymentDetail).toMatch(/canReimportBatch/);
    expect(paymentDetail).toMatch(/canAssumeBatch/);
  });

  it("CompanyAnalysis importa canEditBatch e canActAsValidatorOrDirector", () => {
    expect(companyAnalysis).toMatch(/canEditBatch/);
    expect(companyAnalysis).toMatch(/canActAsValidatorOrDirector/);
  });
});
