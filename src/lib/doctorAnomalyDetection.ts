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
 * Normaliza o nome do setor para comparação semântica.
 * Remove sufixos de centro de custo (ex: "(DFStar)", "(Hospital X)")
 * e mapeia variações conhecidas para um termo canônico.
 */
function normalizeSector(sector: string): string {
  const withoutSuffix = sector.replace(/\s*\([^)]*\)/g, "").trim();

  const norm = withoutSuffix
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();

  const CANONICAL: Record<string, string> = {
    "centro cirurgico": "cirurgia",
    "cirurgia": "cirurgia",
    "cc": "cirurgia",
    "bloco cirurgico": "cirurgia",
    "hemodinamica": "hemodinamica",
    "hemo": "hemodinamica",
    "uti": "uti",
    "unidade de terapia intensiva": "uti",
    "pronto socorro": "emergencia",
    "emergencia": "emergencia",
    "ps": "emergencia",
    "centro de endoscopia": "endoscopia",
    "endoscopia": "endoscopia",
    "radiologia": "radiologia",
    "raio x": "radiologia",
    "rpa": "rpa",
    "recuperacao pos anestesica": "rpa",
    "sadt": "sadt",
    "laboratorio": "laboratorio",
    "ambulatorio": "ambulatorio",
    "internacao": "internacao",
    "apartamento": "internacao",
  };

  for (const [key, canonical] of Object.entries(CANONICAL)) {
    if (norm.includes(key) || key.includes(norm)) return canonical;
  }

  return norm || sector.toLowerCase().trim();
}

/**
 * Detecta médicos que historicamente operam em um setor e que neste lote
 * apresentam concentração relevante em outro setor.
 */
export async function detectDoctorSectorAnomalies(
  paymentId: string,
): Promise<DoctorSectorAnomaly[]> {
  if (!paymentId) return [];

  const { fetchAllPaginated } = await import("@/lib/fetchAllPaginated");

  // Lote atual
  let current: Array<{ doctor_name: string | null; sector: string | null }> = [];
  try {
    current = await fetchAllPaginated((from, to) =>
      supabase
        .from("payment_items")
        .select("doctor_name, sector")
        .eq("payment_id", paymentId)
        .range(from, to),
    );
  } catch {
    return [];
  }

  // Agrupa atual por médico
  const currentByDoctor: Record<string, Record<string, number>> = {};
  for (const row of current) {
    const name = (row.doctor_name ?? "").trim();
    const sec = normalizeSector((row.sector ?? "").trim());
    if (!name || !sec) continue;
    (currentByDoctor[name] ||= {});
    currentByDoctor[name][sec] = (currentByDoctor[name][sec] ?? 0) + 1;
  }
  const doctorNames = Object.keys(currentByDoctor);
  if (doctorNames.length === 0) return [];

  // Histórico 6 meses
  const since = new Date();
  since.setMonth(since.getMonth() - SAMPLE_MONTHS);
  let history: Array<{ doctor_name: string | null; sector: string | null; payment_id: string | null }> = [];
  try {
    history = await fetchAllPaginated((from, to) =>
      supabase
        .from("payment_items")
        .select("doctor_name, sector, payment_id")
        .in("doctor_name", doctorNames)
        .neq("payment_id", paymentId)
        .gte("created_at", since.toISOString())
        .range(from, to),
    );
  } catch {
    return [];
  }

  const histByDoctor: Record<string, Record<string, number>> = {};
  for (const row of history) {
    const name = (row.doctor_name ?? "").trim();
    const sec = normalizeSector((row.sector ?? "").trim());
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
    if (normalizeSector(curTopSector) === normalizeSector(histTopSector)) continue;
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
