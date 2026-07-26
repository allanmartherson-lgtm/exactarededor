import { supabase } from "@/integrations/supabase/client";
import { applySectorStems } from "@/lib/sectorStems";

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

function baseNormalize(s: string): string {
  return s
    .replace(/\s*\([^)]*\)/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

const CANONICAL_FALLBACK: Record<string, string> = {
  "centro cirurgico": "centro_cirurgico",
  "cirurgia": "centro_cirurgico",
  "cc": "centro_cirurgico",
  "bloco cirurgico": "centro_cirurgico",
  "hemodinamica": "hemodinamica",
  "hemo": "hemodinamica",
  "uti": "uti",
  "unidade de terapia intensiva": "uti",
  "pronto socorro": "pronto_socorro",
  "emergencia": "pronto_socorro",
  "ps": "pronto_socorro",
  "endoscopia": "sadt_endoscopia",
  "radiologia": "sadt_radiologia",
  "raio x": "sadt_radiologia",
  "rpa": "rpa",
  "recuperacao pos anestesica": "rpa",
  "sadt": "sadt",
  "ambulatorio": "ambulatorio",
  "internacao": "enfermaria",
  "apartamento": "enfermaria",
  "enfermaria": "enfermaria",
};

/**
 * Normaliza setor via 3 camadas:
 *  1) mapa slug/name/alias → categoria (montado a partir da tabela sectors).
 *     Isso resolve códigos numéricos como "1556" → "centro_cirurgico".
 *  2) sectorStems (mesmos padrões que o motor de regras usa).
 *  3) fallback CANONICAL para variações de texto livre.
 * Só sinaliza anomalia quando as duas pontas convergem para categorias
 * canônicas diferentes — evita falsos positivos entre "1556" e "Centro Cirúrgico".
 */
function normalizeSector(sector: string, sectorMap: Record<string, string>): string {
  const norm = baseNormalize(sector);
  if (!norm) return "";
  if (sectorMap[norm]) return sectorMap[norm];
  const viaStems = applySectorStems(sector) ?? applySectorStems(norm);
  if (viaStems) return viaStems;
  for (const [key, canonical] of Object.entries(CANONICAL_FALLBACK)) {
    if (norm === key || norm.includes(key) || key.includes(norm)) return canonical;
  }
  return norm;
}

async function loadSectorMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const { data } = await supabase.from("sectors").select("slug,name,aliases");
    for (const row of (data ?? []) as Array<{ slug?: string; name?: string; aliases?: string[] | null }>) {
      const cat =
        applySectorStems(row.name ?? "") ??
        applySectorStems((row.aliases ?? []).join(" "));
      if (!cat) continue;
      const keys: string[] = [];
      if (row.slug) keys.push(String(row.slug));
      if (row.name) keys.push(row.name);
      for (const a of row.aliases ?? []) keys.push(a);
      for (const k of keys) {
        const n = baseNormalize(k);
        if (n && !map[n]) map[n] = cat;
      }
    }
  } catch { /* ignore — fallback para stems/canonical */ }
  return map;
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
