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
