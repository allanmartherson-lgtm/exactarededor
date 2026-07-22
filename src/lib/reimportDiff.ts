// Helper puro para calcular o diff entre linhas parseadas de uma reimportação
// e os payment_items já existentes no lote. Sem side-effects: recebe as
// linhas atuais/novas e devolve o resumo. A busca no banco fica em
// PaymentDetail.tsx (compareReimportAgainstDb).
//
// Chave canônica: attendance_number | procedure_code | doctor_norm | source_file
// (mesmo shape usado pelo motor para deduplicar; source_file entra para não
// confundir linhas de arquivos distintos de uma reimportação multi-arquivo).

export type DiffRow = {
  key: string;
  attendance_number: string | null;
  procedure_code: string | null;
  doctor_name: string | null;
  source_file_name: string | null;
  before?: number | null;
  after?: number | null;
};

export type ReimportDiff = {
  addedCount: number;
  removedCount: number;
  changed: DiffRow[]; // linhas com mesma chave e valor bruto diferente
  addedSample: DiffRow[];
  removedSample: DiffRow[];
  totalBefore: number;
  totalAfter: number;
};

const normalizeDoctor = (s: string | null | undefined) =>
  (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeCode = (s: string | null | undefined) =>
  (s ?? "").toString().replace(/\D+/g, "").padStart(8, "0").slice(-8);

export type ExistingItemRow = {
  attendance_number: string | null;
  procedure_code: string | null;
  doctor_name: string | null;
  source_file_name: string | null;
  gross_amount: number | null;
};

export type ParsedItemRow = {
  attendance_number: string | null;
  procedure_code: string | null;
  doctor_name: string | null;
  source_file_name?: string | null;
  gross_amount: number | null | undefined;
};

const buildKey = (r: { attendance_number: string | null; procedure_code: string | null; doctor_name: string | null; source_file_name: string | null | undefined }) =>
  [
    (r.attendance_number ?? "").toString().trim(),
    normalizeCode(r.procedure_code),
    normalizeDoctor(r.doctor_name),
    (r.source_file_name ?? "").toString().trim(),
  ].join("|");

const AMOUNT_EPS = 0.005; // 0,5 centavo — tolerância p/ arredondamento

export function computeReimportDiff(
  existing: ExistingItemRow[],
  parsed: ParsedItemRow[],
): ReimportDiff {
  const existingByKey = new Map<string, ExistingItemRow>();
  for (const it of existing) {
    existingByKey.set(
      buildKey({
        attendance_number: it.attendance_number,
        procedure_code: it.procedure_code,
        doctor_name: it.doctor_name,
        source_file_name: it.source_file_name,
      }),
      it,
    );
  }

  const parsedByKey = new Map<string, ParsedItemRow>();
  for (const it of parsed) {
    parsedByKey.set(
      buildKey({
        attendance_number: it.attendance_number,
        procedure_code: it.procedure_code,
        doctor_name: it.doctor_name,
        source_file_name: it.source_file_name ?? null,
      }),
      it,
    );
  }

  const added: DiffRow[] = [];
  const removed: DiffRow[] = [];
  const changed: DiffRow[] = [];

  for (const [key, row] of parsedByKey.entries()) {
    const prev = existingByKey.get(key);
    if (!prev) {
      added.push({
        key,
        attendance_number: row.attendance_number,
        procedure_code: row.procedure_code,
        doctor_name: row.doctor_name,
        source_file_name: row.source_file_name ?? null,
        after: row.gross_amount ?? null,
      });
      continue;
    }
    const before = Number(prev.gross_amount ?? 0);
    const after = Number(row.gross_amount ?? 0);
    if (Math.abs(before - after) > AMOUNT_EPS) {
      changed.push({
        key,
        attendance_number: row.attendance_number,
        procedure_code: row.procedure_code,
        doctor_name: row.doctor_name,
        source_file_name: row.source_file_name ?? null,
        before,
        after,
      });
    }
  }

  for (const [key, row] of existingByKey.entries()) {
    if (!parsedByKey.has(key)) {
      removed.push({
        key,
        attendance_number: row.attendance_number,
        procedure_code: row.procedure_code,
        doctor_name: row.doctor_name,
        source_file_name: row.source_file_name,
        before: row.gross_amount ?? null,
      });
    }
  }

  const totalBefore = existing.reduce((s, r) => s + (Number(r.gross_amount) || 0), 0);
  const totalAfter = parsed.reduce((s, r) => s + (Number(r.gross_amount) || 0), 0);

  return {
    addedCount: added.length,
    removedCount: removed.length,
    changed,
    addedSample: added.slice(0, 50),
    removedSample: removed.slice(0, 50),
    totalBefore,
    totalAfter,
  };
}

export const hasAnyChange = (d: ReimportDiff) =>
  d.addedCount > 0 || d.removedCount > 0 || d.changed.length > 0;
