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
  // ===== Eixo "convênio" (matching determinístico por operadora) =====
  /**
   * (Legado) Nome principal do convênio. Mantido como tag adicional na lista
   * de convênios da regra para retrocompatibilidade. Novas regras devem usar
   * apenas `agreement_aliases` como lista única de tags.
   */
  agreement_name?: string | null;
  /**
   * Lista de convênios (tags livres) que parametrizam a regra junto com
   * `agreement_match_mode`. Comparação case/acento-insensitive e tolerante
   * a espaços (ex.: "Sul América" = "SULAMERICA").
   */
  agreement_aliases?: string[] | null;
  /**
   * Modo de aplicação:
   *   - 'whitelist' (padrão): regra aplica APENAS quando o convênio do item
   *     bater com uma das tags. Lista vazia = aplica a todos.
   *   - 'blacklist': regra aplica a TODOS os convênios EXCETO os listados.
   *     Lista vazia = aplica a todos.
   */
  agreement_match_mode?: "whitelist" | "blacklist" | null;
  /**
   * IDs de reference_tables (purpose IN ('sem_acordo','exclusao')) vinculadas
   * a esta regra. Camada 2: quando o item bate na regra e o código TUSS está
   * em uma dessas tabelas, o motor pula o cálculo. Tabelas só têm efeito
   * quando explicitamente vinculadas — nada de varredura global.
   */
  exception_table_ids?: string[] | null;
  /**
   * Itens de cálculo (1:N). Quando preenchido, o motor itera sobre cada item
   * que satisfizer as condições (período/dia/horário/etc) e SOMA os resultados.
   * Quando vazio/ausente, o motor cai no comportamento legado e usa os campos
   * de cálculo na própria regra.
   */
  calculations?: RuleCalculationItem[] | null;
}

export interface RuleCalculationItem {
  id?: string;
  label?: string | null;
  calculation_type: CalculationType;
  // ---- condições vinculadas ao cálculo ----
  time_mode?: string | null;         // 'qualquer' | 'comercial' | 'noturno' | 'fim_de_semana' | 'personalizado' | ...
  time_start?: string | null;        // 'HH:MM'
  time_end?: string | null;          // 'HH:MM'
  weekdays?: number[] | null;        // 0..6 (Dom..Sáb)
  includes_holidays?: boolean | null;
  elective_mode?: string | null;     // 'qualquer' | 'eletivo' | 'urgencia'
  // ---- parâmetros de cálculo (espelham os da regra) ----
  convenio_percentage?: number | null;
  fixed_amount?: number | null;
  package_amount?: number | null;
  package_main_code?: string | null;
  package_included_codes?: string[] | null;
  package_visits_count?: boolean | null;
  package_opinions_count?: boolean | null;
  package_auxiliaries_included?: boolean | null;
  package_subtype?: string | null;
  extras_codes?: string[] | null;
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
  /** Convênio/operadora lido da base (header "Convênio"). */
  agreement_name?: string | null;
  /** Especialidade resolvida no import (header "Especialidade" ou cadastro do médico). */
  specialty?: string | null;
}

export interface PaymentContext {
  sectors: string[];
  specialties: string[];
  payment_type: string | null;
  reference_date: string;
}

export type RuleMatchPriority =
  | "convenio_especialidade_codigo"
  | "convenio_especialidade"
  | "convenio_codigo"
  | "convenio"
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
  | "sem_regra"
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
  /** Marca itens que não bateram em nenhuma regra (em nenhum nível) — exigem revisão humana. */
  needs_human_review?: boolean;
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
  /** Detalhamento por item de cálculo (quando a regra usa cálculos 1:N). */
  calculation_breakdown?: CalculationBreakdownEntry[];
  /** Trace de auditoria: regras candidatas avaliadas e motivo de descarte/vitória. */
  selection_trace?: SelectionTrace;
}

export interface CalculationBreakdownEntry {
  calc_id?: string | null;
  label: string;
  calculation_type: CalculationType;
  matched: boolean;
  /** Quando matched=false, motivo curto: 'dia_da_semana'|'horario'|'condicoes'. */
  skip_reason?: string | null;
  expected: number | null;
  explanation: string;
  alerts: string[];
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
  const links = r.group_company_links ?? [];
  const cids = r.group_company_ids ?? [];
  const docs = r.group_doctors ?? [];

