/**
 * Parser leve para planilhas de "Bônus por paciente".
 *
 * Aceita qualquer xlsx que tenha pelo menos UMA coluna de valor e UMA coluna
 * que identifique o paciente (Nome/Paciente/Beneficiário). As demais são
 * opcionais e enriquecem o item, mas não impedem a importação.
 *
 * Saída: lista de itens prontos para virar payment_items. Cada linha vale R$
 * X para o médico responsável escolhido no upload (pass-through, sem motor).
 */
import * as XLSX from "xlsx";

export interface BonusRow {
  patient_name: string | null;
  doctor_name_in_row: string | null;
  agreement_text: string | null;
  attendance_number: string | null;
  procedure_date: string | null;
  gross_amount: number;
  raw: Record<string, unknown>;
}

export interface BonusParseResult {
  rows: BonusRow[];
  declared_total: number | null;
  detected_columns: {
    patient?: string;
    value?: string;
    doctor?: string;
    agreement?: string;
    attendance?: string;
    date?: string;
  };
  warnings: string[];
}

const norm = (s: string) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const PATIENT_KEYS = ["paciente", "beneficiario", "nome do paciente", "nome paciente", "nome"];
const VALUE_KEYS = ["valor", "vl", "vl ", "vl.", "total geral", "valor pago", "valor bonus", "valor bônus", "total"];
const DOCTOR_KEYS = ["profissional", "profissional executante", "medico", "médico", "executante", "prestador"];
const AGREEMENT_KEYS = ["convenio", "convênio", "operadora", "plano"];
const ATT_KEYS = ["n guia", "nº guia", "no guia", "guia", "atendimento", "n atendimento", "nº atendimento"];
const DATE_KEYS = ["data", "data guia", "data atendimento", "data procedimento", "competencia"];

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const nh = headers.map((h) => ({ raw: h, n: norm(h) }));
  // exact first
  for (const c of candidates) {
    const cn = norm(c);
    const hit = nh.find((h) => h.n === cn);
    if (hit) return hit.raw;
  }
  // starts-with / contains
  for (const c of candidates) {
    const cn = norm(c);
    const hit = nh.find((h) => h.n.startsWith(cn) || h.n.includes(cn));
    if (hit) return hit.raw;
  }
  return undefined;
}

function toNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function excelDateToISO(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 15, 0, 0)).toISOString();
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const [, dd, mm, yy] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), 15, 0, 0)).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function parseBonusPacienteFile(file: File): Promise<BonusParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha sem aba.");
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (!json.length) throw new Error("Planilha vazia.");

  const headers = Object.keys(json[0]);
  const detected = {
    patient: findHeader(headers, PATIENT_KEYS),
    value: findHeader(headers, VALUE_KEYS),
    doctor: findHeader(headers, DOCTOR_KEYS),
    agreement: findHeader(headers, AGREEMENT_KEYS),
    attendance: findHeader(headers, ATT_KEYS),
    date: findHeader(headers, DATE_KEYS),
  };

  const warnings: string[] = [];
  if (!detected.value) {
    throw new Error(
      `Coluna de VALOR não encontrada. Cabeçalhos lidos: ${headers.join(", ")}`,
    );
  }
  if (!detected.patient) {
    warnings.push(
      "Coluna de paciente não detectada — itens serão importados sem paciente identificado.",
    );
  }

  const rows: BonusRow[] = [];
  let declared_total: number | null = null;

  for (const raw of json) {
    const valor = toNumber(raw[detected.value!]);
    const patient = detected.patient ? toStr(raw[detected.patient]) : null;
    // Linha de totalização: tem valor mas nada mais → vira declared_total
    const looksTotal =
      valor > 0 &&
      !patient &&
      !(detected.doctor && toStr(raw[detected.doctor])) &&
      !(detected.attendance && toStr(raw[detected.attendance]));
    if (looksTotal) {
      declared_total = (declared_total ?? 0) + valor;
      continue;
    }
    if (valor === 0 && !patient) continue;

    rows.push({
      patient_name: patient,
      doctor_name_in_row: detected.doctor ? toStr(raw[detected.doctor]) : null,
      agreement_text: detected.agreement ? toStr(raw[detected.agreement]) : null,
      attendance_number: detected.attendance ? toStr(raw[detected.attendance]) : null,
      procedure_date: detected.date ? excelDateToISO(raw[detected.date]) : null,
      gross_amount: valor,
      raw,
    });
  }

  return { rows, declared_total, detected_columns: detected, warnings };
}
