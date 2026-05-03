/**
 * Motor determinístico de seleção e cálculo de regras de pagamento (Fase 2).
 *
 * - Toda decisão de QUAL regra aplicar e QUANTO é o esperado mora aqui (TS).
 * - A IA não escolhe regra nem calcula valor — só justifica/aponta alertas
 *   extras em itens que o motor já marcou como `alerta`/`reprovado`.
 * - Funções puras: nada de I/O.
 *
 * Precedência (mais específico ganha):
 *   1. médico  + código procedimento
 *   2. médico
 *   3. empresa + código procedimento
 *   4. empresa
 *   5. setor   + código procedimento
 *   6. setor   (master do setor do item)
 *   7. setor "outro" (master geral)
 *   8. default por setor (hemodinâmica = 88%; demais = 100%)
 */

export type CalculationType =
  | "percentual_sobre_convenio"
  | "regra_vias"
  | "pacote_fechado"
  | "pacote_com_extras"
  | "pacote_por_atendimento"
  | "valor_fixo"
  | "exclusao"
  | "informativo"
  | "tabela_referencia"
  | "tabela_diferenciada"
  | "bonus"
  | "complemento";

export type ItemAiStatus = "pendente" | "aprovado" | "alerta" | "reprovado";

export interface RuleInput {
  id: string;
  name: string;
  rule_text: string;
  description: string | null;
  active: boolean;
  severity: string;
  scope: "master" | "especifica";
  sector: string;
  sectors: string[] | null;
  specialties: string[] | null;
  target_type: "medico" | "empresa" | null;
  target_identifier: string | null;
  target_name: string | null;
  target_company_id: string | null;
  procedure_codes: string[] | null;
  applies_payment_types: string[] | null;
  valid_from: string | null;
  valid_until: string | null;
  calculation_type: CalculationType;
  convenio_percentage: number | null;
  fixed_amount: number | null;
  package_amount: number | null;
  extras_codes: string[] | null;
  // Configuração de pacote
  package_main_code?: string | null;
  package_included_codes?: string[] | null;
  package_visits_count?: boolean | null;
  package_opinions_count?: boolean | null;
  package_auxiliaries_included?: boolean | null;
  // Parâmetros de cálculo de tabela diferenciada (pertencem à regra)
  rule_type?: string | null;
  reference_table_id?: string | null;
  multiplier?: number | null;
  deflator_pct?: number | null;
  repasse_pct?: number | null;
  apply_access_route?: boolean | null;
  include_auxiliaries?: boolean | null;
  auxiliary_pct?: number | null;
  bonus_amount?: number | null;
  bonus_pct?: number | null;
  target_amount?: number | null;
}

export interface ItemInput {
  id: string;
  doctor_name: string | null;
  doctor_document: string | null;
  company_name: string | null;
  company_id: string | null;
  company_document: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  description: string | null;
  access_route: string | null;
  doctor_role: string | null;
  procedure_amount: number | null;
  gross_amount: number;
  attendance_number: string | null;
  patient_name: string | null;
  procedure_date: string | null;
}

export interface PaymentContext {
  sectors: string[];
  specialties: string[];
  payment_type: string | null;
  reference_date: string;
}

export type RuleMatchPriority =
  | "medico_codigo"
  | "medico"
  | "empresa_codigo"
  | "empresa"
  | "setor_codigo"
  | "setor"
  | "setor_outro"
  | "setor_hemodinamica_master"
  | "setor_master_geral"
  | "default_setor"
  | "conflito";

export interface AnalysisResult {
  item_id: string;
  status: ItemAiStatus;
  expected_amount: number | null;
  diff_pct: number | null;
  matched_rule_id: string | null;
  matched_rule_name: string | null;
  matched_priority: RuleMatchPriority;
  calculation_type_used: CalculationType | "default_geral" | "default_hemodinamica";
  calculation_explanation: string;
  alerts: string[];
  needs_ai_review: boolean;
  conflict?: {
    candidate_rule_ids: string[];
    reason: string;
  };
}

