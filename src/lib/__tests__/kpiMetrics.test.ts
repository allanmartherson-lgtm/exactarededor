import { describe, it, expect } from "vitest";
import {
  buildWindows,
  computeAvgHours,
  computeMetrics,
  deltaPct,
  deltaPoints,
  firstTransitionByPayment,
  type HistoryLite,
  type InvoiceLite,
  type ObsLite,
  type PaymentLite,
} from "@/lib/kpiMetrics";

const NOW = new Date("2026-06-06T12:00:00Z").getTime();
const h = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const makePayment = (over: Partial<PaymentLite>): PaymentLite => ({
  id: "p1",
  status: "em_analise_ia",
  total_amount: 100,
  liquido_total: null,
  created_at: h(48),
  updated_at: h(48),
  approved_at: null,
  validated_at: null,
  created_by: "u1",
  validated_by: null,
  approved_by: null,
  ...over,
});

describe("buildWindows", () => {
  it("monta janela atual e anterior do mesmo tamanho", () => {
    const w = buildWindows(7, NOW);
    const day = 24 * 3_600_000;
    expect(new Date(w.sinceCurr).getTime()).toBe(NOW - 7 * day);
    expect(new Date(w.untilPrev).getTime()).toBe(NOW - 7 * day);
    expect(new Date(w.sincePrev).getTime()).toBe(NOW - 14 * day);
  });

  it.each([7, 30, 90])("respeita a largura de janela %i", (r) => {
    const w = buildWindows(r, NOW);
    const widthCurr = NOW - new Date(w.sinceCurr).getTime();
    const widthPrev = new Date(w.untilPrev).getTime() - new Date(w.sincePrev).getTime();
    expect(widthCurr).toBe(widthPrev);
    expect(widthCurr).toBe(r * 24 * 3_600_000);
  });
});

describe("deltaPct / deltaPoints", () => {
  it("retorna null se faltam pontos ou base é zero", () => {
    expect(deltaPct(10, null)).toBeNull();
    expect(deltaPct(null, 10)).toBeNull();
    expect(deltaPct(10, 0)).toBeNull();
    expect(deltaPoints(10, null)).toBeNull();
  });
  it("calcula corretamente", () => {
    expect(deltaPct(15, 10)).toBeCloseTo(50);
    expect(deltaPct(8, 10)).toBeCloseTo(-20);
    expect(deltaPoints(25, 18)).toBe(7);
  });
});

describe("firstTransitionByPayment", () => {
  it("retorna a transição mais antiga por pagamento", () => {
    const hist: HistoryLite[] = [
      { payment_id: "p1", status_from: null, status_to: "aguardando_aprovacao", changed_at: h(10) },
      { payment_id: "p1", status_from: null, status_to: "aguardando_aprovacao", changed_at: h(20) },
      { payment_id: "p2", status_from: null, status_to: "aguardando_aprovacao", changed_at: h(5) },
      { payment_id: "p3", status_from: null, status_to: "pago", changed_at: h(1) },
    ];
    const out = firstTransitionByPayment(
      hist,
      new Set(["p1", "p2", "p3"]),
      (s) => s === "aguardando_aprovacao",
    );
    expect(out.get("p1")).toBe(new Date(h(20)).getTime());
    expect(out.get("p2")).toBe(new Date(h(5)).getTime());
    expect(out.has("p3")).toBe(false);
  });

  it("ignora payments fora do conjunto", () => {
    const hist: HistoryLite[] = [
      { payment_id: "out", status_from: null, status_to: "aguardando_aprovacao", changed_at: h(1) },
    ];
    expect(firstTransitionByPayment(hist, new Set(["p1"]), () => true).size).toBe(0);
  });
});

describe("computeAvgHours", () => {
  it("ignora pagamentos sem transição (não conta zero)", () => {
    const payments = [
      makePayment({ id: "p1", created_at: h(10) }),
      makePayment({ id: "p2", created_at: h(20) }),
    ];
    const transitions = new Map([["p1", NOW - 4 * 3_600_000]]); // 6h
    const r = computeAvgHours(payments, transitions, null);
    expect(r.count).toBe(1);
    expect(r.avg).toBeCloseTo(6);
  });

  it("usa fallback *_at quando não há transição", () => {
    const payments = [
      makePayment({ id: "p1", created_at: h(10), validated_at: h(7) }), // 3h
    ];
    const r = computeAvgHours(payments, new Map(), "validated_at");
    expect(r.count).toBe(1);
    expect(r.avg).toBeCloseTo(3);
  });

  it("retorna null/0 se ninguém tem transição nem fallback", () => {
    const payments = [makePayment({ id: "p1" })];
    const r = computeAvgHours(payments, new Map(), "validated_at");
    expect(r.avg).toBeNull();
    expect(r.count).toBe(0);
  });

  it("descarta diffs negativos (transição antes do created_at)", () => {
    const payments = [makePayment({ id: "p1", created_at: h(5) })];
    const transitions = new Map([["p1", NOW - 10 * 3_600_000]]);
    const r = computeAvgHours(payments, transitions, null);
    expect(r.avg).toBeNull();
  });
});

