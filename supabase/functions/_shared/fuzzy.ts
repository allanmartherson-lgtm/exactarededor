// Fuzzy matching utilities for entity-name similarity
// Used by the engine to detect "quase-match" between
// company/doctor/convenio/sector names that don't match exactly
// but are likely the same entity.

const COMPANY_STOPWORDS = new Set([
  "ltda", "me", "epp", "sa", "s/a", "eireli", "mei",
  "servicos", "servico", "medicos", "medico", "medica",
  "clinica", "consultorio", "associacao", "associados",
  "e", "da", "de", "do", "dos", "das", "the",
]);

/** Normalize: lowercase, remove accents, remove punctuation, remove stopwords. */
export function normalizeEntityName(input: string, stripStopwords = true): string {
  if (!input) return "";
  let s = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")    // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (stripStopwords) {
    s = s
      .split(" ")
      .filter((tok) => tok && !COMPANY_STOPWORDS.has(tok))
      .join(" ");
  }
  return s;
}

/** Jaro similarity in [0,1]. */
export function jaro(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(b.length, i + matchDistance + 1);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler: boosts strings sharing a prefix. */
export function jaroWinkler(a: string, b: string, p = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * p * (1 - j);
}

/** Token-set similarity: handles word reordering ("Dr Joao Silva" vs "Joao Silva, Dr"). */
export function tokenSetSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter++;
  const union = tokensA.size + tokensB.size - inter;
  return inter / union;
}

/**
 * Combined entity-name similarity.
 * Returns 0..1; >=0.92 is high confidence, 0.80..0.91 is fuzzy candidate.
 */
export function entityNameSimilarity(a: string, b: string): number {
  const na = normalizeEntityName(a);
  const nb = normalizeEntityName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const jw = jaroWinkler(na, nb);
  const ts = tokenSetSimilarity(na, nb);
  return Math.max(jw, ts); // best of the two
}

export type SimilarityClass = "exact" | "high" | "low" | "none";

export function classifySimilarity(score: number): SimilarityClass {
  if (score >= 0.999) return "exact";
  if (score >= 0.92) return "high";
  if (score >= 0.80) return "low";
  return "none";
}
