import { supabase } from "@/integrations/supabase/client";

export interface CompanyRiskProfile {
  alertRate: number;       // 0..1
  totalItems: number;
  alertItems: number;
  sampleMonths: number;    // janela usada (fixa: 6)
}

const SAMPLE_MONTHS = 6;
const ALERT_STATUSES = new Set(["alerta", "reprovado"]);

/**
 * Carrega taxa histórica de alerta dos últimos 6 meses para cada empresa.
 * Agregação client-side para evitar criar RPC nova.
 */
export async function fetchCompanyRiskProfiles(
  companyNames: string[],
): Promise<Map<string, CompanyRiskProfile>> {
  const result = new Map<string, CompanyRiskProfile>();
  const unique = Array.from(new Set(companyNames.map((n) => (n ?? "").trim()).filter(Boolean)));
  if (unique.length === 0) return result;

  const since = new Date();
  since.setMonth(since.getMonth() - SAMPLE_MONTHS);

  const { data, error } = await supabase
    .from("payment_items")
    .select("company_name, ai_status")
    .in("company_name", unique)
    .gte("created_at", since.toISOString())
    .limit(50000);

  if (error || !data) {
    for (const name of unique) {
      result.set(name, { alertRate: 0, totalItems: 0, alertItems: 0, sampleMonths: SAMPLE_MONTHS });
    }
    return result;
  }

  const buckets: Record<string, { total: number; alerts: number }> = {};
  for (const row of data as Array<{ company_name: string | null; ai_status: string | null }>) {
    const name = (row.company_name ?? "").trim();
    if (!name) continue;
    (buckets[name] ||= { total: 0, alerts: 0 });
    buckets[name].total++;
    if (row.ai_status && ALERT_STATUSES.has(row.ai_status)) buckets[name].alerts++;
  }

  for (const name of unique) {
    const b = buckets[name] ?? { total: 0, alerts: 0 };
    result.set(name, {
      alertRate: b.total > 0 ? b.alerts / b.total : 0,
      totalItems: b.total,
      alertItems: b.alerts,
      sampleMonths: SAMPLE_MONTHS,
    });
  }
  return result;
}

export function riskLevel(rate: number): "verde" | "amarelo" | "vermelho" {
  if (rate < 0.15) return "verde";
  if (rate < 0.35) return "amarelo";
  return "vermelho";
}
