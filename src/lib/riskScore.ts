import type { PaymentItemRow as PaymentItemRowData } from "@/hooks/usePaymentDetailData";

/**
 * Sistema de priorização por risco baseado em impacto financeiro real.
 * 
 * Formula:
 * score_base = (%_valor_reprovado * 70) + (%_valor_alerta * 30)
 * bonus_volume = log10(valor_total / 1000) * 5 (máx +15)
 * score_final = score_base + bonus_volume
 */

export type RiskLevel = "critico" | "alto" | "medio" | "baixo";

export type RiskBreakdown = {
  score: number;
  level: RiskLevel;
  reasons: string[];
  valorEmRisco: number;
  percentualRisco: number;
};

export const classifyRisk = (score: number): RiskLevel => {
  if (score >= 60) return "critico";
  if (score >= 35) return "alto";
  if (score >= 15) return "medio";
  return "baixo";
};

/** 
 * Calcula o score baseado no impacto financeiro.
 * Pode ser usado para um item, um atendimento ou uma empresa inteira.
 */
export function calculateFinancialRisk(items: PaymentItemRowData[]): RiskBreakdown {
  let valorReprovado = 0;
  let valorAlerta = 0;
  let valorTotal = 0;

  for (const it of items) {
    const val = Number(it.gross_amount ?? 0);
    // Glosas/descontos não entram no valor total para cálculo de risco (são negativos ou redutores)
    if (it.tipo_linha === "glosa_desconto") continue;
    
    valorTotal += val;

    // "Aprovado (manual)" não temos coluna, mas se o status atual for aprovado,
    // ele não cai em reprovado nem alerta.
    // Exceção autorizada manualmente não conta.
    if (it.authorized_exception) continue;

    if (it.ai_status === "reprovado") {
      valorReprovado += val;
    } else if (it.ai_status === "alerta") {
      valorAlerta += val;
    }
  }

  const pctReprovado = valorTotal > 0 ? valorReprovado / valorTotal : 0;
  const pctAlerta = valorTotal > 0 ? valorAlerta / valorTotal : 0;

  const scoreBase = (pctReprovado * 70) + (pctAlerta * 30);
  
  // Bonus volume: penalidade suave para empresas de alto volume
  // log10(1.000/1.000)=0, log10(10.000/1.000)=5, log10(100.000/1.000)=10, max +15
  let bonusVolume = 0;
  if (valorTotal > 1000) {
    bonusVolume = Math.log10(valorTotal / 1000) * 5;
  }
  bonusVolume = Math.max(0, Math.min(15, bonusVolume));

  const scoreFinal = Math.round(scoreBase + bonusVolume);
  const valorEmRisco = valorReprovado + valorAlerta;
  const percentualRisco = valorTotal > 0 ? (valorEmRisco / valorTotal) * 100 : 0;

  const reasons: string[] = [];
  if (pctReprovado > 0) {
    reasons.push(`Reprovado: ${Math.round(pctReprovado * 100)}% do valor (+${Math.round(pctReprovado * 70)})`);
  }
  if (pctAlerta > 0) {
    reasons.push(`Alerta: ${Math.round(pctAlerta * 100)}% do valor (+${Math.round(pctAlerta * 30)})`);
  }
  if (bonusVolume > 0) {
    reasons.push(`Volume: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotal)} (+${Math.round(bonusVolume)})`);
  }

  return {
    score: scoreFinal,
    level: classifyRisk(scoreFinal),
    reasons,
    valorEmRisco,
    percentualRisco
  };
}

/** Mantido para compatibilidade, agora usando a lógica financeira */
export function scoreItem(it: PaymentItemRowData): RiskBreakdown {
  return calculateFinancialRisk([it]);
}

/** Mantido para compatibilidade, agora usando a lógica financeira */
export function scoreAttendance(items: PaymentItemRowData[]): RiskBreakdown {
  return calculateFinancialRisk(items);
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

export const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  critico: "bg-destructive-soft text-destructive border-destructive/40 ring-1 ring-destructive/20 font-semibold",
  alto: "bg-warning-soft text-warning-foreground border-warning/30",
  medio: "bg-muted text-muted-foreground border-border",
  baixo: "bg-muted/50 text-muted-foreground border-border/60",
};
