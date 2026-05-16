import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guarda visual / layout do badge de Validação.
 *
 * O badge ⊙ Validação (N) DEVE:
 *  1. Compartilhar o mesmo container flex do badge de status (ALERTA / APROVADO),
 *     para ficar na mesma linha (com wrap para baixo se faltar largura).
 *  2. Manter a mesma estrutura visual base do badge de status:
 *     `inline-flex rounded-full border px-1 py-0.5` + TEXT_META,
 *     garantindo a MESMA altura e tipografia.
 *
 * Este teste lê o source de ItemsDataGrid.tsx e falha se alguém regredir
 * o container para `flex-col` ou alterar os tokens compartilhados sem
 * atualizar conscientemente este teste.
 *
 * Equivalente ao que um Playwright/Cypress checaria visualmente — só que
 * sem custo de browser, já que o projeto usa vitest + RTL.
 */
const SRC = readFileSync(
  resolve(__dirname, "../ItemsDataGrid.tsx"),
  "utf8",
);

describe("Validation badge — layout invariants", () => {
  it("container dos badges é flex-row com wrap (mesma linha do status)", () => {
    expect(SRC).toContain(
      'className="flex flex-row flex-wrap items-center gap-1"',
    );
    expect(SRC).not.toMatch(
      /className="flex flex-col items-start gap-0\.5"\s*>\s*\{?\s*it\.ai_status/,
    );
  });

  it("badge de status (ALERTA/APROVADO) mantém estrutura base compartilhada", () => {
    // Linha 933-ish: span do status que NÃO é "acatado".
    expect(SRC).toMatch(
      /<span\s+className=\{cn\("inline-flex rounded-full border px-1 py-0\.5",\s*TEXT_META,\s*"uppercase tracking-wide",\s*TONE_CLASSES\[tone\]\)\}>/,
    );
  });

  it("badge de Validação usa a MESMA base estrutural do status (px-1 py-0.5 rounded-full border + TEXT_META)", () => {
    // Trigger do popover do ValidationFindingsBadge.
    expect(SRC).toMatch(
      /"inline-flex items-center rounded-full border px-1 py-0\.5 cursor-pointer",\s*TEXT_META,/,
    );
  });

  it("badge de Validação usa cor índigo discreta (não conflita com status existentes)", () => {
    expect(SRC).toContain(
      "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
    );
  });

  it("badge de Validação usa ícone ShieldCheck (não ShieldAlert) com mesmo tamanho do ícone do status", () => {
    expect(SRC).toMatch(
      /<ShieldCheck className="h-2\.5 w-2\.5 mr-0\.5 inline" \/>\s*Validação/,
    );
  });

  it("badge de Validação é renderizado dentro do mesmo container do status (irmãos no JSX)", () => {
    // Garante que ValidationFindingsBadge aparece logo após o bloco do status,
    // antes do fechamento do </div> do container.
    const containerBlock = SRC.match(
      /flex flex-row flex-wrap items-center gap-1[\s\S]*?<\/div>\s*<\/td>/,
    );
    expect(containerBlock).not.toBeNull();
    const block = containerBlock![0];
    expect(block).toContain("TONE_CLASSES[tone]"); // status badge
    expect(block).toContain("<ValidationFindingsBadge"); // validation badge
    // Validation badge vem DEPOIS do status no mesmo container.
    expect(block.indexOf("TONE_CLASSES[tone]")).toBeLessThan(
      block.indexOf("<ValidationFindingsBadge"),
    );
  });
});
