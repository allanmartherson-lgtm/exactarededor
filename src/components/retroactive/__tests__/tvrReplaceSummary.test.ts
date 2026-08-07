import { describe, expect, it } from "vitest";
import {
  buildTvrReplaceSummary,
  computeTvrCounts,
  computeTvrFinancialTotals,
  type TvrResult,
} from "@/lib/tvr";
import { parseCellMoney } from "../RetroactiveMappingWizard";

/**
 * Factory minimal — preenche apenas campos relevantes para os cálculos
 * (status, valor_total_tasy, valor_pago_base, dif_valor). O restante fica
 * com defaults vazios, suficiente para os helpers puros.
 */
function r(overrides: Partial<TvrResult>): TvrResult {
  return {
    key: overrides.key ?? Math.random().toString(36).slice(2),
    atendimento: "",
    tuss: "",
    procedimento: "",
    paciente: "",
    data: "",
    convenio: "",
    medico: "",
    funcao: "",
    qtd_tasy: 0,
    valor_unit_tasy: 0,
    valor_total_tasy: 0,
    qtd_por_func: 0,
    n_funcs: 0,
    funcoes_pagas: "",
    lotes: "",
    valor_pago_base: 0,
    valor_com_acordo: 0,
    dif_qtd: 0,
    dif_valor: 0,
    valor_recuperar_acordo: 0,
    valor_com_acordo_recalc: 0,
    ajuste_acordo: 0,
    tipo_analise: "valor",
    status: "ok",
    ...overrides,
  };
}

describe("buildTvrReplaceSummary — reprocesso é REPLACE completo", () => {
  it("sobrescreve summary sem mesclar contadores antigos (div_qtd, pago_sem_tasy, etc.)", () => {
    const previous = {
      mode: "tasy_vs_repasse",
      total: 99,
      total_gap: 12345,
      total_excess: 678,
      tvr_counts: {
        nao_pago: 5,
        div_qtd: 7, // status legado — não pode reaparecer
        pago_sem_tasy: 3, // status legado — não pode reaparecer
        div_qtd_valor: 0,
        div_valor: 0,
        pago_a_mais: 0,
        ausente_tasy: 0,
        ok: 0,
      },
      contador_inventado: "lixo",
    };

    const list: TvrResult[] = [
      r({ status: "ok" }),
      r({ status: "ausente_tasy", valor_pago_base: 100 }),
    ];

    const next = buildTvrReplaceSummary(list, previous, {
      tasy_file: "novo.xlsx",
      tasy_file_totals: { file: 10, valid: 8, excluded: 1, dropped: 1 },
      tasy_dropped_examples: [{ row_index: 3, missing: ["TUSS"] }],
      exclude_tuss: "",
      processed_at: "2026-06-10T00:00:00Z",
    });

    expect(next.total).toBe(2);
    expect(next.tvr_counts).toEqual({
      nao_pago: 0,
      div_qtd_valor: 0,
      div_valor: 0,
      pago_a_mais: 0,
      ausente_tasy: 1,
      ok: 1,
    });
    // Não pode existir nenhuma chave legada no novo summary.
    expect((next.tvr_counts as Record<string, unknown>).div_qtd).toBeUndefined();
    expect((next.tvr_counts as Record<string, unknown>).pago_sem_tasy).toBeUndefined();
    expect((next as Record<string, unknown>).contador_inventado).toBeUndefined();
  });

  it("preserva handoff e faz append no histórico (sem mesclar resto)", () => {
    const previous = {
      handoff: { payment_id: "p-1", sent_at: "2026-06-09T10:00:00Z" },
      tvr_validation_history: [{ at: "2026-06-09T09:00:00Z", total: 1 }],
      tvr_counts: { div_qtd: 7 },
    };

    const next = buildTvrReplaceSummary([r({ status: "ok" })], previous, {
      processed_at: "2026-06-10T00:00:00Z",
    });

    expect((next as { handoff?: unknown }).handoff).toEqual(previous.handoff);
    const history = next.tvr_validation_history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ at: "2026-06-09T09:00:00Z", total: 1 });
    expect(history[1].total).toBe(1);
    // counts antigos não vazaram para o nível superior
    expect((next.tvr_counts as Record<string, number>).div_qtd ?? 0).toBe(0);
  });

  it("trunca histórico em 20 entradas", () => {
    const previousHistory = Array.from({ length: 25 }, (_, i) => ({ at: `t-${i}`, total: i }));
    const next = buildTvrReplaceSummary([], { tvr_validation_history: previousHistory }, {});
    const history = next.tvr_validation_history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(20);
    // mantém as 19 mais recentes + a nova
    expect(history[0]).toEqual({ at: "t-6", total: 6 });
  });
});

