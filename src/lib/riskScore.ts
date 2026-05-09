import type { PaymentItemRow as PaymentItemRowData } from "@/hooks/usePaymentDetailData";

/**
 * Sistema de priorização por risco.
 *
 * - Cada validação tem um peso padrão (crítico/alerta/leve).
 * - O score do atendimento soma pesos das validações + sinais adicionais
 *   (outlier, exceção autorizada, complemento elevado).
 * - O score apenas prioriza — NUNCA decide aprovação.
 */

export type RiskLevel = "critico" | "alto" | "medio" | "baixo";

export const RISK_WEIGHTS = {
  critico: 50,   // bloqueio / reprovação
  alerta: 20,    // alerta forte
  leve: 8,       // alerta leve / informativo com ação
  outlier: 25,   // valor fora da curva
  complemento_alto: 15,
  excecao_autorizada: 10,
} as const;

const OUTLIER_RX = /(outlier|fora da curva|acima da m[eé]dia|acima do percentil|múltiplo da m[eé]dia)/i;
const COMPL_ALTO_RX = /(complemento elevado|complemento.*acima)/i;
const ALERT_FORTE_RX = /(bloqueio|cr[ií]tico|reprovad|n[aã]o pagar|exclus[aã]o|inv[aá]lido|obrigat[oó]rio|divergente)/i;
const ALERT_LEVE_RX = /(opcional|recomend|sugest|conferir|verificar|informativo)/i;

const classifyAlert = (text: string): keyof typeof RISK_WEIGHTS => {
  if (OUTLIER_RX.test(text)) return "outlier";
  if (COMPL_ALTO_RX.test(text)) return "complemento_alto";
  if (ALERT_FORTE_RX.test(text)) return "alerta";
  if (ALERT_LEVE_RX.test(text)) return "leve";
  return "alerta";
};

export type RiskBreakdown = {
  score: number;
  level: RiskLevel;
  reasons: string[];
};

export const classifyRisk = (score: number): RiskLevel => {
  if (score >= 100) return "critico";
  if (score >= 60) return "alto";
  if (score >= 30) return "medio";
  return "baixo";
};

/** Calcula score de um item individual. */
export function scoreItem(it: PaymentItemRowData): RiskBreakdown {
  const reasons: string[] = [];
  let score = 0;

  const status = it.ai_status;
  if (status === "reprovado") {
    score += RISK_WEIGHTS.critico;
    reasons.push(`Reprovado (+${RISK_WEIGHTS.critico})`);
  } else if (status === "alerta") {
    score += RISK_WEIGHTS.alerta;
    reasons.push(`Alerta IA (+${RISK_WEIGHTS.alerta})`);
  }

  const alerts = it.ai_findings?.alerts ?? [];
  for (const a of alerts) {
    const k = classifyAlert(a);
    score += RISK_WEIGHTS[k];
    reasons.push(`${a.slice(0, 60)} (+${RISK_WEIGHTS[k]})`);
  }

  // Outlier: diferença significativa do esperado pelo motor
  const diffPct = it.ai_findings?.engine?.diff_pct as number | null | undefined;
  if (diffPct != null && Math.abs(diffPct) > 0.5) {
    score += RISK_WEIGHTS.outlier;
    reasons.push(`Valor ${(diffPct * 100).toFixed(0)}% vs esperado (+${RISK_WEIGHTS.outlier})`);
  }

  const itAny = it as unknown as { authorized_exception?: boolean | null };
  if (itAny.authorized_exception) {
    score += RISK_WEIGHTS.excecao_autorizada;
    reasons.push(`Exceção autorizada (+${RISK_WEIGHTS.excecao_autorizada})`);
  }

  return { score, level: classifyRisk(score), reasons };
}

/** Score agregado por atendimento (mesmo attendance_number). */
export function scoreAttendance(items: PaymentItemRowData[]): RiskBreakdown {
  const reasons: string[] = [];
  let score = 0;
  let base = 0;
  let compl = 0;

  for (const it of items) {
    const s = scoreItem(it);
    score += s.score;
    
    if (s.reasons.length > 0) {
      const itemDesc = it.procedure_name || it.description || it.procedure_code || "Item";
      const itemPrefix = items.length > 1 ? `${itemDesc}: ` : "";
      reasons.push(...s.reasons.map(r => `${itemPrefix}${r}`));
    }

    const tl = (it as any).tipo_linha as string | null;
    const v = Number(it.gross_amount ?? 0);
    if (tl === "complemento_bonus") compl += v;
    else if (tl !== "glosa_desconto") base += v;
  }

  if (base > 0 && compl / base > 0.3) {
    score += RISK_WEIGHTS.complemento_alto;
    reasons.push(`Complemento ${((compl / base) * 100).toFixed(0)}% do base (+${RISK_WEIGHTS.complemento_alto})`);
  }

  return { score, level: classifyRisk(score), reasons };
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
};

export const RISK_EMOJI: Record<RiskLevel, string> = {
  critico: "🔴",
  alto: "🟠",
  medio: "🟡",
  baixo: "🟢",
};

/**
 * Classes visuais por nível.
 * Apenas "crítico" tem destaque forte; demais seguem padrão suave
 * para não competir com o conteúdo principal (valor, status, ação).
 */
export const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  critico: "bg-destructive-soft text-destructive border-destructive/40 ring-1 ring-destructive/20 font-semibold",
  alto: "bg-warning-soft text-warning-foreground border-warning/30",
  medio: "bg-muted text-muted-foreground border-border",
  baixo: "bg-muted/50 text-muted-foreground border-border/60",
};