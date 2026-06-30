/**
 * Teste end-to-end: upload de planilha com "Vl a Repassar = 0".
 *
 * Fluxo coberto:
 *  1) Analista monta um arquivo XLSX (cenário real Sul América/Bradesco onde
 *     o convênio paga R$ 95 mas o repasse ao médico é zero — caso de
 *     procedimento fora do acordo).
 *  2) Mapeia manualmente "Vl a Repassar" → gross_amount (como faria no
 *     diálogo de mapeamento da UI).
 *  3) Roda parsePaymentFile (mesmo motor usado no upload real).
 *  4) Verifica que gross_amount = 0 sobreviveu até a camada de exibição
 *     (formatBRL → "R$ 0,00"), SEM fallback heurístico para "Valor Tot",
 *     "Valor", "Vl Repasse" ou qualquer outro alias.
 *
 * Regressão para: lote 6d76df02 / empresa MATERNAL onde 24 itens com
 * Vl a Repassar = 0 foram sobrescritos por R$ 95 (Valor Tot) inflando o
 * total de R$ 9.590,00 para R$ 11.870,00.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePaymentFile, type CompanyRow } from "../parsePaymentFile";
import { formatBRL } from "../financialStats";

const COMPANIES: CompanyRow[] = [
  { id: "c-maternal", name: "MATERNAL LTDA", aliases: ["MATERNAL"] },
];

const buildFile = (rows: Record<string, unknown>[], name = "MATERNAL.xlsx"): File => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (!file.arrayBuffer) (file as any).arrayBuffer = async () => buf;
  return file;
};

describe("E2E upload — Vl a Repassar = 0 permanece R$ 0,00 sem fallback", () => {
  it("um único item: 0 no upload → 0 salvo → 'R$ 0,00' exibido", async () => {
    const file = buildFile([
      {
        "Médico": "Dra. Joana",
        "CPF": "111.111.111-11",
        "Atendimento": "8837539",
        "Código TUSS": "10101012",
        "Procedimento": "Consulta",
        "Operadora": "Sul América",
        "Setor": "MATERNIDADE",
        "Data Procedimento": "01/06/2026",
        // armadilhas: heurísticas antigas pegariam qualquer um destes
        "Valor Tot": 95,
        "Valor": 80,
        "Vl Repasse": 70,
        // valor que o analista escolheu na UI:
        "Vl a Repassar": 0,
      },
    ]);

    const bucket = await parsePaymentFile(file, COMPANIES, null, {
      manualMapping: { gross_amount: "Vl a Repassar" },
    });

    expect(bucket.rows).toHaveLength(1);
    const row = bucket.rows[0];

    // Valor salvo: zero autoritativo
    expect(row.gross_amount).toBe(0);
    // Nunca o fallback
    expect(row.gross_amount).not.toBe(95);
    expect(row.gross_amount).not.toBe(80);
    expect(row.gross_amount).not.toBe(70);

    // Camada de exibição (mesma usada nos cards/tabelas)
    expect(formatBRL(row.gross_amount)).toMatch(/^R\$\s?0,00$/);
  });

  it("lote MATERNAL reproduzido: 24 itens com Vl a Repassar = 0 → total = R$ 0,00", async () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      "Médico": `Dra. Joana ${i + 1}`,
      "Atendimento": String(8837539 + i),
      "Código TUSS": "10101012",
      "Operadora": "Sul América",
      "Setor": "MATERNIDADE",
      "Data Procedimento": "01/06/2026",
      "Valor Tot": 95, // armadilha — o bug somava 24 × 95 = 2.280 a mais
      "Vl a Repassar": 0,
    }));

    const bucket = await parsePaymentFile(buildFile(rows), COMPANIES, null, {
      manualMapping: { gross_amount: "Vl a Repassar" },
    });

    expect(bucket.rows).toHaveLength(24);
    const total = bucket.rows.reduce((s, r) => s + (r.gross_amount || 0), 0);
    expect(total).toBe(0);
    expect(formatBRL(total)).toMatch(/^R\$\s?0,00$/);
    // Garantia explícita: não inflou em 2.280 (24 × 95) como no bug original
    expect(total).not.toBe(2280);
  });

  it("preserva R$ 0,00 mesmo com cabeçalhos canônicos competindo na mesma linha", async () => {
    const file = buildFile([
      {
        "Médico": "Dr. Teste",
        "Atendimento": "1",
        "Código TUSS": "10101012",
        "Operadora": "Bradesco",
        "Data Procedimento": "01/06/2026",
        // Todos os aliases canônicos presentes, todos com ruído:
        "Vl Repasse": 123.45,
        "Valor Repasse": 200,
        "Repasse": 300,
        "Valor a Repassar": 400,
        "Vl a Repassar": 0, // ← mapeado manualmente, deve vencer todos
      },
    ]);

    const bucket = await parsePaymentFile(file, COMPANIES, null, {
      manualMapping: { gross_amount: "Vl a Repassar" },
    });

    expect(bucket.rows[0].gross_amount).toBe(0);
    expect(formatBRL(bucket.rows[0].gross_amount)).toMatch(/^R\$\s?0,00$/);
  });
});
