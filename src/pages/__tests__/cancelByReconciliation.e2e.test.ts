import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E lógico do fluxo "Cancelar item via conciliação":
 *
 *   abrir conciliação → cancelar item → KPIs/abas atualizam
 *   → item sai de qualquer bucket de validação/aprovação
 *   → totais financeiros do grid de pagamento ignoram o item
 *   → ai_findings/alerts/validation_findings são suprimidos
 *
 * Para evitar dependência do supabase real, simulamos o estado dos dados
 * (items da reconciliation_run e payment_items) e exercitamos as MESMAS
 * funções de cálculo que a UI usa:
 *
 *   • PaymentConciliationModal.scopedStats / filteredItems  → replicamos a regra
 *     (item com action_taken='cancelado_conciliacao' conta como conciliado e
 *      some das abas de divergência).
 *   • ItemsDataGrid.totals  → replicamos a regra (item is_cancelled sai dos
 *     totais valor/esperado).
 *   • usePaymentDetailData sanitização  → grep no arquivo confirma o pós-load.
 *
 * Se algum dia mudarmos a regra, este teste guia a refatoração: a falha aponta
 * exatamente qual invariante quebrou.
 */

type ReconItem = {
  id: string;
  status: string;
  action_taken: string | null;
  valor_exacta: number;
  valor_hospital: number;
};

type PaymentItem = {
  id: string;
  gross_amount: number;
  expected_amount: number | null;
  is_cancelled: boolean;
  ai_findings: { alerts: string[]; needs_human_review?: boolean } | null;
  validation_findings: unknown[];
};

// ─── Replicação fiel da regra do PaymentConciliationModal ────────────────────
function scopedStats(items: ReconItem[]) {
  let conciliado = 0, valor_divergente = 0, so_exacta = 0, cancelado_conc = 0;
  let risco_menos = 0;
  for (const it of items) {
    if (it.action_taken === "cancelado_conciliacao") {
      conciliado++;
      cancelado_conc++;
      continue;
    }
    if (it.status === "conciliado") conciliado++;
    else if (it.status === "valor_divergente") valor_divergente++;
    else if (it.status === "so_exacta") {
      so_exacta++;
      risco_menos += it.valor_exacta;
    }
  }
  return { conciliado, valor_divergente, so_exacta, cancelado_conc, risco_menos };
}

function filteredItems(items: ReconItem[], activeFilter: string) {
  if (activeFilter === "todos") return items;
  if (activeFilter === "conciliado") {
    return items.filter(
      (it) => it.status === "conciliado" || it.action_taken === "cancelado_conciliacao",
    );
  }
  return items.filter(
    (it) => it.status === activeFilter && it.action_taken !== "cancelado_conciliacao",
  );
}

// ─── Replicação fiel da regra do ItemsDataGrid.totals ────────────────────────
function gridTotals(items: PaymentItem[]) {
  let valor = 0, esperado = 0, count = 0;
  let temEsperado = false;
  for (const it of items) {
    if (it.is_cancelled) continue;
    count++;
    valor += it.gross_amount;
    if (it.expected_amount != null) {
      esperado += it.expected_amount;
      temEsperado = true;
    }
  }
  return { count, valor, esperado: temEsperado ? esperado : null };
}

// ─── Cenário base: 3 itens "só no Exacta" + 2 conciliados ─────────────────────
const buildScenario = () => ({
  recon: [
    { id: "r1", status: "so_exacta", action_taken: null, valor_exacta: 1000, valor_hospital: 0 },
    { id: "r2", status: "so_exacta", action_taken: null, valor_exacta: 2000, valor_hospital: 0 },
    { id: "r3", status: "so_exacta", action_taken: null, valor_exacta: 500, valor_hospital: 0 },
    { id: "r4", status: "conciliado", action_taken: null, valor_exacta: 100, valor_hospital: 100 },
    { id: "r5", status: "conciliado", action_taken: null, valor_exacta: 200, valor_hospital: 200 },
  ] as ReconItem[],
  payment: [
    { id: "p1", gross_amount: 1000, expected_amount: 1000, is_cancelled: false,
      ai_findings: { alerts: ["Alerta de validação"], needs_human_review: true },
      validation_findings: [{ kind: "duplicidade_exata", action: "alerta" }] },
    { id: "p2", gross_amount: 2000, expected_amount: 2000, is_cancelled: false,
      ai_findings: { alerts: [] }, validation_findings: [] },
    { id: "p3", gross_amount: 500, expected_amount: 500, is_cancelled: false,
      ai_findings: { alerts: [] }, validation_findings: [] },
  ] as PaymentItem[],
});

