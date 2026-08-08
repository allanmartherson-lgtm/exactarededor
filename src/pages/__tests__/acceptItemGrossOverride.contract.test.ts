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
 *  6) Tratamento manual preserva gross original e o hook de leitura não faz
 *     auto-correção gravando status aprovado em segundo plano.
 *  7) CompanyAnalysis chama composition.refresh() após acatar e desfazer
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
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b[\\s\\S]*?\\$function\\$[\\s\\S]*?\\$function\\$`, "gi");
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
// O cálculo do bruto saiu do TypeScript e passou a ser feito por uma RPC de
// agregação no banco (a edge function só consome `agg.bruto_simple`). As regras
// de package_absorbed e de acate vivem lá — é a migration que precisa ser
// inspecionada, não mais o index.ts.
const financialAggSql = (() => {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .filter((b) => /bruto_simple/i.test(b))
    .join("\n");
})();
const companyAnalysis = readFileSync(
  resolve(__dirname, "../CompanyAnalysis.tsx"),
  "utf8",
);
const manualInterventionDialog = readFileSync(
  resolve(__dirname, "../../components/payment-detail/ManualInterventionDialog.tsx"),
  "utf8",
);
const usePaymentDetailData = readFileSync(
  resolve(__dirname, "../../hooks/usePaymentDetailData.ts"),
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
    const body = lastFn("accept_payment_item");
    expect(body).toMatch(/gross_amount\s*=\s*CASE[\s\S]*v_expected\s+IS\s+NOT\s+NULL[\s\S]*THEN\s+v_expected/i);
  });

  it("accept_payment_item preserva original só na 1ª sobrescrita", () => {
    const fn = lastFn("accept_payment_item");
    expect(fn).toMatch(/v_already_overridden/i);
    expect(fn).toMatch(/gross_amount_original\s*=\s*CASE[\s\S]*NOT\s+v_already_overridden[\s\S]*THEN\s+v_gross/i);
  });

  it("accept_payment_item marca reason='acatado_esperado' e audita", () => {
    const fn = lastFn("accept_payment_item");
    expect(fn).toMatch(/gross_override_reason\s*=\s*CASE[\s\S]*'acatado_esperado'/i);
    expect(fn).toMatch(/INSERT INTO public\.audit_log[\s\S]*'gross_anterior'[\s\S]*'gross_novo'/i);
  });

  it("undo_accept_payment_item restaura gross original e limpa flags", () => {
    const body = lastFn("undo_accept_payment_item");
    expect(body).toMatch(/gross_amount\s*=\s*CASE[\s\S]*gross_override_reason\s*=\s*'acatado_esperado'[\s\S]*gross_amount_original\s+IS\s+NOT\s+NULL[\s\S]*THEN\s+gross_amount_original/i);
    expect(body).toMatch(/gross_amount_original\s*=\s*CASE[\s\S]*'acatado_esperado'[\s\S]*THEN\s+NULL/i);
    expect(body).toMatch(/gross_override_at\s*=\s*CASE[\s\S]*'acatado_esperado'[\s\S]*THEN\s+NULL/i);
    expect(body).toMatch(/gross_override_reason\s*=\s*CASE[\s\S]*'acatado_esperado'[\s\S]*THEN\s+NULL/i);
    expect(body).toMatch(/INSERT INTO public\.audit_log[\s\S]*'gross_restaurado'/i);
  });

  it("undo só age quando o motivo foi 'acatado_esperado' (não mexe em outros overrides)", () => {
    const fn = lastFn("undo_accept_payment_item");
    // Ramos com ELSE explícito preservando o valor atual
    expect(fn).toMatch(/ELSE\s+gross_amount\s+END/i);
    expect(fn).toMatch(/ELSE\s+gross_amount_original\s+END/i);
    expect(fn).toMatch(/ELSE\s+gross_override_reason\s+END/i);
  });

  it("accept_payment_item_keep_paid marca reason='acatado_pago' e preserva gross", () => {
    const body = lastFn("accept_payment_item_keep_paid");
    expect(body).toMatch(/gross_amount\s*=\s*v_effective_paid/i);
    expect(body).toMatch(/gross_override_reason\s*=\s*'acatado_pago'/i);
    expect(body).toMatch(/v_override_reason\s*=\s*'acatado_esperado'[\s\S]*v_gross_original/i);
  });
});

describe("pool · acate mantendo pago", () => {
  const recalcPools = readFileSync(
    resolve(__dirname, "../../../supabase/functions/recalc-payment-pools/index.ts"),
    "utf8",
  );
  const computeFinancials = readFileSync(
    resolve(__dirname, "../../../supabase/functions/compute-company-financials/index.ts"),
    "utf8",
  );

  it("pool usa gross_amount quando item foi acatado mantendo pago", () => {
    expect(recalcPools).toMatch(/gross_override_reason\s*===\s*"acatado_pago"[\s\S]*gross_amount/);
    // Mesma migração de camada do package_absorbed: quem decide usar
    // gross_amount no acate "mantendo pago" é a RPC de agregação.
    expect(financialAggSql).toMatch(/gross_override_reason\s*=\s*'acatado_pago'[\s\S]{0,120}gross_amount/i);
  });
});

describe("composição financeira · líquido reflete acate", () => {
  it("compute-company-financials exclui itens package_absorbed do bruto", () => {
    expect(financialAggSql).toMatch(/NOT\s+(?:COALESCE|coalesce)\(\s*(?:pi\.)?package_absorbed/i);
    // Texto explicando a regra (guard contra remoção acidental)
    // A edge function segue documentando a regra, mesmo consumindo o valor
    // já agregado — guard contra a remoção silenciosa da explicação.
    expect(compute).toMatch(/absorvidos em pacote[\s\S]{0,40}package_absorbed/i);
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

describe("tratamento manual · undo fiel sem auto-aprovação oculta", () => {
  it("ManualInterventionDialog marca override próprio e restaura gross original ao remover", () => {
    expect(manualInterventionDialog).toMatch(/gross_override_reason\s*=\s*"tratamento_manual"/);
    expect(manualInterventionDialog).toMatch(/gross_amount_original/);
    expect(manualInterventionDialog).toMatch(/overrideReason === "tratamento_manual"/);
    expect(manualInterventionDialog).toMatch(/expected_amount:\s*null/);
    expect(manualInterventionDialog).toMatch(/ai_status:\s*"pendente"/);
  });

  it("usePaymentDetailData não auto-corrige payment_items no load()", () => {
    expect(usePaymentDetailData).not.toMatch(/auto-corrigindo/);
    expect(usePaymentDetailData).not.toMatch(/manual_intervention_reason_id[\s\S]{0,180}\.update\(patch\)/);
  });
});
