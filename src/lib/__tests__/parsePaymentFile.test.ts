/**
 * Testes de regressão para o parser de planilhas de pagamento.
 * Cobrem variações REAIS de cabeçalhos encontradas em produção:
 *  - Planilha padrão: "Médico", "Vl Repasse", "Valor Procedimento"
 *  - Planilha de Parecer Adulto: "Repasse" contém NOME (não número),
 *    "Valor a repassar", "Médico Parecerista" (não confundir com "Médico Solic.")
 *  - Datas em "Dt. Resp." / "Dt. Solic." (formato dd/mm/yyyy)
 *  - Tipo Entrada (caráter: ELETIVO / URGENCIA)
 *
 * Cada cenário monta um workbook XLSX em memória e roda parsePaymentFile.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePaymentFile, resolveSimpleFormulas, type CompanyRow } from "../parsePaymentFile";

const COMPANIES: CompanyRow[] = [
  { id: "c-acme", name: "Acme Médica LTDA", aliases: ["Acme"] },
];

const makeFile = (rows: Record<string, unknown>[], name = "Acme Médica LTDA.xlsx"): File => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  // jsdom File precisa de arrayBuffer()
  const file = new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (!file.arrayBuffer) {
    (file as any).arrayBuffer = async () => buf;
  }
  return file;
};

describe("parsePaymentFile — planilha padrão", () => {
  it("lê Médico, Vl Repasse, Valor Procedimento e Tipo Entrada corretamente", async () => {
    const f = makeFile([
      {
        "Médico": "Dr. Silva",
        "CPF": "111.111.111-11",
        "Vl Repasse": "1.200,50",
        "Valor Procedimento": "2.000,00",
        "Procedimento": "Apendicectomia",
        "Cod. TUSS": "31002012",
        "Nr Atendimento": "A123",
        "Paciente": "João",
        "Setor": "CC",
        "Tipo Entrada": "ELETIVO",
        "Data Procedimento": "10/05/2026",
      },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows).toHaveLength(1);
    const r = b.rows[0];
    expect(r.doctor_name).toBe("Dr. Silva");
    expect(r.gross_amount).toBeCloseTo(1200.5);
    expect(r.procedure_amount).toBeCloseTo(2000);
    expect(r.procedure_code).toBe("31002012");
    expect(r.attendance_character).toBe("ELETIVO");
    expect(r.patient_name).toBe("João");
    expect(r.procedure_date).toMatch(/^2026-05-10/);
  });

  it("preserva Vl a Repassar = 0 como repasse autoritativo e não cai em Valor Tot", async () => {
    const f = makeFile([
      {
        "Médico": "Dra. Sul América",
        "Vl a Repassar": 0,
        "Valor Tot": 95,
        "Operadora": "Sul América",
        "Código TUSS": "10101012",
        "Atendimento": "8837539",
      },
    ]);

    const b = await parsePaymentFile(f, COMPANIES);

    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].gross_amount).toBe(0);
    expect(b.rows[0].procedure_amount).toBe(95);
  });

  it("preserva mapeamento manual de repasse = 0 e ignora Valor Tot", async () => {
    const f = makeFile([
      {
        "Médico": "Dra. Manual",
        "Header Repasse Escolhido": 0,
        "Vl a Repassar": 1234,
        "Valor Tot": 95,
      },
    ]);

    const b = await parsePaymentFile(f, COMPANIES, null, {
      manualMapping: { gross_amount: "Header Repasse Escolhido" },
    });

    expect(b.rows[0].gross_amount).toBe(0);
  });

  it("preserva procedure_amount manual = 0 e não troca por repasse ou Valor Tot", async () => {
    const f = makeFile([
      {
        "Médico": "Dra. Procedimento",
        "Vl a Repassar": 300,
        "Header Procedimento Escolhido": 0,
        "Valor Tot": 95,
      },
    ]);

    const b = await parsePaymentFile(f, COMPANIES, null, {
      manualMapping: {
        gross_amount: "Vl a Repassar",
        procedure_amount: "Header Procedimento Escolhido",
      },
    });

    expect(b.rows[0].gross_amount).toBe(300);
    expect(b.rows[0].procedure_amount).toBe(0);
  });
});

describe("parsePaymentFile — planilha de Parecer Adulto", () => {
  it("usa 'Médico Parecerista' como prestador (não 'Médico Solic.')", async () => {
    const f = makeFile([
      {
        "Médico Solic.": "Dr. Solicitante (NÃO usar)",
        "Médico Parecerista": "Dra. Parecerista",
        "Valor a repassar": "350,00",
        "Repasse": "Dra. Parecerista", // nome, não número — não deve quebrar
        "Dt. Resp. Par.": "15/05/2026",
        "Dt. Solic.": "10/05/2026",
        "Paciente": "Maria",
        "Setor": "UTI",
      },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows).toHaveLength(1);
    const r = b.rows[0];
    expect(r.doctor_name).toBe("Dra. Parecerista");
    expect(r.doctor_name).not.toMatch(/Solicit/i);
    expect(r.gross_amount).toBeCloseTo(350);
    expect(r.procedure_date).toMatch(/^2026-05-15/);
  });

  it("não usa Dt. Solic. como fallback quando tipo Parecer não tem data de resposta", async () => {
    const f = makeFile([
      {
        "Médico Parecerista": "Dra. Parecerista",
        "Valor a repassar": "350,00",
        "Dt. Resp. Par.": "",
        "Dt. Solic.": "10/05/2026",
      },
    ]);
    const b = await parsePaymentFile(f, COMPANIES, null, {
      paymentTypeMeta: { label: "Parecer Adulto", tuss_default: "10102019", requires_tuss_in_sheet: false, default_function: "Parecerista" },
    });
    expect(b.rows[0].procedure_date).toBeNull();
  });

  it("coluna 'Repasse' com nome (sem coluna Médico) é aceita como prestador via fallback", async () => {
    const f = makeFile([
      {
        "Repasse": "Dr. Fallback",
        "Valor a repassar": "100",
        "Dt. Solic.": "01/04/2026",
      },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].doctor_name).toBe("Dr. Fallback");
    expect(b.rows[0].gross_amount).toBeCloseTo(100);
  });

  it("não confunde coluna 'Repasse' com valor numérico de repasse (filtro por excludes)", async () => {
    // "Valor" existe e deve ser usado como bruto; "Repasse" é nome e deve ser
    // descartado para o cálculo numérico.
    const f = makeFile([
      {
        "Médico Parecerista": "Dra. X",
        "Repasse": "Dra. X",
        "Valor": "500,00",
      },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].gross_amount).toBeCloseTo(500);
  });
});

describe("parsePaymentFile — datas alternativas", () => {
  it("não auto-mapeia 'Dt. Solic.' como data do procedimento", async () => {
    const f = makeFile([
      { "Médico": "Dr. Y", "Vl Repasse": "10", "Dt. Solic.": "02/03/2026" },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].procedure_date).toBeNull();
  });

  it("prioriza 'Data Procedimento' sobre datas auxiliares", async () => {
    const f = makeFile([
      {
        "Médico": "Dr. Z",
        "Vl Repasse": "10",
        "Data Procedimento": "20/06/2026",
        "Dt. Solic.": "01/01/2026",
      },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].procedure_date).toMatch(/^2026-06-20/);
  });
});

describe("parsePaymentFile — caráter (Tipo Entrada)", () => {
  it.each([
    ["Tipo Entrada", "ELETIVO"],
    ["Tipo de Entrada", "URGENCIA"],
    ["Caráter Atendimento", "EMERGENCIA"],
    ["Carater do Atendimento", "ELETIVO"],
  ])("lê variação '%s'", async (header, value) => {
    const f = makeFile([{ "Médico": "Dr.", "Vl Repasse": "1", [header]: value }]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].attendance_character).toBe(value);
  });
});

describe("parsePaymentFile — empresa via filename", () => {
  it("casa empresa pelo nome do arquivo com alta confiança", async () => {
    const f = makeFile(
      [{ "Médico": "Dr.", "Vl Repasse": "1" }],
      "Acme Médica LTDA - maio 2026.xlsx",
    );
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.matchedCompany?.id).toBe("c-acme");
    expect(b.matchScore).toBeGreaterThanOrEqual(0.9);
    expect(b.rows[0].company_id).toBe("c-acme");
  });
});

describe("parsePaymentFile — header não está na primeira linha", () => {
  it("pula linhas de metadados (EMPRESA, CNPJ, VIGÊNCIA, VALOR DA NF) e localiza o cabeçalho real", async () => {
    const aoa: unknown[][] = [
      [],
      [null, "DF Star  -  Ambulatório"],
      [null, null, "Venus Serviços Médicos Ltda - Ambulatório"],
      [null, "EMPRESA", "Venus Serviços Médicos Ltda"],
      [null, "CNPJ", "18124369000171"],
      [null, "SETOR", "Ambulatório"],
      [null, "VIGÊNCIA", "01/04/2026", "a", null, null, "30/04/2026"],
      [null, "PAGTO EM:", "10 dias uteis após o envio da NF"],
      [null, "VALOR DA NF (R$)", 450],
      [null, "Check valor", 0],
      [null, "MÉDICO", "DATA", "ATENDIMENTO", "Especialidade", "PACIENTE", "PROCEDIMENTO", "Convênio", "R$ A PAGAR"],
      [null, "Renata Souto Viana", "10/04/2026", "009118311", "Oncologia Clínica", "Aguinaldo Siega", "Em Consultório", "Assefaz", 150],
      [null, "Renata Souto Viana", "17/04/2026", "009143361", "Oncologia Clínica", "Theresa Castro", "Em Consultório", "Senado Federal", 150],
      [null, "Renata Souto Viana", "20/04/2026", "009149814", "Oncologia Clínica", "Renata Conill", "Em Consultório", "Bradesco", 150],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "Venus.xlsx");
    if (!file.arrayBuffer) (file as any).arrayBuffer = async () => buf;

    const b = await parsePaymentFile(file, []);
    expect(b.rows).toHaveLength(3);
    expect(b.rows[0].doctor_name).toBe("Renata Souto Viana");
    expect(b.rows[0].gross_amount).toBe(150);
    expect(b.rows[0].attendance_number).toBe("009118311");
    expect(b.rows[0].patient_name).toBe("Aguinaldo Siega");
    expect(b.rows[0].specialty).toBe("Oncologia Clínica");
    expect(b.rows[0].agreement_text).toBe("Assefaz");
    expect(b.rows[0].procedure_date).toMatch(/^2026-04-10/);
  });
});

/**
 * Regressão: "Vl a Repassar = 0" é legítimo (ex.: Regra "Retorno" — atendimento
 * não pago). NÃO pode virar "Valor obrigatório (gross_amount)". Cobre também
 * "0,00" (string PT-BR), célula vazia (coluna existe mas blank) e fórmula sem
 * cache (=N3*O3 salvo sem recalcular pelo Excel/LibreOffice).
 */