  const matchDoctorList = (doctors: { name?: string; crm?: string }[]): boolean => {
    if (!doctors.length || !item.doctor_name) return false;
    const itemNm = normName(item.doctor_name);
    const itemCrm = onlyDigits(item.doctor_document);
    for (const d of doctors) {
      if (d?.name && normName(d.name) === itemNm) return true;
      if (d?.crm && itemCrm && onlyDigits(d.crm) === itemCrm) return true;
    }
    return false;
  };

  // Novo modelo: vínculos por empresa (linha-a-linha).
  if (links.length > 0) {
    for (const link of links) {
      if (!link?.company_id) continue;
      if (item.company_id !== link.company_id) continue;
      const ds = link.doctors ?? [];
      if (ds.length === 0) return true; // todos os médicos daquela empresa
      if (matchDoctorList(ds)) return true;
    }
    // Sem links de empresa casados, ainda permite "médicos avulsos" (sem empresa).
    if (docs.length > 0 && cids.length === 0) return matchDoctorList(docs);
    return false;
  }

  // Legado modo empresa.
  if (cids.length > 0) {
    const inCompany = !!(item.company_id && cids.includes(item.company_id));
    if (!inCompany) return false;
    if (docs.length === 0) return true;
    return matchDoctorList(docs);
  }

  // Legado modo médico avulso.
  if (docs.length > 0) return matchDoctorList(docs);

  // Sem vínculos de empresa nem médicos: regra de grupo sem alvo NÃO casa
  // com nada (proteção contra o bug onde "vazio = aplica a todos").
  return false;
}



// ---------- match por convênio ----------
/** Normaliza removendo acentos, caixa e TODOS os espaços para tolerar variações
 *  de escrita ("Sul América" = "SUL AMERICA" = "sulamerica"). */
const normAgreement = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");

/** Lista consolidada de tags da regra (aliases + nome principal legado). */
function ruleAgreementTags(r: RuleInput): string[] {
  const tags = Array.isArray(r.agreement_aliases) ? [...r.agreement_aliases] : [];
  if (r.agreement_name && r.agreement_name.trim()) tags.push(r.agreement_name.trim());
  return Array.from(new Set(tags.map(normAgreement).filter(Boolean)));
}

/**
 * A regra se aplica ao item considerando whitelist/blacklist:
 *  - sem tags                 → aplica a todos os convênios
 *  - whitelist + tags         → aplica APENAS se o convênio do item ∈ tags
 *  - blacklist + tags         → aplica a TODOS exceto os convênios em tags
 *  - blacklist sem convênio no item → aplica (não há o que excluir)
 *  - whitelist sem convênio no item → não aplica (não há como confirmar match)
 */
function targetsAgreement(r: RuleInput, item: ItemInput): boolean {
  const tags = ruleAgreementTags(r);
  if (tags.length === 0) return true;
  const mode = r.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist";
  const itemAg = normAgreement(item.agreement_name);
  if (mode === "whitelist") return !!itemAg && tags.includes(itemAg);
  // blacklist
  if (!itemAg) return true;
  return !tags.includes(itemAg);
}

/** A regra possui restrição explícita por convênio (= entra no eixo determinístico). */
export function ruleHasAgreement(r: RuleInput): boolean {
  return ruleAgreementTags(r).length > 0;
}

/**
 * Camada 1 — Gating por-regra de convênio.
 *
 * Após o motor identificar a regra vencedora pelos eixos (especialidade,
 * código TUSS, médico, empresa, grupo, setor) IGNORANDO convênio, esta função
 * decide se essa MESMA regra aceita o convênio do item:
 *  - whitelist + tags → só aplica se o convênio do item ∈ tags
 *  - blacklist + tags → não aplica se o convênio do item ∈ tags
 *  - sem tags         → aplica
 *
 * Cada regra é uma unidade autocontida: blacklists/whitelists de OUTRAS
 * regras NÃO interferem nesta decisão.
 */
export function ruleAcceptsItemAgreement(r: RuleInput, item: ItemInput): boolean {
  return targetsAgreement(r, item);
}

function ruleHasSpecialty(r: RuleInput): boolean {
  return Array.isArray(r.specialties) && r.specialties.length > 0;
}