// ---------- helpers ----------
const onlyDigits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");
const normName = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function inferItemSector(item: ItemInput): string {
  const txt = normName(`${item.procedure_name ?? ""} ${item.description ?? ""}`);
  if (/(hemodin|cateter|angiopl|stent|coronari)/.test(txt)) return "hemodinamica";
  if (/(cirurg|operac|herni|colecist|laparo|artrosc)/.test(txt)) return "cirurgia";
  if (/parecer/.test(txt)) return "parecer";
  if (/visita/.test(txt)) return "visita";
  if (/consulta/.test(txt)) return "consulta";
  if (/procediment/.test(txt)) return "procedimento";
  return "outro";
}

function ruleSectors(r: RuleInput): string[] {
  if (Array.isArray(r.sectors) && r.sectors.length > 0) return r.sectors;
  return r.sector ? [r.sector] : [];
}

function isInValidity(r: RuleInput, refDate: string): boolean {
  if (r.valid_from && refDate < r.valid_from) return false;
  if (r.valid_until && refDate > r.valid_until) return false;
  return true;
}

function intersectsAll(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const A = a ?? [], B = b ?? [];
  if (A.length === 0 || B.length === 0) return true;
  return A.some((x) => B.includes(x));
}

function matchesProcedureCode(r: RuleInput, item: ItemInput): boolean {
  const codes = r.procedure_codes ?? [];
  if (codes.length === 0) return true;
  if (!item.procedure_code) return false;
  return codes.includes(item.procedure_code);
}

function hasCodeRestriction(r: RuleInput): boolean {
  return Array.isArray(r.procedure_codes) && r.procedure_codes.length > 0;
}

function targetsDoctor(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "especifica" || r.target_type !== "medico") return false;
  const ruleDoc = onlyDigits(r.target_identifier);
  const itemDoc = onlyDigits(item.doctor_document);
  if (ruleDoc && itemDoc && ruleDoc === itemDoc) return true;
  if (r.target_name && item.doctor_name && normName(r.target_name) === normName(item.doctor_name)) return true;
  return false;
}

function targetsCompany(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "especifica" || r.target_type !== "empresa") return false;
  if (r.target_company_id && item.company_id && r.target_company_id === item.company_id) return true;
  const ruleDoc = onlyDigits(r.target_identifier);
  const itemDoc = onlyDigits(item.company_document);
  if (ruleDoc && itemDoc && ruleDoc === itemDoc) return true;
  if (r.target_name && item.company_name && normName(r.target_name) === normName(item.company_name)) return true;
  return false;
}

// ---------- pré-filtro ----------
export function preFilterRules(rules: RuleInput[], ctx: PaymentContext): RuleInput[] {
  return rules.filter((r) => {
    if (!r.active) return false;
    if (!isInValidity(r, ctx.reference_date)) return false;
    if (!intersectsAll(ruleSectors(r), ctx.sectors)) return false;
    if (!intersectsAll(r.specialties, ctx.specialties)) return false;
    if (!intersectsAll(r.applies_payment_types, ctx.payment_type ? [ctx.payment_type] : [])) return false;
    return true;
  });
}

// ---------- seleção ----------
const SEVERITY_RANK: Record<string, number> = { bloqueio: 3, aviso: 2, info: 1 };

function severityRank(r: RuleInput): number {
  return SEVERITY_RANK[String(r.severity ?? "").toLowerCase()] ?? 0;
}

/**
 * Desempate dentro de um mesmo nível de prioridade:
 *   1) regra com código de procedimento específico (já filtrada antes,
 *      mas mantida aqui para o caso de buckets mistos)
 *   2) maior severidade (bloqueio > aviso > info)
 *   3) vigência mais recente (maior valid_from)
 *   4) se ainda houver empate => conflito
 */
function breakTie(candidates: RuleInput[]): { winner: RuleInput | null; tied: RuleInput[] } {
  if (candidates.length === 0) return { winner: null, tied: [] };
  if (candidates.length === 1) return { winner: candidates[0], tied: [] };

  // 1) código específico
  const withCode = candidates.filter(hasCodeRestriction);
  let pool = withCode.length > 0 && withCode.length < candidates.length ? withCode : candidates;
  if (pool.length === 1) return { winner: pool[0], tied: [] };

  // 2) severidade
  const maxSev = Math.max(...pool.map(severityRank));
  pool = pool.filter((r) => severityRank(r) === maxSev);
  if (pool.length === 1) return { winner: pool[0], tied: [] };

  // 3) vigência mais recente
  const validFromTs = (r: RuleInput) => (r.valid_from ? Date.parse(r.valid_from) : 0);
  const maxFrom = Math.max(...pool.map(validFromTs));
  pool = pool.filter((r) => validFromTs(r) === maxFrom);
  if (pool.length === 1) return { winner: pool[0], tied: [] };

  // 4) empate persistente => conflito
  return { winner: null, tied: pool };
}

