import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato dos BOTÕES da etapa de análise dentro da conciliação:
 *   - Ignorar
 *   - Revisar manualmente
 *   - Marcar como glosa
 *   - Cancelar item deste pagamento (via RPC `cancel_by_reconciliation`)
 *   - Incorporar crédito / débito
 *
 * Garante simultaneamente que:
 *  1) O TRIGGER `enforce_recon_action_analysis_stage` está definido no banco e
 *     bloqueia gravação fora da etapa de análise.
 *  2) O `handleAction` do modal `PaymentConciliationModal` NÃO consulta nenhuma
 *     tabela ou status do ciclo de NF — toda operação só toca tabelas da etapa
 *     de análise (reconciliation_items, payment_items, payment_company_groups).
 *  3) As filtragens de "lote ativo" para incorporar crédito/débito usam apenas
 *     status de análise.
 */

const migrationsDir = resolve(__dirname, "../../../supabase/migrations");
const modalPath = resolve(
  __dirname,
  "../../components/payment-detail/PaymentConciliationModal.tsx",
);
const paymentDetailHookPath = resolve(__dirname, "../../hooks/usePaymentDetailData.ts");

const ANALYSIS_STAGE = [
  "rascunho",
  "em_confeccao",
  "em_analise_ia",
  "revisao_analista",
  "concluida_analista",
  "devolvido_analista",
  "aprovado_em_revisao",
  "aguardando_validacao",
  "aguardando_aprovacao",
] as const;

const NF_TABLES = ["invoices", "invoice_questions", "invoice_question_attachments"];
const NF_STATUSES = [
  "pedido_nf_enviado",
  "nf_recebida",
  "nf_conciliada",
  "nf_divergente",
  "nf_questionada",
  "em_questionamento",
];

// Ações válidas que os botões podem gravar — devem casar com o trigger SQL.
const VALID_ACTIONS = [
  "ignorar",
  "revisar_manual",
  "marcar_glosa",
  "incorporar_credito",
  "incorporar_debito",
  "cancelado_conciliacao",
] as const;

const latestMigrationContaining = (needle: string): string => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const body = readFileSync(resolve(migrationsDir, files[i]), "utf8");
    if (body.includes(needle)) return body;
  }
  throw new Error(`Nenhuma migração contém '${needle}'`);
};

// ─── 1. Trigger no banco ────────────────────────────────────────────────────
describe("Trigger enforce_recon_action_analysis_stage", () => {
  // Precisa ser a migração que DEFINE o trigger. Um needle genérico pegava
  // a migração mais recente que apenas o cita num comentário.
  const sql = latestMigrationContaining("CREATE TRIGGER trg_enforce_recon_action_analysis_stage");

  it("é criado em BEFORE INSERT OR UPDATE OF action_taken", () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_enforce_recon_action_analysis_stage/i);
    expect(sql).toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+action_taken/i);
    expect(sql).toMatch(/ON\s+public\.reconciliation_items/i);
  });

  it("lista exatamente o allowlist da etapa de análise", () => {
    for (const s of ANALYSIS_STAGE) {
      expect(sql, `trigger deve listar '${s}'`).toContain(`'${s}'`);
    }
  });

  it("rejeita ações em pagamentos fora da etapa de análise", () => {
    expect(sql).toMatch(/recon_action_payment_not_in_analysis_stage/);
  });

  it("rejeita valores de action_taken inválidos", () => {
    expect(sql).toMatch(/invalid_action_taken/);
    for (const a of VALID_ACTIONS) {
      expect(sql, `trigger deve permitir ação '${a}'`).toContain(`'${a}'`);
    }
  });

  it("não menciona nenhum status do ciclo de NF", () => {
    for (const s of NF_STATUSES) {
      expect(sql, `trigger não pode citar status '${s}'`).not.toContain(`'${s}'`);
    }
  });

  it("não consulta tabelas do ciclo de NF", () => {
    for (const t of NF_TABLES) {
      expect(sql, `trigger não pode citar tabela '${t}'`).not.toMatch(
        new RegExp(`\\bpublic\\.${t}\\b|\\bfrom\\s+${t}\\b|\\bjoin\\s+${t}\\b`, "i"),
      );
    }
  });
});

