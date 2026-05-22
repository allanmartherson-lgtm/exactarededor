import { supabase } from "@/integrations/supabase/client";

export interface DoctorSectorAnomaly {
  doctorName: string;
  historicalSector: string;
  historicalShare: number; // 0..1
  currentSector: string;
  currentShare: number;    // 0..1
  deviation: number;       // currentShare - historicalShare (positivo => anômalo)
  currentItems: number;
  historicalItems: number;
}

const SAMPLE_MONTHS = 6;
const HISTORICAL_DOMINANCE = 0.6;
const CURRENT_DEVIATION = 0.4;

/**
 * Detecta médicos que historicamente operam em um setor e que neste lote
 * apresentam concentração relevante em outro setor.
 */
export async function detectDoctorSectorAnomalies(
  paymentId: string,
): Promise<DoctorSectorAnomaly[]> {
  if (!paymentId) return [];

  // Lote atual
  const { data: current, error: currentErr } = await supabase
    .from("payment_items")
    .select("doctor_name, sector")
    .eq("payment_id", paymentId)
    .limit(5000);
  if (currentErr || !current) return [];

  // Agrupa atual por médico
  const currentByDoctor: Record<string, Record<string, number>> = {};
  for (const row of current as Array<{ doctor_name: string | null; sector: string | null }>) {
    const name = (row.doctor_name ?? "").trim();
    const sec = (row.sector ?? "").trim();
    if (!name || !sec) continue;
    (currentByDoctor[name] ||= {});
    currentByDoctor[name][sec] = (currentByDoctor[name][sec] ?? 0) + 1;
  }
  const doctorNames = Object.keys(currentByDoctor);
  if (doctorNames.length === 0) return [];

  // Histórico 6 meses
  const since = new Date();
  since.setMonth(since.getMonth() - SAMPLE_MONTHS);
  const { data: history, error: histErr } = await supabase
    .from("payment_items")
    .select("doctor_name, sector, payment_id")
    .in("doctor_name", doctorNames)
    .neq("payment_id", paymentId)
    .gte("created_at", since.toISOString())
    .limit(5000);
  if (histErr || !history) return [];

  const histByDoctor: Record<string, Record<string, number>> = {};
  for (const row of history as Array<{ doctor_name: string | null; sector: string | null }>) {
    const name = (row.doctor_name ?? "").trim();
    const sec = (row.sector ?? "").trim();
    if (!name || !sec) continue;
    (histByDoctor[name] ||= {});
    histByDoctor[name][sec] = (histByDoctor[name][sec] ?? 0) + 1;
  }

  const anomalies: DoctorSectorAnomaly[] = [];
  for (const name of doctorNames) {
    const hist = histByDoctor[name];
    if (!hist) continue;
    const histTotal = Object.values(hist).reduce((a, b) => a + b, 0);
    if (histTotal < 5) continue; // amostra insuficiente

    const histEntries = Object.entries(hist).sort((a, b) => b[1] - a[1]);
    const [histTopSector, histTopCount] = histEntries[0];
    const histShare = histTopCount / histTotal;
    if (histShare < HISTORICAL_DOMINANCE) continue;

    const cur = currentByDoctor[name] ?? {};
    const curTotal = Object.values(cur).reduce((a, b) => a + b, 0);
    if (curTotal === 0) continue;
    const curEntries = Object.entries(cur).sort((a, b) => b[1] - a[1]);
    const [curTopSector, curTopCount] = curEntries[0];
    if (curTopSector === histTopSector) continue;
    const curShare = curTopCount / curTotal;
    if (curShare < CURRENT_DEVIATION) continue;

    anomalies.push({
      doctorName: name,
      historicalSector: histTopSector,
      historicalShare: histShare,
      currentSector: curTopSector,
      currentShare: curShare,
      deviation: curShare,
      currentItems: curTotal,
      historicalItems: histTotal,
    });
  }
  return anomalies.sort((a, b) => b.deviation - a.deviation);
}
