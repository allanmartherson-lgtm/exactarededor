/**
 * Helpers de matching de nomes de empresas (PJs) usados tanto no
 * cruzamento do lote (PaymentConciliationModal) quanto no fluxo retroativo
 * (RetroactiveMappingWizard / RetroactiveReconciliationsTab).
 *
 * Convenção de níveis de confiança:
 * - "exact"  → alias persistido OU normalização idêntica  → auto-mapeado
 * - "high"   → substring de nome                          → auto-mapeado
 * - "medium" → ≥2 identificadores em comum (fuzzy)        → pede confirmação
 * - null     → nenhum candidato razoável                  → cai em "Ignorar"
 */

export type MatchLevel = "exact" | "high" | "medium" | null;

/** Normalização agressiva: minúsculas, sem acento, apenas [a-z0-9]. */
export const normFull = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const STOPWORDS = new Set([
  "servicos", "medicos", "medica", "ltda", "eireli", "ss", "me", "sa",
  "clinica", "instituto", "centro", "cirurgia", "cirurgica", "saude",
  "hospitalares", "hospitalar", "associados", "associadas", "brasilia",
  "brasil", "cuidados", "servico", "especialidades", "geral",
]);

/** Tokens ≥3 chars e não-stopword. Usado para score fuzzy. */
export const getIdentifiers = (name: string): string[] => {
  const norm = name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
  return norm.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
};

/** Mapa opcional: nome canônico da PJ → lista de aliases já aprendidos. */
export type AliasMap = Record<string, { aliases: string[] } | undefined>;

/**
 * Casa um texto bruto de PJ ("terceiro" da planilha) contra uma lista de
 * candidatos (nomes canônicos das PJs do universo alvo).
 */
export function findCompanyMatch(
  raw: string,
  candidates: string[],
  aliasMap: AliasMap = {},
): { company: string | null; level: MatchLevel } {
  const normT = normFull(raw);
  if (!normT) return { company: null, level: null };
  const idsT = getIdentifiers(raw);

  // 1) Alias persistido — vínculo já confirmado em rodada anterior.
  const aliasHit = candidates.find((c) =>
    (aliasMap[c]?.aliases ?? []).some((a) => normFull(a) === normT),
  );
  if (aliasHit) return { company: aliasHit, level: "exact" };

  // 2) Normalização idêntica.
  const exact = candidates.find((c) => normFull(c) === normT);
  if (exact) return { company: exact, level: "exact" };

  // 3) Substring de nome.
  const substring = candidates.find((c) => {
    const normC = normFull(c);
    return normT.includes(normC) || normC.includes(normT);
  });
  if (substring) return { company: substring, level: "high" };

  // 4) Score por identificadores em comum (≥2 tokens obrigatórios).
  let best: { company: string; score: number } | null = null;
  for (const c of candidates) {
    const idsC = getIdentifiers(c);
    const common = idsT.filter((id) => idsC.includes(id));
    const score = common.reduce((s, id) => s + id.length, 0);
    if (common.length >= 2 && score > (best?.score ?? 0)) {
      best = { company: c, score };
    }
  }
  if (best) return { company: best.company, level: "medium" };

  return { company: null, level: null };
}