export interface SelectionOutcome {
  rule: RuleInput | null;
  priority: RuleMatchPriority;
  conflict?: { candidate_rule_ids: string[]; reason: string };
}

export function selectWinningRule(item: ItemInput, rules: RuleInput[]): SelectionOutcome | null {
  const itemSector = inferItemSector(item);
  const isHemo = itemSector === "hemodinamica";

  const doctorRules  = rules.filter((r) => targetsDoctor(r, item));
  const companyRules = rules.filter((r) => targetsCompany(r, item));
  const sectorRules  = rules.filter((r) => r.scope === "master" && ruleSectors(r).includes(itemSector) && itemSector !== "outro");
  const hemoMaster   = rules.filter((r) => r.scope === "master" && ruleSectors(r).includes("hemodinamica"));
  const generalMaster = rules.filter((r) => r.scope === "master" && (ruleSectors(r).includes("outro") || ruleSectors(r).length === 0));

  // Cada nível: primeiro tenta "com código", depois "sem código".
  const levels: Array<{
    bucket: RuleInput[];
    withCodePriority: RuleMatchPriority;
    withoutCodePriority: RuleMatchPriority;
    enabled?: boolean;
  }> = [
    { bucket: doctorRules,    withCodePriority: "medico_codigo",  withoutCodePriority: "medico" },
    { bucket: companyRules,   withCodePriority: "empresa_codigo", withoutCodePriority: "empresa" },
    { bucket: sectorRules,    withCodePriority: "setor_codigo",   withoutCodePriority: "setor" },
    { bucket: hemoMaster,     withCodePriority: "setor_codigo",   withoutCodePriority: "setor_hemodinamica_master", enabled: isHemo },
    { bucket: generalMaster,  withCodePriority: "setor_codigo",   withoutCodePriority: "setor_master_geral" },
  ];

  for (const lvl of levels) {
    if (lvl.enabled === false) continue;
    const withCode = lvl.bucket.filter((r) => hasCodeRestriction(r) && matchesProcedureCode(r, item));
    if (withCode.length > 0) {
      const { winner, tied } = breakTie(withCode);
      if (winner) return { rule: winner, priority: lvl.withCodePriority };
      return {
        rule: null,
        priority: "conflito",
        conflict: {
          candidate_rule_ids: tied.map((r) => r.id),
          reason: `Conflito de regras no nível ${lvl.withCodePriority}: ${tied.length} regras empatadas após desempate por severidade e vigência.`,
        },
      };
    }
    const withoutCode = lvl.bucket.filter((r) => !hasCodeRestriction(r));
    if (withoutCode.length > 0) {
      const { winner, tied } = breakTie(withoutCode);
      if (winner) return { rule: winner, priority: lvl.withoutCodePriority };
      return {
        rule: null,
        priority: "conflito",
        conflict: {
          candidate_rule_ids: tied.map((r) => r.id),
          reason: `Conflito de regras no nível ${lvl.withoutCodePriority}: ${tied.length} regras empatadas após desempate por severidade e vigência.`,
        },
      };
    }
  }
  return null;
}

// ---------- via de acesso (em código) ----------
export function accessRouteFactor(raw: string | null | undefined): number {
  const t = normName(raw);
  if (!t) return 1;
  if (/(unica|única|principal)/.test(t)) return 1;
  if (/(mesma)/.test(t)) return 0.5;
  if (/(diferente|outra via)/.test(t)) return 0.7;
  return 1;
}

export function doctorRoleFactor(raw: string | null | undefined): number {
  const t = normName(raw);
  if (!t) return 1;
  if (/(instrumentador)/.test(t)) return 0.1;
  if (/(2.*auxili|segundo auxili)/.test(t)) return 0.2;
  if (/(1.*auxili|primeiro auxili|auxili)/.test(t)) return 0.3;
  return 1;
}

// ---------- calculadores ----------
interface ExpectedCalc { expected: number | null; explanation: string; alerts: string[]; }