function matchesItemSpecialty(r: RuleInput, item: ItemInput): boolean {
  const its = normName(item.specialty);
  if (!its) return false;
  const list = (r.specialties ?? []).map(normName);
  return list.includes(its);
}

// ---------- pré-filtro ----------
// Observação: especialidade NÃO é filtrada aqui — o `payments.specialties` é
// uma propriedade do pagamento (frequentemente vazia) enquanto a whitelist da
// regra é por item (`item.specialty`). O match correto é feito no nível de
// item dentro de `selectWinningRule` via `matchesItemSpecialty`.
export function preFilterRules(rules: RuleInput[], ctx: PaymentContext): RuleInput[] {
  return rules.filter((r) => {
    if (!r.active) return false;
    if (!isInValidity(r, ctx.reference_date)) return false;
    if (!intersectsAll(ruleSectors(r), ctx.sectors)) return false;
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
  trace?: SelectionTrace;
}

/**
 * Trace de auditoria do motor: para cada item, registra todas as regras
 * candidatas avaliadas, em qual nível, e por que cada uma foi descartada
 * ou venceu. É a base de auditoria — permite responder "por que essa
 * regra foi escolhida para esse item?" sem reexecutar o motor.
 */
export interface SelectionTrace {
  item_sector: string;
  is_hemo: boolean;
  levels: SelectionTraceLevel[];
  winner_rule_id: string | null;
  winner_priority: RuleMatchPriority;
}
export interface SelectionTraceLevel {
  level: RuleMatchPriority;
  bucket_size: number;
  candidates: SelectionTraceCandidate[];
  outcome: "winner" | "conflict" | "empty" | "skipped" | "all_filtered";
}
export interface SelectionTraceCandidate {
  rule_id: string;
  rule_name: string;
  with_code: boolean;
  result: "winner" | "tied" | "filtered_specialty" | "skipped";
  filter_reason?: string;
}

/**
 * Filtra a whitelist de especialidade da regra contra a especialidade do
 * ITEM (não do pagamento). Quando a regra não tem whitelist, aceita qualquer
 * item. Quando tem mas o item não traz especialidade, a regra é descartada.
 */
function ruleAcceptsItemSpecialty(r: RuleInput, item: ItemInput): boolean {
  if (!ruleHasSpecialty(r)) return true;
  if (!item.specialty) return false;
  return matchesItemSpecialty(r, item);
}

export function selectWinningRule(
  item: ItemInput,
  rules: RuleInput[],
  opts?: { collectTrace?: boolean },
): SelectionOutcome | null {
  const itemSector = inferItemSector(item);
  const isHemo = itemSector === "hemodinamica";
  const trace: SelectionTrace | undefined = opts?.collectTrace
    ? { item_sector: itemSector, is_hemo: isHemo, levels: [], winner_rule_id: null, winner_priority: "sem_regra" }
    : undefined;

  // Filtragem por especialidade aplicada por bucket, ANTES da decisão de
  // prioridade. Regra com whitelist que não bate com o item é descartada
  // como candidata e registrada no trace.
  const filterBySpecialty = (bucket: RuleInput[], levelLabel: RuleMatchPriority): RuleInput[] => {
    const kept: RuleInput[] = [];
    const dropped: SelectionTraceCandidate[] = [];
    for (const r of bucket) {
      if (ruleAcceptsItemSpecialty(r, item)) {
        kept.push(r);
      } else {
        dropped.push({
          rule_id: r.id,
          rule_name: r.name,
          with_code: hasCodeRestriction(r),
          result: "filtered_specialty",
          filter_reason: item.specialty
            ? `whitelist [${(r.specialties ?? []).join(", ")}] não inclui especialidade do item "${item.specialty}"`
            : `regra exige especialidade [${(r.specialties ?? []).join(", ")}], item sem especialidade`,
        });
      }
    }
    if (trace && dropped.length > 0) {
      trace.levels.push({
        level: levelLabel,
        bucket_size: bucket.length,
        candidates: dropped,
        outcome: kept.length === 0 ? "all_filtered" : "skipped",
      });
    }
    return kept;
  };

  const doctorRules  = filterBySpecialty(rules.filter((r) => targetsDoctor(r, item)), "medico");
  const companyRules = filterBySpecialty(rules.filter((r) => targetsCompany(r, item)), "empresa");
  const groupRules   = filterBySpecialty(rules.filter((r) => targetsGroup(r, item)), "grupo");
  const sectorRules  = filterBySpecialty(rules.filter((r) => r.scope === "master" && ruleSectors(r).includes(itemSector) && itemSector !== "outro"), "setor");
  const hemoMaster   = filterBySpecialty(rules.filter((r) => r.scope === "master" && ruleSectors(r).includes("hemodinamica")), "setor_hemodinamica_master");
  const generalMaster = filterBySpecialty(rules.filter((r) => r.scope === "master" && (ruleSectors(r).includes("outro") || ruleSectors(r).length === 0)), "setor_master_geral");

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

  const recordLevel = (
    level: RuleMatchPriority,
    bucketSize: number,
    pool: RuleInput[],
    winnerId: string | null,
    tied: RuleInput[],
    outcome: SelectionTraceLevel["outcome"],
  ) => {
    if (!trace) return;
    trace.levels.push({
      level,
      bucket_size: bucketSize,
      candidates: pool.map((r) => ({
        rule_id: r.id,
        rule_name: r.name,
        with_code: hasCodeRestriction(r),
        result:
          winnerId === r.id ? "winner" :
          tied.some((t) => t.id === r.id) ? "tied" : "skipped",
      })),
      outcome,
    });
  };

  for (const lvl of levels) {
    if (lvl.enabled === false) continue;
    const withCode = lvl.bucket.filter((r) => hasCodeRestriction(r) && matchesProcedureCode(r, item));
    if (withCode.length > 0) {
      const { winner, tied } = breakTie(withCode);
      if (winner) {
        recordLevel(lvl.withCodePriority, lvl.bucket.length, withCode, winner.id, [], "winner");
        if (trace) { trace.winner_rule_id = winner.id; trace.winner_priority = lvl.withCodePriority; }
        return { rule: winner, priority: lvl.withCodePriority, trace };
      }
      recordLevel(lvl.withCodePriority, lvl.bucket.length, withCode, null, tied, "conflict");
      return {
        rule: null,
        priority: "conflito",
        conflict: {
          candidate_rule_ids: tied.map((r) => r.id),
          reason: `Conflito de regras no nível ${lvl.withCodePriority}: ${tied.length} regras empatadas após desempate por severidade e vigência.`,
        },
        trace,
      };
    }
    const withoutCode = lvl.bucket.filter((r) => !hasCodeRestriction(r));
    if (withoutCode.length > 0) {
      const { winner, tied } = breakTie(withoutCode);
      if (winner) {
        recordLevel(lvl.withoutCodePriority, lvl.bucket.length, withoutCode, winner.id, [], "winner");
        if (trace) { trace.winner_rule_id = winner.id; trace.winner_priority = lvl.withoutCodePriority; }
        return { rule: winner, priority: lvl.withoutCodePriority, trace };
      }
      recordLevel(lvl.withoutCodePriority, lvl.bucket.length, withoutCode, null, tied, "conflict");
      return {
        rule: null,
        priority: "conflito",
        conflict: {
          candidate_rule_ids: tied.map((r) => r.id),
          reason: `Conflito de regras no nível ${lvl.withoutCodePriority}: ${tied.length} regras empatadas após desempate por severidade e vigência.`,
        },
        trace,
      };
    }
  }
  if (trace) return { rule: null, priority: "sem_regra", trace };
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
interface ExpectedCalc { expected: number | null; explanation: string; alerts: string[]; breakdown?: CalculationBreakdownEntry[]; }

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

export type ReferenceTableLookup = (referenceTableId: string, procedureCode: string) => number | null;

/**
 * Camada 2: dado um id de tabela de exceção (sem_acordo/exclusao) e um código
 * TUSS, retorna metadados se o código está nessa tabela; null caso contrário.
 */
export type ExceptionTableLookup = (
  referenceTableId: string,
  procedureCode: string,
) => { table_name: string; purpose: "sem_acordo" | "exclusao"; reason: string | null } | null;

export interface EngineCtx {
  appliedAttendancesByRule: Map<string, Set<string>>;
  referenceLookup?: ReferenceTableLookup;
  exceptionLookup?: ExceptionTableLookup;
}

/**
 * Verifica se um item de cálculo se aplica ao item, considerando as condições
 * vinculadas (período/dia/horário/eletivo). Quando uma condição não está
 * configurada (modo "qualquer"/vazio), ela é considerada satisfeita.
 */
export function calcItemMatches(c: RuleCalculationItem, item: ItemInput): { ok: true } | { ok: false; reason: string } {
  // Dia da semana
  const wds = Array.isArray(c.weekdays) ? c.weekdays : [];
  if (wds.length > 0 && item.procedure_date) {
    const d = new Date(item.procedure_date);
    if (!Number.isNaN(d.getTime())) {
      if (!wds.includes(d.getDay())) return { ok: false, reason: "dia_da_semana" };
    }
  }
  // Janela horária
  if (c.time_start && c.time_end && item.procedure_date) {
    const d = new Date(item.procedure_date);
    if (!Number.isNaN(d.getTime())) {
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const s = c.time_start, e = c.time_end;
      const inside = s <= e ? (hhmm >= s && hhmm <= e) : (hhmm >= s || hhmm <= e);
      if (!inside) return { ok: false, reason: "horario" };
    }
  }
  return { ok: true };
}

/** Projeta um item de cálculo sobre a regra, criando uma "regra efetiva" para
 *  reutilizar os calculadores legados. */
function ruleFromCalcItem(rule: RuleInput, c: RuleCalculationItem): RuleInput {
  return {
    ...rule,
    calculation_type: c.calculation_type,
    convenio_percentage: c.convenio_percentage ?? rule.convenio_percentage,
    fixed_amount: c.fixed_amount ?? rule.fixed_amount,
    package_amount: c.package_amount ?? rule.package_amount,
    package_main_code: c.package_main_code ?? rule.package_main_code,
    package_included_codes: c.package_included_codes ?? rule.package_included_codes,
    package_visits_count: c.package_visits_count ?? rule.package_visits_count,
    package_opinions_count: c.package_opinions_count ?? rule.package_opinions_count,
    package_auxiliaries_included: c.package_auxiliaries_included ?? rule.package_auxiliaries_included,
    package_subtype: c.package_subtype ?? rule.package_subtype,
    extras_codes: c.extras_codes ?? rule.extras_codes,
    reference_table_id: c.reference_table_id ?? rule.reference_table_id,
    multiplier: c.multiplier ?? rule.multiplier,
    deflator_pct: c.deflator_pct ?? rule.deflator_pct,
    repasse_pct: c.repasse_pct ?? rule.repasse_pct,
    apply_access_route: c.apply_access_route ?? rule.apply_access_route,
    include_auxiliaries: c.include_auxiliaries ?? rule.include_auxiliaries,
    auxiliary_pct: c.auxiliary_pct ?? rule.auxiliary_pct,
    aux_first_pct: c.aux_first_pct ?? rule.aux_first_pct,
    aux_second_pct: c.aux_second_pct ?? rule.aux_second_pct,
    instrumentador_pct: c.instrumentador_pct ?? rule.instrumentador_pct,
    bonus_amount: c.bonus_amount ?? rule.bonus_amount,
    bonus_pct: c.bonus_pct ?? rule.bonus_pct,
    target_amount: c.target_amount ?? rule.target_amount,
  };
}

export function applyCalculation(
  rule: RuleInput,
  item: ItemInput,
  ctx?: EngineCtx,
): ExpectedCalc {
  // ---- NOVO: itens de cálculo (1:N) ----
  const list = Array.isArray(rule.calculations) ? rule.calculations : [];
  if (list.length > 0) {
    const breakdown: CalculationBreakdownEntry[] = [];
    let sum = 0;
    let anyMatched = false;
    let anyNullMatched = false;
    const aggAlerts: string[] = [];
    const matchedExplanations: string[] = [];

    for (const c of list) {
      const label = (c.label && c.label.trim()) || c.calculation_type;
      const m = calcItemMatches(c, item);
      if (!m.ok) {
        breakdown.push({
          calc_id: c.id ?? null,
          label,
          calculation_type: c.calculation_type,
          matched: false,
          skip_reason: m.reason,
          expected: null,
          explanation: `Não aplicado — condição "${m.reason}" não satisfeita.`,
          alerts: [],
        });
        continue;
      }
      anyMatched = true;
      const eff = ruleFromCalcItem(rule, c);
      const r = applyCalculationSingle(eff, item, ctx);
      const prefixedAlerts = r.alerts.map((a) => `[${label}] ${a}`);
      breakdown.push({
        calc_id: c.id ?? null,
        label,
        calculation_type: c.calculation_type,
        matched: true,
        expected: r.expected,
        explanation: r.explanation,
        alerts: prefixedAlerts,
      });
      aggAlerts.push(...prefixedAlerts);
      matchedExplanations.push(`[${label}] ${r.explanation}`);
      if (r.expected == null) anyNullMatched = true;
      else sum += r.expected;
    }

    if (!anyMatched) {
      return {
        expected: null,
        explanation: `Regra "${rule.name}" possui ${list.length} cálculo(s), mas nenhum satisfez as condições deste item.`,
        alerts: ["Nenhum item de cálculo da regra se aplica a este item."],
        breakdown,
      };
    }

    if (anyNullMatched && sum === 0) {
      return { expected: null, explanation: matchedExplanations.join(" + "), alerts: aggAlerts, breakdown };
    }
    const expected = Number(sum.toFixed(2));
    const header = matchedExplanations.length > 1 ? `Soma de ${matchedExplanations.length} cálculos` : "1 cálculo";
    return {
      expected,
      explanation: `${header}: ${matchedExplanations.join(" + ")} = R$ ${expected.toFixed(2)}${anyNullMatched ? " (alguns cálculos sem valor base)" : ""}`,
      alerts: aggAlerts,
      breakdown,
    };
  }
  // ---- LEGADO: campos diretos na regra ----
  return applyCalculationSingle(rule, item, ctx);
}

function applyCalculationSingle(
  rule: RuleInput,
  item: ItemInput,
  ctx?: EngineCtx,
): ExpectedCalc {
  if (rule.rule_type === "tabela_diferenciada" && rule.reference_table_id) {
    return calcTabelaDiferenciada(rule, item, ctx?.referenceLookup);
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
      const map = ctx?.appliedAttendancesByRule ?? new Map<string, Set<string>>();
      let set = map.get(rule.id);
      if (!set) { set = new Set<string>(); map.set(rule.id, set); }
      return calcPacotePorAtendimento(rule, item, set);
    }
    case "valor_fixo":                return calcValorFixo(rule);
    case "exclusao":                  return calcExclusao(rule);
    case "informativo":               return calcInformativo();
    case "tabela_referencia":         return calcTabelaDiferenciada(rule, item, ctx?.referenceLookup);
    case "tabela_diferenciada":       return calcTabelaDiferenciada(rule, item, ctx?.referenceLookup);
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
 * Tabela diferenciada: busca o valor base na TABELA DE REFERÊNCIA vinculada
 * à regra (por código TUSS do item) e aplica os parâmetros da regra.
 * NÃO depende de `procedure_amount` da planilha.
 * Ordem correta: tabela → multiplicador → via/função (auxiliares) → repasse → deflator
 *
 * Fallback: se a regra não tiver `reference_table_id` (ou lookup ausente),
 * usa `procedure_amount` como aproximação (compatibilidade).
 */
function calcTabelaDiferenciada(
  rule: RuleInput,
  item: ItemInput,
  lookup?: ReferenceTableLookup,
): ExpectedCalc {
  let base: number | null = null;
  let baseLabel = "valor_tabela_referencia";
  let baseSource = "";

  if (rule.reference_table_id && lookup) {
    const code = (item.procedure_code ?? "").toString().trim();
    if (!code) {
      return {
        expected: null,
        explanation: "Tabela diferenciada — item sem código TUSS para busca na tabela de referência.",
        alerts: ["Item sem código TUSS — não é possível buscar na tabela de referência."],
      };
    }
    const v = lookup(rule.reference_table_id, code);
    if (v == null) {
      return {
        expected: null,
        explanation: `Tabela diferenciada — código ${code} não encontrado na tabela de referência vinculada à regra.`,
        alerts: [`Código ${code} não encontrado na tabela de referência.`],
      };
    }
    base = v;
    baseSource = ` (tabela ref., código ${code})`;
  } else {
    base = item.procedure_amount;
    baseLabel = "procedure_amount";
    if (base == null) {
      return {
        expected: null,
        explanation: "Tabela diferenciada — valor base ausente (sem tabela vinculada e sem procedure_amount).",
        alerts: ["Tabela diferenciada sem tabela de referência vinculada e sem valor base no item."],
      };
    }
  }

  const mult = rule.multiplier ?? 1;
  const defl = rule.deflator_pct ?? 0;
  const rep  = rule.repasse_pct ?? 100;

  // 1) base × multiplicador
  let value = base * mult;
  const parts: string[] = [
    `${baseLabel} R$ ${base.toFixed(2)}${baseSource}`,
    `× mult ${mult}`,
  ];

  // 2) função do médico (auxiliar/instrumentador) e via de acesso são fatores
  //    INDEPENDENTES — quando ambos os checkboxes estão ativos, multiplicam juntos.
  if (rule.include_auxiliaries) {
    const role = classifyDoctorRole(item.doctor_role);
    if (role === "instrumentador") {
      const pct = (rule.instrumentador_pct ?? 10) / 100;
      value *= pct;
      parts.push(`× instrumentador ${(pct * 100).toFixed(0)}%`);
    } else if (role === "primeiro_aux") {
      const pct = (rule.aux_first_pct ?? 30) / 100;
      value *= pct;
      parts.push(`× 1º aux ${(pct * 100).toFixed(0)}%`);
    } else if (role === "demais_aux") {
      const pct = (rule.aux_second_pct ?? 20) / 100;
      value *= pct;
      parts.push(`× aux 2+ ${(pct * 100).toFixed(0)}%`);
    }
  }
  if (rule.apply_access_route) {
    const f = accessRouteFactor(item.access_route);
    value *= f;
    parts.push(`× via(${(f * 100).toFixed(0)}%)`);
  }

  // 3) repasse (% do convênio repassado), se configurado < 100
  if (rep !== 100) {
    value *= (rep / 100);
    parts.push(`× repasse ${rep}%`);
  }

  // 4) deflator/glosa por último
  if (defl !== 0) {
    value *= (1 - defl / 100);
    parts.push(`× (1 − deflator ${defl}%)`);
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
  ctx?: EngineCtx,
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

  const outcome = selectWinningRule(item, preFilteredRules, { collectTrace: true });
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

    // === Camada 1 — Gating por-regra de convênio ===
    // A vencedora foi escolhida pelos eixos (especialidade/código/médico/
    // empresa/grupo/setor) sem considerar convênio. Agora validamos se a
    // PRÓPRIA regra aceita o convênio do item (whitelist/blacklist dela).
    // Se não aceita → o item cai no fallback (default por setor) com alerta
    // explicando qual regra/blacklist disparou. Outras regras NÃO são
    // consultadas — cada regra é uma unidade autocontida.
    if (ruleHasAgreement(winner) && !ruleAcceptsItemAgreement(winner, item)) {
      const mode = winner.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist";
      const motivo = mode === "blacklist"
        ? `Convênio "${item.agreement_name ?? "—"}" está na blacklist da regra "${winner.name}".`
        : `Convênio "${item.agreement_name ?? "—"}" não satisfaz a whitelist da regra "${winner.name}".`;
      const paid = Number(item.gross_amount ?? 0);
      return {
        item_id: item.id,
        status: "aprovado",
        expected_amount: paid,
        diff_pct: 0,
        matched_rule_id: null,
        matched_rule_name: `Camada 1 — Bloqueio de convênio: ${winner.name}`,
        matched_priority: "sem_regra",
        calculation_type_used: "informativo",
        calculation_explanation:
          `Bloqueado pela Camada 1 (${motivo}) — sem acordo para esta combinação. ` +
          `Sistema não tem acesso à tabela interna do convênio; aceita o valor pago como esperado (R$ ${paid.toFixed(2)}).`,
        alerts: [
          `${motivo} Regra de cálculo não aplicada — esperado = valor pago pelo convênio.`,
        ],
        needs_ai_review: false,
        needs_human_review: false,
      };
    }

    // === Camada 2 — Tabelas de exceção VINCULADAS à regra ===
    // Princípio: tabelas são entidades dormentes. Só atuam quando a regra
    // vencedora declara `exception_table_ids` e o código TUSS está em uma
    // delas. Não há varredura global. Quando bloqueia: aceita o valor pago
    // como esperado e marca o item como "aprovado" — comportamento esperado,
    // não erro a auditar (sistema não tem a tabela interna do convênio).
    {
      const linkedIds = Array.isArray(winner.exception_table_ids) ? winner.exception_table_ids : [];
      const code = (item.procedure_code ?? "").trim();
      if (linkedIds.length > 0 && code && ctx?.exceptionLookup) {
        let hit: { table_name: string; purpose: "sem_acordo" | "exclusao"; reason: string | null } | null = null;
        for (const tid of linkedIds) {
          const h = ctx.exceptionLookup(tid, code);
          if (h) { hit = h; break; }
        }
        if (hit) {
          const motivo = hit.reason ? ` (motivo: ${hit.reason})` : "";
          const purposeLabel = hit.purpose === "sem_acordo" ? "Sem acordo" : "Exclusão";
          const paid = Number(item.gross_amount ?? 0);
          return {
            item_id: item.id,
            status: "aprovado",
            expected_amount: paid,
            diff_pct: 0,
            matched_rule_id: winner.id,
            matched_rule_name: `Camada 2 — ${purposeLabel}: ${hit.table_name} (via regra "${winner.name}")`,
            matched_priority: "sem_regra",
            calculation_type_used: "informativo",
            calculation_explanation:
              `Bloqueado pela Camada 2 — código TUSS ${code} consta na tabela "${hit.table_name}" ` +
              `(${purposeLabel.toLowerCase()}) vinculada à regra "${winner.name}"${motivo}. ` +
              `Regra de cálculo ignorada — esperado = valor pago pelo convênio (R$ ${paid.toFixed(2)}).`,
            alerts: [
              `Código ${code} em tabela "${hit.table_name}" (${purposeLabel.toLowerCase()}) vinculada à regra "${winner.name}"${motivo} — cálculo não aplicado.`,
            ],
            needs_ai_review: false,
            needs_human_review: false,
          };
        }
      }
    }


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
    // Sem regra específica → fallback determinístico (default por setor:
    // hemodinâmica = 88%, demais = 100%). Esse é o COMPORTAMENTO ESPERADO,
    // não uma exceção: se o valor pago bater com o default, o item é
    // aprovado normalmente. O alerta só aparece se houver divergência real
    // (tratada por classifyDiff abaixo). A rastreabilidade fica no
    // calculation_explanation e no calculation_type_used.
    const def = calcDefault(item);
    calc = def;
    priority = "default_setor";
    calculation_type_used = def.calculation_type_used;
  }

  // Multiplicação final pela quantidade do item (coluna "Quantidade" da base).
  // Aplica a TODOS os tipos de cálculo: o esperado é por unidade × qtd.
  const qty = Number(item.quantity ?? 1);
  if (calc.expected != null && Number.isFinite(qty) && qty > 0 && qty !== 1) {
    const before = calc.expected;
    calc.expected = Number((before * qty).toFixed(2));
    calc.explanation = `${calc.explanation} × qtd ${qty} = R$ ${calc.expected.toFixed(2)}`;
  }

  let { status, diff_pct } = classifyDiff(calc.expected, item.gross_amount);
  if (priority === "conflito") status = "alerta";
  if (priority === "sem_regra") status = "alerta";
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
    needs_human_review: priority === "sem_regra" || priority === "conflito",
    ...(conflict ? { conflict } : {}),
    ...(calc.breakdown ? { calculation_breakdown: calc.breakdown } : {}),
    ...(outcome?.trace ? { selection_trace: outcome.trace } : {}),
  };
}

export function analyzePaymentItems(
  items: ItemInput[],
  rules: RuleInput[],
  ctx: PaymentContext,
  options?: { referenceLookup?: ReferenceTableLookup; exceptionLookup?: ExceptionTableLookup },
): AnalysisResult[] {
  const filtered = preFilterRules(rules, ctx);
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
  const state: EngineCtx = {
    appliedAttendancesByRule: new Map<string, Set<string>>(),
    referenceLookup: options?.referenceLookup,
    exceptionLookup: options?.exceptionLookup,
  };
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
