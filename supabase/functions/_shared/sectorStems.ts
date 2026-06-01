/**
 * Stems determinísticos de setor — espelha o que `convenioStems.ts` faz para
 * convênios. Resolvem o setor BRUTO da planilha (qualquer modelo de Tasy ou
 * MV) para uma CATEGORIA CANÔNICA usada pelo motor de regras
 * (`hemodinamica`, `centro_cirurgico`, `uti`, ...).
 *
 * POR QUE EXISTE
 * --------------
 * A tabela `sectors` usa `slug` numérico (ex.: "1574" para Hemodinâmica DFStar)
 * — quando o motor recebe o item, `SECTOR_MAP[normName("Hemodinâmica")] = "1574"`
 * e o `inferItemSector` antigo retornava "1574". Mas o engine compara
 * literalmente `itemSector === "hemodinamica"` (linha do hemoMaster) e o
 * rule-matching também espera categorias canônicas. Resultado: itens da
 * planilha marcados como "Hemodinâmica" caíam no bucket de Centro Cirúrgico
 * porque "1574" não casava com nada.
 *
 * Esses stems normalizam a coluna "Setor" da planilha — agnóstica de modelo —
 * para a categoria canônica que o motor entende. Aplicados ANTES do lookup
 * do `SECTOR_MAP` (tabela `sectors`), garantindo que mesmo com o cadastro
 * vazio/desatualizado as categorias principais resolvam corretamente.
 *
 * IMPORTANTE
 * ----------
 * - Categorias aqui são as MESMAS strings usadas pelas regras cadastradas
 *   (`rules.sectors`) e pelo motor (`isHemo`, `hemoMaster`, etc).
 * - Ordem importa: padrões mais específicos primeiro (ex.: "rpa centro
 *   cirurgico" antes de "centro cirurgico", "uti neonatal" antes de "uti").
 * - NUNCA infira setor pelo TIPO DO PROCEDIMENTO aqui — esta tabela só olha
 *   para o texto declarado da coluna "Setor". A inferência por procedimento
 *   vive em `procedure_classifications` e só age quando a planilha NÃO traz
 *   setor (fonte de verdade é sempre a planilha).
 */

export const SECTOR_CATEGORY_STEMS: Array<{ category: string; pattern: RegExp }> = [
  // --- Recuperações Pós-Anestésicas (RPA) — capturam ANTES do CC genérico ---
  { category: "rpa",               pattern: /\brpa\b|recupera[cç][aã]o\s+p[oó]s[\s\-]?anest/i },

  // --- Hemodinâmica (qualquer variação, inclui "sala de hemodinâmica") ---
  { category: "hemodinamica",      pattern: /hemodin[aâ]mica|\bhemodin\b|sala\s+(de\s+)?hemodin/i },

  // --- Centro Cirúrgico (CC, bloco cirúrgico, sala cirúrgica) ---
  //     "cirurgia" sozinho TAMBÉM cai aqui — é o setor operacional default
  //     quando a coluna traz só "Cirurgia/Cirurgião".
  { category: "centro_cirurgico",  pattern: /\bc\.?\s*c\.?\b|centro\s+cir[uú]rgico|bloco\s+cir[uú]rgico|sala\s+cir[uú]rgica|unidade\s+cir[uú]rgica|\bcirurgia(s)?\b/i },

  // --- UTI / CTI (neonatal, pediátrica, adulto, coronariana) ---
  { category: "uti_neonatal",      pattern: /uti\s*(neo|neonatal)|utin\b/i },
  { category: "uti_pediatrica",    pattern: /uti\s*(ped|pedi[aá]trica)|utip\b/i },
  { category: "uti_coronariana",   pattern: /uti\s*(coro|coronariana)|unidade\s+coronariana/i },
  { category: "uti",               pattern: /\buti\b|\bcti\b|terapia\s+intensiva/i },

  // --- Pronto Socorro / Emergência ---
  { category: "pronto_socorro",    pattern: /\bps\b|pronto\s+socorro|emerg[eê]ncia|aguardando\s+vaga\s+emerg/i },

  // --- Internação (enfermaria, apartamento, leito) ---
  { category: "enfermaria",        pattern: /enfermaria|aparta?mento|leito\s+comum|interna[cç][aã]o/i },

  // --- Ambulatorial / Consulta / Parecer / Visita (atos sem CC) ---
  { category: "ambulatorio",       pattern: /ambulat[oó]rio|ambulatorial/i },
  { category: "consulta",          pattern: /\bconsultas?\b/i },
  { category: "parecer",           pattern: /\bparecer(es)?\b|\binterconsultas?\b/i },
  { category: "visita",            pattern: /\bvisitas?\b/i },

  // --- SADT (subcategorias quando reconhecíveis; senão genérico) ---
  { category: "sadt_endoscopia",   pattern: /endoscopia|\bendo\b/i },
  { category: "sadt_tomografia",   pattern: /tomografia|\btomo\b|\btc\b/i },
  { category: "sadt_ressonancia",  pattern: /resson[aâ]ncia\s+magn[eé]tica|\brm\b/i },
  { category: "sadt_radiologia",   pattern: /radiologia|\braio\s*x\b|\brx\b/i },
  { category: "sadt_ultrassom",    pattern: /ultrassom|ultrassonografia|\bus\b|\beco\b/i },
  { category: "sadt_mamografia",   pattern: /mamografia|\bmamo\b/i },
  { category: "sadt",              pattern: /\bsadt\b|apoio\s+(ao\s+)?diagn[oó]stico/i },

  // --- Diagnóstico por Imagem (CDI quando isolado) ---
  { category: "cdi",               pattern: /\bcdi\b|centro\s+de\s+diagn[oó]stico\s+por\s+imagem|\bimagem\b/i },

  // --- Onco / Radio / Medicina Nuclear / Hemoterapia ---
  { category: "oncologia",         pattern: /oncologia|\bonco\b|quimioterapia|\bquimio\b/i },
  { category: "radioterapia",      pattern: /radioterapia|\bradio\b/i },
  { category: "medicina_nuclear",  pattern: /medicina\s+nuclear|\bmed\s+nuclear\b/i },
  { category: "banco_sangue",      pattern: /banco\s+(de\s+)?sangue|hemocentro/i },
];

/**
 * Aplica os stems sobre o setor RAW da planilha.
 * Retorna a categoria canônica ou `null` quando nenhum padrão casou.
 *
 * @param raw - texto da coluna "Setor" exatamente como veio da planilha
 */
export function applySectorStems(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  for (const rule of SECTOR_CATEGORY_STEMS) {
    if (rule.pattern.test(s)) return rule.category;
  }
  return null;
}
