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

export type IntervenorRole =
  | "diretor"
  | "validador"
  | "analista"
  | "cancelamento_empresa"
  | "cancelamento_item"
  | "cancelamento_conciliacao"
  | "aceite_esperado"
  | "aceite_pago"
  | "ajuste_manual"
  | "glosa"
  | "glosa_pj"
  | "cancelamento";

export const ROLE_LABELS: Record<IntervenorRole, string> = {
  diretor: "Diretor",
  validador: "Supervisor",
  analista: "Analista",
  cancelamento_empresa: "Cancelamento empresa",
  cancelamento_item: "Cancelamento item",
  cancelamento_conciliacao: "Cancelamento via conciliação",
  // Novo: analista aceitou o valor esperado do motor — economia = gross original − esperado.
  aceite_esperado: "Aceite do esperado (motor)",
  aceite_pago: "Aceite mantendo pago",
  ajuste_manual: "Ajuste manual",
  glosa: "Glosa aplicada",
  glosa_pj: "Glosa aplicada (PJ)",
  cancelamento: "Cancelamento",
};


export const roleLabel = (r: string): string =>
  (ROLE_LABELS as Record<string, string>)[r] ?? r;

export interface InterventionSummary {
  economia: number;
  perda: number;
  /** Cancelamentos operacionais (pago em outro lote, duplicidade motor, "outro" sem contexto) — não somam no saldo. */
  neutro: number;
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
  company_group_id: string | null;
  /** Motivo do cancelamento — buscado client-side a partir de payment_items para classificação fina. */
  cancellation_reason?: string | null;
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
  neutro: 0,
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

/** Papéis que representam cancelamento manual e dependem do motivo p/ contar como economia. */
const CANCELLATION_ROLES: ReadonlySet<IntervenorRole> = new Set([
  "cancelamento_item",
  "cancelamento_empresa",
]);

/** Motivos de cancelamento que contam como economia real (espelha lib/cancelledPayments.ts). */
const ECONOMIA_REAL_REASONS: ReadonlySet<string> = new Set([
  "medico_fatura_externamente",
  "contrato_encerrado",
  "glosa_total_quitada",
  "decisao_juridica",
  "duplicidade_externa",
  "economia_real",
]);

/**
 * Decide se um item de cancelamento conta como neutro (não soma no saldo).
 * Aplicável só a cancelamento_item e cancelamento_empresa; diretor/validador/analista
 * e cancelamento_conciliacao (automático) mantêm a lógica clássica de delta.
 *
 * Sem `cancellation_reason` (ou motivo neutro/outro) → NEUTRO até o analista classificar.
 */
export const isCancellationNeutral = (it: InterventionItem): boolean => {
  if (!CANCELLATION_ROLES.has(it.role)) return false;
  if (!it.cancellation_reason) return true;
  return !ECONOMIA_REAL_REASONS.has(it.cancellation_reason);
};

/** Recalcula resumo a partir da lista de itens — útil para filtros client-side. */
export const summarizeItems = (items: InterventionItem[]): InterventionSummary => {
  let economia = 0;
  let perda = 0;
  let neutro = 0;
  for (const it of items) {
    if (isCancellationNeutral(it)) {
      neutro += Math.abs(it.delta);
      continue;
    }
    if (it.delta > 0) economia += it.delta;
    else if (it.delta < 0) perda += -it.delta;
  }
  return {
    economia,
    perda,
    neutro,
    saldo: economia - perda,
    qtd_itens: items.length,
  };
};

/** Filtros aplicáveis client-side ao drill-down. */
export interface InterventionFilters {
  role?: IntervenorRole | "all";
  userId?: string | "all";
  search?: string;
  /** Filtra pela classificação semântica do item (economia/aumento/neutro). */
  classification?: "all" | "economia" | "aumento" | "neutro";
  /** Faixa de valor absoluto do Δ (em R$). */
  minValue?: number | null;
  maxValue?: number | null;
  /** Filtra por lote de origem (payment_id). */
  paymentId?: string | "all";
  /** Filtra por empresa exata (company_name). */
  companyName?: string | "all";
  /** Filtra por médico exato (doctor_name). */
  doctorName?: string | "all";
}


export const filterItems = (
  items: InterventionItem[],
  f: InterventionFilters,
): InterventionItem[] => {
  const q = (f.search ?? "").trim().toLowerCase();
  const min = f.minValue ?? null;
  const max = f.maxValue ?? null;
  const cls = f.classification ?? "all";
  return items.filter((it) => {
    if (f.role && f.role !== "all" && it.role !== f.role) return false;
    if (f.userId && f.userId !== "all" && it.author_id !== f.userId) return false;
    if (f.paymentId && f.paymentId !== "all" && it.payment_id !== f.paymentId) return false;
    if (f.companyName && f.companyName !== "all" && (it.company_name ?? "") !== f.companyName) return false;
    if (f.doctorName && f.doctorName !== "all" && (it.doctor_name ?? "") !== f.doctorName) return false;
    if (cls !== "all" && classifyItem(it) !== cls) return false;
    const abs = Math.abs(it.delta);
    if (min != null && abs < min) return false;
    if (max != null && abs > max) return false;
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

/** Classifica o delta para exibição: positivo = economia, negativo = aumento. */
export const classifyDelta = (delta: number): "economia" | "aumento" | "neutro" => {
  if (Math.abs(delta) < 0.005) return "neutro";
  return delta > 0 ? "economia" : "aumento";
};

/**
 * Classificação semântica do item considerando motivo do cancelamento.
 * Cancelamento manual sem motivo de economia real → "neutro" (operacional).
 */
export const classifyItem = (
  it: InterventionItem,
): "economia" | "aumento" | "neutro" => {
  if (isCancellationNeutral(it)) return "neutro";
  return classifyDelta(it.delta);
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
    "classificacao",
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
      classifyDelta(it.delta),
      it.payment_id,
      it.item_id,
    ].join(";"),
  );
  return [header, ...rows].join("\n");
};

/**
 * Agrupamento para auditoria: lista, por pagamento, todos os eventos
 * (ajuste de valor, devolução, cancelamento empresa, cancelamento item)
 * que contribuíram para o KPI, com seus deltas/valores brutos individuais.
 *
 * Não deduplica — o RPC já se encarrega de evitar dupla contagem
 * (ex.: item_cancels exclui itens cujo grupo foi cancelado no período).
 */
export interface InterventionAuditGroup {
  payment_id: string;
  company_name: string | null;
  qtd_eventos: number;
  economia: number;
  perda: number;
  saldo: number;
  eventos: InterventionItem[];
}

export const groupItemsForAudit = (
  items: InterventionItem[],
): InterventionAuditGroup[] => {
  const map = new Map<string, InterventionAuditGroup>();
  for (const it of items) {
    const g = map.get(it.payment_id) ?? {
      payment_id: it.payment_id,
      company_name: it.company_name,
      qtd_eventos: 0,
      economia: 0,
      perda: 0,
      saldo: 0,
      eventos: [],
    };
    g.eventos.push(it);
    g.qtd_eventos += 1;
    if (it.delta > 0) g.economia += it.delta;
    else if (it.delta < 0) g.perda += -it.delta;
    g.saldo = g.economia - g.perda;
    if (!g.company_name && it.company_name) g.company_name = it.company_name;
    map.set(it.payment_id, g);
  }
  return Array.from(map.values()).sort((a, b) => b.saldo - a.saldo);
};

/**
 * Detecta possíveis duplicatas (mesmo item_id contabilizado por mais de uma fonte).
 * Útil para alertas de auditoria — se algum item aparecer mais de uma vez é sinal
 * de que cancelamento de empresa + cancelamento de item bateram no mesmo registro.
 */
export const findDuplicateItemEvents = (
  items: InterventionItem[],
): { item_id: string; roles: IntervenorRole[] }[] => {
  const map = new Map<string, IntervenorRole[]>();
  for (const it of items) {
    const arr = map.get(it.item_id) ?? [];
    arr.push(it.role);
    map.set(it.item_id, arr);
  }
  return Array.from(map.entries())
    .filter(([, roles]) => roles.length > 1)
    .map(([item_id, roles]) => ({ item_id, roles }));
};