function calcPercentual(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const pct = rule.convenio_percentage ?? 100;
  const base = item.procedure_amount;
  if (base == null) return { expected: null, explanation: `${pct}% do convênio — valor base ausente.`, alerts: ["procedure_amount ausente."] };
  const expected = Number((base * (pct / 100)).toFixed(2));
  return { expected, explanation: `${pct}% × R$ ${base.toFixed(2)} = R$ ${expected.toFixed(2)}`, alerts: [] };
}

function calcRegraVias(_rule: RuleInput, item: ItemInput): ExpectedCalc {
  const factor = accessRouteFactor(item.access_route);
  const base = item.procedure_amount;
  if (base == null) return { expected: null, explanation: "regra_vias: valor base ausente.", alerts: ["procedure_amount ausente."] };
  const expected = Number((base * factor).toFixed(2));
  return { expected, explanation: `Via "${item.access_route ?? "—"}" → fator ${factor} × R$ ${base.toFixed(2)} = R$ ${expected.toFixed(2)}`, alerts: [] };
}

const isVisita  = (it: ItemInput) => /visita/.test(normName(`${it.procedure_name ?? ""} ${it.description ?? ""}`));
const isParecer = (it: ItemInput) => /parecer/.test(normName(`${it.procedure_name ?? ""} ${it.description ?? ""}`));
const isAuxiliar = (it: ItemInput) => /auxili|instrumentador/.test(normName(it.doctor_role ?? ""));

function isMainPackageCode(rule: RuleInput, item: ItemInput): boolean {
  if (!item.procedure_code) return false;
  if (rule.package_main_code && item.procedure_code === rule.package_main_code) return true;
  // fallback: se não houver main_code definido, qualquer item é considerado principal
  return !rule.package_main_code;
}

function isIncludedInPackage(rule: RuleInput, item: ItemInput): boolean {
  const inc = rule.package_included_codes ?? [];
  if (item.procedure_code && inc.includes(item.procedure_code)) return true;
  if (rule.package_visits_count && isVisita(item)) return true;
  if (rule.package_opinions_count && isParecer(item)) return true;
  if (rule.package_auxiliaries_included && isAuxiliar(item)) return true;
  return false;
}

function calcPacoteFechado(rule: RuleInput, item: ItemInput): ExpectedCalc {
  if (rule.package_amount == null) {
    return { expected: null, explanation: "pacote_fechado sem package_amount.", alerts: ["Pacote sem valor."] };
  }
  if (isMainPackageCode(rule, item)) {
    return { expected: Number(rule.package_amount), explanation: `Pacote fechado (principal ${item.procedure_code ?? "—"}): R$ ${rule.package_amount.toFixed(2)}`, alerts: [] };
  }
  if (isIncludedInPackage(rule, item)) {
    return { expected: 0, explanation: `Item embutido no pacote fechado — esperado R$ 0.`, alerts: [] };
  }
  // Não é principal nem incluído → fora do pacote
  return {
    expected: 0,
    explanation: `Item fora do pacote fechado (código ${item.procedure_code ?? "—"}) — não previsto.`,
    alerts: [`Item fora do pacote fechado (código ${item.procedure_code ?? "—"}).`],
  };
}

function calcPacoteExtras(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const pkg = rule.package_amount ?? 0;
  const extras = rule.extras_codes ?? [];
  const isExtra = item.procedure_code != null && extras.includes(item.procedure_code);
  if (isExtra) {
    const base = item.procedure_amount;
    if (base == null) return { expected: null, explanation: "Extra do pacote sem valor base.", alerts: ["Extra sem procedure_amount."] };
    return { expected: Number(base.toFixed(2)), explanation: `Extra permitido (código ${item.procedure_code}) — 100% do convênio: R$ ${base.toFixed(2)}`, alerts: [] };
  }
  if (isMainPackageCode(rule, item)) {
    return { expected: Number(pkg.toFixed(2)), explanation: `Pacote com extras — principal: R$ ${pkg.toFixed(2)}`, alerts: [] };
  }
  if (isIncludedInPackage(rule, item)) {
    return { expected: 0, explanation: `Item embutido no pacote — esperado R$ 0.`, alerts: [] };
  }
  return {
    expected: 0,
    explanation: `Item fora do pacote e não está na lista de extras permitidos.`,
    alerts: [`Item fora do pacote e não está nos extras permitidos (código ${item.procedure_code ?? "—"}).`],
  };
}

