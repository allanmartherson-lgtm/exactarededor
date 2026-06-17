import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
const paymentsPage = readFileSync(resolve(root, "pages/Payments.tsx"), "utf8");

const collectClientFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectClientFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

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
    // Marcador específico do JSX (não pega o comentário).
    expect(enclosingGate(paymentDetail, "/> Editar lote")).toBe("canEditMeta");
  });

  it("botão 'Reimportar base' está dentro do gate canReimport", () => {
    // O label exato aparece duas vezes (DropdownMenuItem e AlertDialogTitle);
    // usamos a marcação JSX única do item de menu.
    expect(enclosingGate(paymentDetail, "/> Reimportar base")).toBe("canReimport");
  });

  it("AssignmentCard recebe canAssume={canAssumeNow} (botão Assumir governado)", () => {
    expect(paymentDetail).toMatch(/canAssume=\{canAssumeNow\}/);
  });

  it("PaymentBatchActionsFooter (Questionar/Devolver/Aprovar) está dentro do gate canUseBatchActions", () => {
    // As ações de validador/diretor foram movidas de CompanyAnalysis para o
    // footer global em PaymentDetail. O gate canUseBatchActions combina
    // status + papel (validador/diretor), garantindo segregação de funções.
    expect(paymentDetail).toMatch(
      /\{\s*id\s*&&\s*canUseBatchActions\s*&&\s*\(\s*[\r\n][\s\S]{0,200}PaymentBatchActionsFooter/,
    );
  });

  it("canUseBatchActions exige status válido E papel (validador OU diretor)", () => {
    expect(paymentDetail).toMatch(
      /canUseBatchActions\s*=[\s\S]{0,300}batchActionStatuses\.includes[\s\S]{0,200}isDiretor[\s\S]{0,40}isValidador/,
    );
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
    // Marcador único do JSX do botão (existe também um texto de ajuda solto
    // com "Reaplicar regras" entre aspas — ignorar).
    expect(enclosingGate(companyAnalysis, ": \"Reaplicar regras\")")).toBe("canActAnalista");
  });

  it("botão 'Concluir análise / Finalizar confecção' está dentro do gate canActAnalista", () => {
    // Substitui o antigo 'Validar e enviar para aprovação' — as ações de
    // validador/diretor por empresa foram movidas para o footer em lote do
    // PaymentDetail (PaymentBatchActionsFooter). O que sobra aqui é a
    // finalização do analista, que deve permanecer atrás de canActAnalista.
    expect(enclosingGate(companyAnalysis, "Finalizar confecção")).toBe("canActAnalista");
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

describe("Reanálise — sempre passa pelo orquestrador", () => {
  it("PaymentDetail, CompanyAnalysis e Payments disparam dispatch-payment-analysis", () => {
    expect(paymentDetail).toMatch(/functions\.invoke\(\s*["']dispatch-payment-analysis["']/);
    expect(companyAnalysis).toMatch(/functions\.invoke\(\s*["']dispatch-payment-analysis["']/);
    expect(paymentsPage).toMatch(/functions\.invoke\(\s*["']dispatch-payment-analysis["']/);
  });

  it("nenhuma UI persistente chama analyze-payment direto (exceto simulação dry-run)", () => {
    const offenders: string[] = [];
    for (const file of collectClientFiles(root)) {
      const src = readFileSync(file, "utf8");
      const re = /functions\.invoke\(\s*["']analyze-payment["'][\s\S]{0,300}\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (!/is_dry_run\s*:\s*true/.test(m[0])) offenders.push(file.replace(root, "src"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
