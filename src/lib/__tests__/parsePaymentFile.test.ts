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
import { parsePaymentFile, type CompanyRow } from "../parsePaymentFile";

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
    // Comportamento atual: "Dt. Solic." casa exatamente (score 100) e ganha
    // de "Dt. Resp. Par." (startsWith, score 60). Travamos esse contrato aqui
    // para detectar regressões — se um dia decidirmos priorizar a data da
    // resposta no parecer, este teste deve ser atualizado deliberadamente.
    expect(r.procedure_date).toMatch(/^2026-05-10/);
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
  it("aceita 'Dt. Solic.' quando não há 'Dt. Resp.'", async () => {
    const f = makeFile([
      { "Médico": "Dr. Y", "Vl Repasse": "10", "Dt. Solic.": "02/03/2026" },
    ]);
    const b = await parsePaymentFile(f, COMPANIES);
    expect(b.rows[0].procedure_date).toMatch(/^2026-03-02/);
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
