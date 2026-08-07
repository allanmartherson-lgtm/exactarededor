import { describe, expect, it } from "vitest";
import {
  collectInvalidDocuments,
  groupItemsForInvoicing,
  type CompanyInfo,
  type GroupableItem,
} from "../../../supabase/functions/send-invoice-request/grouping";

/**
 * Regras de destinatário do pedido de NF (send-invoice-request).
 *
 * Decidem quem recebe a cobrança e por qual valor. A função foi reescrita
 * três vezes sem nenhum teste de comportamento — só havia teste do texto do
 * e-mail, que não cobre nada disto.
 */

// CNPJ válido usado nos fixtures (dígitos verificadores corretos).
const CNPJ_OK = "11444777000161";
const CNPJ_BAD = "11111111111111";

function item(over: Partial<GroupableItem> = {}): GroupableItem {
  return {
    id: "i1",
    doctor_name: "João Silva",
    doctor_email: "joao@clinica.com",
    company_id: null,
    company_name: null,
    company_document: null,
    gross_amount: 100,
    ...over,
  };
}

const companies = (entries: Array<[string, Partial<CompanyInfo>]>) =>
  new Map<string, CompanyInfo>(
    entries.map(([id, c]) => [
      id,
      { name: c.name ?? "Empresa", document: c.document ?? CNPJ_OK, invoice_emails: c.invoice_emails ?? ["nf@empresa.com"] },
    ]),
  );

describe("collectInvalidDocuments — o que bloqueia o envio", () => {
  it("não acusa nada quando os documentos estão corretos", () => {
    const map = companies([["c1", { document: CNPJ_OK }]]);
    const out = collectInvalidDocuments([item({ company_id: "c1" })], map);
    expect(out).toEqual([]);
  });

  it("acusa CNPJ inválido no cadastro da empresa", () => {
    const map = companies([["c1", { name: "Clínica X", document: CNPJ_BAD }]]);
    const out = collectInvalidDocuments([item({ company_id: "c1" })], map);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toContain('CNPJ da empresa "Clínica X" é inválido');
    expect(out[0].item_id).toBe("i1");
  });

  it("acusa CNPJ inválido digitado no item", () => {
    const out = collectInvalidDocuments([item({ company_document: CNPJ_BAD })], new Map());
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("CNPJ informado no item é inválido.");
  });

  it("valida o documento do item SÓ quando tem 14 dígitos", () => {
    // CPF (11 dígitos) não é checado aqui — passa sem bloquear.
    const cpf = collectInvalidDocuments([item({ company_document: "12345678901" })], new Map());
    expect(cpf).toEqual([]);
    // Documento truncado também passa.
    const curto = collectInvalidDocuments([item({ company_document: "123" })], new Map());
    expect(curto).toEqual([]);
  });

  it("ignora pontuação ao validar o documento do item", () => {
    const out = collectInvalidDocuments([item({ company_document: "11.444.777/0001-61" })], new Map());
    expect(out).toEqual([]);
  });

  it("empresa sem documento cadastrado não bloqueia", () => {
    const map = companies([["c1", { document: null }]]);
    expect(collectInvalidDocuments([item({ company_id: "c1" })], map)).toEqual([]);
  });

  it("um item pode acusar os dois documentos ao mesmo tempo", () => {
    const map = companies([["c1", { document: CNPJ_BAD }]]);
    const out = collectInvalidDocuments([item({ company_id: "c1", company_document: CNPJ_BAD })], map);
    expect(out).toHaveLength(2);
  });

  it("company_id fora do cadastro não gera falso bloqueio", () => {
    const out = collectInvalidDocuments([item({ company_id: "inexistente" })], new Map());
    expect(out).toEqual([]);
  });
});

describe("groupItemsForInvoicing — quem é cobrado", () => {
  it("soma os itens da mesma empresa em um único destinatário", () => {
    const map = companies([["c1", { name: "Clínica X", invoice_emails: ["nf@x.com"] }]]);
    const { byCompany, byDoctorFallback } = groupItemsForInvoicing(
      [
        item({ id: "i1", company_id: "c1", gross_amount: 100 }),
        item({ id: "i2", company_id: "c1", gross_amount: 250.5 }),
      ],
      map,
    );
    expect(byCompany.size).toBe(1);
    expect(byDoctorFallback.size).toBe(0);
    const b = byCompany.get("c1")!;
    expect(b.total).toBe(350.5);
    expect(b.items).toHaveLength(2);
    expect(b.to).toEqual(["nf@x.com"]);
  });

  it("médicos da empresa entram em CC, normalizados e sem repetir", () => {
    const map = companies([["c1", {}]]);
    const { byCompany } = groupItemsForInvoicing(
      [
        item({ id: "i1", company_id: "c1", doctor_email: "  Joao@Clinica.com " }),
        item({ id: "i2", company_id: "c1", doctor_email: "joao@clinica.com" }),
        item({ id: "i3", company_id: "c1", doctor_email: "ana@clinica.com" }),
      ],
      map,
    );
    expect([...byCompany.get("c1")!.cc].sort()).toEqual(["ana@clinica.com", "joao@clinica.com"]);
  });

  it("item sem e-mail de médico não polui o CC da empresa", () => {
    const map = companies([["c1", {}]]);
    const { byCompany } = groupItemsForInvoicing(
      [item({ company_id: "c1", doctor_email: null })],
      map,
    );
    expect([...byCompany.get("c1")!.cc]).toEqual([]);
    expect(byCompany.get("c1")!.total).toBe(100);
  });

  it("gross_amount nulo conta como zero", () => {
    const map = companies([["c1", {}]]);
    const { byCompany } = groupItemsForInvoicing(
      [item({ company_id: "c1", gross_amount: null }), item({ id: "i2", company_id: "c1", gross_amount: 40 })],
      map,
    );
    expect(byCompany.get("c1")!.total).toBe(40);
  });

  it("empresas diferentes viram destinatários separados", () => {
    const map = companies([["c1", { name: "A" }], ["c2", { name: "B" }]]);
    const { byCompany } = groupItemsForInvoicing(
      [item({ company_id: "c1" }), item({ id: "i2", company_id: "c2" })],
      map,
    );
    expect(byCompany.size).toBe(2);
  });
});

