/**
 * Helpers puros para vínculo rubrica ↔ convênio (Modelos de Repasse).
 *
 * Convenção:
 * - `convenio_slugs = []` na rubrica significa **"vale para qualquer convênio"**.
 * - Qualquer slug com valor concreto restringe a aplicação àquele(s) convênio(s).
 * - Slugs duplicados ou em branco são silenciosamente removidos para evitar
 *   inconsistência entre UI ↔ banco e regras de matching.
 */

/** Normaliza uma lista de slugs de convênio: trim, lowercase, dedup, remove vazios. */
export function normalizeConvenioSlugs(input: ReadonlyArray<string | null | undefined> | null | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (raw == null) continue;
    const s = String(raw).trim().toLowerCase();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** true se `candidate` já está presente em `slugs` (após normalização). */
export function hasConvenioSlug(slugs: ReadonlyArray<string>, candidate: string): boolean {
  const norm = String(candidate ?? "").trim().toLowerCase();
  if (!norm) return false;
  return normalizeConvenioSlugs(slugs).includes(norm);
}

/** Alterna a presença de um slug, garantindo deduplicação. */
export function toggleConvenioSlug(slugs: ReadonlyArray<string>, candidate: string): string[] {
  const norm = String(candidate ?? "").trim().toLowerCase();
  if (!norm) return normalizeConvenioSlugs(slugs);
  const current = normalizeConvenioSlugs(slugs);
  return current.includes(norm) ? current.filter((s) => s !== norm) : [...current, norm];
}

/**
 * Regra canônica de matching rubrica ↔ item.
 * - Lista vazia/nula na rubrica = casa com QUALQUER convênio (inclusive item sem convênio).
 * - Lista preenchida = só casa se o convênio do item estiver na lista.
 * - Item sem convênio nunca casa com rubrica restrita.
 */
export function rubricMatchesConvenio(
  rubricSlugs: ReadonlyArray<string> | null | undefined,
  itemSlug: string | null | undefined,
): boolean {
  const list = normalizeConvenioSlugs(rubricSlugs);
  if (list.length === 0) return true; // vazio = qualquer
  const target = String(itemSlug ?? "").trim().toLowerCase();
  if (!target) return false;
  return list.includes(target);
}
