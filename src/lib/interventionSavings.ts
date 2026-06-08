/**
 * Tipos e helpers do KPI "Valor financeiro ajustado por intervenção".
 *
 * Mede o impacto em R$ das devoluções/reprovações feitas por diretor/validador:
 * `delta = expected_amount (motor) − gross_amount (pago final)`.
 *  - delta > 0  → economia para o hospital (pagou menos que a regra previa)
 *  - delta < 0  → perda (pagou mais que a regra previa)
 *
 * O cálculo pesado vive na RPC `get_intervention_savings`. Aqui ficam só os tipos
 * e funções puras (resumo + format) para serem testadas isoladamente.
 */

export type IntervenorRole = "diretor" | "validador";

export interface InterventionSummary {
  economia: number;
  perda: number;
  saldo: number;
  qtd_itens: number;
}

export interface InterventionByRole {
  role: IntervenorRole;
  saldo: number;
  qtd: number;
}

export interface InterventionByUser {
  user_id: string;
  nome: string;
  role: IntervenorRole;
  qtd_itens: number;
  economia: number;
  perda: number;
  saldo: number;
}

export interface InterventionItem {
  item_id: string;
  payment_id: string;
  obs_id: string;
  valor_regra: number;
  valor_pago_final: number;
  delta: number;
  author_id: string;
  autor: string;
  role: IntervenorRole;
  obs_at: string;
  acatado_at: string;
  doctor_name: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  company_name: string | null;
}

export interface InterventionSavingsResult {
  summary: InterventionSummary;
  by_role: InterventionByRole[];
  by_user: InterventionByUser[];
  items: InterventionItem[];
  window: { start: string; end: string; hospital_id: string | null };
}

export const emptySummary = (): InterventionSummary => ({
  economia: 0,
  perda: 0,
  saldo: 0,
  qtd_itens: 0,
});

export const emptyResult = (): InterventionSavingsResult => ({
  summary: emptySummary(),
  by_role: [],
  by_user: [],
  items: [],
  window: { start: "", end: "", hospital_id: null },
});

/** Recalcula resumo a partir da lista de itens — útil para filtros client-side. */
export const summarizeItems = (items: InterventionItem[]): InterventionSummary => {
  let economia = 0;
  let perda = 0;
  for (const it of items) {
    if (it.delta > 0) economia += it.delta;
    else if (it.delta < 0) perda += -it.delta;
  }
  return {
    economia,
    perda,
    saldo: economia - perda,
    qtd_itens: items.length,
  };
};

/** Filtros aplicáveis client-side ao drill-down. */
export interface InterventionFilters {
  role?: IntervenorRole | "all";
  userId?: string | "all";
  search?: string;
}

export const filterItems = (
  items: InterventionItem[],
  f: InterventionFilters,
): InterventionItem[] => {
  const q = (f.search ?? "").trim().toLowerCase();
  return items.filter((it) => {
    if (f.role && f.role !== "all" && it.role !== f.role) return false;
    if (f.userId && f.userId !== "all" && it.author_id !== f.userId) return false;
    if (q) {
      const hay = [
        it.autor,
        it.doctor_name,
        it.procedure_code,
        it.procedure_name,
        it.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

/** Sinal de impacto: positivo é bom para o hospital. */
export const impactTone = (
  saldo: number,
): "neutral" | "positive" | "negative" => {
  if (Math.abs(saldo) < 0.005) return "neutral";
  return saldo > 0 ? "positive" : "negative";
};

/** Converte linhas do drill-down para CSV (separador `;`, padrão BR). */
export const itemsToCsv = (items: InterventionItem[]): string => {
  const header = [
    "data_intervencao",
    "data_acatamento",
    "autor",
    "papel",
    "empresa",
    "medico",
    "procedimento",
    "valor_regra",
    "valor_pago_final",
    "delta",
    "payment_id",
    "item_id",
  ].join(";");
  const rows = items.map((it) =>
    [
      it.obs_at,
      it.acatado_at,
      `"${(it.autor ?? "").replace(/"/g, '""')}"`,
      it.role,
      `"${(it.company_name ?? "").replace(/"/g, '""')}"`,
      `"${(it.doctor_name ?? "").replace(/"/g, '""')}"`,
      `"${[it.procedure_code, it.procedure_name].filter(Boolean).join(" - ").replace(/"/g, '""')}"`,
      it.valor_regra.toFixed(2).replace(".", ","),
      it.valor_pago_final.toFixed(2).replace(".", ","),
      it.delta.toFixed(2).replace(".", ","),
      it.payment_id,
      it.item_id,
    ].join(";"),
  );
  return [header, ...rows].join("\n");
};