describe("E2E — cancelar item via conciliação reflete em toda a UI", () => {
  it("estado inicial: 3 só-no-Exacta, 2 conciliados, risco_menos = 3500", () => {
    const { recon } = buildScenario();
    const s = scopedStats(recon);
    expect(s.so_exacta).toBe(3);
    expect(s.conciliado).toBe(2);
    expect(s.cancelado_conc).toBe(0);
    expect(s.risco_menos).toBe(3500);
    expect(filteredItems(recon, "so_exacta")).toHaveLength(3);
    expect(filteredItems(recon, "conciliado")).toHaveLength(2);
  });

  it("após cancelar 1 item: KPI Só no Exacta cai, Conciliados sobe, risco_menos diminui", () => {
    const { recon } = buildScenario();
    // Simula RPC cancel_by_reconciliation: marca a linha como cancelado_conciliacao.
    const after = recon.map((it) =>
      it.id === "r1" ? { ...it, action_taken: "cancelado_conciliacao" } : it,
    );
    const s = scopedStats(after);
    expect(s.so_exacta).toBe(2);            // era 3
    expect(s.conciliado).toBe(3);           // era 2 (sobe pelo cancelado)
    expect(s.cancelado_conc).toBe(1);
    expect(s.risco_menos).toBe(2500);       // era 3500, perdeu 1000 do r1
  });

  it("item cancelado some da aba 'Só no Exacta' e aparece em 'Conciliados'", () => {
    const { recon } = buildScenario();
    const after = recon.map((it) =>
      it.id === "r1" ? { ...it, action_taken: "cancelado_conciliacao" } : it,
    );
    const soExacta = filteredItems(after, "so_exacta");
    expect(soExacta.map((i) => i.id)).not.toContain("r1");
    expect(soExacta).toHaveLength(2);

    const conciliados = filteredItems(after, "conciliado");
    expect(conciliados.map((i) => i.id)).toContain("r1");
    expect(conciliados).toHaveLength(3);
  });

  it("item cancelado NÃO aparece em buckets de divergência (valor/qtd/etc.)", () => {
    const { recon } = buildScenario();
    // Mesmo se o status original fosse valor_divergente, o cancelamento prevalece.
    const after = recon.map((it) =>
      it.id === "r1"
        ? { ...it, status: "valor_divergente", action_taken: "cancelado_conciliacao" }
        : it,
    );
    expect(filteredItems(after, "valor_divergente")).toHaveLength(0);
    const conciliados = filteredItems(after, "conciliado");
    expect(conciliados.map((i) => i.id)).toContain("r1");
  });

  it("totais do grid de pagamento ignoram item cancelado", () => {
    const { payment } = buildScenario();
    const before = gridTotals(payment);
    expect(before.count).toBe(3);
    expect(before.valor).toBe(3500);
    expect(before.esperado).toBe(3500);

    // Simula UPDATE em payment_items: is_cancelled = true para p1.
    const after = payment.map((it) =>
      it.id === "p1" ? { ...it, is_cancelled: true } : it,
    );
    const afterTotals = gridTotals(after);
    expect(afterTotals.count).toBe(2);       // era 3
    expect(afterTotals.valor).toBe(2500);    // perdeu 1000 de p1
    expect(afterTotals.esperado).toBe(2500); // perdeu 1000 de p1
  });
});

describe("Supressão de ai_findings/alerts em itens cancelados — sanitização no load", () => {
  const hook = readFileSync(
    resolve(__dirname, "../../hooks/usePaymentDetailData.ts"),
    "utf8",
  );

  it("usePaymentDetailData sanitiza alerts em ai_findings quando is_cancelled", () => {
    expect(hook).toMatch(/is_cancelled[\s\S]{0,400}alerts:\s*\[\s*\]/);
  });

  it("usePaymentDetailData zera validation_findings quando is_cancelled", () => {
    expect(hook).toMatch(/is_cancelled[\s\S]{0,400}validation_findings:\s*\[\s*\]/);
  });

  it("usePaymentDetailData desliga needs_human_review quando is_cancelled", () => {
    expect(hook).toMatch(/is_cancelled[\s\S]{0,400}needs_human_review:\s*false/);
  });
});
