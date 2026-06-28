/**
 * Motor de composição de repasse (Onda 2).
 *
 * Função pura: recebe a lista de rubricas de um payout_model + valores informados
 * pelo analista para as bases (e quantidades para faixas) e devolve a memória de
 * cálculo estruturada que vai pra `payments.payout_breakdown`.
 *
 * Nenhuma chamada de I/O aqui — tabelas de faixa são resolvidas antes pelo caller
 * (ver NewManualPaymentComposicao.tsx). Isso mantém o motor testável e estável.
 *
 * Ordem de cálculo (importante):
 *  1) Resolver bases (base_producao = input do analista; base_fixa = fixed_value).
 *  2) Aplicar acréscimos por faixa (resolvidos via tier_table_id + quantidade).
 *  3) Para cada rubrica de desconto/acréscimo %/valor: calcular sobre `incide_sobre`.
 *     - bruto = soma de TODAS as bases (sem descontos).
 *     - subtotal_anterior = soma acumulada até a rubrica anterior.
 *     - rubrica_especifica = valor da rubrica em `ref_rubric_order`.
 *  4) Retenções % são tratadas como descontos finais (mesma lógica, sinal negativo).
 *  5) total_nf = soma de todas as contribuições (com sinal).
 */
export type RubricKind =
  | "base_producao"
  | "base_fixa"
  | "desconto_pct"
  | "desconto_valor"
  | "acrescimo_pct"
  | "acrescimo_valor"
  | "acrescimo_faixa"
  | "retencao_pct";

export type IncideSobre = "bruto" | "subtotal_anterior" | "rubrica_especifica";

export interface RubricDef {
  id: string;
  sort_order: number;
  kind: RubricKind;
  label: string;
  incide_sobre: IncideSobre | null;
  ref_rubric_order: number | null;
  param_key: string | null;
  fixed_pct: number | null;
  fixed_value: number | null;
  tier_table_id: string | null;
  convenio_slug: string | null;
  required: boolean;
}

/** Input do analista para cada rubrica que precisa de entrada. */
export interface RubricInputs {
  /** Valor digitado para base_producao (em R$). */
  baseValue?: number;
  /** Quantidade usada para resolver acrescimo_faixa (atendimentos, etc.). */
  tierQuantity?: number;
  /** Override do % (quando param_key estiver vazio e fixed_pct não definido). */
  overridePct?: number;
  /** Override do valor (idem). */
  overrideValue?: number;
}

export interface ResolvedTierTable {
  id: string;
  rows: Array<{ min_value: number; max_value: number | null; output_value: number; label: string | null }>;
}

export interface BreakdownLine {
  order: number;
  kind: RubricKind;
  label: string;
  /** Contribuição líquida com sinal (negativa para descontos/retenções). */
  value: number;
  pct?: number;
  base?: number;
  /** Para faixas: a quantidade que entrou + a faixa resolvida. */
  tier_quantity?: number;
  tier_row_label?: string | null;
  ref_rubric_order?: number | null;
  incide_sobre?: IncideSobre | null;
}

export interface Breakdown {
  rubrics: BreakdownLine[];
  total_bases: number;
  total_descontos: number;
  total_acrescimos: number;
  total_retencoes: number;
  total_nf: number;
}

const KIND_SIGN: Record<RubricKind, 1 | -1 | 0> = {
  base_producao: 1,
  base_fixa: 1,
  acrescimo_faixa: 1,
  acrescimo_pct: 1,
  acrescimo_valor: 1,
  desconto_pct: -1,
  desconto_valor: -1,
  retencao_pct: -1,
};

function resolveTier(qty: number, table: ResolvedTierTable): { value: number; label: string | null } {
  for (const row of table.rows) {
    const okMin = qty >= row.min_value;
    const okMax = row.max_value == null || qty <= row.max_value;
    if (okMin && okMax) return { value: row.output_value, label: row.label };
  }
  return { value: 0, label: null };
}

