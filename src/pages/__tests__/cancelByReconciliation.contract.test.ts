import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato do RPC `cancel_by_reconciliation` (botão "Cancelar item deste pagamento").
 *
 * Garante que a máquina de estados está padronizada na ETAPA DE ANÁLISE:
 *  - allowlist explícito contém apenas status de análise
 *  - nenhuma referência a status/tabelas de NF (nota fiscal)
 *
 * Se alguém reintroduzir checagens contra `invoices` ou status `nf_*` neste
 * RPC, este teste quebra — protegendo contra a regressão original em que
 * cancelar pela conciliação tentava ler NF na etapa errada.
 */

const migrationsDir = resolve(__dirname, "../../../supabase/migrations");

const latestRpc = (): string => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const body = readFileSync(resolve(migrationsDir, files[i]), "utf8");
    if (
      body.includes("FUNCTION public.cancel_by_reconciliation") ||
      body.includes("function public.cancel_by_reconciliation")
    ) {
      return body;
    }
  }
  throw new Error("Nenhuma migração define cancel_by_reconciliation");
};

const sql = latestRpc();

const AUDIT_LOG_ALLOWED_ACTIONS = [
  "create",
  "update",
  "create_via_rpc",
  "update_via_rpc",
  "auto_set_valid_until",
  "delete",
  "profile_updated",
  "created",
  "updated",
  "deleted",
  "approved",
  "rejected",
  "reactivated",
  "deactivated",
  "role_added",
  "role_removed",
  "password_reset",
  "invite_resent",
] as const;

const AUDIT_LOG_ALLOWED_ENTITY_TYPES = [
  "rule",
  "rule_calculation",
  "payment",
  "payment_item",
  "user",
  "profile",
  "access_request",
  "company",
  "doctor",
  "invoice",
  "notification",
] as const;

// Allowlist canônico da etapa de análise. Mantenha em sincronia com a função SQL
// e com src/lib/paymentFlow.ts.
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
];

// Status que NÃO podem aparecer no RPC: pertencem ao ciclo de NF ou são pós-análise.
const FORBIDDEN_STATUSES = [
  "pedido_nf_enviado",
  "nf_recebida",
  "nf_conciliada",
  "nf_divergente",
  "nf_questionada",
  "pago",
  "lancado",
];

describe("RPC cancel_by_reconciliation — máquina de estados (etapa de análise)", () => {
  it("define um allowlist explícito da etapa de análise", () => {
    for (const s of ANALYSIS_STAGE) {
      expect(sql, `allowlist deve mencionar '${s}'`).toContain(`'${s}'`);
    }
  });

  it("rejeita pagamento fora da etapa de análise com erro claro", () => {
    expect(sql).toMatch(/payment_not_in_analysis_stage/);
  });

  it("não referencia status do ciclo de NF", () => {
    for (const s of FORBIDDEN_STATUSES) {
      expect(sql, `RPC não pode mencionar status de NF '${s}'`).not.toContain(`'${s}'`);
    }
  });

  it("não consulta a tabela invoices em nenhum ponto", () => {
    expect(sql).not.toMatch(/\bpublic\.invoices\b/i);
    expect(sql).not.toMatch(/\bfrom\s+invoices\b/i);
    expect(sql).not.toMatch(/\bjoin\s+invoices\b/i);
  });

  it("não usa o erro legado de NF ativa", () => {
    expect(sql).not.toMatch(/cannot_cancel_with_active_invoice/);
  });

  it("marca a linha do relatório com action_taken = cancelado_conciliacao", () => {
    expect(sql).toMatch(/action_taken\s*=\s*'cancelado_conciliacao'/);
  });

  it("registra trilha de auditoria com o status do pagamento no momento", () => {
    expect(sql).toMatch(/INSERT INTO public\.audit_log/);
    expect(sql).toMatch(/payment_status_at_action/);
  });

  it("usa action/entity_type aceitos pelas constraints reais do audit_log", () => {
    const insertMatch = sql.match(
      /INSERT INTO public\.audit_log\(actor_id, action, entity_type, entity_id, diff, hospital_id\)[\s\S]*?VALUES\s*\([\s\S]*?v_uid,\s*'([^']+)',\s*'([^']+)'/,
    );
    expect(insertMatch, "INSERT em audit_log não encontrado").not.toBeNull();
    const [, action, entityType] = insertMatch!;
    expect(AUDIT_LOG_ALLOWED_ACTIONS).toContain(action as never);
    expect(AUDIT_LOG_ALLOWED_ENTITY_TYPES).toContain(entityType as never);
    expect(action).not.toBe("cancel_by_reconciliation");
    expect(entityType).not.toBe("reconciliation_runs");
  });
});

describe("Dialog CancelByReconciliation — UI não mistura com fluxo de NF", () => {
  const dialog = readFileSync(
    resolve(__dirname, "../../components/payment-detail/CancelByReconciliationDialog.tsx"),
    "utf8",
  );

  it("não trata erros nem termos do ciclo de NF no dialog de conciliação", () => {
    expect(dialog).not.toMatch(/cannot_cancel_with_active_invoice/);
    expect(dialog).not.toMatch(/nota fiscal/i);
    expect(dialog).not.toMatch(/\bNF\b/);
    expect(dialog).not.toMatch(/invoice/i);
  });

  it("trata explicitamente o erro de etapa de análise", () => {
    expect(dialog).toContain("payment_not_in_analysis_stage");
  });
});

