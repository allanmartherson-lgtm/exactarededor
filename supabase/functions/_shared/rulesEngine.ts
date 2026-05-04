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
  | "pacote"
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
  scope: "master" | "especifica" | "grupo";
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
  package_subtype?: string | null;
  // Parâmetros de cálculo de tabela diferenciada (pertencem à regra)
  rule_type?: string | null;
  reference_table_id?: string | null;
  multiplier?: number | null;
  deflator_pct?: number | null;
  repasse_pct?: number | null;
  apply_access_route?: boolean | null;
  include_auxiliaries?: boolean | null;
  auxiliary_pct?: number | null;
  aux_first_pct?: number | null;
  aux_second_pct?: number | null;
  instrumentador_pct?: number | null;
  group_company_ids?: string[] | null;
  group_doctors?: { name?: string; crm?: string }[] | null;
  /**
   * Vínculos por empresa (novo modelo). Cada item: empresa + (opcional) lista de médicos.
   * Se `doctors` estiver vazio → aplica a todos médicos daquela empresa.
   * Se preenchido → aplica somente aos médicos listados naquela empresa.
   * Tem precedência sobre `group_company_ids`/`group_doctors` quando presente.
   */
  group_company_links?: { company_id: string; doctors?: { name?: string; crm?: string }[] }[] | null;
  bonus_amount?: number | null;
  bonus_pct?: number | null;
  target_amount?: number | null;
  // Exclusão / não pagar
  exclusion_reason?: string | null;
  allows_authorized_exception?: boolean | null;
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
  quantity?: number | null;
  // Exceção autorizada (marcada pelo analista)
  authorized_exception?: boolean | null;
  exception_reason?: string | null;
  exception_authorizer?: string | null;
  exception_note?: string | null;
  /** Classificação determinística pré-aplicada (ex.: tabela_procedimentos_hemodinamica). */
  classification_sector?: string | null;
  classification_source?: string | null;
  classification_confidence?: string | null;
  /** Classificação do tipo de linha (pré-validação). */
  tipo_linha?: string | null;
  /** Motivo/justificativa quando tipo_linha = complemento_bonus. */
  complement_reason?: string | null;
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
  | "grupo_codigo"
  | "grupo"
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
  calculation_type_used: CalculationType | "default_geral" | "default_hemodinamica" | "exclusao" | "pacote_fixo";
  calculation_explanation: string;
  alerts: string[];
  needs_ai_review: boolean;
  conflict?: {
    candidate_rule_ids: string[];
    reason: string;
  };
  /** Chave do grupo de atendimento (atendimento|paciente|data|empresa|médico). */
  attendance_group_key?: string;
  /** Se este item foi escolhido como procedimento principal do grupo. */
  is_main_procedure?: boolean;
  /** Motivo determinístico da escolha do principal. */
  main_reason?: MainReason | null;
  /** Se o grupo teve empate na escolha do principal (alerta). */
  main_ambiguous?: boolean;
}

export type MainReason =
  | "codigo_principal_pacote"
  | "maior_valor_tabela"
  | "via_principal_unica"
  | "maior_quantidade_ou_bruto"
  | "ambiguo";

