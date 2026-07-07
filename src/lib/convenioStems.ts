/**
 * Espelho client-side de `supabase/functions/_shared/convenioStems.ts`.
 *
 * Por que existe: o motor de análise (edge function) usa stems hardcoded para
 * resolver famílias de convênios (Bradesco/Sul América/Amil/CNU) mesmo quando
 * a tabela `convenios` não tem o alias exato. Mas o painel "Resolução de
 * cadastros" do fluxo de criação de lote roda 100% no cliente e só consulta a
 * tabela — então convênios como "Sul América Empresarial 445" aparecem como
 * não resolvidos, obrigando o analista a abrir o cadastro para criar o alias
 * manualmente.
 *
 * Aqui reaproveitamos as mesmas regras para SUGERIR o slug canônico dentro do
 * próprio painel: o analista vê "Sugerido: Sul América" com um clique só.
 *
 * ⚠️ Manter em sincronia com o arquivo do backend. Se adicionar regra nova
 * aqui, adicione lá também (ou vice-versa).
 */
export const CONVENIO_STEM_RULES: Array<{ slug: string; pattern: RegExp }> = [
  { slug: "bradesco_funcional", pattern: /(brade?s|bradesco).*func/i },
  { slug: "bradesco_operad",    pattern: /(brade?s|bradesco).*(opera?d\b|operadoras?|\bop\b)/i },
  { slug: "bradesco_segur",     pattern: /(brade?s|bradesco).*(segur|seguros?|saude)/i },
  { slug: "bradesco_segur",     pattern: /^\s*brade?sco\s*$/i },
  { slug: "sul_america",        pattern: /sul[\s\-_./]*america/i },
  { slug: "amil",               pattern: /^\s*amil(\s|$|saude|\s*-\s*|\s+one)/i },
  { slug: "central_nacional_unimed", pattern: /(central[\s\-_./]+nacional[\s\-_./]+unimed|unimed[\s\-_./]+central|unimed[\s\-_./]+rede[\s\-_./]*master|^\s*cnu\s*$)/i },
];

/** Retorna o slug se algum stem casar com a string bruta (com acentos removidos). */
export function applyConvenioStems(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const norm = String(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const r of CONVENIO_STEM_RULES) {
    if (r.pattern.test(norm)) return r.slug;
  }
  return null;
}
