/**
 * Pure helper for picking the best package_main_code match for an attendance.
 * Extracted from analyze-payment/index.ts (block 4.1) so it can be unit-tested
 * — especially the cross-PJ scenario where the codeSet must come from items of
 * MULTIPLE companies that share the same attendance_number.
 *
 * The helper is intentionally pure:
 *   • Receives a `codeSet` already expanded by the caller (single or cross-PJ).
 *   • Receives `attCompanyIds` (set of company_ids present in the attendance)
 *     so it can enforce rule.scope === 'grupo' restrictions.
 *   • Returns the winning calc + which included codes were found, or null.
 */
export type PackageRoleDist = {
  role_key: string;
  label: string;
  dist_type: "pct" | "fixo";
  value: number;
};

export type PkgCalc = {
  rule_id: string;
  rule_name: string;
  calc_id: string;
  /**
   * Lista de códigos que disparam o pacote. Qualquer um deles presente
   * no atendimento ativa o pacote (operador OU, não E).
   * Aceita também o formato antigo (`package_main_code` string única) — o
   * loader deve converter para array antes de chamar `pickPackageForAttendance`.
   */
  package_main_codes: string[];
  package_included_codes: string[];
  package_amount: number;
  package_roles_distribution: PackageRoleDist[] | null;
  rule_company_ids: Set<string>;
  rule_scope: string;
};

export type PkgMatch = {
  calc: PkgCalc;
  /** Código que efetivamente disparou o pacote neste atendimento. */
  triggerCode: string;
  coverageCount: number;
  includedFound: string[];
  absorbedCodes: Set<string>;
};

export function pickPackageForAttendance(
  packageCalcs: PkgCalc[],
  codeSet: Set<string>,
  attCompanyIds: Set<string>,
): PkgMatch | null {
  const matches: Array<{ calc: PkgCalc; triggerCode: string; coverageCount: number; includedFound: string[] }> = [];

  for (const calc of packageCalcs) {
    const triggerCode = calc.package_main_codes.find((c) => codeSet.has(c));
    if (!triggerCode) continue;

    if (calc.rule_scope === "grupo" && calc.rule_company_ids.size > 0) {
      const appliesToCompany = [...attCompanyIds].some((cid) => calc.rule_company_ids.has(cid));
      if (!appliesToCompany) continue;
    }

    const includedFound = calc.package_included_codes.filter((c) => codeSet.has(c));
    if (calc.package_included_codes.length > 0 && includedFound.length === 0) continue;
    matches.push({ calc, triggerCode, coverageCount: includedFound.length, includedFound });
  }

  if (matches.length === 0) return null;

  // Desempate: maior cobertura; em empate, mais included declarados (mais específico).
  matches.sort((a, b) => {
    if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
    return b.calc.package_included_codes.length - a.calc.package_included_codes.length;
  });

  const winner = matches[0];
  return {
    calc: winner.calc,
    triggerCode: winner.triggerCode,
    coverageCount: winner.coverageCount,
    includedFound: winner.includedFound,
    absorbedCodes: new Set([winner.triggerCode, ...winner.includedFound]),
  };
}

/**
 * Multi-pacote por atendimento: aplica `pickPackageForAttendance` em loop,
 * removendo do codeSet os códigos já absorvidos a cada rodada e excluindo
 * os calcs já usados. Permite que um mesmo atendimento receba múltiplos
 * pacotes/excedentes independentes (ex.: pacote principal + linhas de
 * excedente para códigos avulsos).
 *
 * Não muta as entradas. Retorna as escolhas na ordem em que foram aplicadas.
 */
export function pickAllPackagesForAttendance(
  packageCalcs: PkgCalc[],
  codeSet: Set<string>,
  attCompanyIds: Set<string>,
  maxIterations = 20,
): PkgMatch[] {
  const picks: PkgMatch[] = [];
  const globallyAbsorbed = new Set<string>();
  const usedCalcIds = new Set<string>();

  for (let i = 0; i < maxIterations; i++) {
    const remaining = new Set<string>([...codeSet].filter((c) => !globallyAbsorbed.has(c)));
    if (remaining.size === 0) break;

    const eligible = packageCalcs.filter((c) => !usedCalcIds.has(c.calc_id));
    const winner = pickPackageForAttendance(eligible, remaining, attCompanyIds);
    if (!winner) break;

    picks.push(winner);
    usedCalcIds.add(winner.calc.calc_id);
    for (const c of winner.absorbedCodes) globallyAbsorbed.add(c);
  }
  return picks;
}