// ─── 2. handleAction no modal — análise pura ────────────────────────────────
describe("PaymentConciliationModal.handleAction — não mistura com fluxo de NF", () => {
  const modal = readFileSync(modalPath, "utf8");
  const paymentDetailHook = readFileSync(paymentDetailHookPath, "utf8");

  // Extrai o corpo da função handleAction (do "const handleAction" até o "};" do escopo).
  const extractHandler = (): string => {
    const start = modal.indexOf("const handleAction");
    expect(start, "handleAction não encontrado no modal").toBeGreaterThan(-1);
    // Heurística: a função termina em "\n  };\n" no nível de indentação 2.
    const tail = modal.indexOf("\n  };\n", start);
    expect(tail, "fim de handleAction não localizado").toBeGreaterThan(start);
    return modal.slice(start, tail);
  };

  const handler = extractHandler();

  it("declara as 5 ações válidas da etapa de análise", () => {
    for (const a of ["incorporar_credito", "incorporar_debito", "marcar_glosa", "revisar_manual", "ignorar"]) {
      expect(handler, `handleAction deve declarar '${a}'`).toContain(`'${a}'`);
    }
  });

  it("nunca consulta tabelas do ciclo de NF", () => {
    for (const t of NF_TABLES) {
      expect(handler, `handler não pode usar .from('${t}')`).not.toContain(`'${t}'`);
      expect(handler, `handler não pode usar .from("${t}")`).not.toContain(`"${t}"`);
    }
  });

  it("nunca menciona status do ciclo de NF", () => {
    for (const s of NF_STATUSES) {
      expect(handler, `handler não pode usar status '${s}'`).not.toContain(`'${s}'`);
    }
  });

  it("incorporar só grava no lote vigente — nunca procura outro lote", () => {
    // O alvo da incorporação é SEMPRE o `paymentId` do modal aberto. Antes o
    // handler escolhia um "lote ativo" por consulta (`.in('payments.status',
    // [...analysis])`); hoje não há escolha nenhuma, o que é mais forte: não
    // existe caminho para escrever num lote que já entrou no ciclo de NF.
    //
    // O que garante que o lote vigente está de fato na etapa de análise é o
    // trigger enforce_recon_action_analysis_stage (bloco 1 deste arquivo).
    // Aqui protegemos a outra metade: que o cliente não volte a resolver lote
    // por conta própria.
    expect(handler, "handler não pode consultar a tabela payments").not.toMatch(
      /\.from\(\s*['"]payments['"]\s*\)/,
    );
    expect(handler, "handler não pode filtrar por payments.status").not.toContain(
      "payments.status",
    );

    // E toda escrita fica presa ao lote do modal.
    const eqPaymentId = [...handler.matchAll(/\.eq\(\s*['"]payment_id['"]\s*,\s*([A-Za-z0-9_.]+)/g)];
    expect(eqPaymentId.length, "esperado ao menos um .eq('payment_id', paymentId)").toBeGreaterThan(0);
    for (const m of eqPaymentId) {
      expect(m[1], `.eq('payment_id', ${m[1]}) deveria usar paymentId`).toBe("paymentId");
    }
    expect(handler, "o insert do item incorporado usa o lote vigente").toMatch(
      /payment_id:\s*paymentId/,
    );
  });

  it("toda gravação em reconciliation_items grava action_taken válido", () => {
    // Procura todos os literais passados ao campo action_taken e confere que
    // batem com VALID_ACTIONS (mesma lista que o trigger aceita).
    const re = /action_taken:\s*['"]([a-z_]+)['"]/g;
    const used = new Set<string>();
    for (const m of handler.matchAll(re)) used.add(m[1]);
    // Também o caso `action_taken: action` (variável) — adicionamos os 5 acima por inferência.
    for (const a of used) {
      expect(
        (VALID_ACTIONS as readonly string[]).includes(a),
        `action_taken='${a}' não está na allowlist do trigger`,
      ).toBe(true);
    }
  });

  it("cancelamento é delegado ao RPC dedicado, nunca grava cancelado_conciliacao direto no modal", () => {
    // O botão "Cancelar item deste pagamento" usa o dialog que chama rpc().
    // O handler NÃO pode gravar essa ação por update direto (bypassaria a auditoria).
    expect(handler).not.toMatch(/action_taken:\s*['"]cancelado_conciliacao['"]/);
  });

  it("não seleciona coluna inexistente rules.action ao carregar regras da análise", () => {
    expect(paymentDetailHook).not.toMatch(/from\(["']rules["']\)[\s\S]*?select\(["'][^"']*\baction\b/);
  });
});
