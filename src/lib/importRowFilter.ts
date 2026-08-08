/**
 * Filtro ÚNICO de linhas não-item das planilhas de pagamento.
 *
 * Usado por TODOS os caminhos de parsing (importação original em
 * NewPayment/mapJsonToRows, reimportação do lote e reimportação dentro da PJ
 * via parsePaymentFile) para que uma linha totalizadora nunca entre como item
 * em um caminho e seja descartada em outro.
 *
 * Critérios — apenas ESTRUTURAIS. Nunca descartamos por "valor igual à soma"
 * das demais linhas: é heurística arriscada e pode matar item legítimo.
 *
 *  (a) totalizador  — coluna de identificação (médico / paciente / atendimento)
 *      contém palavra de fechamento ("TOTAL", "TOTAL A PAGAR", "SUBTOTAL",
 *      "SOMA", "VALOR TOTAL", "TOTAL REPASSE", "NOTA FISCAL"...). Colunas de
 *      procedimento/descrição só contam quando a linha não tem nenhum
 *      identificador — "Prótese total de joelho" não pode virar rodapé.
 *  (b) sem identificação — sem médico E sem paciente E sem atendimento E sem
 *      código de procedimento. Linha assim não é item, mesmo com valor.
 *  (c) linha vazia — nada preenchido além de valores.
 */

export type IgnoredRowReason = "totalizador" | "sem_identificacao" | "linha_vazia";

export const IGNORED_REASON_LABELS: Record<IgnoredRowReason, string> = {
  totalizador: "Linha de totalizador (Total / Subtotal / Soma / NF)",
  sem_identificacao: "Sem paciente, médico, atendimento ou código de procedimento",
  linha_vazia: "Linha vazia (apenas valores)",
};

/** Palavras de fechamento, com ou sem acento, em qualquer posição inicial. */
const FOOTER_WORDS =
  /^(sub\s*)?(total(\s+(geral|a\s+pagar|do\s+repasse|repasse|liquido|bruto|visita(s)?|parecer(es)?|visitas?\s+e\s+parecer(es)?|itens))?|soma(\s+dos?\s+\w+)?|valor\s+total|total\s+de\s+\w+|dividido\s+por|valor\s+(da\s+)?nf|nota\s+fiscal|desconto\s+de\s+final\s+de\s+semana)\b/;

const norm = (v: unknown): string =>
  (v == null ? "" : String(v))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const filled = (v: unknown) => norm(v).length > 0;

export interface ImportRowLike {
  doctor_name?: string | null;
  patient_name?: string | null;
  attendance_number?: string | null;
  procedure_code?: string | null;
  procedure_name?: string | null;
  description?: string | null;
  gross_amount?: number | null;
  procedure_amount?: number | null;
  source_row_number?: number;
  [k: string]: unknown;
}

export interface IgnoredRowInfo {
  rowNumber: number | null;
  reason: IgnoredRowReason;
  /** Amostra legível da linha, para o analista conferir o descarte. */
  preview: string;
  value: number;
}

const rowValue = (r: ImportRowLike) =>
  Math.abs(Number(r.gross_amount ?? 0)) || Math.abs(Number(r.procedure_amount ?? 0)) || 0;

const rowPreview = (r: ImportRowLike) =>
  [r.attendance_number, r.patient_name, r.doctor_name, r.procedure_code, r.procedure_name ?? r.description]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(" · ") || "(linha sem texto)";

/** Retorna o motivo do descarte, ou null quando a linha é um item legítimo. */
export function classifyNonItemRow(r: ImportRowLike): IgnoredRowReason | null {
  const hasDoctor = filled(r.doctor_name);
  const hasPatient = filled(r.patient_name);
  const hasAttendance = filled(r.attendance_number);
  const hasCode = filled(r.procedure_code);
  const hasIdentifier = hasDoctor || hasPatient || hasAttendance || hasCode;

  // (a) totalizador nas colunas de identificação
  for (const v of [r.doctor_name, r.patient_name, r.attendance_number]) {
    if (filled(v) && FOOTER_WORDS.test(norm(v))) return "totalizador";
  }
  // (a') totalizador em descrição/procedimento — só quando não há identificador
  if (!hasDoctor && !hasPatient && !hasAttendance) {
    for (const v of [r.procedure_name, r.description]) {
      if (filled(v) && FOOTER_WORDS.test(norm(v))) return "totalizador";
    }
  }

  if (!hasIdentifier) {
    const hasText = filled(r.procedure_name) || filled(r.description);
    // (c) nada preenchido além de valores
    if (!hasText) return "linha_vazia";
    // (b) tem texto/valor mas nenhum identificador de item
    return "sem_identificacao";
  }

  return null;
}

export interface PartitionResult<T> {
  kept: T[];
  ignored: IgnoredRowInfo[];
}

/** Separa itens legítimos das linhas não-item, preservando o motivo de cada descarte. */
export function partitionImportRows<T extends ImportRowLike>(rows: T[]): PartitionResult<T> {
  const kept: T[] = [];
  const ignored: IgnoredRowInfo[] = [];
  for (const r of rows) {
    const reason = classifyNonItemRow(r);
    if (!reason) {
      kept.push(r);
      continue;
    }
    ignored.push({
      rowNumber: typeof r.source_row_number === "number" ? r.source_row_number : null,
      reason,
      preview: rowPreview(r),
      value: rowValue(r),
    });
  }
  return { kept, ignored };
}
