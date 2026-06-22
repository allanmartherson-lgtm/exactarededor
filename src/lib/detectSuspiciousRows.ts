/**
 * Detecção heurística de linhas-total / rodapé / informativas em planilhas
 * de pagamento. Roda APÓS o parse para inspecionar linhas que passaram pelo
 * filtro mas têm cara de "totalizador" e iriam inflar o valor da base se
 * fossem tratadas como itens normais.
 *
 * Filosofia (project memory): o analista envia base tratada — o sistema
 * NUNCA descarta silenciosamente; só APONTA suspeitas e exige decisão.
 */

const FOOTER_TEXT_REGEX = /\b(total(?:\s+geral)?|subtotal|valor\s+(?:para\s+)?emiss[aã]o|nota\s+fiscal|nf\b|soma|grand\s+total)\b/i;

export type SuspicionReason =
  | "footer-text"          // alguma célula bate em /total|nota fiscal|.../
  | "value-without-key"    // tem valor mas não tem médico, atendimento nem TUSS
  | "tail-summary";        // linha no final da planilha com pouquíssimas células preenchidas e valor alto

export interface SuspiciousRow {
  /** source_row_number do ParsedRow original (1-based Excel). */
  rowNumber: number;
  /** Conteúdo bruto (pares header→valor) — só células não vazias. */
  cells: Array<{ header: string; value: string }>;
  reasons: SuspicionReason[];
  /** Valor monetário detectado na linha (para exibir "R$ 50.000"). */
  suspectedValue: number | null;
}

interface ParsedRowLike {
  doctor_name?: string | null;
  attendance_number?: string | null;
  procedure_code?: string | null;
  description?: string | null;
  procedure_name?: string | null;
  gross_amount?: number | null;
  procedure_amount?: number | null;
  raw_data?: Record<string, unknown> | null;
  source_row_number?: number;
}

const empty = (s: string | null | undefined) => !s || !String(s).trim();

const stringifyCell = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
};

/**
 * Inspeciona linhas já parseadas e retorna as suspeitas. Não decide nada —
 * apenas sinaliza. A UI exige ação explícita do analista.
 */
export function detectSuspiciousRows(
  rows: ParsedRowLike[],
  opts?: { totalRowsInSheet?: number }
): SuspiciousRow[] {
  const total = opts?.totalRowsInSheet ?? rows.length;
  const out: SuspiciousRow[] = [];

  for (const r of rows) {
    const reasons: SuspicionReason[] = [];
    const raw = r.raw_data ?? {};
    const value = Math.abs(Number(r.gross_amount ?? 0)) || Math.abs(Number(r.procedure_amount ?? 0));

    // 1) Texto de rodapé em qualquer célula
    let footerMatch = false;
    for (const v of Object.values(raw)) {
      const s = stringifyCell(v);
      if (s && FOOTER_TEXT_REGEX.test(s)) { footerMatch = true; break; }
    }
    if (footerMatch) reasons.push("footer-text");

    // 2) Tem valor mas não tem nenhuma chave operacional
    const noKeys = empty(r.doctor_name) && empty(r.attendance_number) && empty(r.procedure_code);
    if (noKeys && value > 0) reasons.push("value-without-key");

    // 3) Linha de cauda com pouquíssimas células preenchidas e valor alto
    const filledCells = Object.values(raw).filter((v) => stringifyCell(v).length > 0).length;
    const srn = r.source_row_number ?? 0;
    const nearTail = total > 0 && srn >= total - 3;
    if (nearTail && filledCells <= 3 && value >= 1000) {
      if (!reasons.includes("value-without-key")) reasons.push("tail-summary");
    }

    if (reasons.length === 0) continue;

    const cells = Object.entries(raw)
      .map(([header, v]) => ({ header, value: stringifyCell(v) }))
      .filter((c) => c.value.length > 0)
      .slice(0, 8);

    out.push({
      rowNumber: srn,
      cells,
      reasons,
      suspectedValue: value > 0 ? value : null,
    });
  }

  return out;
}

export const REASON_LABELS: Record<SuspicionReason, string> = {
  "footer-text": "Texto de totalizador (Total/Subtotal/NF…)",
  "value-without-key": "Valor sem médico, atendimento ou TUSS",
  "tail-summary": "Linha no fim da planilha com poucas células",
};
