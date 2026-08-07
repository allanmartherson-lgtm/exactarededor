import { describe, expect, it } from "vitest";
import { EXPORT_COLS, buildExportRows } from "@/lib/tvr/exportCols";
import type { TvrResult } from "@/lib/tvr";

/**
 * Contrato de colunas do relatório TVR.
 *
 * `EXPORT_COLS` alimenta os três formatos: no XLSX vira cabeçalho de dois
 * níveis com merge por grupo; no CSV/JSON o grupo entra como coluna própria.
 * Renomear um header aqui muda o arquivo que o analista recebe — e quebra
 * qualquer planilha que ele mantenha em cima do export.
 */

function res(over: Partial<TvrResult> = {}): TvrResult {
  return {
    key: "k1",
    atendimento: "A1",
    tuss: "10101012",
    procedimento: "Proc",
    paciente: "Paciente",
    data: "2026-03-10",
    convenio: "Unimed",
    medico: "João Silva",
    funcao: "Cirurgião Principal",
    qtd_tasy: 1,
    valor_unit_tasy: 1000,
    valor_total_tasy: 1000,
    qtd_por_func: 1,
    n_funcs: 1,
    funcoes_pagas: "Cirurgião Principal",
    lotes: "L1",
    valor_pago_base: 1000,
    valor_com_acordo: 1000,
    dif_qtd: 0,
    dif_valor: 0,
    valor_recuperar_acordo: 0,
    valor_com_acordo_recalc: 1000,
    ajuste_acordo: 0,
    tipo_analise: "valor",
    status: "ok",
    ...over,
  } as TvrResult;
}

describe("EXPORT_COLS — contrato de colunas", () => {
  it("mantém as 46 colunas e os 9 grupos esperados", () => {
    expect(EXPORT_COLS).toHaveLength(46);
    const groups = [...new Set(EXPORT_COLS.map((c) => c.group))];
    expect(groups).toEqual([
      "Item",
      "Contexto",
      "TASY hoje (100% convênio)",
      "Lote histórico",
      "Diferenças brutas (TASY hoje − lote)",
      "Devido hoje (acordo × TASY hoje)",
      "Ajuste (pago no lote − devido hoje)",
      "Ação sugerida",
      "Rastreio",
    ]);
  });

  it("colunas do mesmo grupo são ADJACENTES", () => {
    // O XLSX faz merge do cabeçalho varrendo colunas vizinhas do mesmo grupo.
    // Inserir uma coluna no meio de outro grupo produziria merge errado — e o
    // erro só apareceria ao abrir a planilha.
    const seen = new Set<string>();
    let prev = "";
    for (const col of EXPORT_COLS) {
      if (col.group !== prev) {
        expect(seen.has(col.group), `grupo "${col.group}" reaparece fora de sequência`).toBe(false);
        seen.add(col.group);
        prev = col.group;
      }
    }
  });

  it("não repete header (viraria chave duplicada no CSV/JSON)", () => {
    const headers = EXPORT_COLS.map((c) => c.header);
    expect(new Set(headers).size).toBe(headers.length);
  });

  it("todo header e grupo são não-vazios e sem espaço nas pontas", () => {
    for (const col of EXPORT_COLS) {
      expect(col.header.trim()).toBe(col.header);
      expect(col.group.trim()).toBe(col.group);
      expect(col.header.length).toBeGreaterThan(0);
      expect(col.group.length).toBeGreaterThan(0);
    }
  });

  it("nenhum `get` estoura em um resultado mínimo", () => {
    for (const col of EXPORT_COLS) {
      expect(() => col.get(res()), `coluna "${col.header}" quebrou`).not.toThrow();
    }
  });
});

describe("EXPORT_COLS — valores", () => {
  const val = (header: string, r: TvrResult) => EXPORT_COLS.find((c) => c.header === header)!.get(r);

  it("Status usa o rótulo do domínio, não o enum cru", () => {
    expect(val("Status", res({ status: "nao_pago" }))).toBe("Faltou pagar");
    expect(val("Status", res({ status: "ausente_tasy" }))).toBe("Ausente base faturamento");
  });

  it("Tipo de análise é legível", () => {
    expect(val("Tipo de análise", res({ tipo_analise: "quantidade" }))).toBe("Quantidade (tabela própria)");
    expect(val("Tipo de análise", res({ tipo_analise: "valor" }))).toBe("Valor (% convênio)");
  });

  it("PJ mostra a conciliada e marca a provável com [prev.]", () => {
    expect(val("PJ", res({ pj_conciliada: "Clínica X" }))).toBe("Clínica X");
    expect(val("PJ", res({ status: "nao_pago", pj_provavel: "Clínica Y" }))).toBe("[prev.] Clínica Y");
    // Só "Faltou pagar" recebe a inferência — nos demais fica vazio.
    expect(val("PJ", res({ status: "ok", pj_provavel: "Clínica Y" }))).toBe("");
  });

  it("Ação sai sem o prefixo de seta (↑/↓/—) usado só na tela", () => {
    const acao = String(val("Ação", res({ status: "ausente_tasy", valor_com_acordo: 500 })));
    expect(acao).not.toMatch(/^[↓↑—]/);
    expect(acao).toContain("Recuperar");
  });

  it("Sem lastro TASY é 'Sim' ou vazio, nunca 'false'", () => {
    expect(val("Sem lastro TASY", res({ sem_lastro_tasy: true }))).toBe("Sim");
    expect(val("Sem lastro TASY", res({ sem_lastro_tasy: false }))).toBe("");
  });
});

describe("buildExportRows", () => {
  it("gera um objeto por linha com todos os headers", () => {
    const rows = buildExportRows([res(), res({ key: "k2" })]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row)).toHaveLength(EXPORT_COLS.length);
      for (const col of EXPORT_COLS) expect(row).toHaveProperty(col.header);
    }
  });

  it("lista vazia gera nenhuma linha", () => {
    expect(buildExportRows([])).toEqual([]);
  });

  it("não muta os resultados de entrada", () => {
    const list = [res()];
    const snapshot = JSON.stringify(list);
    buildExportRows(list);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});
