// Espelho client-side de normAccessRoute do backend (supabase/functions/_shared/rulesEngine.ts).
// Usado na importação da base de pagamento para garantir que toda via de acesso
// seja mapeada para uma das 4 canônicas — evita divergência no cruzamento.

export type CanonicalAccessRoute =
  | "unica_principal"
  | "mesma_via"
  | "outra_via"
  | "sem_via"
  | "";

export const CANONICAL_ACCESS_ROUTES: { key: Exclude<CanonicalAccessRoute, "">; label: string }[] = [
  { key: "unica_principal", label: "Única ou principal" },
  { key: "mesma_via", label: "Mesma via" },
  { key: "outra_via", label: "Outra via" },
  { key: "sem_via", label: "Sem via" },
];

export const CANONICAL_LABEL: Record<Exclude<CanonicalAccessRoute, "">, string> =
  CANONICAL_ACCESS_ROUTES.reduce((acc, r) => { acc[r.key] = r.label; return acc; }, {} as any);

export function normAccessRoute(s: string | null | undefined): CanonicalAccessRoute {
  const n = (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!n) return "";

  if (/(unica\s?ou\s?principal|unica\s?\/\s?principal|unica\s?e\s?principal|1[aª]\s?via\s?principal|principal)/i.test(n)) return "unica_principal";
  if (/(unica|1[aª]|1[.\s]?via|primeira\s?via|1\.[aª]\s?via)/i.test(n)) return "unica_principal";
  if (/(mesma\s?via|repetida|mesma\s?via\s?de\s?acesso)/.test(n)) return "mesma_via";
  if (n === "mesma") return "mesma_via";
  if (/(outra\s?via|via\s?diferente|diferente|2[aª]|segunda\s?via|via\s?de\s?acesso\s?diferente)/.test(n)) return "outra_via";
  if (/(sem\s?via|bonus|complemento|n\/a|nao\s?se\s?aplica|null)/.test(n)) return "sem_via";

  return ""; // não bateu — caller decide fallback
}

/**
 * Normaliza o valor textual da base hospitalar para o LABEL canônico armazenado
 * em payment_items.access_route. Retorna também o motivo, para o relatório.
 *
 * Política (acordada com analista): se não bater nenhuma das 4, cai em "Sem via"
 * e o item é marcado com alerta no relatório de inconsistências.
 */
export function normalizeAccessRouteForImport(raw: string | null | undefined): {
  canonical: string | null;
  fallback: boolean;
  raw: string | null;
} {
  const original = (raw ?? "").trim();
  if (!original) return { canonical: null, fallback: false, raw: null };

  const key = normAccessRoute(original);
  if (key) return { canonical: CANONICAL_LABEL[key], fallback: false, raw: original };

  // Não bateu — fallback "Sem via" + sinaliza inconsistência
  return { canonical: CANONICAL_LABEL.sem_via, fallback: true, raw: original };
}