describe("Reprocessar mantém cards financeiros e exportação Excel idênticos", () => {
  const list: TvrResult[] = [
    r({ status: "nao_pago", valor_total_tasy: 1000, valor_previsto_regra: 700 }),
    r({ status: "div_valor", dif_valor: 250, valor_pago_base: 750 }),
    r({ status: "div_valor", dif_valor: -180, valor_pago_base: 1180 }),
    r({ status: "ausente_tasy", valor_pago_base: 420 }),
    r({ status: "ok", valor_total_tasy: 500, valor_pago_base: 500 }),
  ];

  it("computeTvrFinancialTotals é determinístico por input (cards financeiros estáveis)", () => {
    const first = computeTvrFinancialTotals(list);
    const second = computeTvrFinancialTotals(list);
    expect(first).toEqual(second);
    // Sanidade dos números (alinhado às regras dos cards):
    //  - Complementar = 700 (não pago COM previsão) + 250 (dif positivo)
    //  - Retirar = 420 (ausente_tasy) + 180 (dif negativo)
    expect(first.totalComplementar).toBeCloseTo(950, 2);
    expect(first.totalRetirar).toBeCloseTo(600, 2);
  });

  it("computeTvrCounts é determinístico (status pills estáveis)", () => {
    expect(computeTvrCounts(list)).toEqual(computeTvrCounts(list));
  });

  it("reprocessar a MESMA reconciliation_id produz os mesmos totais no summary, independente do previousSummary", () => {
    const a = buildTvrReplaceSummary(list, null, { processed_at: "2026-06-10T00:00:00Z" });
    const b = buildTvrReplaceSummary(
      list,
      {
        total: 999,
        total_gap: 0,
        total_excess: 0,
        tvr_counts: { pago_sem_tasy: 42, div_qtd: 99 },
      },
      { processed_at: "2026-06-10T00:00:00Z" },
    );
    expect(b.total).toBe(a.total);
    expect(b.total_gap).toBe(a.total_gap);
    expect(b.total_excess).toBe(a.total_excess);
    expect(b.tvr_counts).toEqual(a.tvr_counts);
  });
});

