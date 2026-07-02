export const SECTOR_CATEGORY_STEMS: Array<{ category: string; pattern: RegExp }> = [
  { category: "rpa", pattern: /\brpa\b|recupera[cç][aã]o\s+p[oó]s[\s\-]?anest/i },
  { category: "hemodinamica", pattern: /hemodin[aâ]mica|\bhemodin\b|sala\s+(de\s+)?hemodin/i },
  { category: "centro_cirurgico", pattern: /\bc\.?\s*c\.?\b|centro\s+cir[uú]rgico|bloco\s+cir[uú]rgico|sala\s+cir[uú]rgica|unidade\s+cir[uú]rgica|\bcirurgia(s)?\b/i },
  { category: "uti_neonatal", pattern: /uti\s*(neo|neonatal)|utin\b/i },
  { category: "uti_pediatrica", pattern: /uti\s*(ped|pedi[aá]trica)|utip\b/i },
  { category: "uti_coronariana", pattern: /uti\s*(coro|coronariana)|unidade\s+coronariana/i },
  { category: "uti", pattern: /\buti\b|\bcti\b|terapia\s+intensiva/i },
  { category: "pronto_socorro", pattern: /\bps\b|pronto\s+socorro|emerg[eê]ncia|aguardando\s+vaga\s+emerg/i },
  { category: "enfermaria", pattern: /enfermaria|aparta?mento|leito\s+comum|interna[cç][aã]o/i },
  { category: "ambulatorio", pattern: /ambulat[oó]rio|ambulatorial/i },
  { category: "consulta", pattern: /\bconsultas?\b/i },
  { category: "parecer", pattern: /\bparecer(es)?\b|\binterconsultas?\b/i },
  { category: "visita", pattern: /\bvisitas?\b/i },
  { category: "sadt_endoscopia", pattern: /endoscopia|\bendo\b/i },
  { category: "sadt_tomografia", pattern: /tomografia|\btomo\b|\btc\b/i },
  { category: "sadt_ressonancia", pattern: /resson[aâ]ncia\s+magn[eé]tica|\brm\b/i },
  { category: "sadt_radiologia", pattern: /radiologia|\braio\s*x\b|\brx\b/i },
  { category: "sadt_ultrassom", pattern: /ultrassom|ultrassonografia|\bus\b|\beco\b/i },
  { category: "sadt_mamografia", pattern: /mamografia|\bmamo\b/i },
  { category: "sadt", pattern: /\bsadt\b|apoio\s+(ao\s+)?diagn[oó]stico/i },
  { category: "cdi", pattern: /\bcdi\b|centro\s+de\s+diagn[oó]stico\s+por\s+imagem|\bimagem\b/i },
  { category: "oncologia", pattern: /oncologia|\bonco\b|quimioterapia|\bquimio\b/i },
  { category: "radioterapia", pattern: /radioterapia|\bradio\b/i },
  { category: "medicina_nuclear", pattern: /medicina\s+nuclear|\bmed\s+nuclear\b/i },
  { category: "banco_sangue", pattern: /banco\s+(de\s+)?sangue|hemocentro/i },
];

export function applySectorStems(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  for (const rule of SECTOR_CATEGORY_STEMS) {
    if (rule.pattern.test(s)) return rule.category;
  }
  return null;
}