// ---------- helpers ----------
const onlyDigits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");
const normName = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function inferItemSector(item: ItemInput): string {
  if (item.classification_sector) return item.classification_sector;
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

type DoctorRole = "cirurgiao" | "primeiro_aux" | "demais_aux" | "instrumentador" | "outro";
function classifyDoctorRole(role: string | null | undefined): DoctorRole {
  const s = (role ?? "").toLowerCase().trim();
  if (!s) return "outro";
  if (s.includes("instrument")) return "instrumentador";
  if (s.includes("cirurgi")) return "cirurgiao";
  // 1º / primeiro / 1
  if (/(^|\b)(1º|1o|1\b|primeir)/.test(s) && s.includes("aux")) return "primeiro_aux";
  // 2º / 3º / segundo / terceiro / etc + aux
  if (/(2º|2o|3º|3o|4º|4o|segund|terceir|quart|quint)/.test(s) && s.includes("aux")) return "demais_aux";
  if (s.includes("aux")) return "primeiro_aux"; // sem ordinal explícito → trata como 1º
  return "outro";
}

function targetsGroup(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "grupo") return false;
  const cids = r.group_company_ids ?? [];
  const docs = r.group_doctors ?? [];
  // Sem vínculos: aplica a todos os itens (master implícito dentro do escopo grupo).
  if (cids.length === 0 && docs.length === 0) return true;

  const matchesDoctor = (() => {
    if (docs.length === 0 || !item.doctor_name) return false;
    const itemNm = normName(item.doctor_name);
    const itemCrm = onlyDigits(item.doctor_document);
    for (const d of docs) {
      if (d?.name && normName(d.name) === itemNm) return true;
      if (d?.crm && itemCrm && onlyDigits(d.crm) === itemCrm) return true;
    }
    return false;
  })();

  // Modo 1 — Por empresa: empresa(s) selecionada(s).
  // Sem médicos → aplica a todos da empresa. Com médicos → restringe.
  if (cids.length > 0) {
    const inCompany = !!(item.company_id && cids.includes(item.company_id));
    if (!inCompany) return false;
    if (docs.length === 0) return true;
    return matchesDoctor;
  }

  // Modo 2 — Por médico: aplica somente aos médicos selecionados.
  return matchesDoctor;
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
  const groupRules   = rules.filter((r) => targetsGroup(r, item));
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
    { bucket: groupRules,     withCodePriority: "grupo_codigo",   withoutCodePriority: "grupo" },
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

function calcExclusao(rule: RuleInput): ExpectedCalc {
  const motivo = rule.exclusion_reason ? ` (motivo: ${rule.exclusion_reason})` : "";
  const exc = rule.allows_authorized_exception
    ? " — admite exceção autorizada pelo analista."
    : "";
  return {
    expected: 0,
    explanation: `Exclusão${motivo}: este item não deve ser pago${exc}`,
    alerts: [`Item excluído por regra${motivo}.`],
  };
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
    case "pacote": {
      // Método unificado: sempre opera no nível do atendimento.
      // O subtipo controla o comportamento dos extras/flags.
      const map = ctx?.appliedAttendancesByRule ?? new Map<string, Set<string>>();
      let set = map.get(rule.id);
      if (!set) { set = new Set<string>(); map.set(rule.id, set); }
      return calcPacotePorAtendimento(rule, item, set);
    }
    case "valor_fixo":                return calcValorFixo(rule);
    case "exclusao":                  return calcExclusao(rule);
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
    const role = classifyDoctorRole(item.doctor_role);
    if (role === "instrumentador") {
      const pct = (rule.instrumentador_pct ?? 10) / 100;
      value = base * (rule.multiplier ?? 1) * (1 - (rule.deflator_pct ?? 0) / 100) * ((rule.repasse_pct ?? 100) / 100) * pct;
      parts.push(`× instrumentador ${(pct * 100).toFixed(0)}%`);
    } else if (role === "primeiro_aux") {
      const pct = (rule.aux_first_pct ?? 30) / 100;
      value = base * (rule.multiplier ?? 1) * (1 - (rule.deflator_pct ?? 0) / 100) * ((rule.repasse_pct ?? 100) / 100) * pct;
      parts.push(`× 1º aux ${(pct * 100).toFixed(0)}%`);
    } else if (role === "demais_aux") {
      const pct = (rule.aux_second_pct ?? 20) / 100;
      value = base * (rule.multiplier ?? 1) * (1 - (rule.deflator_pct ?? 0) / 100) * ((rule.repasse_pct ?? 100) / 100) * pct;
      parts.push(`× aux 2+ ${(pct * 100).toFixed(0)}%`);
    } else {
      // sem função identificada → comportamento legado: soma composta com % por auxiliar (fallback auxiliary_pct)
      const auxPct = (rule.auxiliary_pct ?? rule.aux_first_pct ?? 30) / 100;
      value *= (1 + auxPct);
      parts.push(`× (1 + aux ${(auxPct * 100).toFixed(0)}%)`);
    }
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

/**
 * Quando há exceção autorizada à exclusão, procura a próxima regra aplicável
 * que seja calculável (não "exclusao" e não "informativo"), respeitando a
 * mesma hierarquia de precedência. Retorna null se não houver.
 */
function findNextCalculableRule(
  item: ItemInput,
  rules: RuleInput[],
  excludeId: string,
): { rule: RuleInput; priority: RuleMatchPriority } | null {
  const remaining = rules.filter(
    (r) =>
      r.id !== excludeId &&
      r.calculation_type !== "exclusao" &&
      r.calculation_type !== "informativo",
  );
  const out = selectWinningRule(item, remaining);
  if (out && out.rule) return { rule: out.rule, priority: out.priority };
  return null;
}

export function analyzeItem(
  item: ItemInput,
  preFilteredRules: RuleInput[],
  ctx?: { appliedAttendancesByRule: Map<string, Set<string>> },
): AnalysisResult {
  // === Tratamento especial: complemento/bônus, glosa, reprocessamento ===
  // Estes lançamentos NÃO são itens independentes para o motor de regras:
  // não exigem código TUSS, tabela ou regra de procedimento. A vinculação
  // ao atendimento é feita em `analyzePaymentItems` (attendance_group_key).
  const tl = (item.tipo_linha ?? "").toLowerCase();
  if (tl === "complemento_bonus" || tl === "glosa_desconto" || tl === "reprocessamento") {
    const alerts: string[] = [];
    if (tl === "complemento_bonus" && !item.complement_reason && !item.description) {
      alerts.push("Complemento sem motivo/descrição — exigida rastreabilidade.");
    }
    if (tl === "complemento_bonus" && !item.attendance_number && !item.patient_name) {
      alerts.push("Complemento sem atendimento/paciente — vinculação ao atendimento incerta.");
    }
    if (tl === "glosa_desconto" && !item.description) {
      alerts.push("Glosa/desconto sem motivo informado.");
    }
    return {
      item_id: item.id,
      status: alerts.length ? "alerta" : "aprovado",
      expected_amount: item.gross_amount,
      diff_pct: 0,
      matched_rule_id: null,
      matched_rule_name: null,
      matched_priority: "default_setor",
      calculation_type_used: "informativo",
      calculation_explanation:
        tl === "complemento_bonus"
          ? "Complemento/bônus vinculado ao atendimento — não calculado por regra de procedimento."
          : tl === "glosa_desconto"
            ? "Glosa/desconto — lançamento financeiro, não calculado por regra de procedimento."
            : "Reprocessamento/pendência — lançamento financeiro, sem regra de procedimento aplicada.",
      alerts,
      needs_ai_review: alerts.length > 0,
    };
  }

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
    let winner = outcome.rule;
    let winnerPriority = outcome.priority;

    // === Tratamento de "Exclusão / não pagar" como bloqueio com exceção autorizada ===
    // Se a regra vencedora é uma exclusão e o analista marcou o item como
    // "exceção autorizada", e a regra permite essa exceção, o motor NÃO aplica
    // a exclusão automática: tenta encontrar a próxima regra calculável
    // específica entre as candidatas (excluindo as exclusões). Se não houver,
    // mantém como alerta para validação manual.
    if (
      winner.calculation_type === "exclusao" &&
      item.authorized_exception === true &&
      winner.allows_authorized_exception === true
    ) {
      const fallback = findNextCalculableRule(item, preFilteredRules, winner.id);
      if (fallback) {
        winner = fallback.rule;
        winnerPriority = fallback.priority;
        calc = applyCalculation(winner, item, ctx);
        calc.explanation = `Exceção autorizada — exclusão substituída por regra calculável "${winner.name}". ${calc.explanation}`;
        calc.alerts = [
          `Exceção autorizada (${item.exception_reason ?? "—"}) por ${item.exception_authorizer ?? "—"}.`,
          ...calc.alerts,
        ];
      } else {
        calc = {
          expected: null,
          explanation:
            "Exceção autorizada à exclusão — não há regra calculável específica. Encaminhar para validação manual.",
          alerts: [
            `Exceção autorizada (${item.exception_reason ?? "—"}) por ${item.exception_authorizer ?? "—"} — sem regra calculável; revisão manual necessária.`,
          ],
        };
      }
    } else {
      calc = applyCalculation(winner, item, ctx);
    }
    priority = winnerPriority;
    calculation_type_used = winner.calculation_type;
    matched_rule_id = winner.id;
    matched_rule_name = winner.name;

    // Se o item foi marcado como exceção autorizada mas a regra NÃO permite,
    // gera alerta explícito (analista marcou em regra que não admite exceção).
    if (
      item.authorized_exception === true &&
      outcome.rule.calculation_type === "exclusao" &&
      outcome.rule.allows_authorized_exception !== true
    ) {
      calc.alerts = [
        ...calc.alerts,
        "Tentativa de exceção autorizada em regra de exclusão que NÃO admite exceção — ignorada.",
      ];
    }
  } else {
    const def = calcDefault(item);
    calc = def;
    priority = "default_setor";
    calculation_type_used = def.calculation_type_used;
  }

  let { status, diff_pct } = classifyDiff(calc.expected, item.gross_amount);
  if (priority === "conflito") status = "alerta";
  // Exceção autorizada que caiu sem regra calculável => alerta de validação manual.
  if (
    item.authorized_exception === true &&
    calc.expected == null &&
    matched_rule_id != null
  ) {
    status = "alerta";
  }
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
    const isPkgAtt = (r: RuleInput) =>
      r.calculation_type === "pacote_por_atendimento" || r.calculation_type === "pacote";
    const aMain = filtered.some((r) => isPkgAtt(r) && r.package_main_code && a.procedure_code === r.package_main_code) ? -1 : 0;
    const bMain = filtered.some((r) => isPkgAtt(r) && r.package_main_code && b.procedure_code === r.package_main_code) ? -1 : 0;
    if (aMain !== bMain) return aMain - bMain;
    return (a.procedure_code ?? "").localeCompare(b.procedure_code ?? "");
  });
  const state = { appliedAttendancesByRule: new Map<string, Set<string>>() };
  const resultsOrdered = ordered.map((it) => analyzeItem(it, filtered, state));
  // Reordenar resultados para a ordem original de `items`
  const byId = new Map(resultsOrdered.map((r) => [r.item_id, r] as const));
  const out = items.map((it) => byId.get(it.id)!);

  // === Identificação determinística do procedimento principal ===
  // Agrupa por: atendimento | paciente | data | empresa | médico.
  const mainSelections = selectMainProcedures(items, filtered);
  for (const r of out) {
    const sel = mainSelections.byItemId.get(r.item_id);
    if (!sel) continue;
    r.attendance_group_key = sel.groupKey;
    r.is_main_procedure = sel.isMain;
    r.main_reason = sel.reason;
    r.main_ambiguous = sel.ambiguous;
    if (sel.ambiguous && sel.isMain) {
      r.alerts = [...r.alerts, "Procedimento principal ambíguo: o motor não conseguiu desempatar de forma determinística."];
      if (r.status === "aprovado") r.status = "alerta";
      r.needs_ai_review = true;
    }
  }

  // === Complemento/bônus: vincular ao atendimento e alertar se elevado ===
  // Soma valor base (procedimentos) e complementos por grupo de atendimento.
  const baseByGroup = new Map<string, number>();
  const complByGroup = new Map<string, number>();
  for (const it of items) {
    const sel = mainSelections.byItemId.get(it.id);
    if (!sel) continue;
    const gk = sel.groupKey;
    const tl = (it.tipo_linha ?? "").toLowerCase();
    if (tl === "complemento_bonus") {
      complByGroup.set(gk, (complByGroup.get(gk) ?? 0) + Number(it.gross_amount || 0));
    } else if (tl !== "glosa_desconto" && tl !== "reprocessamento") {
      baseByGroup.set(gk, (baseByGroup.get(gk) ?? 0) + Number(it.gross_amount || 0));
    }
  }
  const COMPLEMENT_THRESHOLD_PCT = 30; // alerta se complemento > 30% do valor base
  for (const it of items) {
    const tl = (it.tipo_linha ?? "").toLowerCase();
    if (tl !== "complemento_bonus") continue;
    const r = byId.get(it.id);
    const sel = mainSelections.byItemId.get(it.id);
    if (!r || !sel) continue;
    const base = baseByGroup.get(sel.groupKey) ?? 0;
    const compl = complByGroup.get(sel.groupKey) ?? 0;
    if (base > 0) {
      const pct = (compl / base) * 100;
      if (pct > COMPLEMENT_THRESHOLD_PCT) {
        r.alerts = [
          ...r.alerts,
          `Complemento elevado em relação ao valor base (${pct.toFixed(0)}% — complementos R$ ${compl.toFixed(2)} vs base R$ ${base.toFixed(2)}).`,
        ];
        if (r.status === "aprovado") r.status = "alerta";
        r.needs_ai_review = true;
      }
    } else if (compl > 0) {
      r.alerts = [
        ...r.alerts,
        "Complemento sem valor base no mesmo atendimento — verificar vinculação.",
      ];
      if (r.status === "aprovado") r.status = "alerta";
      r.needs_ai_review = true;
    }
  }

  return out;
}

