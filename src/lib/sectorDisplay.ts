/**
 * Formata o nome de um setor para exibição amigável.
 *
 * Regras:
 * - "cirurgia" → "Centro Cirúrgico" (slug interno mantido no banco, mas exibido com nome canônico)
 * - Demais valores: primeira letra em caixa alta, restante em caixa baixa
 *   (ex.: "hemodinâmica" → "Hemodinâmica", "HEMODINÂMICA" → "Hemodinâmica")
 * - Preserva o complemento entre parênteses se vier da planilha
 *   (ex.: "Hemodinâmica (DFStar)" → "Hemodinâmica (DFStar)")
 */

const norm = (s: string) =>
  s
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const SLUG_LABELS: Record<string, string> = {
  cirurgia: "Centro Cirúrgico",
  hemodinamica: "Hemodinâmica",
  sadt_endoscopia: "SADT Endoscopia",
  outro: "Outro",
};

const capFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1).toLocaleLowerCase("pt-BR") : s);

export function formatSectorName(raw: string | null | undefined): string {
  if (!raw) return "—";
  const v = String(raw).trim();
  if (!v) return "—";

  // Slug interno conhecido (ex.: "cirurgia", "hemodinamica")
  const slug = SLUG_LABELS[norm(v).replace(/[^a-z0-9]+/g, "_")];
  if (slug) return slug;

  // Caso "cirurgia" venha como palavra solta (não slug)
  if (norm(v) === "cirurgia") return "Centro Cirúrgico";

  // Mantém parênteses (ex.: "HEMODINÂMICA (DFStar)" → "Hemodinâmica (DFStar)")
  const m = v.match(/^([^()]+?)(\s*\(.+\))?\s*$/);
  if (m) {
    const head = capFirst(m[1].trim());
    const tail = m[2] ?? "";
    return (head + tail).trim();
  }
  return capFirst(v);
}
