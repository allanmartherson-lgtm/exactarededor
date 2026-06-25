// Dedup intra-lote para classificação Parecer → Visita.
// Chave canônica: ATENDIMENTO + ESPECIALIDADE + CONVÊNIO.
// NUNCA usa paciente — atendimento é o identificador estável do Tasy
// e equipes da mesma especialidade se revezam entre médicos.

export const norm = (s: any): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const onlyDigits = (s: any): string =>
  String(s ?? "").replace(/\D+/g, "");

export interface DedupItem {
  id: string;
  attendance_number: string | null;
  specialty: string | null;
  convenio_slug: string | null;
  procedure_date: string | null;
}

export interface DedupResult {
  reclassifiedIds: Set<string>;
  reasonById: Map<string, string>;
  skippedNoKey: string[]; // ids ignorados por falta de atendimento OU especialidade
}

/**
 * Dedup intra-lote: para cada (atendimento+especialidade+convenio),
 * mantém o 1º (mais antigo por procedure_date) como Parecer e
 * marca os demais como reclassificados.
 *
 * Sem fallback para paciente. Item sem atendimento OU sem especialidade
 * é deixado intocado (vai para skippedNoKey para auditoria).
 */
export function dedupIntraLot(
  items: DedupItem[],
  confirmedIds: Set<string>,
): DedupResult {
  const reclassifiedIds = new Set<string>();
  const reasonById = new Map<string, string>();
  const skippedNoKey: string[] = [];

  const buckets = new Map<string, Array<{ id: string; date: string | null }>>();
  for (const it of items) {
    if (!confirmedIds.has(it.id)) continue;
    const att = onlyDigits(it.attendance_number);
    const spec = norm(it.specialty);
    const conv = norm(it.convenio_slug);
    if (!att || !spec) {
      skippedNoKey.push(it.id);
      continue;
    }
    const key = `${att}|${spec}|${conv}`;
    const list = buckets.get(key) ?? [];
    list.push({ id: it.id, date: it.procedure_date });
    buckets.set(key, list);
  }

  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const da = a.date ? Date.parse(a.date) : 0;
      const db = b.date ? Date.parse(b.date) : 0;
      return da - db;
    });
    const firstDate = list[0].date
      ? new Date(list[0].date).toISOString().slice(0, 10)
      : "?";
    for (let i = 1; i < list.length; i++) {
      reclassifiedIds.add(list[i].id);
      reasonById.set(
        list[i].id,
        `Parecer prévio no mesmo lote em ${firstDate} (mesmo atendimento+especialidade+convênio)`,
      );
    }
  }

  return { reclassifiedIds, reasonById, skippedNoKey };
}
