import { describe, expect, it } from "vitest";
import {
  buildTvrReplaceSummary,
  computeTvrCounts,
  computeTvrFinancialTotals,
  type TvrResult,
} from "../RetroactiveReconciliationsTab";

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
    r({ status: "nao_pago", valor_total_tasy: 1000 }),
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
    //  - Complementar = 1000 (não pago) + 250 (dif positivo)
    //  - Retirar = 420 (ausente_tasy) + 180 (dif negativo)
    expect(first.totalComplementar).toBeCloseTo(1250, 2);
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
