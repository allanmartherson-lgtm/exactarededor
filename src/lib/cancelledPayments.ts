/**
 * Tipos e helpers do relatório "Pagamentos cancelados (não-devidos)".
 * O cálculo agregado vive na RPC `get_cancelled_payments_summary`; aqui ficam
 * só estruturas + filtros + CSV para serem testáveis isoladamente.
 */

export type CancellationReason =
  | "medico_fatura_externamente"
  | "contrato_encerrado"
  | "glosa_total_quitada"
  | "decisao_juridica"
  | "duplicidade_externa"
  | "outro";

export const REASON_LABELS: Record<CancellationReason, string> = {
  medico_fatura_externamente: "Médico fatura externamente",
  contrato_encerrado: "Contrato encerrado",
  glosa_total_quitada: "Glosa total quitada",
  decisao_juridica: "Decisão jurídica",
  duplicidade_externa: "Duplicidade externa",
  outro: "Outro",
};

export const ALL_REASONS: CancellationReason[] = [
  "medico_fatura_externamente",
  "contrato_encerrado",
  "glosa_total_quitada",
  "decisao_juridica",
  "duplicidade_externa",
  "outro",
];

export const reasonLabel = (r: string | null | undefined): string => {
  if (!r) return "Outro";
  return (REASON_LABELS as Record<string, string>)[r] ?? r;
};

export interface CancelledSummary {
  valor_total: number;
  qtd_grupos: number;
  qtd_itens: number;
}

export interface CancelledByReason {
  reason: string;
  valor: number;
  qtd: number;
}

export interface CancelledRow {
  nivel: "grupo" | "item";
  id: string;
  payment_id: string;
  company_name: string | null;
  doctor_name: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  valor: number;
  cancelled_at: string;
  cancelled_by: string;
  reason: string;
  note: string | null;
  reactivated: boolean;
  autor: string;
}

export interface CancelledResult {
  summary: CancelledSummary;
  by_reason: CancelledByReason[];
  items: CancelledRow[];
  window: { start: string; end: string; hospital_id: string | null };
}

export const emptyCancelledResult = (): CancelledResult => ({
  summary: { valor_total: 0, qtd_grupos: 0, qtd_itens: 0 },
  by_reason: [],
  items: [],
  window: { start: "", end: "", hospital_id: null },
});

export interface CancelledFilters {
  reason?: CancellationReason | "all";
  nivel?: "grupo" | "item" | "all";
  search?: string;
  includeReactivated?: boolean;
}

export const filterCancelled = (
  rows: CancelledRow[],
  f: CancelledFilters,
): CancelledRow[] => {
  const q = (f.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.reason && f.reason !== "all" && r.reason !== f.reason) return false;
    if (f.nivel && f.nivel !== "all" && r.nivel !== f.nivel) return false;
    if (!f.includeReactivated && r.reactivated) return false;
    if (q) {
      const hay = [r.company_name, r.doctor_name, r.procedure_name, r.procedure_code, r.autor, r.note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

export const summarizeRows = (rows: CancelledRow[]): CancelledSummary => {
  let valor = 0, grupos = 0, itens = 0;
  for (const r of rows) {
    valor += r.valor;
    if (r.nivel === "grupo") grupos++;
    else itens++;
  }
  return { valor_total: valor, qtd_grupos: grupos, qtd_itens: itens };
};

export const groupByReason = (rows: CancelledRow[]): CancelledByReason[] => {
  const map = new Map<string, { valor: number; qtd: number }>();
  for (const r of rows) {
    const cur = map.get(r.reason) ?? { valor: 0, qtd: 0 };
    cur.valor += r.valor;
    cur.qtd += 1;
    map.set(r.reason, cur);
  }
  return [...map.entries()]
    .map(([reason, v]) => ({ reason, valor: v.valor, qtd: v.qtd }))
    .sort((a, b) => b.valor - a.valor);
};

export const cancelledToCsv = (rows: CancelledRow[]): string => {
  const header = [
    "data_cancelamento",
    "nivel",
    "empresa",
    "medico",
    "procedimento",
    "valor",
    "motivo",
    "autor",
    "reativado",
    "observacao",
    "payment_id",
    "id",
  ].join(";");
  const lines = rows.map((r) =>
    [
      r.cancelled_at,
      r.nivel,
      `"${(r.company_name ?? "").replace(/"/g, '""')}"`,
      `"${(r.doctor_name ?? "").replace(/"/g, '""')}"`,
      `"${[r.procedure_code, r.procedure_name].filter(Boolean).join(" - ").replace(/"/g, '""')}"`,
      r.valor.toFixed(2).replace(".", ","),
      reasonLabel(r.reason),
      `"${(r.autor ?? "").replace(/"/g, '""')}"`,
      r.reactivated ? "sim" : "nao",
      `"${(r.note ?? "").replace(/"/g, '""')}"`,
      r.payment_id,
      r.id,
    ].join(";"),
  );
  return [header, ...lines].join("\n");
};
