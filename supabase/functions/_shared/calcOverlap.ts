/**
 * Sub-Onda 2D — Verificação D (calc_overlap).
 *
 * Detecta pares de cálculos RESTRITIVOS dentro da MESMA regra cuja interseção
 * de filtros (em todos os 9 eixos definidos pela 2C/Rodada-3) é não-vazia —
 * ou seja, pares que podem casar simultaneamente com o mesmo item, gerando
 * `erro_duplicidade_calculo` em runtime.
 *
 * Cálculo catch-all (não restritivo) é fallback interno e NÃO entra na
 * detecção (mesmo critério da 2C: `isRestrictiveCalculation(c, peers)`).
 *
 * Eixos avaliados (mesmos da 2C):
 *   1) procedure_codes + code_match_mode
 *   2) extras_codes
 *   3) agreement_aliases (+ agreement_match_mode)
 *   4) doctor_roles
 *   5) dia/horário (time_mode/weekdays/time_start/time_end)
 *   6) elective_mode
 *   7) vias de acesso (apply_access_route + allowed_access_routes)
 *   8) sectors
 *   9) specialties
 *
 * Algoritmo: para cada par (A, B), se EM ALGUM eixo a interseção for vazia,
 * o par NÃO conflita. Caso contrário (todos os eixos com interseção
 * não-vazia), reporta `calc_overlap`.
 */
import {
  isRestrictiveCalculation,
  type RuleCalculationItem,
} from "./rulesEngine.ts";

export interface CalcOverlapProblem {
  type: "calc_overlap";
  calc_a_id: string;
  calc_a_label: string;
  calc_b_id: string;
  calc_b_label: string;
  intersection_description: string;
}

// ---------- helpers de array (set, ordem-insensível, case-insensível p/ strings) ----------
const _norm = (x: unknown) => String(x ?? "").trim().toLowerCase();
const _setOf = (a: unknown): Set<string> =>
  new Set((Array.isArray(a) ? a : []).map(_norm).filter((s) => s.length > 0));
const _hasItems = (a: unknown): boolean =>
  Array.isArray(a) && a.some((x) => _norm(x).length > 0);
const _interSet = (A: Set<string>, B: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const x of A) if (B.has(x)) out.add(x);
  return out;
};
const _diffSet = (A: Set<string>, B: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const x of A) if (!B.has(x)) out.add(x);
  return out;
};

// ---------- resultado da interseção em UM eixo ----------
type AxisResult =
  | { empty: true }
  | { empty: false; shared: true; description: string } // ambos restringem e há interseção
  | { empty: false; shared: false }; // pelo menos um eixo é "any" → universo

// ===== Eixo 1: procedure_codes + code_match_mode =====
function axisCodes(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const modeA = a.code_match_mode ?? "any";
  const modeB = b.code_match_mode ?? "any";
  const A = _setOf(a.procedure_codes);
  const B = _setOf(b.procedure_codes);
  const aRestricts = modeA !== "any" && A.size > 0;
  const bRestricts = modeB !== "any" && B.size > 0;
  if (!aRestricts && !bRestricts) return { empty: false, shared: false };
  if (aRestricts && !bRestricts) return { empty: false, shared: false };
  if (!aRestricts && bRestricts) return { empty: false, shared: false };
  // ambos restringem
  if (modeA === "whitelist" && modeB === "whitelist") {
    const inter = _interSet(A, B);
    if (inter.size === 0) return { empty: true };
    return { empty: false, shared: true, description: `Códigos {${[...inter].sort().join(", ")}}` };
  }
  if (modeA === "whitelist" && modeB === "blacklist") {
    const inter = _diffSet(A, B);
    if (inter.size === 0) return { empty: true };
    return { empty: false, shared: true, description: `Códigos {${[...inter].sort().join(", ")}}` };
  }
  if (modeA === "blacklist" && modeB === "whitelist") {
    const inter = _diffSet(B, A);
    if (inter.size === 0) return { empty: true };
    return { empty: false, shared: true, description: `Códigos {${[...inter].sort().join(", ")}}` };
  }
  // blacklist + blacklist → universo \ (A ∪ B): sempre não-vazio em domínio aberto.
  return { empty: false, shared: true, description: "Códigos (qualquer fora das exclusões)" };
}

// Helper genérico para arrays simples (sem mode): empty = "any".
function axisSimpleArray(
  a: unknown,
  b: unknown,
  label: string,
): AxisResult {
  const aHas = _hasItems(a);
  const bHas = _hasItems(b);
  if (!aHas && !bHas) return { empty: false, shared: false };
  if (aHas && !bHas) return { empty: false, shared: false };
  if (!aHas && bHas) return { empty: false, shared: false };
  const inter = _interSet(_setOf(a), _setOf(b));
  if (inter.size === 0) return { empty: true };
  return { empty: false, shared: true, description: `${label} {${[...inter].sort().join(", ")}}` };
}

