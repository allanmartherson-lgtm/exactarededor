import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato — acatar item sobrescreve gross_amount; undo restaura o original.
 *
 * Garante por inspeção das migrations + edge function + UI que:
 *  1) payment_items tem os campos de trilha: gross_amount_original,
 *     gross_override_at, gross_override_by, gross_override_reason.
 *  2) accept_payment_item copia expected_amount → gross_amount, preserva
 *     o valor original em gross_amount_original (só na 1ª sobrescrita),
 *     marca reason='acatado_esperado' e audita gross_anterior/novo.
 *  3) undo_accept_payment_item restaura gross_amount a partir de
 *     gross_amount_original e LIMPA as flags de override quando o motivo
 *     era 'acatado_esperado'.
 *  4) compute-company-financials NÃO conta itens com package_absorbed no
 *     bruto (garante que o líquido reflete o novo gross após acatar pacote).
 *  5) analyze-payment respeita gross_override_at em modo confecção
 *     (não sobrescreve gross do analista em reanálise).
 *  6) CompanyAnalysis chama composition.refresh() após acatar e desfazer
 *     (líquido atualiza na UI sem reload).
 */

function loadMigrations(): string {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const blobs: string[] = [];
  for (const f of files) {
    const body = readFileSync(resolve(dir, f), "utf8");
    if (/gross_amount_original|accept_payment_item|undo_accept_payment_item/i.test(body)) {
      blobs.push(body);
    }
  }
  if (blobs.length === 0) throw new Error("migrações de acate/override não encontradas");
  return blobs.join("\n\n-- ===NEXT===\n\n");
}

const sql = loadMigrations();

function lastFn(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$`, "gi");
  const all = [...sql.matchAll(re)].map((m) => m[0]);
  if (all.length === 0) throw new Error(`função ${name} não encontrada`);
  return all[all.length - 1];
}
const analyze = readFileSync(
  resolve(__dirname, "../../../supabase/functions/analyze-payment/index.ts"),
  "utf8",
);
const compute = readFileSync(
  resolve(__dirname, "../../../supabase/functions/compute-company-financials/index.ts"),
  "utf8",
);
const companyAnalysis = readFileSync(
  resolve(__dirname, "../CompanyAnalysis.tsx"),
  "utf8",
);

describe("acatar item · sobrescrita de gross_amount", () => {
  it("payment_items ganha campos de trilha (original/at/by/reason)", () => {
    expect(sql).toMatch(/gross_amount_original\s+numeric/i);
    expect(sql).toMatch(/gross_override_at\s+timestamptz/i);
    expect(sql).toMatch(/gross_override_by\s+uuid/i);
    expect(sql).toMatch(/gross_override_reason\s+text/i);
  });

  it("accept_payment_item copia expected_amount → gross_amount", () => {
    // Bloco da função
    const fn = null /*replaced*/;
    expect(fn, "accept_payment_item não encontrada").toBeTruthy();
    const body = fn![0];
    // gross_amount = CASE WHEN v_expected IS NOT NULL THEN v_expected
    expect(body).toMatch(/gross_amount\s*=\s*CASE[\s\S]*v_expected\s+IS\s+NOT\s+NULL[\s\S]*THEN\s+v_expected/i);
  });

  it("accept_payment_item preserva original só na 1ª sobrescrita", () => {
    const fn = null /*replaced*/![0];
    // Usa flag v_already_overridden para não sobrescrever original
    expect(fn).toMatch(/v_already_overridden/i);
    expect(fn).toMatch(/gross_amount_original\s*=\s*CASE[\s\S]*NOT\s+v_already_overridden[\s\S]*THEN\s+v_gross/i);
  });

  it("accept_payment_item marca reason='acatado_esperado' e audita", () => {
    const fn = null /*replaced*/![0];
    expect(fn).toMatch(/gross_override_reason\s*=\s*CASE[\s\S]*'acatado_esperado'/i);
    expect(fn).toMatch(/INSERT INTO public\.audit_log[\s\S]*'gross_anterior'[\s\S]*'gross_novo'/i);
  });

  it("undo_accept_payment_item restaura gross original e limpa flags", () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.undo_accept_payment_item[\s\S]*?\$function\$/i);
    expect(fn, "undo_accept_payment_item não encontrada").toBeTruthy();
    const body = fn![0];
    // Restaura gross
    expect(body).toMatch(/gross_amount\s*=\s*CASE[\s\S]*gross_override_reason\s*=\s*'acatado_esperado'[\s\S]*gross_amount_original\s+IS\s+NOT\s+NULL[\s\S]*THEN\s+gross_amount_original/i);
    // Limpa trilha
    expect(body).toMatch(/gross_amount_original\s*=\s*CASE[\s\S]*'acatado_esperado'[\s\S]*THEN\s+NULL/i);
    expect(body).toMatch(/gross_override_at\s*=\s*CASE[\s\S]*'acatado_esperado'[\s\S]*THEN\s+NULL/i);
    expect(body).toMatch(/gross_override_reason\s*=\s*CASE[\s\S]*'acatado_esperado'[\s\S]*THEN\s+NULL/i);
    // Auditoria
    expect(body).toMatch(/INSERT INTO public\.audit_log[\s\S]*'gross_restaurado'/i);
  });

  it("undo só age quando o motivo foi 'acatado_esperado' (não mexe em outros overrides)", () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.undo_accept_payment_item[\s\S]*?\$function\$/i)![0];
    // ELSE preserva o valor atual (não NULL fora do reason específico)
    expect(fn).toMatch(/THEN\s+NULL\s+END/i);
    expect(fn).toMatch(/ELSE\s+gross_amount\s+END/i);
  });
});

describe("composição financeira · líquido reflete acate", () => {
  it("compute-company-financials exclui itens package_absorbed do bruto", () => {
    expect(compute).toMatch(/!it\.package_absorbed/);
    // Texto explicando a regra (guard contra remoção acidental)
    expect(compute).toMatch(/absorbed[\s\S]*pacote/i);
  });

  it("CompanyAnalysis chama composition.refresh() após acatar e desfazer", () => {
    // Encontra a função acceptItem e checa o refresh ao final
    const accept = companyAnalysis.match(/const acceptItem[\s\S]*?\n  \};/);
    expect(accept, "acceptItem não encontrado").toBeTruthy();
    expect(accept![0]).toMatch(/composition\.refresh\(\)/);

    const undo = companyAnalysis.match(/const undoAcceptItem[\s\S]*?\n  \};/);
    expect(undo, "undoAcceptItem não encontrado").toBeTruthy();
    expect(undo![0]).toMatch(/composition\.refresh\(\)/);
  });
});

describe("analyze-payment · respeita override do analista", () => {
  it("seleciona gross_override_at na query de payment_items", () => {
    expect(analyze).toMatch(/gross_override_at/);
  });

  it("em confecção, NÃO sobrescreve gross_amount quando há override", () => {
    // Bloco com a guarda explícita
    expect(analyze).toMatch(/if\s*\(\s*isConfeccao\s*\)[\s\S]*gross_override_at[\s\S]*patch\.gross_amount\s*=\s*u\.expected_amount/);
  });
});
