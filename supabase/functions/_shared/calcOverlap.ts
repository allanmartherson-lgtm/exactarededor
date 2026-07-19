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
 *   10) special_case_filter
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

// ---------- prefixo TUSS (código terminando em `*`) ----------
// Códigos como "4100*" representam TODA a família 4100.... Para detecção de
// sobreposição, comparamos com semântica de prefixo: dois prefixos conflitam
// se um contém o outro; prefixo × literal conflita se literal começa com o prefixo.
const _isPrefix = (s: string) => s.endsWith("*");
const _prefixBody = (s: string) => s.slice(0, -1);
function _codeSetsIntersectPrefix(A: Set<string>, B: Set<string>): Set<string> {
  const out = new Set<string>();
  const aArr = [...A];
  const bArr = [...B];
  for (const a of aArr) {
    for (const b of bArr) {
      if (a === b) { out.add(a); continue; }
      if (_isPrefix(a) && _isPrefix(b)) {
        const pa = _prefixBody(a); const pb = _prefixBody(b);
        if (pa.startsWith(pb) || pb.startsWith(pa)) out.add(a.length >= b.length ? a : b);
      } else if (_isPrefix(a) && b.startsWith(_prefixBody(a))) {
        out.add(b);
      } else if (_isPrefix(b) && a.startsWith(_prefixBody(b))) {
        out.add(a);
      }
    }
  }
  return out;
}

// ---------- resultado da interseção em UM eixo ----------
type AxisResult =
  | { empty: true }
  | { empty: false; shared: true; description: string } // ambos restringem e há interseção
  | { empty: false; shared: false }; // pelo menos um eixo é "any" → universo

// ===== Eixo 1: procedure_codes + code_match_mode =====
// Para cálculos do tipo "pacote*", os códigos TUSS que diferenciam o cálculo
// vivem em `package_main_code` (+ `package_included_codes`), não em
// `procedure_codes`. Tratamos esse conjunto como whitelist implícita.
const _PACKAGE_KINDS = new Set([
  "pacote",
  "pacote_por_atendimento",
  "pacote_fechado",
  "pacote_com_extras",
]);
function _isPackage(c: RuleCalculationItem): boolean {
  return _PACKAGE_KINDS.has(String((c as any).calculation_type ?? ""));
}
function _splitMain(v: unknown): string[] {
  if (v == null) return [];
  return String(v).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}