/**
 * Pacote por atendimento: o motor agrupa os itens pelo mesmo atendimento e
 * aplica o valor do pacote UMA ÚNICA VEZ (no item principal). Os demais itens
 * do mesmo atendimento ficam com esperado = 0 (embutidos), salvo se forem
 * extras permitidos. A flag `__appliedAttendances` é usada apenas para
 * decidir, em runtime, qual item leva o valor do pacote.
 */
function calcPacotePorAtendimento(
  rule: RuleInput,
  item: ItemInput,
  applied: Set<string>,
): ExpectedCalc {
  if (rule.package_amount == null) {
    return { expected: null, explanation: "pacote_por_atendimento sem package_amount.", alerts: ["Pacote sem valor."] };
  }
  const att = (item.attendance_number ?? "").trim();
  if (!att) {
    return {
      expected: null,
      explanation: "Pacote por atendimento exige número de atendimento no item.",
      alerts: ["Item sem número de atendimento — pacote não pôde ser agrupado."],
    };
  }
  const extras = rule.extras_codes ?? [];
  if (item.procedure_code && extras.includes(item.procedure_code)) {
    const base = item.procedure_amount ?? 0;
    return { expected: Number(base.toFixed(2)), explanation: `Extra permitido no atendimento ${att}: R$ ${base.toFixed(2)}`, alerts: [] };
  }
  // Decide qual item leva o pacote: o "principal" se houver, senão o primeiro processado
  const isMain = isMainPackageCode(rule, item);
  if (!applied.has(att) && isMain) {
    applied.add(att);
    return { expected: Number(rule.package_amount), explanation: `Pacote por atendimento ${att} aplicado em ${item.procedure_code ?? "principal"}: R$ ${rule.package_amount.toFixed(2)}`, alerts: [] };
  }
  if (!applied.has(att) && !rule.package_main_code) {
    // sem código principal definido — primeiro item recebe
    applied.add(att);
    return { expected: Number(rule.package_amount), explanation: `Pacote por atendimento ${att} aplicado: R$ ${rule.package_amount.toFixed(2)}`, alerts: [] };
  }
  if (isIncludedInPackage(rule, item) || isMain || applied.has(att)) {
    return { expected: 0, explanation: `Item embutido no pacote do atendimento ${att} — esperado R$ 0.`, alerts: [] };
  }
  return {
    expected: 0,
    explanation: `Item fora do pacote do atendimento ${att}.`,
    alerts: [`Item fora do pacote por atendimento (código ${item.procedure_code ?? "—"}).`],
  };
}

function calcValorFixo(rule: RuleInput): ExpectedCalc {
  if (rule.fixed_amount == null) return { expected: null, explanation: "valor_fixo sem fixed_amount.", alerts: ["Valor fixo não configurado."] };
  return { expected: Number(rule.fixed_amount), explanation: `Valor fixo: R$ ${rule.fixed_amount.toFixed(2)}`, alerts: [] };
}

function calcExclusao(): ExpectedCalc {
  return { expected: 0, explanation: "Exclusão: este item não deve ser pago.", alerts: ["Item excluído por regra."] };
}

function calcInformativo(): ExpectedCalc {
  return { expected: null, explanation: "Regra informativa.", alerts: [] };
}

function calcDefault(item: ItemInput): ExpectedCalc & { calculation_type_used: "default_hemodinamica" | "default_geral" } {
  const sector = inferItemSector(item);
  const pct = sector === "hemodinamica" ? 88 : 100;
  const base = item.procedure_amount;
  const ctu = sector === "hemodinamica" ? "default_hemodinamica" as const : "default_geral" as const;
  if (base == null) {
    return { expected: null, explanation: `Default ${sector} (${pct}%) — valor base ausente.`, alerts: ["Sem regra e sem procedure_amount."], calculation_type_used: ctu };
  }
  const expected = Number((base * (pct / 100)).toFixed(2));
  return { expected, explanation: `Sem regra → default ${sector} ${pct}% × R$ ${base.toFixed(2)} = R$ ${expected.toFixed(2)}`, alerts: [], calculation_type_used: ctu };
}