describe("groupItemsForInvoicing — fallback por médico", () => {
  it("item sem empresa cai no bucket do médico", () => {
    const { byCompany, byDoctorFallback } = groupItemsForInvoicing(
      [item({ company_id: null, doctor_email: "joao@clinica.com", gross_amount: 80 })],
      new Map(),
    );
    expect(byCompany.size).toBe(0);
    expect(byDoctorFallback.get("joao@clinica.com")!.total).toBe(80);
  });

  it("empresa fora do cadastro também cai no médico", () => {
    const { byDoctorFallback } = groupItemsForInvoicing(
      [item({ company_id: "nao-cadastrada" })],
      new Map(),
    );
    expect(byDoctorFallback.size).toBe(1);
  });

  it("agrupa por e-mail normalizado", () => {
    const { byDoctorFallback } = groupItemsForInvoicing(
      [
        item({ id: "i1", doctor_email: "JOAO@clinica.com", gross_amount: 10 }),
        item({ id: "i2", doctor_email: " joao@clinica.com ", gross_amount: 20 }),
      ],
      new Map(),
    );
    expect(byDoctorFallback.size).toBe(1);
    expect(byDoctorFallback.get("joao@clinica.com")!.total).toBe(30);
  });
});

describe("groupItemsForInvoicing — empresa sem e-mail de NF", () => {
  it("lista a empresa e não cria bucket para ela", () => {
    const map = companies([["c1", { name: "Clínica Sem Email", invoice_emails: [] }]]);
    const { byCompany, missingCompanyEmails } = groupItemsForInvoicing(
      [item({ company_id: "c1" })],
      map,
    );
    expect(byCompany.size).toBe(0);
    expect(missingCompanyEmails).toEqual([{ company_id: "c1", company_name: "Clínica Sem Email" }]);
  });

  it("lista a empresa uma única vez, mesmo com vários itens", () => {
    const map = companies([["c1", { invoice_emails: [] }]]);
    const { missingCompanyEmails } = groupItemsForInvoicing(
      [item({ id: "i1", company_id: "c1" }), item({ id: "i2", company_id: "c1" })],
      map,
    );
    expect(missingCompanyEmails).toHaveLength(1);
  });

  it("itens da empresa sem e-mail NÃO caem no fallback do médico", () => {
    // O envio é bloqueado no handler; se caíssem no médico, a cobrança iria
    // para a pessoa física em vez da PJ.
    const map = companies([["c1", { invoice_emails: [] }]]);
    const { byDoctorFallback } = groupItemsForInvoicing(
      [item({ company_id: "c1", doctor_email: "joao@clinica.com" })],
      map,
    );
    expect(byDoctorFallback.size).toBe(0);
  });
});

describe("groupItemsForInvoicing — itens sem destinatário possível", () => {
  it("item sem empresa e sem e-mail de médico é descartado em silêncio", () => {
    const { byCompany, byDoctorFallback, missingCompanyEmails } = groupItemsForInvoicing(
      [item({ company_id: null, doctor_email: null, gross_amount: 500 })],
      new Map(),
    );
    expect(byCompany.size).toBe(0);
    expect(byDoctorFallback.size).toBe(0);
    // Não entra em nenhuma lista de bloqueio — some do pedido sem aviso.
    expect(missingCompanyEmails).toEqual([]);
  });

  it("e-mail só com espaços conta como ausente", () => {
    const { byDoctorFallback } = groupItemsForInvoicing(
      [item({ company_id: null, doctor_email: "   " })],
      new Map(),
    );
    expect(byDoctorFallback.size).toBe(0);
  });

  it("o descarte não afeta os demais itens do mesmo lote", () => {
    const map = companies([["c1", {}]]);
    const { byCompany, byDoctorFallback } = groupItemsForInvoicing(
      [
        item({ id: "i1", company_id: null, doctor_email: null, gross_amount: 500 }),
        item({ id: "i2", company_id: "c1", gross_amount: 100 }),
        item({ id: "i3", company_id: null, doctor_email: "ana@x.com", gross_amount: 70 }),
      ],
      map,
    );
    expect(byCompany.get("c1")!.total).toBe(100);
    expect(byDoctorFallback.get("ana@x.com")!.total).toBe(70);
  });
});

/**
 * NOTA (comportamento atual, não alterado por estes testes):
 *
 * Item sem `company_id` e sem `doctor_email` é descartado silenciosamente —
 * não vira cobrança e não aparece em `missingCompanyEmails` nem em nenhum
 * outro bloqueio. O handler só devolve erro quando NENHUM destinatário sobra;
 * se houver ao menos um, o lote é enviado e esses itens simplesmente não são
 * cobrados de ninguém.
 *
 * Se isso puder acontecer na operação, o caminho seria devolvê-los numa lista
 * (ex.: `items_sem_destinatario`) para o handler bloquear ou reportar.
 */