describe("parsePaymentFile — Vl a Repassar zero / vazio / fórmula sem cache", () => {
  const baseRow = {
    "Médico": "Dr. Silva",
    "CPF": "111.111.111-11",
    "Procedimento": "Em Consultório (No Horário Normal Ou Preestabelecido)",
    "Cod. TUSS": "10101012",
    "Nr Atendimento": "A123",
    "Paciente": "João",
    "Valor Tot": 95,
    "Regra": "Retorno",
  };

  const expectNoValorObrigatorio = (issues: { message: string }[]) => {
    const blocking = issues.filter((i) => /Valor obrigatório|Valor total obrigatório/.test(i.message));
    expect(blocking).toEqual([]);
  };

  it("aceita Vl a Repassar = 0 numérico (Retorno não pago) sem bloquear", async () => {
    const f = makeFile([{ ...baseRow, "Vl a Repassar": 0 }]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].gross_amount).toBe(0);
    expect(b.rows[0].gross_explicit).toBe(true);
    expectNoValorObrigatorio(b.rows[0].line_issues);
  });

  it('aceita Vl a Repassar = "0,00" (string PT-BR) sem bloquear', async () => {
    const f = makeFile([{ ...baseRow, "Vl a Repassar": "0,00" }]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].gross_amount).toBe(0);
    expect(b.rows[0].gross_explicit).toBe(true);
    expectNoValorObrigatorio(b.rows[0].line_issues);
  });

  it("aceita célula vazia quando a coluna Vl a Repassar existe no cabeçalho", async () => {
    // AOA garante que a coluna existe mesmo com célula em branco.
    const aoa = [
      ["Médico", "CPF", "Procedimento", "Cod. TUSS", "Nr Atendimento", "Paciente", "Valor Tot", "Regra", "Vl a Repassar"],
      ["Dr. Silva", "111.111.111-11", "Em Consultório", "10101012", "A123", "João", 95, "Retorno", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], "Acme Médica LTDA.xlsx");
    if (!file.arrayBuffer) (file as any).arrayBuffer = async () => buf;

    const b = await parsePaymentFile(file, COMPANIES);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].gross_amount).toBe(0);
    expect(b.rows[0].gross_explicit).toBe(true);
    expectNoValorObrigatorio(b.rows[0].line_issues);
  });

  it("resolveSimpleFormulas avalia =G2*H2 (fórmula sem cached value)", () => {
    // Cenário "Excel salvou sem recalcular": célula tem .f mas .v vazio/ausente.
    // O writer do xlsx descarta cells sem .v, então testamos diretamente o
    // helper que parsePaymentFile chama no sheet logo após XLSX.read().
    const sheet: Record<string, any> = {
      "!ref": "A1:I2",
      "G2": { t: "n", v: 350 },
      "H2": { t: "n", v: 0.7 },
      "I2": { t: "n", f: "G2*H2" }, // sem .v → simula fórmula sem cache
    };
    resolveSimpleFormulas(sheet);
    expect(sheet["I2"].v).toBeCloseTo(245, 5);
  });

  it("resolveSimpleFormulas aceita referência de valor PT-BR ('1.234,56') em célula referida", () => {
    const sheet: Record<string, any> = {
      "!ref": "A1:B2",
      "A2": { t: "s", v: "1.234,56" }, // string PT-BR
      "B2": { t: "n", f: "A2*2" },
    };
    resolveSimpleFormulas(sheet);
    expect(sheet["B2"].v).toBeCloseTo(2469.12, 2);
  });

  it("resolveSimpleFormulas NÃO sobrescreve célula que já tem cached value", () => {
    const sheet: Record<string, any> = {
      "!ref": "A1:C2",
      "A2": { t: "n", v: 10 },
      "B2": { t: "n", v: 5 },
      "C2": { t: "n", v: 999, f: "A2*B2" }, // cache presente
    };
    resolveSimpleFormulas(sheet);
    expect(sheet["C2"].v).toBe(999);
  });

  it("resolveSimpleFormulas ignora fórmulas com funções (não-simples) sem quebrar o sheet", () => {
    const sheet: Record<string, any> = {
      "!ref": "A1:B2",
      "A2": { t: "n", v: 10 },
      "B2": { t: "n", f: "SUM(A1:A2)" }, // contém letras + (), não é safe
    };
    resolveSimpleFormulas(sheet);
    // Não resolve, mas também não joga erro nem corrompe o cell.
    expect(sheet["B2"].v).toBeUndefined();
    expect(sheet["B2"].f).toBe("SUM(A1:A2)");
  });
});
});