export function applyCalculation(
  rule: RuleInput,
  item: ItemInput,
  ctx?: { appliedAttendancesByRule: Map<string, Set<string>> },
): ExpectedCalc {
  if (rule.rule_type === "tabela_diferenciada" && rule.reference_table_id) {
    return calcTabelaDiferenciada(rule, item);
  }
  switch (rule.calculation_type) {
    case "percentual_sobre_convenio": return calcPercentual(rule, item);
    case "regra_vias":                return calcRegraVias(rule, item);
    case "pacote_fechado":            return calcPacoteFechado(rule, item);
    case "pacote_com_extras":         return calcPacoteExtras(rule, item);
    case "pacote_por_atendimento": {
      const map = ctx?.appliedAttendancesByRule ?? new Map<string, Set<string>>();
      let set = map.get(rule.id);
      if (!set) { set = new Set<string>(); map.set(rule.id, set); }
      return calcPacotePorAtendimento(rule, item, set);
    }
    case "valor_fixo":                return calcValorFixo(rule);
    case "exclusao":                  return calcExclusao();
    case "informativo":               return calcInformativo();
    case "tabela_referencia":         return calcTabelaDiferenciada(rule, item);
    case "tabela_diferenciada":       return calcTabelaDiferenciada(rule, item);
    case "bonus":                     return calcBonus(rule, item);
    case "complemento":               return calcComplemento(rule, item);
  }
}

function calcBonus(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const base = item.procedure_amount;
  if (base == null) return { expected: null, explanation: "Bônus — valor base ausente.", alerts: ["procedure_amount ausente."] };
  const fixed = rule.bonus_amount ?? 0;
  const pct = rule.bonus_pct ?? 0;
  const value = base + fixed + base * (pct / 100);
  const expected = Number(value.toFixed(2));
  return { expected, explanation: `R$ ${base.toFixed(2)} + R$ ${fixed.toFixed(2)} + ${pct}% = R$ ${expected.toFixed(2)}`, alerts: [] };
}

function calcComplemento(rule: RuleInput, item: ItemInput): ExpectedCalc {
  if (rule.target_amount == null) return { expected: null, explanation: "Complemento sem valor alvo.", alerts: ["target_amount não configurado."] };
  const expected = Number(rule.target_amount.toFixed(2));
  return { expected, explanation: `Complemento até R$ ${expected.toFixed(2)} (valor alvo).`, alerts: [] };
}

/**
 * Tabela diferenciada: usa procedure_amount como aproximação do valor base
 * da tabela de referência (ex: CBHPM) e aplica os parâmetros da REGRA.
 * Ordem: base × multiplicador × (1 - deflator%) × (repasse%) × via × (1 + aux)
 */
function calcTabelaDiferenciada(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const base = item.procedure_amount;
  if (base == null) {
    return { expected: null, explanation: "Tabela diferenciada — valor base ausente.", alerts: ["procedure_amount ausente."] };
  }
  const mult = rule.multiplier ?? 1;
  const defl = rule.deflator_pct ?? 0;
  const rep  = rule.repasse_pct ?? 100;
  let value = base * mult * (1 - defl / 100) * (rep / 100);
  const parts: string[] = [`base R$ ${base.toFixed(2)}`, `× ${mult}`, `× (1 − ${defl}%)`, `× ${rep}%`];
  if (rule.apply_access_route) {
    const f = accessRouteFactor(item.access_route);
    value *= f;
    parts.push(`× via(${f})`);
  }
  if (rule.include_auxiliaries) {
    const auxPct = (rule.auxiliary_pct ?? 30) / 100;
    value *= (1 + auxPct);
    parts.push(`× (1 + aux ${(auxPct * 100).toFixed(0)}%)`);
  }
  const expected = Number(value.toFixed(2));
  return { expected, explanation: `${parts.join(" ")} = R$ ${expected.toFixed(2)}`, alerts: [] };
}

function classifyDiff(expected: number | null, gross: number): { status: ItemAiStatus; diff_pct: number | null } {
  if (expected == null) return { status: "alerta", diff_pct: null };
  if (gross <= 0) return { status: "alerta", diff_pct: null };
  const diff = Math.abs(expected - gross) / Math.max(Math.abs(expected), 0.01);
  if (diff <= 0.01) return { status: "aprovado", diff_pct: diff };
  if (diff <= 0.10) return { status: "alerta",   diff_pct: diff };
  return { status: "reprovado", diff_pct: diff };
}

