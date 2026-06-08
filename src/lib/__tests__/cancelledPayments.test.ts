import { describe, it, expect } from "vitest";
import {
  cancelledToCsv,
  filterCancelled,
  groupByReason,
  reasonLabel,
  summarizeRows,
  type CancelledRow,
} from "@/lib/cancelledPayments";

const row = (over: Partial<CancelledRow>): CancelledRow => ({
  nivel: "grupo",
  id: "g1",
  payment_id: "p1",
  company_name: "Acme",
  doctor_name: null,
  procedure_code: null,
  procedure_name: null,
  valor: 1000,
  cancelled_at: "2026-06-01T10:00:00Z",
  cancelled_by: "u1",
  reason: "medico_fatura_externamente",
  note: null,
  reactivated: false,
  autor: "Analista X",
  ...over,
});

describe("reasonLabel", () => {
  it("traduz motivos conhecidos", () => {
    expect(reasonLabel("medico_fatura_externamente")).toBe("Médico fatura externamente");
    expect(reasonLabel("contrato_encerrado")).toBe("Contrato encerrado");
  });
  it("retorna 'Outro' para nulo/vazio e devolve a string crua se desconhecida", () => {
    expect(reasonLabel(null)).toBe("Outro");
    expect(reasonLabel("foo_bar")).toBe("foo_bar");
  });
});

describe("summarizeRows", () => {
  it("conta grupos e itens separadamente; soma valor total", () => {
    const s = summarizeRows([
      row({ nivel: "grupo", valor: 500 }),
      row({ nivel: "grupo", valor: 300 }),
      row({ nivel: "item", valor: 50 }),
    ]);
    expect(s).toEqual({ valor_total: 850, qtd_grupos: 2, qtd_itens: 1 });
  });
});

describe("groupByReason", () => {
  it("agrupa por motivo e ordena por valor desc", () => {
    const g = groupByReason([
      row({ reason: "medico_fatura_externamente", valor: 1000 }),
      row({ reason: "outro", valor: 200 }),
      row({ reason: "medico_fatura_externamente", valor: 500 }),
    ]);
    expect(g[0]).toMatchObject({ reason: "medico_fatura_externamente", valor: 1500, qtd: 2 });
    expect(g[1]).toMatchObject({ reason: "outro", valor: 200, qtd: 1 });
  });
});

describe("filterCancelled", () => {
  const rows = [
    row({ id: "a", reason: "medico_fatura_externamente", nivel: "grupo", company_name: "Acme" }),
    row({ id: "b", reason: "contrato_encerrado", nivel: "item", company_name: "Beta" }),
    row({ id: "c", reason: "outro", nivel: "grupo", reactivated: true, company_name: "Gamma" }),
  ];

  it("filtra por motivo", () => {
    expect(filterCancelled(rows, { reason: "contrato_encerrado" }).map((r) => r.id)).toEqual(["b"]);
  });
  it("filtra por nível", () => {
    expect(filterCancelled(rows, { nivel: "item" }).map((r) => r.id)).toEqual(["b"]);
  });
  it("esconde reativados por padrão; mostra se includeReactivated=true", () => {
    expect(filterCancelled(rows, {}).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterCancelled(rows, { includeReactivated: true }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("busca textual cobre empresa/autor/nota", () => {
    expect(filterCancelled(rows, { search: "beta" }).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("cancelledToCsv", () => {
  it("inclui header e formato BR para valor", () => {
    const csv = cancelledToCsv([row({ valor: 1234.56 })]);
    const [h, l] = csv.split("\n");
    expect(h.split(";")).toContain("motivo");
    expect(l).toContain("1234,56");
    expect(l).toContain("Médico fatura externamente");
  });
});