export function computeBreakdown(
  rubrics: RubricDef[],
  inputs: Record<string, RubricInputs>,
  tiers: Record<string, ResolvedTierTable>,
  params: Record<string, number> = {},
): Breakdown {
  // Garante ordem
  const sorted = [...rubrics].sort((a, b) => a.sort_order - b.sort_order);

  // Passo 1: calcula contribuição de cada rubrica em ordem
  const lines: BreakdownLine[] = [];
  const valueByOrder = new Map<number, number>();

  const sumBases = () =>
    lines.filter((l) => l.kind === "base_producao" || l.kind === "base_fixa" || l.kind === "acrescimo_faixa")
      .reduce((s, l) => s + l.value, 0);
  const subtotal = () => lines.reduce((s, l) => s + l.value, 0);

  for (const r of sorted) {
    const input = inputs[r.id] ?? {};
    let value = 0;
    let pct: number | undefined;
    let base: number | undefined;
    let tierQty: number | undefined;
    let tierLabel: string | null | undefined;

    switch (r.kind) {
      case "base_producao":
        value = input.baseValue ?? 0;
        break;
      case "base_fixa":
        value = r.fixed_value ?? input.overrideValue ?? 0;
        break;
      case "acrescimo_faixa": {
        const tbl = r.tier_table_id ? tiers[r.tier_table_id] : null;
        tierQty = input.tierQuantity ?? 0;
        if (tbl && tierQty > 0) {
          const hit = resolveTier(tierQty, tbl);
          value = hit.value;
          tierLabel = hit.label;
        }
        break;
      }
      case "desconto_pct":
      case "acrescimo_pct":
      case "retencao_pct": {
        pct = r.fixed_pct ?? (r.param_key ? params[r.param_key] : undefined) ?? input.overridePct ?? 0;
        base = computeBase(r.incide_sobre, r.ref_rubric_order, sumBases(), subtotal(), valueByOrder);
        value = (base * pct) / 100 * KIND_SIGN[r.kind];
        break;
      }
      case "desconto_valor":
      case "acrescimo_valor":
        value = (r.fixed_value ?? input.overrideValue ?? 0) * KIND_SIGN[r.kind];
        break;
    }

    const line: BreakdownLine = {
      order: r.sort_order,
      kind: r.kind,
      label: r.label,
      value: round2(value),
      pct,
      base: base != null ? round2(base) : undefined,
      tier_quantity: tierQty,
      tier_row_label: tierLabel ?? undefined,
      ref_rubric_order: r.ref_rubric_order ?? undefined,
      incide_sobre: r.incide_sobre,
    };
    lines.push(line);
    valueByOrder.set(r.sort_order, line.value);
  }

  const total_bases = lines.filter((l) => l.kind === "base_producao" || l.kind === "base_fixa").reduce((s, l) => s + l.value, 0);
  const total_descontos = lines.filter((l) => l.kind === "desconto_pct" || l.kind === "desconto_valor").reduce((s, l) => s + l.value, 0);
  const total_acrescimos = lines.filter((l) => l.kind === "acrescimo_pct" || l.kind === "acrescimo_valor" || l.kind === "acrescimo_faixa").reduce((s, l) => s + l.value, 0);
  const total_retencoes = lines.filter((l) => l.kind === "retencao_pct").reduce((s, l) => s + l.value, 0);
  const total_nf = round2(lines.reduce((s, l) => s + l.value, 0));

  return {
    rubrics: lines,
    total_bases: round2(total_bases),
    total_descontos: round2(total_descontos),
    total_acrescimos: round2(total_acrescimos),
    total_retencoes: round2(total_retencoes),
    total_nf,
  };
}

function computeBase(
  incide: IncideSobre | null,
  refOrder: number | null,
  bruto: number,
  subtotal: number,
  byOrder: Map<number, number>,
): number {
  if (incide === "bruto") return bruto;
  if (incide === "rubrica_especifica" && refOrder != null) return Math.abs(byOrder.get(refOrder) ?? 0);
  return subtotal; // default: subtotal_anterior
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
