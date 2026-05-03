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
  | "tabela_referencia";

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
  | "default_setor";

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
export function selectWinningRule(
  item: ItemInput,
  rules: RuleInput[],
): { rule: RuleInput; priority: RuleMatchPriority } | null {
  const itemSector = inferItemSector(item);
  const doctorRules  = rules.filter((r) => targetsDoctor(r, item));
  const companyRules = rules.filter((r) => targetsCompany(r, item));
  const sectorRules  = rules.filter((r) => r.scope === "master" && ruleSectors(r).includes(itemSector));
  const outroRules   = rules.filter((r) => r.scope === "master" && ruleSectors(r).includes("outro"));

  const tryBucket = (
    bucket: RuleInput[],
    withCodePriority: RuleMatchPriority,
    withoutCodePriority: RuleMatchPriority,
  ): { rule: RuleInput; priority: RuleMatchPriority } | null => {
    const withCode = bucket.filter((r) => hasCodeRestriction(r) && matchesProcedureCode(r, item));
    if (withCode.length > 0) return { rule: withCode[0], priority: withCodePriority };
    const withoutCode = bucket.filter((r) => !hasCodeRestriction(r));
    if (withoutCode.length > 0) return { rule: withoutCode[0], priority: withoutCodePriority };
    return null;
  };

  return (
    tryBucket(doctorRules,  "medico_codigo",  "medico") ??
    tryBucket(companyRules, "empresa_codigo", "empresa") ??
    tryBucket(sectorRules,  "setor_codigo",   "setor") ??
    tryBucket(outroRules,   "setor_codigo",   "setor_outro") ??
    null
  );
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

function calcPacote(rule: RuleInput): ExpectedCalc {
  if (rule.package_amount == null) return { expected: null, explanation: "pacote_fechado sem package_amount.", alerts: ["Pacote sem valor."] };
  return { expected: Number(rule.package_amount), explanation: `Pacote fechado: R$ ${rule.package_amount.toFixed(2)}`, alerts: [] };
}

function calcPacoteExtras(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const pkg = rule.package_amount ?? 0;
  const extras = rule.extras_codes ?? [];
  const isExtra = item.procedure_code != null && extras.includes(item.procedure_code);
  if (isExtra) {
    const base = item.procedure_amount;
    if (base == null) return { expected: null, explanation: "Extra do pacote sem valor base.", alerts: ["Extra sem procedure_amount."] };
    return { expected: Number(base.toFixed(2)), explanation: `Extra do pacote (código ${item.procedure_code}) — 100% do convênio: R$ ${base.toFixed(2)}`, alerts: [] };
  }
  return { expected: Number(pkg.toFixed(2)), explanation: `Pacote com extras — dentro do pacote: R$ ${pkg.toFixed(2)}`, alerts: [] };
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

export function applyCalculation(rule: RuleInput, item: ItemInput): ExpectedCalc {
  if (rule.rule_type === "tabela_diferenciada" && rule.reference_table_id) {
    return calcTabelaDiferenciada(rule, item);
  }
  switch (rule.calculation_type) {
    case "percentual_sobre_convenio": return calcPercentual(rule, item);
    case "regra_vias":                return calcRegraVias(rule, item);
    case "pacote_fechado":            return calcPacote(rule);
    case "pacote_com_extras":         return calcPacoteExtras(rule, item);
    case "valor_fixo":                return calcValorFixo(rule);
    case "exclusao":                  return calcExclusao();
    case "informativo":               return calcInformativo();
    case "tabela_referencia":         return calcTabelaDiferenciada(rule, item);
  }
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

export function analyzeItem(item: ItemInput, preFilteredRules: RuleInput[]): AnalysisResult {
  const winner = selectWinningRule(item, preFilteredRules);
  let calc: ExpectedCalc;
  let priority: RuleMatchPriority;
  let calculation_type_used: AnalysisResult["calculation_type_used"];
  let matched_rule_id: string | null = null;
  let matched_rule_name: string | null = null;

  if (winner) {
    calc = applyCalculation(winner.rule, item);
    priority = winner.priority;
    calculation_type_used = winner.rule.calculation_type;
    matched_rule_id = winner.rule.id;
    matched_rule_name = winner.rule.name;
  } else {
    const def = calcDefault(item);
    calc = def;
    priority = "default_setor";
    calculation_type_used = def.calculation_type_used;
  }

  const { status, diff_pct } = classifyDiff(calc.expected, item.gross_amount);
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
  };
}

export function analyzePaymentItems(items: ItemInput[], rules: RuleInput[], ctx: PaymentContext): AnalysisResult[] {
  const filtered = preFilterRules(rules, ctx);
  return items.map((it) => analyzeItem(it, filtered));
}