function _packageMainCodes(c: RuleCalculationItem): Set<string> {
  return _setOf(_splitMain((c as any).package_main_code));
}
function _calcCodes(c: RuleCalculationItem): { mode: "whitelist" | "blacklist" | "any"; set: Set<string>; isPackage: boolean; mainSet: Set<string> } {
  if (_isPackage(c)) {
    const main = _splitMain((c as any).package_main_code);
    const inc = Array.isArray((c as any).package_included_codes) ? (c as any).package_included_codes : [];
    const set = _setOf([...main, ...inc]);
    return { mode: set.size > 0 ? "whitelist" : "any", set, isPackage: true, mainSet: _packageMainCodes(c) };
  }
  const mode = (c.code_match_mode ?? "any") as "whitelist" | "blacklist" | "any";
  return { mode, set: _setOf(c.procedure_codes), isPackage: false, mainSet: new Set<string>() };
}
function axisCodes(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const aC = _calcCodes(a);
  const bC = _calcCodes(b);
  // Pacote tem precedência contextual por atendimento: códigos incluídos só
  // entram no pacote quando o código principal do pacote está presente; caso
  // contrário, caem para valor_fixo/tabela. Portanto package×não-package não é
  // ambiguidade de cadastro. Entre dois pacotes, o gatilho que define disputa é
  // o package_main_code, não os acessórios compartilhados.
  if (aC.isPackage || bC.isPackage) {
    if (aC.isPackage && bC.isPackage) {
      const interMain = _interSet(aC.mainSet, bC.mainSet);
      if (interMain.size === 0) return { empty: true };
      return { empty: false, shared: true, description: `Códigos principais de pacote {${[...interMain].sort().join(", ")}}` };
    }
    return { empty: true };
  }
  const A = aC.set, B = bC.set;
  const modeA = aC.mode, modeB = bC.mode;
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

function axisSpecialCase(a: RuleCalculationItem, b: RuleCalculationItem, sameRulePrecedence: boolean): AxisResult {
  const aHas = _hasItems((a as any).special_case_filter);
  const bHas = _hasItems((b as any).special_case_filter);
  if (sameRulePrecedence && aHas !== bHas) return { empty: true };
  return axisSimpleArray((a as any).special_case_filter, (b as any).special_case_filter, "Caso especial");
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

// ===== Eixo 11: item_type_id (tipo de item por cálculo) =====
// O motor (rulesEngine) já filtra cada cálculo pelo item_type_id do item.
// Cálculos com item_type_id diferentes NUNCA disputam o mesmo item em runtime.
function axisItemType(a: RuleCalculationItem, b: RuleCalculationItem): AxisResult {
  const A = (a as any).item_type_id ?? null;
  const B = (b as any).item_type_id ?? null;
  const aRestricts = A != null;
  const bRestricts = B != null;
  if (!aRestricts && !bRestricts) return { empty: false, shared: false };
  if (aRestricts !== bRestricts) return { empty: false, shared: false };
  if (A !== B) return { empty: true };
  return { empty: false, shared: true, description: `Tipo de item` };
}


function evaluatePair(
  a: RuleCalculationItem,
  b: RuleCalculationItem,
  sameRulePrecedence = false,
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
    axisSpecialCase(a, b, sameRulePrecedence),
    axisItemType(a, b),
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
  opts?: { calculationMode?: string | null },
): CalcOverlapProblem[] {
  // Regras em modo "cascade" avaliam cálculos por sort_order (primeiro match
  // vence). Sobreposição de filtros é intencional (ex.: cateteres > noturno >
  // FDS > tomografia > base) e não deve bloquear o salvamento.
  if (opts?.calculationMode === "cascade") return [];
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
      const r = evaluatePair(A, B, true);
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

/**
 * Cross-rule variant: dado dois conjuntos de cálculos (de regras DIFERENTES),
 * retorna pares (A∈rule1, B∈rule2) cujos filtros se sobrepõem em todos os 9 eixos.
 *
 * Usado por `validate-rule-save` para reabrir `company_already_bound`: se
 * NENHUM par cruzado se sobrepõe, as duas regras nunca disputam o mesmo item
 * em runtime → o conflito de empresa é falso-positivo e deve ser descartado.
 *
 * Catch-all (não-restritivo) entra como "universo total" pelo lado dele —
 * isto é, casa com qualquer cálculo restritivo do outro lado. Isso é
 * intencional: catch-all é um curinga que pega TUDO o que sobra.
 */
export function detectCrossRuleOverlap(
  calcsA: RuleCalculationItem[] | null | undefined,
  calcsB: RuleCalculationItem[] | null | undefined,
): CalcOverlapProblem[] {
  const A = Array.isArray(calcsA) ? calcsA : [];
  const B = Array.isArray(calcsB) ? calcsB : [];
  // Se um dos lados não tem cálculos, é um catch-all puro (regra master legada
  // com parâmetros no nível da própria regra, sem rule_calculations).
  // Catch-all não compete com regras que têm filtros restritivos — ele é o fallback.
  // Só reportamos overlap quando AMBOS os lados têm pelo menos um cálculo restritivo
  // com filtros que se intersectam.
  if (A.length === 0 || B.length === 0) {
    // Lado sem cálculos = catch-all puro → nunca conflita cruzado.
    return [];
  }
  // Filtra catch-alls: cálculos não-restritivos nunca competem com regras específicas —
  // eles são fallback. Só comparamos cálculos restritivos (que têm filtros definidos).
  const restrictiveA = A.filter((c) => isRestrictiveCalculation(c, A));
  const restrictiveB = B.filter((c) => isRestrictiveCalculation(c, B));

  // Se um dos lados não tem cálculos restritivos, é puramente catch-all → sem overlap.
  if (restrictiveA.length === 0 || restrictiveB.length === 0) {
    return [];
  }

  const out: CalcOverlapProblem[] = [];
  for (const a of restrictiveA) {
    for (const b of restrictiveB) {
      const r = evaluatePair(a, b);
      if (!r.conflicts) continue;
      const desc = r.pieces.length > 0
        ? r.pieces.join(", ")
        : "qualquer item satisfaz ambos os cálculos";
      out.push({
        type: "calc_overlap",
        calc_a_id: a.id ?? "",
        calc_a_label: a.label ?? "(sem rótulo)",
        calc_b_id: b.id ?? "",
        calc_b_label: b.label ?? "(sem rótulo)",
        intersection_description: desc,
      });
    }
  }
  return out;
}
