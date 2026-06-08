/**
 * Cobre a soma do KPI quando combinamos as 4 fontes que alimentam
 * `get_intervention_savings`:
 *  - intervenção de diretor/validador (delta = expected − gross)
 *  - correção do analista (delta = old − new)
 *  - cancelamento de empresa  (delta = gross do item)
 *  - cancelamento de item     (delta = gross do item)
 *
 * Também valida que itens contabilizados por mais de uma fonte são
 * detectados (sinal de duplicidade) e que a agregação por pagamento
 * cobre todos os eventos.
 */
import { describe, it, expect } from "vitest";
import {
  classifyDelta,
  filterItems,
  findDuplicateItemEvents,
  groupItemsForAudit,
  summarizeItems,
  type InterventionItem,
  type IntervenorRole,
} from "@/lib/interventionSavings";

const ev = (
  role: IntervenorRole,
  delta: number,
  over: Partial<InterventionItem> = {},
): InterventionItem => ({
  item_id: over.item_id ?? `it-${Math.random().toString(36).slice(2, 8)}`,
  payment_id: over.payment_id ?? "pay-1",
  obs_id: over.obs_id ?? `o-${Math.random().toString(36).slice(2, 8)}`,
  valor_regra: over.valor_regra ?? Math.max(0, delta),
  valor_pago_final: over.valor_pago_final ?? Math.max(0, -delta),
  delta,
  author_id: over.author_id ?? "u1",
  autor: over.autor ?? "Tester",
  role,
  obs_at: over.obs_at ?? "2026-06-01T10:00:00Z",
  acatado_at: over.acatado_at ?? "2026-06-02T10:00:00Z",
  doctor_name: over.doctor_name ?? null,
  procedure_code: over.procedure_code ?? null,
  procedure_name: over.procedure_name ?? null,
  company_name: over.company_name ?? null,
});

describe("KPI — todas as fontes alimentam o saldo sem perder sinal", () => {
  it("soma diretor + analista + cancelamento empresa + cancelamento item", () => {
    const items: InterventionItem[] = [
      ev("diretor", 300),               // economia
      ev("analista", 200),              // economia (ajuste p/ menos)
      ev("analista", -150),             // aumento (ajuste p/ mais → entra como perda)
      ev("cancelamento_empresa", 500),  // economia
      ev("cancelamento_item", 80),      // economia
      ev("validador", -40),             // aumento
    ];
    const s = summarizeItems(items);
    expect(s.economia).toBeCloseTo(300 + 200 + 500 + 80);
    expect(s.perda).toBeCloseTo(150 + 40);
    expect(s.saldo).toBeCloseTo(1080 - 190);
    expect(s.qtd_itens).toBe(6);
  });

  it("classifica delta negativo como aumento (caso ANDROS-inverso)", () => {
    expect(classifyDelta(-289.59)).toBe("aumento");
    expect(classifyDelta(289.59)).toBe("economia");
    expect(classifyDelta(0)).toBe("neutro");
  });

  it("filtra por cada role nova exposta no KPI", () => {
    const items: InterventionItem[] = [
      ev("cancelamento_empresa", 100, { item_id: "a" }),
      ev("cancelamento_item", 50, { item_id: "b" }),
      ev("analista", 25, { item_id: "c" }),
    ];
    expect(filterItems(items, { role: "cancelamento_empresa" }).map(i => i.item_id)).toEqual(["a"]);
    expect(filterItems(items, { role: "cancelamento_item" }).map(i => i.item_id)).toEqual(["b"]);
    expect(filterItems(items, { role: "analista" }).map(i => i.item_id)).toEqual(["c"]);
  });
});

describe("auditoria por pagamento", () => {
  it("agrupa todos os eventos do mesmo pagamento com totais corretos", () => {
    const items: InterventionItem[] = [
      ev("diretor", 100, { payment_id: "P1", company_name: "Acme" }),
      ev("analista", -30, { payment_id: "P1" }),
      ev("cancelamento_empresa", 500, { payment_id: "P2", company_name: "Globex" }),
      ev("cancelamento_item", 20, { payment_id: "P1" }),
    ];
    const groups = groupItemsForAudit(items);
    const p1 = groups.find(g => g.payment_id === "P1")!;
    const p2 = groups.find(g => g.payment_id === "P2")!;
    expect(p1.qtd_eventos).toBe(3);
    expect(p1.economia).toBeCloseTo(120);
    expect(p1.perda).toBeCloseTo(30);
    expect(p1.saldo).toBeCloseTo(90);
    expect(p1.company_name).toBe("Acme");
    expect(p2.saldo).toBeCloseTo(500);
    // ordenado por saldo desc
    expect(groups[0].payment_id).toBe("P2");
  });

  it("preserva todos os deltas/valores brutos dentro de cada grupo", () => {
    const items: InterventionItem[] = [
      ev("diretor", 100, { payment_id: "P1", valor_regra: 1000, valor_pago_final: 900 }),
      ev("cancelamento_item", 250, { payment_id: "P1", valor_regra: 250, valor_pago_final: 0 }),
    ];
    const [g] = groupItemsForAudit(items);
    expect(g.eventos).toHaveLength(2);
    expect(g.eventos.map(e => e.role).sort()).toEqual(["cancelamento_item", "diretor"]);
    expect(g.eventos.map(e => e.valor_regra)).toEqual([1000, 250]);
  });
});

describe("dedup — cancelamentos reativados / dupla contagem", () => {
  it("RPC já filtra reativados; client confia em ausência deles na lista", () => {
    // O RPC exclui cancellation_reactivated_at IS NOT NULL. Esta suíte
    // simula a saída do RPC: nenhum item reativado deve aparecer no input.
    const items: InterventionItem[] = [
      ev("cancelamento_empresa", 400, { item_id: "live" }),
      // simulação: se algum dia um reativado vazar, ele NÃO está aqui
    ];
    const s = summarizeItems(items);
    expect(s.economia).toBe(400);
    expect(s.qtd_itens).toBe(1);
  });

  it("detecta duplicatas quando o mesmo item_id é contabilizado por > 1 fonte", () => {
    const items: InterventionItem[] = [
      ev("cancelamento_empresa", 200, { item_id: "X" }),
      ev("cancelamento_item", 200, { item_id: "X" }),
      ev("diretor", 50, { item_id: "Y" }),
    ];
    const dups = findDuplicateItemEvents(items);
    expect(dups).toHaveLength(1);
    expect(dups[0].item_id).toBe("X");
    expect(dups[0].roles.sort()).toEqual(["cancelamento_empresa", "cancelamento_item"]);
  });

  it("lista sem duplicatas → nada a sinalizar", () => {
    const items: InterventionItem[] = [
      ev("diretor", 100, { item_id: "A" }),
      ev("analista", -30, { item_id: "B" }),
      ev("cancelamento_item", 80, { item_id: "C" }),
    ];
    expect(findDuplicateItemEvents(items)).toEqual([]);
  });
});
