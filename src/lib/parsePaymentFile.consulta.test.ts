import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePaymentFile } from "@/lib/parsePaymentFile";

const CONSULTA_META = {
  code: "consulta",
  label: "Consulta",
  tuss_default: "10101012",
  requires_tuss_in_sheet: false,
  default_function: null,
};

function makeFile(rows: Record<string, unknown>[], name = "consulta.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  // jsdom's File não implementa arrayBuffer(); criamos um stub compatível.
  const fake = {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    arrayBuffer: async () => buf,
  };
  return fake as unknown as File;
}


const BASE_ROW = {
  "Nr. Atendimento": "111222",
  "Médico": "DR FULANO DE TAL",
  "CPF Médico": "12345678901",
  "Empresa": "ACME LTDA",
  "Convênio": "BRADESCO SAUDE",
  "Setor": "AMBULATORIO",
  "Data Atendimento": "2026-01-15",
  "Valor": "150,00",
  "Qtd": 1,
};


describe("parsePaymentFile — regra híbrida Consulta", () => {
  it("planilha COM Código TUSS e Produto: prevalece a planilha, sem flag de default", async () => {
    const file = makeFile([{
      ...BASE_ROW,
      "Código TUSS": "40901130",
      "Procedimento": "CONSULTA EM PRONTO SOCORRO",
    }]);
    const bucket = await parsePaymentFile(file, [], "consulta", { paymentTypeMeta: CONSULTA_META });
    expect(bucket.rows.length).toBeGreaterThan(0);
    const r = bucket.rows[0];
    expect(r.procedure_code).toBe("40901130");
    expect(r.procedure_name).toBe("CONSULTA EM PRONTO SOCORRO");
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    expect(raw.__tuss_default_applied).toBeUndefined();
    expect(raw.__procedure_name_defaulted).toBeUndefined();
  });

  it("planilha SEM Código TUSS e SEM Produto: sistema imputa default e marca flags", async () => {
    const file = makeFile([BASE_ROW]);
    const bucket = await parsePaymentFile(file, [], "consulta", { paymentTypeMeta: CONSULTA_META });
    const r = bucket.rows[0];
    expect(r.procedure_code).toBe(CONSULTA_META.tuss_default);
    expect(r.procedure_name).toBe(CONSULTA_META.label);
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    expect(raw.__tuss_default_applied).toBe(CONSULTA_META.tuss_default);
    expect(raw.__procedure_name_defaulted).toBe(CONSULTA_META.label);
  });

  it("planilha SÓ com Código TUSS: tuss vem da planilha, nome usa default", async () => {
    const file = makeFile([{ ...BASE_ROW, "Código TUSS": "40901130" }]);
    const bucket = await parsePaymentFile(file, [], "consulta", { paymentTypeMeta: CONSULTA_META });
    const r = bucket.rows[0];
    expect(r.procedure_code).toBe("40901130");
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    expect(raw.__tuss_default_applied).toBeUndefined();
    expect(r.procedure_name).toBe(CONSULTA_META.label);
    expect(raw.__procedure_name_defaulted).toBe(CONSULTA_META.label);
  });

  it("planilha SÓ com Produto: nome vem da planilha, tuss usa default", async () => {
    const file = makeFile([{ ...BASE_ROW, "Procedimento": "CONSULTA AMBULATORIAL" }]);
    const bucket = await parsePaymentFile(file, [], "consulta", { paymentTypeMeta: CONSULTA_META });
    const r = bucket.rows[0];
    expect(r.procedure_code).toBe(CONSULTA_META.tuss_default);
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    expect(raw.__tuss_default_applied).toBe(CONSULTA_META.tuss_default);
    expect(r.procedure_name).toBe("CONSULTA AMBULATORIAL");
    expect(raw.__procedure_name_defaulted).toBeUndefined();
  });
});
