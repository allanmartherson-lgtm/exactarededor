import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato E2E — finalize_confeccao + trigger enforce_confeccao_status_coherence.
 *
 * Lê o SQL da migração de separação Confecção × Análise e garante, por inspeção,
 * que o fluxo end-to-end NÃO permite escapar do modo confecção sem passar pela RPC:
 *
 *  1) Trigger BEFORE INSERT OR UPDATE em payments E payment_company_groups bloqueia
 *     status de análise (ex.: revisao_analista) enquanto analysis_mode='confeccao'.
 *  2) confeccao_status='em_confeccao' é proibido fora de modo confecção.
 *  3) finalize_confeccao() é a ÚNICA via que troca analysis_mode confeccao → padrao
 *     antes de liberar status='em_analise_ia' / grupos='revisao_analista'.
 *  4) finalize_confeccao() valida pré-condição (analysis_mode='confeccao'),
 *     marca confeccao_concluida, escreve audit_log e está gated por authenticated.
 *  5) O front (PaymentDetail) usa SEMPRE a RPC para sair da confecção — nunca
 *     UPDATE direto em payments.status.
 */

function loadConfeccaoMigrations(): string {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const blobs: string[] = [];
  for (const f of files) {
    const body = readFileSync(resolve(dir, f), "utf8");
    if (/finalize_confeccao|enforce_confeccao_status_coherence|confeccao_status/i.test(body)) {
      blobs.push(body);
    }
  }
  if (blobs.length === 0) throw new Error("migrações de confecção não encontradas");
  return blobs.join("\n\n-- ===NEXT MIGRATION===\n\n");
}

const sql = loadConfeccaoMigrations();

describe("finalize_confeccao · contrato E2E", () => {
  it("define enum confeccao_status com em_confeccao/confeccao_concluida", () => {
    expect(sql).toMatch(/CREATE\s+TYPE\s+public\.confeccao_status[\s\S]*'em_confeccao'[\s\S]*'confeccao_concluida'/i);
  });

  it("cria trigger de coerência em payments E payment_company_groups", () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_confeccao_coherence_payments[\s\S]*ON\s+public\.payments/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_confeccao_coherence_groups[\s\S]*ON\s+public\.payment_company_groups/i);
    // BEFORE para realmente impedir o write
    expect(sql).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.payments/i);
    expect(sql).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.payment_company_groups/i);
  });

  it("trigger bloqueia status de análise enquanto mode='confeccao'", () => {
    // Em modo confecção: só placeholders são aceitos.
    expect(sql).toMatch(/IF\s+mode\s*=\s*'confeccao'[\s\S]*NEW\.status\s+NOT\s+IN\s*\(\s*'rascunho'\s*,\s*'arquivado'\s*,\s*'cancelado'\s*\)/i);
    // Mensagem de erro explícita e ERRCODE check_violation.
    expect(sql).toMatch(/Transição inválida em modo CONFECÇÃO[\s\S]*finalize_confeccao\(\)/i);
    expect(sql).toMatch(/USING\s+ERRCODE\s*=\s*'check_violation'/i);
  });

  it("trigger bloqueia confeccao_status='em_confeccao' fora do modo confecção", () => {
    expect(sql).toMatch(/IF\s+NEW\.confeccao_status\s*=\s*'em_confeccao'[\s\S]*RAISE\s+EXCEPTION/i);
  });

  it("trigger exige confeccao_status não-nulo em modo confecção (salvo arquivado/cancelado)", () => {
    expect(sql).toMatch(/NEW\.confeccao_status\s+IS\s+NULL[\s\S]*confeccao_status é obrigatório/i);
  });

  it("RPC finalize_confeccao recusa pagamento que não está em modo confecção", () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.finalize_confeccao\(_payment_id\s+uuid\)/i);
    expect(sql).toMatch(/pay\.analysis_mode\s+IS\s+DISTINCT\s+FROM\s+'confeccao'[\s\S]*RAISE\s+EXCEPTION/i);
    expect(sql).toMatch(/SELECT\s+\*\s+INTO\s+pay\s+FROM\s+public\.payments\s+WHERE\s+id\s*=\s*_payment_id\s+FOR\s+UPDATE/i);
  });

  it("RPC marca todos os grupos como confeccao_concluida antes de virar o modo", () => {
    expect(sql).toMatch(/UPDATE\s+public\.payment_company_groups[\s\S]*confeccao_status\s*=\s*'confeccao_concluida'[\s\S]*WHERE\s+payment_id\s*=\s*_payment_id/i);
  });

  it("RPC troca analysis_mode → padrao ANTES de setar status='em_analise_ia'", () => {
    // Mesma cláusula UPDATE deve mexer em analysis_mode e status, evitando estados intermediários inválidos.
    expect(sql).toMatch(/UPDATE\s+public\.payments\s+SET\s+analysis_mode\s*=\s*'padrao'[\s\S]*status\s*=\s*'em_analise_ia'[\s\S]*WHERE\s+id\s*=\s*_payment_id/i);
  });

  it("RPC promove grupos placeholder (rascunho) para revisao_analista", () => {
    expect(sql).toMatch(/UPDATE\s+public\.payment_company_groups\s+SET\s+status\s*=\s*'revisao_analista'[\s\S]*status\s+IN\s*\(\s*'rascunho'\s*\)/i);
  });

  it("RPC registra auditoria da finalização", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.audit_log[\s\S]*'confeccao_finalizada'/i);
  });

  it("RPC é SECURITY DEFINER e exposta apenas para authenticated", () => {
    expect(sql).toMatch(/FUNCTION\s+public\.finalize_confeccao[\s\S]*SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.finalize_confeccao\(uuid\)\s+TO\s+authenticated/i);
  });
});

describe("PaymentDetail · usa RPC finalize_confeccao para sair da confecção", () => {
  const pd = readFileSync(
    resolve(__dirname, "../PaymentDetail.tsx"),
    "utf8",
  );

  it("invoca supabase.rpc('finalize_confeccao') no encaminhamento", () => {
    expect(pd).toMatch(/supabase\.rpc\(\s*["']finalize_confeccao["']\s*,\s*\{\s*_payment_id\s*:/);
  });

  it("não tenta UPDATE direto em payments.status='em_analise_ia' / 'revisao_analista' fora da RPC", () => {
    // Procura update raw em payments.status diretamente do front (não permitido enquanto em confecção).
    const directUpdate = /\.from\(\s*["']payments["']\s*\)\s*\.update\(\s*\{[^}]*status\s*:\s*["'](?:em_analise_ia|revisao_analista)["']/;
    expect(pd).not.toMatch(directUpdate);
  });
});
