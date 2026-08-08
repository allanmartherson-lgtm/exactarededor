import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato do RPC `reactivate_cancelled_group`.
 *
 * Garante que a reativação SEMPRE limpa as marcas de cancelamento do grupo
 * e dos itens — caso contrário o banner vermelho "Pagamento cancelado"
 * continua aparecendo na tela mesmo após o supervisor reativar.
 *
 * O contrato é validado lendo a última migração que define a função e
 * verificando palavra-por-palavra os SET ... = NULL exigidos. Caso alguém
 * remova um dos NULLs em uma refatoração, este teste quebra.
 */

const migrationsDir = resolve(__dirname, "../../../supabase/migrations");

/**
 * Retorna o CORPO da função na migração mais recente que a define.
 *
 * O recorte pelo corpo é essencial: a mesma migração costuma redefinir
 * outras funções que também dão UPDATE em payment_company_groups. Lendo o
 * arquivo inteiro, o `blockFor` abaixo casava com o primeiro UPDATE do
 * arquivo — de outra função — e o contrato passava a validar o trecho errado.
 */
const latestRpcDefinition = (): string => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const body = readFileSync(resolve(migrationsDir, files[i]), "utf8");
    const start = body.search(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reactivate_cancelled_group/i,
    );
    if (start === -1) continue;
    // Corpo vai até o fim do bloco dollar-quoted que fecha a função.
    const rest = body.slice(start);
    const end = rest.search(/\n\s*\$(?:function)?\$\s*;/i);
    return end === -1 ? rest : rest.slice(0, end);
  }
  throw new Error("Nenhuma migração define reactivate_cancelled_group");
};

const sql = latestRpcDefinition();

/** Extrai apenas o bloco UPDATE de um alvo (groups | items). */
const blockFor = (table: "payment_company_groups" | "payment_items"): string => {
  const re = new RegExp(`UPDATE\\s+public\\.${table}[\\s\\S]*?WHERE[\\s\\S]*?;`, "i");
  const m = sql.match(re);
  if (!m) throw new Error(`UPDATE em ${table} não encontrado`);
  return m[0];
};

const REQUIRED_NULLS = [
  "cancelled_at = NULL",
  "cancelled_by = NULL",
  "cancellation_reason = NULL",
  "cancellation_note = NULL",
  "cancellation_source = NULL",
  "reconciliation_run_id = NULL",
];

describe("RPC reactivate_cancelled_group — contrato", () => {
  it("zera todas as marcas de cancelamento no grupo", () => {
    const block = blockFor("payment_company_groups");
    for (const clause of REQUIRED_NULLS) {
      expect(block, `groups deve conter: ${clause}`).toContain(clause);
    }
  });

  it("zera todas as marcas de cancelamento nos itens (cascata)", () => {
    const block = blockFor("payment_items");
    for (const clause of [...REQUIRED_NULLS, "is_cancelled = false"]) {
      expect(block, `items deve conter: ${clause}`).toContain(clause);
    }
  });

  it("registra quem reativou (trilha de auditoria preservada)", () => {
    expect(sql).toMatch(/cancellation_reactivated_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/cancellation_reactivated_by\s*=\s*v_uid/);
    expect(sql).toMatch(/INSERT INTO public\.audit_log/);
  });

  it("é idempotente — funciona mesmo quando o grupo já não está em status cancelado", () => {
    // Não pode ter "AND status = 'cancelado'" no WHERE do UPDATE de groups,
    // senão registros órfãos (status já mudado mas cancelled_at presente)
    // ficam com o banner para sempre.
    const block = blockFor("payment_company_groups");
    expect(block).not.toMatch(/WHERE[\s\S]*AND\s+status\s*=\s*'cancelado'/);
    // Aceita reativar enquanto houver qualquer marca: status OU cancelled_at.
    expect(sql).toMatch(/status\s*=\s*'cancelado'[\s\S]*OR[\s\S]*cancelled_at\s+IS\s+NOT\s+NULL/);
  });

  it("bloqueia reativação de pagamentos já efetivados", () => {
    expect(sql).toMatch(/cannot_reactivate_paid_payment/);
    expect(sql).toMatch(/IN\s*\(\s*'pago'\s*,\s*'lancado'\s*,\s*'arquivado'\s*\)/);
  });
});

describe("UI banner — contrato com CompanyAnalysis", () => {
  it("o banner depende exclusivamente de cancelled_at (não de status)", () => {
    // Se alguém mudar para `status === 'cancelado'`, o banner volta a divergir
    // do que o RPC limpa. Mantém a fonte única de verdade em cancelled_at.
    const page = readFileSync(
      resolve(__dirname, "../CompanyAnalysis.tsx"),
      "utf8",
    );
    // Aceita tanto a forma extraída `if (!g?.cancelled_at) return null`
    // como o gate inline em JSX `!(group ...).cancelled_at && (...)`.
    expect(page).toMatch(/cancelled_at/);
    expect(page).not.toMatch(/status\s*===\s*['"]cancelado['"]\s*&&\s*\(/);
  });
});
