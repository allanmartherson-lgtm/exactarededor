/**
 * Detecção inteligente da coluna "Setor" em uma planilha de pagamento.
 *
 * Objetivo: ser agnóstico ao modelo de planilha (Tasy, MV, planilhas
 * artesanais de hospitais). Em vez de procurar APENAS por "Setor", também
 * reconhece sinônimos comuns (unidade, departamento, lotação, área, ala…)
 * e, quando o nome do cabeçalho não é claro, faz uma checagem por
 * AMOSTRAGEM DE VALORES contra os setores cadastrados — sem nunca inferir
 * automaticamente: sempre devolve candidatos para o usuário confirmar.
 *
 * Convenção: as decisões finais sempre passam pelo usuário responsável
 * pela importação (ver UI em NewPayment). Esta função só pontua e ranqueia.
 */

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Palavras que, sozinhas ou compostas, marcam o cabeçalho como "setor". */
const HEADER_TOKENS = [
  "setor", "setores",
  "unidade", "unidades", "unidade de atendimento", "unid",
  "departamento", "departamentos", "depto", "dept",
  "lotacao", "lotação", "lotacoes",
  "servico", "serviço", "servicos", "serviços",
  "area", "área", "areas", "áreas",
  "ala", "alas",
  "local", "local de atendimento", "localizacao", "localização",
  "posto",
  "centro cirurgico", "centro cirúrgico",
  "clinica", "clínica",
].map(norm);

/** Palavras que indicam que a coluna NÃO é setor (mesmo contendo "unidade" etc). */
const HEADER_EXCLUDE_TOKENS = [
  "centro de custo", "cod centro", "codigo centro",
  "unidade de medida", "und medida",
  "valor unitario", "preco unitario",
  "data", "hora",
  "cnpj", "cpf",
  "empresa", "hospital", "fornecedor",
].map(norm);

export type SectorColumnCandidate = {
  header: string;
  /** "header" = nome do cabeçalho casou. "values" = valores casam com setores cadastrados. */
  reason: "header" | "values";
  /** Para reason=values: % de valores distintos não-vazios que resolveram para um setor cadastrado (0..1). */
  matchRate: number;
  /** Até 5 valores distintos da coluna (amostra para o usuário ver). */
  sampleValues: string[];
  /** Até 5 valores que resolveram para setores cadastrados. */
  matchedValues: string[];
};

export type SectorColumnDetection = {
  /** Melhor candidato sugerido (NUNCA aplicado sozinho — sempre confirmar com usuário). */
  recommended: string | null;
  /** Confiança: "header"=nome bateu, "values"=só os valores apontam, "none"=nada encontrado. */
  confidence: "header" | "values" | "none";
  /** Todos os candidatos ordenados (header matches primeiro, depois value matches). */
  candidates: SectorColumnCandidate[];
};

function headerMatches(header: string): boolean {
  const nh = norm(header);
  if (!nh) return false;
  if (HEADER_EXCLUDE_TOKENS.some((ex) => nh.includes(ex))) return false;
  return HEADER_TOKENS.some((tk) => nh === tk || nh.includes(tk));
}

/**
 * Detecta a coluna setor em uma planilha.
 *
 * @param headers      cabeçalhos brutos da planilha (na ordem original)
 * @param rows         linhas (objetos) — usaremos as primeiras N para amostragem
 * @param resolveSlug  função que dado um texto bruto devolve o slug de um setor
 *                     cadastrado, ou null. Tipicamente vem de `useSectorAliases`.
 * @param sampleSize   quantas linhas amostrar para checagem por valores (default 200)
 */
export function detectSectorColumn(
  headers: string[],
  rows: Record<string, unknown>[],
  resolveSlug: (raw: string | null | undefined) => string | null,
  sampleSize = 200,
): SectorColumnDetection {
  const candidates: SectorColumnCandidate[] = [];
  const sample = rows.slice(0, sampleSize);

  // 1ª passada: cabeçalhos com nome reconhecido como setor.
  for (const h of headers) {
    if (!h || h.startsWith("__col_")) continue;
    if (!headerMatches(h)) continue;
    const distinct = collectDistinctValues(sample, h);
    const matched = distinct.filter((v) => !!resolveSlug(v));
    candidates.push({
      header: h,
      reason: "header",
      matchRate: distinct.length ? matched.length / distinct.length : 0,
      sampleValues: distinct.slice(0, 5),
      matchedValues: matched.slice(0, 5),
    });
  }

  // 2ª passada: para cada coluna textual cujo NOME não bateu, checar
  // se os VALORES distintos cruzam com setores cadastrados.
  const headerMatched = new Set(candidates.map((c) => c.header));
  for (const h of headers) {
    if (!h || h.startsWith("__col_")) continue;
    if (headerMatched.has(h)) continue;
    const nh = norm(h);
    // pula colunas que claramente NÃO são setor
    if (HEADER_EXCLUDE_TOKENS.some((ex) => nh.includes(ex))) continue;

    const distinct = collectDistinctValues(sample, h);
    if (distinct.length < 2 || distinct.length > 60) continue; // setor costuma ter cardinalidade baixa
    const matched = distinct.filter((v) => !!resolveSlug(v));
    if (matched.length === 0) continue;
    const rate = matched.length / distinct.length;
    if (rate < 0.6) continue; // confiança mínima para SUGERIR (usuário decide)
    candidates.push({
      header: h,
      reason: "values",
      matchRate: rate,
      sampleValues: distinct.slice(0, 5),
      matchedValues: matched.slice(0, 5),
    });
  }

  // Ordena: header matches primeiro (com mais "matched" valores), depois value matches por rate.
  candidates.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "header" ? -1 : 1;
    return b.matchRate - a.matchRate;
  });

  const top = candidates[0] ?? null;
  return {
    recommended: top?.header ?? null,
    confidence: top?.reason ?? "none",
    candidates,
  };
}

function collectDistinctValues(rows: Record<string, unknown>[], col: string): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const v = row?.[col];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (s.length > 80) continue; // evita pegar colunas de descrição longa
    set.add(s);
    if (set.size >= 60) break;
  }
  return [...set];
}
