export type PriorityLevel = "urgente" | "alta" | "normal" | "baixa";

export interface PriorityScore {
  score: number;
  level: PriorityLevel;
  reasons: string[];
}

export interface PriorityInput {
  slaLevel: "ok" | "preventivo" | "vencido" | null;
  elapsedDays: number;
  riskScore: number;
  status: string;
  totalAmount: number;
  itemsCount: number;
}

export function calcPriorityScore(params: PriorityInput): PriorityScore {
  const reasons: string[] = [];
  let score = 0;

  if (params.slaLevel === "vencido") {
    score += 50;
    reasons.push("SLA vencido");
  } else if (params.slaLevel === "preventivo") {
    score += 25;
    reasons.push("SLA próximo do vencimento");
  }

  if (params.riskScore > 70) {
    score += 30;
    reasons.push("Alta concentração de alertas");
  } else if (params.riskScore >= 40) {
    score += 15;
    reasons.push("Concentração moderada de alertas");
  }

  if (params.elapsedDays > 7) {
    score += 15;
    reasons.push("Parado há mais de 7 dias");
  } else if (params.elapsedDays > 3) {
    score += 8;
    reasons.push("Parado há mais de 3 dias");
  }

  if (params.totalAmount > 500000) {
    score += 5;
    reasons.push("Lote de alto valor");
  }

  score = Math.min(100, score);

  let level: PriorityLevel;
  if (score >= 75) level = "urgente";
  else if (score >= 50) level = "alta";
  else if (score >= 25) level = "normal";
  else level = "baixa";

  return { score, level, reasons };
}