// ---------- Procedimento principal do atendimento ----------

export interface MainSelection {
  groupKey: string;
  isMain: boolean;
  reason: MainReason | null;
  ambiguous: boolean;
}

/** Constrói a chave de agrupamento atendimento|paciente|data|empresa|médico. */
function attendanceGroupKey(item: ItemInput): string {
  const att = (item.attendance_number ?? "").trim().toLowerCase();
  const pat = normName(item.patient_name);
  const date = (item.procedure_date ?? "").slice(0, 10);
  const comp = item.company_id ?? onlyDigits(item.company_document) ?? normName(item.company_name);
  const doc = onlyDigits(item.doctor_document) || normName(item.doctor_name);
  return [att, pat, date, comp, doc].join("|");
}

/**
 * Seleciona o procedimento principal de cada grupo, na ordem:
 *   1. código marcado como "código principal do pacote" (se houver regra de pacote no grupo)
 *   2. maior valor de tabela/convênio (procedure_amount)
 *   3. via de acesso = principal/única
 *   4. maior quantidade ou maior valor bruto
 *   5. empate restante => ambíguo (alerta)
 */
export function selectMainProcedures(
  items: ItemInput[],
  rules: RuleInput[],
): { byItemId: Map<string, MainSelection> } {
  const byItemId = new Map<string, MainSelection>();
  const groups = new Map<string, ItemInput[]>();
  for (const it of items) {
    const k = attendanceGroupKey(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  // Conjunto de códigos principais de pacote vindos das regras.
  const packageMainCodes = new Set(
    rules
      .filter((r) => {
        const ct = r.calculation_type;
        return (ct === "pacote" || ct === "pacote_fechado" || ct === "pacote_com_extras" || ct === "pacote_por_atendimento") && !!r.package_main_code;
      })
      .map((r) => r.package_main_code as string),
  );

  for (const [groupKey, members] of groups) {
    if (members.length === 0) continue;

    // Critério 1: código principal de pacote.
    let pool = members.filter((it) => it.procedure_code && packageMainCodes.has(it.procedure_code));
    let reason: MainReason | null = pool.length > 0 ? "codigo_principal_pacote" : null;

    // Critério 2: maior valor de tabela/convênio.
    if (pool.length === 0 || pool.length > 1) {
      const base = pool.length > 0 ? pool : members;
      const vals = base.map((it) => Number(it.procedure_amount ?? 0));
      const maxVal = Math.max(...vals);
      if (maxVal > 0) {
        const next = base.filter((it) => Number(it.procedure_amount ?? 0) === maxVal);
        if (next.length > 0 && next.length < base.length) {
          pool = next;
          reason = reason ?? "maior_valor_tabela";
        } else if (pool.length === 0) {
          pool = next;
          reason = "maior_valor_tabela";
        }
      }
    }

    // Critério 3: via de acesso principal/única.
    if (pool.length === 0 || pool.length > 1) {
      const base = pool.length > 0 ? pool : members;
      const isPrincipal = (it: ItemInput) => {
        const t = normName(it.access_route);
        return /(unica|única|principal)/.test(t);
      };
      const next = base.filter(isPrincipal);
      if (next.length > 0 && next.length < base.length) {
        pool = next;
        reason = reason ?? "via_principal_unica";
      } else if (pool.length === 0 && next.length > 0) {
        pool = next;
        reason = "via_principal_unica";
      }
    }

    // Critério 4: maior quantidade ou maior valor bruto.
    if (pool.length === 0 || pool.length > 1) {
      const base = pool.length > 0 ? pool : members;
      const qtys = base.map((it) => Number(it.quantity ?? 0));
      const maxQty = Math.max(...qtys);
      let next = base;
      if (maxQty > 0) {
        const byQty = base.filter((it) => Number(it.quantity ?? 0) === maxQty);
        if (byQty.length > 0 && byQty.length < base.length) next = byQty;
      }
      if (next.length > 1) {
        const grosses = next.map((it) => Number(it.gross_amount ?? 0));
        const maxGross = Math.max(...grosses);
        const byGross = next.filter((it) => Number(it.gross_amount ?? 0) === maxGross);
        if (byGross.length > 0) next = byGross;
      }
      if (next.length > 0 && (pool.length === 0 || next.length < pool.length)) {
        pool = next;
        reason = reason ?? "maior_quantidade_ou_bruto";
      }
    }

    // Fallback: se ainda vazio, usa todos os membros.
    if (pool.length === 0) pool = members;

    const ambiguous = pool.length > 1;
    if (ambiguous) reason = "ambiguo";

    // Marca o(s) item(ns) escolhido(s) e os demais.
    const winnerIds = new Set(pool.map((it) => it.id));
    for (const it of members) {
      byItemId.set(it.id, {
        groupKey,
        isMain: winnerIds.has(it.id),
        reason: winnerIds.has(it.id) ? reason : null,
        ambiguous: ambiguous && winnerIds.has(it.id),
      });
    }
  }

  return { byItemId };
}
