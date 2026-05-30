/**
 * Regras de stem hardcoded para desambiguar famílias de convênios.
 *
 * Aplicadas APÓS o lookup exato no CONVENIO_MAP (carregado da tabela `convenios`)
 * e ANTES do fallback startsWith. Servem como "rede de segurança" do motor:
 * mesmo que a tabela `convenios` esteja vazia, desatualizada ou que a planilha
 * traga uma variação inédita, os principais operadores resolvem para o slug correto.
 *
 * Ordem importa: padrões mais específicos primeiro (p.ex. "bradesco funcional"
 * antes de "bradesco" puro).
 *
 * Padrões são testados contra a forma "raw normalizada" (lowercase + sem acentos,
 * MAS com espaços/pontuação preservados — o stripping de espaços é só para a chave
 * de hash do CONVENIO_MAP).
 */
export const CONVENIO_STEM_RULES: Array<{ slug: string; pattern: RegExp }> = [
  // --- Bradesco (3 produtos distintos) ---
  { slug: "bradesco_funcional", pattern: /(brade?s|bradesco).*func/i },
  { slug: "bradesco_operad",    pattern: /(brade?s|bradesco).*(opera?d\b|operadoras?|\bop\b)/i },
  { slug: "bradesco_segur",     pattern: /(brade?s|bradesco).*(segur|seguros?|saude)/i },
  // "Bradesco" sozinho → default para Segur (produto mais comum na Rede D'Or)
  { slug: "bradesco_segur",     pattern: /^\s*brade?sco\s*$/i },

  // --- Sul América (qualquer variação) ---
  { slug: "sul_america",        pattern: /sul[\s\-_./]*america/i },

  // --- Amil (evita pegar "amilcar" e parecidos) ---
  { slug: "amil",               pattern: /^\s*amil(\s|$|saude|\s*-\s*|\s+one)/i },

  // --- Unimed Central Nacional / Rede Master ---
  { slug: "central_nacional_unimed", pattern: /(central[\s\-_./]+nacional[\s\-_./]+unimed|unimed[\s\-_./]+central|unimed[\s\-_./]+rede[\s\-_./]*master|^\s*cnu\s*$)/i },
];

/** Retorna o slug se algum stem casar com a forma raw (com espaços). */
export function applyConvenioStems(raw: string): string | null {
  if (!raw) return null;
  for (const r of CONVENIO_STEM_RULES) {
    if (r.pattern.test(raw)) return r.slug;
  }
  return null;
}

// ---------- Aprendizado: aliases coletados em runtime ----------
const LEARNED_ALIASES: Map<string, Set<string>> = new Map();

/**
 * Registra um alias aprendido (raw string da planilha → slug canônico).
 * Chamado por normAgreement sempre que cair em stem-match ou startsWith.
 * O analyze-payment drena ao final e persiste em `convenios.aliases`.
 */
export function recordLearnedAlias(slug: string, raw: string): void {
  if (!slug || !raw) return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  // Evita poluir com strings irrelevantes (curtas demais ou só pontuação)
  if (trimmed.length < 2) return;
  let set = LEARNED_ALIASES.get(slug);
  if (!set) {
    set = new Set();
    LEARNED_ALIASES.set(slug, set);
  }
  set.add(trimmed);
}

export function drainLearnedAliases(): Array<{ slug: string; aliases: string[] }> {
  const out: Array<{ slug: string; aliases: string[] }> = [];
  for (const [slug, set] of LEARNED_ALIASES.entries()) {
    out.push({ slug, aliases: Array.from(set) });
  }
  LEARNED_ALIASES.clear();
  return out;
}

export function peekLearnedAliases(): Array<{ slug: string; aliases: string[] }> {
  return Array.from(LEARNED_ALIASES.entries()).map(([slug, set]) => ({
    slug,
    aliases: Array.from(set),
  }));
}