// ===== Eixo 3: agreements (whitelist/blacklist como em códigos) =====
function axisAgreements(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const A = _setOf(a.agreement_aliases);
  const B = _setOf(b.agreement_aliases);
  const modeA = a.agreement_match_mode ?? (A.size > 0 ? "whitelist" : null);
  const modeB = b.agreement_match_mode ?? (B.size > 0 ? "whitelist" : null);
  const aRestricts = modeA != null && A.size > 0;
  const bRestricts = modeB != null && B.size > 0;
  if (!aRestricts && !bRestricts) return { empty: false, shared: false };
  if (aRestricts !== bRestricts) return { empty: false, shared: false };
  if (modeA === "whitelist" && modeB === "whitelist") {
    const inter = _interSet(A, B);
    if (inter.size === 0) return { empty: true };
    return { empty: false, shared: true, description: `Convênio {${[...inter].sort().join(", ")}}` };
  }
  if (modeA === "whitelist" && modeB === "blacklist") {
    const inter = _diffSet(A, B);
    if (inter.size === 0) return { empty: true };
    return { empty: false, shared: true, description: `Convênio {${[...inter].sort().join(", ")}}` };
  }
  if (modeA === "blacklist" && modeB === "whitelist") {
    const inter = _diffSet(B, A);
    if (inter.size === 0) return { empty: true };
    return { empty: false, shared: true, description: `Convênio {${[...inter].sort().join(", ")}}` };
  }
  return { empty: false, shared: true, description: "Convênio (qualquer fora das exclusões)" };
}

// ===== Eixo 5: dia/horário =====
function axisTime(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const tmA = (a.time_mode ?? "qualquer");
  const tmB = (b.time_mode ?? "qualquer");
  const aRestricts = tmA !== "qualquer" || _hasItems(a.weekdays) || a.time_start != null || a.time_end != null;
  const bRestricts = tmB !== "qualquer" || _hasItems(b.weekdays) || b.time_start != null || b.time_end != null;
  if (!aRestricts && !bRestricts) return { empty: false, shared: false };
  if (aRestricts !== bRestricts) return { empty: false, shared: false };
  // ambos restringem
  if (tmA !== "qualquer" && tmB !== "qualquer" && tmA !== tmB) return { empty: true };
  // weekdays: se ambos têm lista, exigir interseção
  if (_hasItems(a.weekdays) && _hasItems(b.weekdays)) {
    const inter = _interSet(_setOf(a.weekdays), _setOf(b.weekdays));
    if (inter.size === 0) return { empty: true };
  }
  const desc = tmA !== "qualquer" ? `Horário {${tmA}}` : "Horário (faixa restrita)";
  return { empty: false, shared: true, description: desc };
}

// ===== Eixo 6: elective_mode =====
function axisElective(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const A = a.elective_mode ?? "qualquer";
  const B = b.elective_mode ?? "qualquer";
  const aRestricts = A !== "qualquer";
  const bRestricts = B !== "qualquer";
  if (!aRestricts && !bRestricts) return { empty: false, shared: false };
  if (aRestricts !== bRestricts) return { empty: false, shared: false };
  if (A !== B) return { empty: true };
  return { empty: false, shared: true, description: `Modalidade {${A}}` };
}

// ===== Eixo 7: vias de acesso =====
function axisAccessRoutes(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const aOn = a.apply_access_route === true && _hasItems(a.allowed_access_routes);
  const bOn = b.apply_access_route === true && _hasItems(b.allowed_access_routes);
  if (!aOn && !bOn) return { empty: false, shared: false };
  if (aOn !== bOn) return { empty: false, shared: false };
  const inter = _interSet(_setOf(a.allowed_access_routes), _setOf(b.allowed_access_routes));
  if (inter.size === 0) return { empty: true };
  return { empty: false, shared: true, description: `Vias {${[...inter].sort().join(", ")}}` };
}

function evaluatePair(
  a: RuleCalculationItem,
  b: RuleCalculationItem,
): { conflicts: boolean; pieces: string[] } {
  const results: AxisResult[] = [
    axisCodes(a, b),
    axisSimpleArray(a.extras_codes, b.extras_codes, "Extras"),
    axisAgreements(a, b),
    axisSimpleArray(a.doctor_roles, b.doctor_roles, "Função"),
    axisTime(a, b),
    axisElective(a, b),
    axisAccessRoutes(a, b),
    axisSimpleArray(a.sectors, b.sectors, "Setor"),
    axisSimpleArray(a.specialties, b.specialties, "Especialidade"),
  ];
  const pieces: string[] = [];
  for (const r of results) {
    if (r.empty) return { conflicts: false, pieces: [] };
    if (!r.empty && r.shared) pieces.push(r.description);
  }
  return { conflicts: true, pieces };
}

export function detectCalcOverlap(
  calculations: RuleCalculationItem[] | null | undefined,
): CalcOverlapProblem[] {
  const all = Array.isArray(calculations) ? calculations : [];
  if (all.length < 2) return [];
  // Restritivos apenas (mesmo critério da 2C).
  const restrictive = all
    .map((c, i) => ({ c, i, so: c.sort_order ?? Number.MAX_SAFE_INTEGER }))
    .filter(({ c }) => isRestrictiveCalculation(c, all))
    .sort((x, y) => x.so - y.so || x.i - y.i)
    .map(({ c }) => c);

  const out: CalcOverlapProblem[] = [];
  for (let i = 0; i < restrictive.length; i++) {
    for (let j = i + 1; j < restrictive.length; j++) {
      const A = restrictive[i];
      const B = restrictive[j];
      const r = evaluatePair(A, B);
      if (!r.conflicts) continue;
      const desc = r.pieces.length > 0
        ? r.pieces.join(", ")
        : "qualquer item satisfaz ambos os cálculos";
      out.push({
        type: "calc_overlap",
        calc_a_id: A.id ?? "",
        calc_a_label: A.label ?? "(sem rótulo)",
        calc_b_id: B.id ?? "",
        calc_b_label: B.label ?? "(sem rótulo)",
        intersection_description: desc,
      });
    }
  }
  return out;
}