describe("buildTvrReplaceSummary — preserva escopo do lote em reprocessos repetidos", () => {
  const scopedPrevious = {
    mode: "tasy_vs_repasse",
    scope: "selected_payments",
    selected_payment_ids: ["p-1", "p-2"],
    selected_payment_labels: ["Lote A", "Lote B"],
    multi_company_ids: ["c-1"],
    multi_doctor_ids: ["d-1", "d-2"],
    multi_labels: { companies: ["Empresa X"], doctors: ["Dr. A", "Dr. B"] },
    handoff: { payment_id: "p-1", sent_at: "2026-06-09T10:00:00Z" },
    tvr_counts: { div_qtd: 7, pago_sem_tasy: 3 },
    total: 42,
  };

  it("mantém selected_payment_ids/scope/multi_* no primeiro reprocesso (trigger enforce não rejeita)", () => {
    const list: TvrResult[] = [r({ status: "ok" }), r({ status: "nao_pago", valor_total_tasy: 100 })];
    const next = buildTvrReplaceSummary(list, scopedPrevious, { processed_at: "2026-06-10T00:00:00Z" });

    expect(next.scope).toBe("selected_payments");
    expect(next.selected_payment_ids).toEqual(["p-1", "p-2"]);
    expect(next.selected_payment_labels).toEqual(["Lote A", "Lote B"]);
    expect(next.multi_company_ids).toEqual(["c-1"]);
    expect(next.multi_doctor_ids).toEqual(["d-1", "d-2"]);
    expect(next.multi_labels).toEqual({ companies: ["Empresa X"], doctors: ["Dr. A", "Dr. B"] });
    expect((next as { handoff?: unknown }).handoff).toEqual(scopedPrevious.handoff);
  });

  it("N reprocessos consecutivos não perdem escopo e não inflam totais", () => {
    const list: TvrResult[] = [
      // nao_pago COM previsão soma no gap; sem previsão só entra como teto.
      r({ status: "nao_pago", valor_total_tasy: 1000, valor_previsto_regra: 700 }),
      r({ status: "div_valor", dif_valor: 250, valor_pago_base: 750 }),
      r({ status: "ausente_tasy", valor_pago_base: 420 }),
    ];

    let summary: Record<string, unknown> = scopedPrevious;
    const snapshots: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5; i++) {
      summary = buildTvrReplaceSummary(list, summary, {
        processed_at: `2026-06-1${i}T00:00:00Z`,
      });
      snapshots.push(summary);
    }

    // Totais estáveis em todos os reprocessos — nada infla.
    for (const s of snapshots) {
      expect(s.total).toBe(3);
      expect(s.total_gap).toBeCloseTo(950, 2); // 700 (previsto) + 250 (dif)
      expect(s.total_excess).toBeCloseTo(420, 2);
      expect(s.selected_payment_ids).toEqual(["p-1", "p-2"]);
      expect(s.scope).toBe("selected_payments");
      expect(s.multi_company_ids).toEqual(["c-1"]);
    }

    // Histórico cresce em cada reprocesso (append, sem duplicar counters legados).
    const history = snapshots[4].tvr_validation_history as Array<Record<string, unknown>>;
    expect(history.length).toBe(5);
    expect((snapshots[4].tvr_counts as Record<string, unknown>).div_qtd).toBeUndefined();
    expect((snapshots[4].tvr_counts as Record<string, unknown>).pago_sem_tasy).toBeUndefined();
  });

  it("cenário 'Limpar tudo' — lista vazia zera totais mas mantém escopo do lote", () => {
    const cleared = buildTvrReplaceSummary([], scopedPrevious, {
      processed_at: "2026-06-10T00:00:00Z",
    });
    expect(cleared.total).toBe(0);
    expect(cleared.total_gap).toBe(0);
    expect(cleared.total_excess).toBe(0);
    // Escopo obrigatório para o trigger continua no summary.
    expect(cleared.selected_payment_ids).toEqual(["p-1", "p-2"]);
    expect(cleared.scope).toBe("selected_payments");
    // Todos os counters zeram — nada legado sobrevive.
    expect(cleared.tvr_counts).toEqual({
      nao_pago: 0,
      div_qtd_valor: 0,
      div_valor: 0,
      pago_a_mais: 0,
      ausente_tasy: 0,
      ok: 0,
    });
  });

  it("previousSummary sem escopo não injeta chaves undefined (evita quebra do trigger)", () => {
    const next = buildTvrReplaceSummary([r({ status: "ok" })], {}, {});
    expect("selected_payment_ids" in next).toBe(false);
    expect("scope" in next).toBe(false);
    expect("multi_company_ids" in next).toBe(false);
  });
});

describe("parseCellMoney — BRL determinístico (vírgula=decimal, ponto=milhar)", () => {
  it("interpreta formato BR canônico", () => {
    expect(parseCellMoney("1.234,56")).toBe("1234.56");
    expect(parseCellMoney("50.000,00")).toBe("50000.00");
    expect(parseCellMoney("326,06")).toBe("326.06");
  });

  it("sem vírgula: pontos são sempre milhar", () => {
    expect(parseCellMoney("629.765")).toBe("629765");
    expect(parseCellMoney("1.234.567")).toBe("1234567");
    expect(parseCellMoney("50.000")).toBe("50000");
  });

  it("preserva números puros e vazio", () => {
    expect(parseCellMoney(1234.56)).toBe("1234.56");
    expect(parseCellMoney(0)).toBe("0");
    expect(parseCellMoney("")).toBe("");
    expect(parseCellMoney(null)).toBe("");
    expect(parseCellMoney(undefined)).toBe("");
  });

  it("mantém sinal negativo", () => {
    expect(parseCellMoney("-1.234,56")).toBe("-1234.56");
    expect(parseCellMoney("-500")).toBe("-500");
    expect(parseCellMoney("R$ -1.234,56")).toBe("-1234.56");
  });

  it("aceita símbolos monetários e espaços", () => {
    expect(parseCellMoney("R$ 1.234,56")).toBe("1234.56");
    expect(parseCellMoney(" 1234,56 ")).toBe("1234.56");
  });

  it("múltiplos milhares em BR", () => {
    expect(parseCellMoney("1.234.567,89")).toBe("1234567.89");
  });
});