describe("computeMetrics", () => {
  const baseArgs = (over: { payments?: PaymentLite[]; history?: HistoryLite[]; observations?: ObsLite[]; invoices?: InvoiceLite[] } = {}) => ({
    payments: [],
    observations: [],
    history: [],
    invoices: [],
    rangeDays: 30,
    invoicesUnscoped: false,
    ...over,
  });

  it("tempos saem do history; validated_at vazio não zera a média", () => {
    const payments: PaymentLite[] = [
      makePayment({ id: "p1", created_at: h(20), validated_at: null, approved_at: null }),
      makePayment({ id: "p2", created_at: h(40), validated_at: null, approved_at: null }),
      makePayment({ id: "p3", created_at: h(10), validated_at: null, approved_at: null }),
    ];
    const history: HistoryLite[] = [
      // p1: 20h até validação, 16h até aprovação
      { payment_id: "p1", status_from: null, status_to: "aguardando_aprovacao", changed_at: h(0) },
      { payment_id: "p1", status_from: null, status_to: "aprovado", changed_at: h(4) === h(4) ? h(4) : h(4) },
      // p2: 40h até validação
      { payment_id: "p2", status_from: null, status_to: "aguardando_aprovacao", changed_at: h(0) },
      // p3: nada
    ];
    // ajuste: aprovação de p1 = saiu 4h atrás => created p1 era 20h atrás => 16h
    const m = computeMetrics(baseArgs({ payments, history }));
    expect(m.validadosCount).toBe(2);
    expect(m.ttValid).toBeCloseTo((20 + 40) / 2);
    expect(m.aprovadosCount).toBe(1);
    expect(m.ttApprov).toBeCloseTo(16);
  });

  it("conta devoluções via payment_observations.status_to", () => {
    const payments = [makePayment({ id: "p1" }), makePayment({ id: "p2" })];
    const observations: ObsLite[] = [
      { payment_id: "p1", status_from: null, status_to: "devolvido_analista", created_at: h(1) },
      { payment_id: "p2", status_from: null, status_to: "aprovado", created_at: h(1) },
    ];
    const m = computeMetrics(baseArgs({ payments, observations }));
    expect(m.devolucoes).toBe(1);
    expect(m.taxaDevolucao).toBeCloseTo(50);
  });

  it("taxa de conclusão soma pago+arquivado", () => {
    const payments = [
      makePayment({ id: "p1", status: "pago" }),
      makePayment({ id: "p2", status: "arquivado" }),
      makePayment({ id: "p3", status: "em_analise_ia" }),
      makePayment({ id: "p4", status: "rejeitado" }),
    ];
    const m = computeMetrics(baseArgs({ payments }));
    expect(m.pagos).toBe(2);
    expect(m.rejeitados).toBe(1);
    expect(m.taxaConclusao).toBeCloseTo(50);
  });

  it("throughput = total / max(range,1)", () => {
    const payments = Array.from({ length: 9 }, (_, i) => makePayment({ id: `p${i}` }));
    const m = computeMetrics(baseArgs({ payments, rangeDays: 30 }));
    expect(m.throughput).toBeCloseTo(0.3);
  });

  it("invoices unscoped vs scoped", () => {
    const payments = [makePayment({ id: "p1" })];
    const invoices: InvoiceLite[] = [
      { id: "i1", status: "divergente", payment_id: "p1", created_at: h(1), ai_validation: null },
      { id: "i2", status: "conciliada", payment_id: "outsider", created_at: h(1), ai_validation: null },
    ];
    expect(computeMetrics(baseArgs({ payments, invoices, invoicesUnscoped: false })).nfTotal).toBe(1);
    expect(computeMetrics({ ...baseArgs({ payments, invoices }), invoicesUnscoped: true }).nfTotal).toBe(2);
  });

  it("janela anterior produz métricas independentes para delta", () => {
    const curr = [makePayment({ id: "a", status: "pago" }), makePayment({ id: "b", status: "pago" })];
    const prev = [makePayment({ id: "c", status: "pago" })];
    const mCurr = computeMetrics(baseArgs({ payments: curr }));
    const mPrev = computeMetrics(baseArgs({ payments: prev }));
    expect(deltaPct(mCurr.total, mPrev.total)).toBeCloseTo(100);
  });
});
