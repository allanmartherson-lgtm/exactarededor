/**
 * Regras de destinatário e cobrança do pedido de NF.
 *
 * Extraído do handler de `index.ts`, onde vivia inline dentro do `serve()` e
 * portanto não era alcançável por teste. É o que decide QUEM é cobrado e por
 * QUANTO: a validação que bloqueia o envio e o agrupamento dos itens por
 * empresa (com fallback por médico quando o item não tem PJ).
 *
 * Puro: nada de Deno, Supabase ou rede. O handler continua responsável por
 * carregar os itens e o cadastro de empresas e por traduzir o resultado em
 * respostas HTTP.
 */
import { isValidCNPJ, onlyDigits } from "./docs.ts";

/** Subconjunto de payment_items que estas regras realmente leem. */
export type GroupableItem = {
  id: string;
  doctor_name: string;
  doctor_email: string | null;
  company_id: string | null;
  company_name: string | null;
  company_document: string | null;
  gross_amount: number | null;
};

export type CompanyInfo = {
  name: string;
  document: string | null;
  invoice_emails: string[];
};

export type InvalidDocument = {
  item_id: string;
  doctor_name: string;
  document: string | null;
  company_name: string | null;
  reason: string;
};

export type CompanyBucket<T extends GroupableItem = GroupableItem> = {
  company_id: string;
  company_name: string;
  to: string[];
  cc: Set<string>;
  total: number;
  items: T[];
};

export type DoctorBucket<T extends GroupableItem = GroupableItem> = {
  doctor_email: string;
  total: number;
  items: T[];
};

export type GroupingResult<T extends GroupableItem = GroupableItem> = {
  byCompany: Map<string, CompanyBucket<T>>;
  byDoctorFallback: Map<string, DoctorBucket<T>>;
  /** Empresas que têm itens mas nenhum e-mail de NF — bloqueiam o envio em lote. */
  missingCompanyEmails: Array<{ company_id: string; company_name: string }>;
};

/**
 * Documentos que impedem o envio.
 *
 * Duas verificações independentes por item:
 *  - CNPJ do cadastro da empresa vinculada (quando há `company_id`);
 *  - CNPJ digitado no próprio item, validado SÓ quando tem 14 dígitos —
 *    documento com outro tamanho (ex.: CPF) passa sem checagem aqui.
 *
 * Um item pode gerar duas entradas se ambos estiverem inválidos.
 */
export function collectInvalidDocuments<T extends GroupableItem>(
  items: T[],
  companyMap: Map<string, CompanyInfo>,
): InvalidDocument[] {
  const invalid: InvalidDocument[] = [];
  for (const it of items) {
    if (it.company_id) {
      const c = companyMap.get(it.company_id);
      if (c?.document && !isValidCNPJ(c.document)) {
        invalid.push({
          item_id: it.id,
          doctor_name: it.doctor_name,
          document: c.document,
          company_name: c.name,
          reason: `CNPJ da empresa "${c.name}" é inválido.`,
        });
      }
    }
    const itemCnpjDigits = onlyDigits(it.company_document ?? "");
    if (itemCnpjDigits.length === 14 && !isValidCNPJ(itemCnpjDigits)) {
      invalid.push({
        item_id: it.id,
        doctor_name: it.doctor_name,
        document: it.company_document,
        company_name: it.company_name,
        reason: "CNPJ informado no item é inválido.",
      });
    }
  }
  return invalid;
}

/**
 * Agrupa os itens por destinatário.
 *
 * Ordem de decisão por item:
 *  1. Tem `company_id` presente no cadastro:
 *       · empresa SEM e-mail de NF  → item é ignorado e a empresa entra em
 *         `missingCompanyEmails` (uma vez só);
 *       · empresa COM e-mail        → soma no bucket da empresa e o e-mail do
 *         médico entra em CC (normalizado, sem repetir).
 *  2. Sem empresa (ou empresa fora do cadastro): cai no bucket do médico,
 *     pela chave do e-mail normalizado.
 *  3. Sem empresa e sem e-mail de médico: o item é DESCARTADO — não há para
 *     quem enviar. Ver o teste correspondente: esses itens somem do pedido
 *     sem aparecer em nenhum bloqueio.
 */
export function groupItemsForInvoicing<T extends GroupableItem>(
  items: T[],
  companyMap: Map<string, CompanyInfo>,
): GroupingResult<T> {
  const byCompany = new Map<string, CompanyBucket<T>>();
  const byDoctorFallback = new Map<string, DoctorBucket<T>>();
  const missingCompanyEmails: Array<{ company_id: string; company_name: string }> = [];

  for (const it of items) {
    const docEmail = (it.doctor_email ?? "").trim().toLowerCase();
    if (it.company_id && companyMap.has(it.company_id)) {
      const c = companyMap.get(it.company_id)!;
      if (!c.invoice_emails.length) {
        if (!missingCompanyEmails.find((m) => m.company_id === it.company_id)) {
          missingCompanyEmails.push({ company_id: it.company_id!, company_name: c.name });
        }
        continue;
      }
      const cur = byCompany.get(it.company_id) ?? {
        company_id: it.company_id,
        company_name: c.name,
        to: c.invoice_emails,
        cc: new Set<string>(),
        total: 0,
        items: [] as T[],
      };
      cur.total += Number(it.gross_amount ?? 0);
      cur.items.push(it);
      if (docEmail) cur.cc.add(docEmail);
      byCompany.set(it.company_id, cur);
    } else {
      if (!docEmail) continue;
      const cur = byDoctorFallback.get(docEmail) ?? {
        doctor_email: docEmail,
        total: 0,
        items: [] as T[],
      };
      cur.total += Number(it.gross_amount ?? 0);
      cur.items.push(it);
      byDoctorFallback.set(docEmail, cur);
    }
  }

  return { byCompany, byDoctorFallback, missingCompanyEmails };
}