/**
 * Constrói o codeSet expandido cross-PJ a partir de linhas (attendance_number, procedure_code)
 * vindas de payment_items de TODAS as empresas do payment.
 */
export function buildCrossPjCodeSet(
  rows: Array<{ attendance_number: string | null; procedure_code: string | null }>,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const row of rows) {
    const att = (row.attendance_number ?? "").toString().trim();
    const code = (row.procedure_code ?? "").toString().trim();
    if (!att || !code) continue;
    (out[att] ||= new Set<string>()).add(code);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Desempate de âncoras por VIA DE ACESSO + detecção de pacote sem
 * código-alavanca. Ambos puros: recebem dados já normalizados pelo
 * caller (analyze-payment usa normAccessRoute de rulesEngine.ts).
 * ------------------------------------------------------------------ */

/** Prioridade canônica das vias de acesso para desempate de pacote. */
export const ACCESS_ROUTE_PRIORITY: Record<string, number> = {
  unica_principal: 3,
  outra_via: 2,
  mesma_via: 1,
  sem_via: 0,
  "": 0,
};

export type AnchorCandidate = {
  calc: PkgCalc;
  triggerCode: string;
  includedFound: string[];
  /** Chave canônica retornada por normAccessRoute (pode ser ""). */
  routeKey: string;
};

export type AnchorRanking = {
  /** Pacote a aplicar automaticamente. null = empate real → ninguém aplica. */
  winner: AnchorCandidate | null;
  /** Candidatos que NÃO foram aplicados e viram decisão do analista. */
  ambiguous: AnchorCandidate[];
};

/**
 * Regra (THORAX): dois códigos-alavanca distintos no mesmo atendimento.
 *  1. Vence a maior prioridade de via de acesso.
 *  2. Se exatamente um candidato tem a prioridade máxima → aplica; os demais
 *     ficam ambíguos (não aplicados).
 *  3. Empate na prioridade máxima → NINGUÉM é aplicado; todos ficam ambíguos.
 */
export function rankAnchorsByAccessRoute(candidates: AnchorCandidate[]): AnchorRanking {
  if (candidates.length === 0) return { winner: null, ambiguous: [] };
  if (candidates.length === 1) return { winner: candidates[0], ambiguous: [] };

  const prio = (c: AnchorCandidate) => ACCESS_ROUTE_PRIORITY[c.routeKey] ?? 0;
  const max = Math.max(...candidates.map(prio));
  const top = candidates.filter((c) => prio(c) === max);

  if (top.length === 1) {
    return { winner: top[0], ambiguous: candidates.filter((c) => c !== top[0]) };
  }
  return { winner: null, ambiguous: candidates };
}

export type NoAnchorSuggestion = {
  calc: PkgCalc;
  /** Códigos do atendimento que este pacote absorveria. */
  matchedIncluded: string[];
};

/**
 * Regra (AGATHA): nenhum código-alavanca foi faturado, mas os códigos do
 * atendimento pertencem a package_included_codes de algum pacote.
 * Retorna sugestões (top N por cobertura) — NÃO altera valor nenhum.
 */
export function findPackagesWithoutAnchor(
  packageCalcs: PkgCalc[],
  codeSet: Set<string>,
  attCompanyIds: Set<string>,
  limit = 3,
): NoAnchorSuggestion[] {
  const out: NoAnchorSuggestion[] = [];
  for (const calc of packageCalcs) {
    // Só entra se NENHUM main_code estiver presente.
    if (calc.package_main_codes.some((c) => codeSet.has(c))) continue;
    if (calc.rule_scope === "grupo" && calc.rule_company_ids.size > 0) {
      const applies = [...attCompanyIds].some((cid) => calc.rule_company_ids.has(cid));
      if (!applies) continue;
    }
    const matchedIncluded = calc.package_included_codes.filter((c) => codeSet.has(c));
    if (matchedIncluded.length === 0) continue;
    out.push({ calc, matchedIncluded });
  }
  out.sort((a, b) => {
    if (b.matchedIncluded.length !== a.matchedIncluded.length) {
      return b.matchedIncluded.length - a.matchedIncluded.length;
    }
    return a.calc.rule_name.localeCompare(b.calc.rule_name);
  });
  return out.slice(0, limit);
}