export function analyzeItem(
  item: ItemInput,
  preFilteredRules: RuleInput[],
  ctx?: { appliedAttendancesByRule: Map<string, Set<string>> },
): AnalysisResult {
  const outcome = selectWinningRule(item, preFilteredRules);
  let calc: ExpectedCalc;
  let priority: RuleMatchPriority;
  let calculation_type_used: AnalysisResult["calculation_type_used"];
  let matched_rule_id: string | null = null;
  let matched_rule_name: string | null = null;
  let conflict: AnalysisResult["conflict"] | undefined;

  if (outcome && outcome.priority === "conflito") {
    priority = "conflito";
    calculation_type_used = "informativo";
    calc = {
      expected: null,
      explanation: outcome.conflict?.reason ?? "Conflito de regras — análise bloqueada.",
      alerts: [
        "Conflito de regra: múltiplas regras aplicáveis no mesmo nível de prioridade.",
        ...(outcome.conflict ? [`Regras candidatas: ${outcome.conflict.candidate_rule_ids.join(", ")}`] : []),
      ],
    };
    conflict = outcome.conflict;
  } else if (outcome && outcome.rule) {
    calc = applyCalculation(outcome.rule, item, ctx);
    priority = outcome.priority;
    calculation_type_used = outcome.rule.calculation_type;
    matched_rule_id = outcome.rule.id;
    matched_rule_name = outcome.rule.name;
  } else {
    const def = calcDefault(item);
    calc = def;
    priority = "default_setor";
    calculation_type_used = def.calculation_type_used;
  }

  let { status, diff_pct } = classifyDiff(calc.expected, item.gross_amount);
  if (priority === "conflito") status = "alerta";
  const alerts = [...calc.alerts];
  if (calc.expected != null && status === "reprovado") {
    alerts.push(`Divergência de ${(diff_pct! * 100).toFixed(1)}% entre esperado (R$ ${calc.expected.toFixed(2)}) e pago (R$ ${item.gross_amount.toFixed(2)}).`);
  } else if (calc.expected != null && status === "alerta" && diff_pct != null && diff_pct > 0.01) {
    alerts.push(`Diferença de ${(diff_pct * 100).toFixed(1)}% entre esperado e pago.`);
  }

  return {
    item_id: item.id,
    status,
    expected_amount: calc.expected,
    diff_pct,
    matched_rule_id,
    matched_rule_name,
    matched_priority: priority,
    calculation_type_used,
    calculation_explanation: calc.explanation,
    alerts,
    needs_ai_review: status !== "aprovado",
    ...(conflict ? { conflict } : {}),
  };
}

export function analyzePaymentItems(items: ItemInput[], rules: RuleInput[], ctx: PaymentContext): AnalysisResult[] {
  const filtered = preFilterRules(rules, ctx);
  // Para "pacote_por_atendimento", precisamos de ordem determinística:
  // 1) por atendimento, 2) item com código principal primeiro,
  // 3) demais por código. Assim o pacote é aplicado no item certo.
  const ordered = [...items].sort((a, b) => {
    const aa = (a.attendance_number ?? "").localeCompare(b.attendance_number ?? "");
    if (aa !== 0) return aa;
    const aMain = filtered.some((r) => r.calculation_type === "pacote_por_atendimento" && r.package_main_code && a.procedure_code === r.package_main_code) ? -1 : 0;
    const bMain = filtered.some((r) => r.calculation_type === "pacote_por_atendimento" && r.package_main_code && b.procedure_code === r.package_main_code) ? -1 : 0;
    if (aMain !== bMain) return aMain - bMain;
    return (a.procedure_code ?? "").localeCompare(b.procedure_code ?? "");
  });
  const state = { appliedAttendancesByRule: new Map<string, Set<string>>() };
  const resultsOrdered = ordered.map((it) => analyzeItem(it, filtered, state));
  // Reordenar resultados para a ordem original de `items`
  const byId = new Map(resultsOrdered.map((r) => [r.item_id, r] as const));
  return items.map((it) => byId.get(it.id)!);
}
