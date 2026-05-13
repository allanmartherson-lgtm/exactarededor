/**
 * Motor determinístico de seleção e cálculo de regras de pagamento (Fase 2).
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
 *   9. setor_master_geral (master absoluto de fallback)
 */

// ReferenceTableLookup e ExceptionTableLookup movidos para EngineCtx para evitar duplicidade


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
  sectors: string[] | null;
  specialties: string[] | null;
  target_type: "medico" | "empresa" | null;
  target_identifier: string | null;
  target_name: string | null;
  target_company_id: string | null;
  procedure_codes: string[] | null;
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
  /**
   * Vínculos por empresa (escopo "grupo"). Cada item: empresa + (opcional) lista de médicos.
   * Se `doctors` estiver vazio → aplica a todos médicos daquela empresa.
   * Se preenchido → aplica somente aos médicos listados naquela empresa.
   */
  group_company_links?: { company_id: string; doctors?: { name?: string; crm?: string }[] }[] | null;
  /**
   * Médicos avulsos (sem PJ). Casa por nome+CRM em qualquer empresa do item.
   * Útil para acordos pessoais que seguem o médico independente do CNPJ que faturar.
   */
  group_doctors?: { name?: string; crm?: string }[] | null;
  bonus_amount?: number | null;
  bonus_pct?: number | null;
  target_amount?: number | null;
  // Exclusão / não pagar
  exclusion_reason?: string | null;
  allows_authorized_exception?: boolean | null;
  /** Se verdadeiro, o motor ignora a coluna quantidade do item e considera o valor calculado como total. */
  force_totalized?: boolean | null;
  /** Unidade de aplicação no nível da regra (fallback quando o item de cálculo não define). */
  application_unit?: "por_item" | "por_atendimento" | "por_paciente_dia" | null;
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
   * Lista de vias de acesso permitidas (ex: 'Única ou principal').
   * Se preenchido, a regra só dá match se o item tiver uma dessas vias.
   */
  allowed_access_routes?: string[] | null;
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
  limiar_alerta_tipo?: "percentual" | "absoluto" | null;
  limiar_alerta_valor?: number | null;
  limiar_bloqueio_tipo?: "percentual" | "absoluto" | null;
  limiar_bloqueio_valor?: number | null;
}

export interface RuleCalculationItem {
  id?: string;
  label?: string | null;
  /** Ordem do item dentro da regra (0,1,2…). O motor processa em ordem
   *  crescente — o PRIMEIRO item cujas condições casarem e produzir um
   *  valor calculado define o resultado (exclusividade). */
  sort_order?: number | null;
  calculation_type: CalculationType;
  // ---- condições vinculadas ao cálculo ----
  time_mode?: string | null;         // 'qualquer' | 'comercial' | 'noturno' | 'fim_de_semana' | 'personalizado' | ...
  time_start?: string | null;        // 'HH:MM'
  time_end?: string | null;          // 'HH:MM'
  weekdays?: number[] | null;        // 0..6 (Dom..Sáb)
  includes_holidays?: boolean | null;
  elective_mode?: string | null;     // 'qualquer' | 'eletivo' | 'urgencia'
  /** Vias de acesso permitidas para este item de cálculo específico. */
  allowed_access_routes?: string[] | null;
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
  /** Se verdadeiro, ignora a quantidade para este item de cálculo específico. */
  force_totalized?: boolean | null;
  /**
   * Unidade de aplicação do cálculo (usado principalmente em bônus):
   * - "por_item" (default): aplica em cada linha que casar.
   * - "por_atendimento": aplica 1× por grupo de atendimento (anchor = procedimento principal).
   * - "por_paciente_dia": idem, mas usa paciente+data quando não há attendance_number.
   */
  application_unit?: "por_item" | "por_atendimento" | "por_paciente_dia" | null;
  // ===== Filtros restritivos por cálculo (refactor "tudo no cálculo") =====
  /** Lista de códigos TUSS/CBHPM aos quais este cálculo se aplica. Vazio = qualquer código. */
  procedure_codes?: string[] | null;
  /** Modo de comparação dos códigos: 'whitelist' (só esses), 'blacklist' (todos menos esses), 'any' (ignora). */
  code_match_mode?: "whitelist" | "blacklist" | "any" | null;
  /** Funções do médico (cirurgiao, primeiro_aux, demais_aux, instrumentador) — vazio = qualquer função. */
  doctor_roles?: string[] | null;
  /** Lista de convênios que este cálculo aceita/bloqueia (mesmo formato da regra). */
  agreement_aliases?: string[] | null;
  /** Modo do filtro de convênio: 'whitelist' | 'blacklist'. Se ausente, herda da regra-pai. */
  agreement_match_mode?: "whitelist" | "blacklist" | null;
  /** Setores aplicáveis (vazio = qualquer). */
  sectors?: string[] | null;
  /** Especialidades aplicáveis (vazio = qualquer). */
  specialties?: string[] | null;
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
  /** Se verdadeiro, o valor base (procedure_amount) já é o total (Unitário * Qtd). */
  convenio_value_totalized?: boolean | null;
  /** Especialidade resolvida no import (header "Especialidade" ou cadastro do médico). */
  specialty?: string | null;
  /** Setor informado na planilha (opcional). */
  sector?: string | null;
}

export interface PaymentContext {
  sectors: string[];
  specialties: string[];
  payment_type: string | null;
  reference_date: string;
  globalExceptionTableIds?: string[];
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
  | "regra_bloqueio"
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
  /** Unidade de aplicação efetivamente usada (do calc item ou da regra). */
  application_unit_used?: "por_item" | "por_atendimento" | "por_paciente_dia" | null;
  /** Se este resultado foi suprimido por dedup (já contado em outro item do mesmo atendimento). */
  suppressed_by_dedup?: boolean;
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

const SECTOR_MAP: Record<string, string> = {
  "cirurgia": "cirurgia",
  "centro cirurgico": "cirurgia",
  "cc": "cirurgia",
  "hemodinamica": "hemodinamica",
  "parecer": "parecer",
  "visita": "visita",
  "consulta": "consulta",
  "procedimento": "procedimento",
  "ambulatorial": "procedimento",
};

export function inferItemSector(item: ItemInput, ctx?: PaymentContext): string {
  // 1. Prioridade máxima: setor informado na planilha (se for um valor útil)
  if (item.sector) {
    const s = normName(item.sector);
    // "Outros" ou similar é ignorado para permitir que heurísticas/TUSS/Pagamento encontrem o setor real
    if (s !== "outro" && s !== "outros") {
      if (SECTOR_MAP[s]) return SECTOR_MAP[s];
      for (const [k, v] of Object.entries(SECTOR_MAP)) {
        if (s.includes(k)) return v;
      }
      return s;
    }
  }

  // 2. Segunda prioridade: se o lote/pagamento tem UM ÚNICO setor definido, usamos ele
  if (ctx && Array.isArray(ctx.sectors) && ctx.sectors.length === 1) {
    return ctx.sectors[0];
  }

  // 3. Classificação determinística pré-aplicada (ex.: tabela_procedimentos_hemodinamica)
  if (item.classification_sector) return item.classification_sector;

  // 4. Heurística baseada em nomes
  const txt = normName(`${item.procedure_name ?? ""} ${item.description ?? ""}`);
  if (/(hemodin|cateter|angiopl|stent|coronari)/.test(txt)) return "hemodinamica";
  if (/(cirurg|operac|herni|colecist|laparo|artrosc|tue\b)/.test(txt)) return "cirurgia";
  if (/parecer/.test(txt)) return "parecer";
  if (/visita/.test(txt)) return "visita";
  if (/consulta/.test(txt)) return "consulta";
  if (/procediment/.test(txt)) return "procedimento";

  // 5. Fallback final: se o pagamento tem múltiplos setores, usa o primeiro como palpite
  if (ctx && Array.isArray(ctx.sectors) && ctx.sectors.length > 0) {
    return ctx.sectors[0];
  }

  return "outro";
}

function ruleSectors(r: RuleInput): string[] {
  if (Array.isArray(r.sectors) && r.sectors.length > 0) return r.sectors;
  return [];
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

/** Coleta de códigos a partir dos cálculos da regra (nível raiz é legado).
 *  - hasAnyCodes: existe pelo menos um cálculo com whitelist/blacklist de códigos
 *  - hasFallback: existe pelo menos um cálculo SEM restrição de código (aceita qualquer)
 *  - allCodes: união dos códigos declarados em modo whitelist nos cálculos
 */
function collectCalcCodes(r: RuleInput): { hasAnyCodes: boolean; hasFallback: boolean; allCodes: string[] } {
  const calcs = (Array.isArray((r as any).calculations) ? (r as any).calculations : []) as RuleCalculationItem[];
  let hasAnyCodes = false;
  let hasFallback = false;
  const allCodes = new Set<string>();
  // Legado nível raiz (deve estar vazio após migração; mantido por defesa)
  if (Array.isArray(r.procedure_codes) && r.procedure_codes.length > 0) {
    hasAnyCodes = true;
    r.procedure_codes.forEach((c) => allCodes.add(c));
  }
  if (calcs.length === 0) {
    if (!Array.isArray(r.procedure_codes) || r.procedure_codes.length === 0) hasFallback = true;
    return { hasAnyCodes, hasFallback, allCodes: Array.from(allCodes) };
  }
  for (const c of calcs) {
    const codes = Array.isArray(c.procedure_codes) ? c.procedure_codes : [];
    const mode = c.code_match_mode ?? "whitelist";
    if (codes.length === 0 || mode === "any") {
      hasFallback = true;
    } else {
      hasAnyCodes = true;
      if (mode !== "blacklist") codes.forEach((x) => allCodes.add(x));
    }
  }
  return { hasAnyCodes, hasFallback, allCodes: Array.from(allCodes) };
}

function matchesProcedureCode(r: RuleInput, item: ItemInput): boolean {
  const info = collectCalcCodes(r);
  if (!info.hasAnyCodes) return true;          // sem restrição → aceita
  if (info.hasFallback) return true;           // tem cálculo "qualquer" → aceita
  if (!item.procedure_code) return false;
  return info.allCodes.includes(item.procedure_code);
}

function hasCodeRestriction(r: RuleInput): boolean {
  const info = collectCalcCodes(r);
  return info.hasAnyCodes && !info.hasFallback;
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
  const s = (role ?? "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!s) return "outro";
  if (s.includes("instrument")) return "instrumentador";
  if (s.includes("cirurgi") || s.includes("operador")) return "cirurgiao";
  
  // 2º / 3º / segundo / terceiro / etc + aux (deve vir ANTES do match de 1º)
  // Ordem importa: 2º casa com /2/ mas não com /^1/
  if (/(2[ºo]|2\b|segund|3[ºo]|3\b|terceir|quart|quint)/.test(s) && (s.includes("aux") || s.includes("ajudante"))) {
    return "demais_aux";
  }
  
  // 1º / primeiro / 1
  if (/(^|\b)(1[ºo]|1\b|primeir)/.test(s) && (s.includes("aux") || s.includes("ajudante"))) {
    return "primeiro_aux";
  }
  
  if (s.includes("aux") || s.includes("ajudante")) return "primeiro_aux"; // sem ordinal explícito → trata como 1º
  return "outro";
}

function targetsGroup(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "grupo") return false;
  const links = r.group_company_links ?? [];
  const looseDoctors = r.group_doctors ?? [];

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

  // Match por médico avulso (independente da PJ): segue o médico em qualquer empresa.
  if (looseDoctors.length > 0 && matchDoctorList(looseDoctors)) return true;

  // Vínculos por empresa: empresa do item precisa estar na lista; se a lista de
  // médicos do link estiver vazia, vale para toda a equipe da PJ.
  for (const link of links) {
    if (!link?.company_id) continue;
    if (item.company_id !== link.company_id) continue;
    const ds = link.doctors ?? [];
    if (ds.length === 0) return true;
    if (matchDoctorList(ds)) return true;
  }

  return false;
}



// ---------- match por convênio ----------
/** Normaliza removendo acentos, caixa e TODOS os espaços para tolerar variações
 *  de escrita ("Sul América" = "SUL AMERICA" = "sulamerica"). */
const normAgreement = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");

/**
 * Normaliza vias de acesso para tolerar variações de escrita e abreviações comuns.
 * "Única ou principal" = "unica/principal" = "unica ou principal" = "unica"
 */
export function normAccessRoute(s: string | null | undefined): string {
  const n = (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!n) return "";
  
  // Mapeamento de variações comuns para termos canônicos
  // Importante: a ordem aqui importa para não pegar substrings erradas
  if (/(unica\s?ou\s?principal|unica\s?\/\s?principal|unica\s?e\s?principal|1[aª]\s?via\s?principal|principal)/i.test(n)) {
    return "unica_principal";
  }
  
  if (/(unica|1[aª]|1[.\s]?via|primeira\s?via|1\.[aª]\s?via)/i.test(n)) {
    return "unica_principal";
  }

  if (/(mesma\s?via|repetida|mesma\s?via\s?de\s?acesso)/.test(n)) {
    return "mesma_via";
  }
  
  if (n === "mesma") return "mesma_via";

  if (/(outra\s?via|via\s?diferente|diferente|2[aª]|segunda\s?via|via\s?de\s?acesso\s?diferente)/.test(n)) {
    return "outra_via";
  }

  // Tratamento específico para strings compostas de REGRAS (não de ITENS)
  if (n === "mesma via outra via" || n === "mesmaviaoutravia") {
    return "mesma_outra_via";
  }

  if (/(sem\s?via|bonus|complemento|n\/a|nao\s?se\s?aplica|null)/.test(n)) {
    return "sem_via";
  }
  
  return n.replace(/\s+/g, "_");
}

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
 * Verifica se a regra aceita a via de acesso do item.
 */
export function ruleAcceptsAccessRoute(r: { allowed_access_routes?: string[] | null }, item: ItemInput): boolean {
  const allowed = Array.isArray(r.allowed_access_routes) ? r.allowed_access_routes : [];
  if (allowed.length === 0) return true;
  
  const itemRoute = normAccessRoute(item.access_route);
  
  // Normaliza as vias permitidas da regra
  const normalizedAllowed = allowed.map(a => normAccessRoute(a));
  
  // Se a regra tem a string composta "mesma_outra_via", ela aceita tanto mesma quanto outra
  if (normalizedAllowed.includes("mesma_outra_via")) {
    if (itemRoute === "mesma_via" || itemRoute === "outra_via") return true;
  }

  // Se o item não tem via mas a regra exige, não aceita (exceto se a regra aceita 'sem_via')
  if (!itemRoute) return normalizedAllowed.includes("sem_via");
  
  return normalizedAllowed.includes(itemRoute);
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

// Especialidade do item é metadado de relatório/filtro — não é eixo do motor.
// As funções abaixo foram removidas intencionalmente (ver `ruleAcceptsItemSpecialty`).

// ---------- pré-filtro ----------
// Observação: especialidade NÃO é filtrada aqui — o `payments.specialties` é
// uma propriedade do pagamento (frequentemente vazia) enquanto a whitelist da
// regra é por item (`item.specialty`). O match correto é feito no nível de
// item dentro de `selectWinningRule` via `matchesItemSpecialty`.
export function preFilterRules(rules: RuleInput[], ctx: PaymentContext): RuleInput[] {
  return rules.filter((r) => {
    if (!r.active) return false;
    // VIGÊNCIA: NÃO checa aqui. A vigência da regra depende da `procedure_date`
    // de cada item (regra de competência fiscal — Onda 1). Filtro de vigência
    // ocorre por item dentro de `analyzeItem`. ctx.reference_date é informativo.

    // SEGUNDA CAMADA: Filtro por setor do lote (payments.sectors).
    // REGRA DE PROJETO: Se a regra é vinculada (específica ou grupo), ela IGNRORA
    // o setor do lote/pagamento — pois o vínculo explícito por empresa/médico
    // tem precedência sobre o setor estatístico do lote.
    if (r.scope === "master") {
      // Regras master são filtradas pelo setor do lote para evitar poluição.
      // Se o lote é de 'cirurgia', pulamos regras exclusivas de 'hemodinamica'.
      // Regras 'gerais' (setor vazio ou 'outro') passam sempre.
      if (!intersectsAll(ruleSectors(r), ctx.sectors)) return false;
    }

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
 * REGRA DE PROJETO: especialidade médica é apenas relatório/busca/filtro,
 * NUNCA impacta o cálculo, status ou seleção de regra. Por isso este
 * "filtro" é intencionalmente um no-op — mantemos a função e a chave
 * `filtered_specialty` no tipo `SelectionTraceCandidate` apenas para
 * compatibilidade com traces históricos. Não use `r.specialties` para
 * decidir aplicabilidade no motor.
 */
function ruleAcceptsItemSpecialty(_r: RuleInput, _item: ItemInput): boolean {
  return true;
}

// ruleAcceptsAccessRoute removida por duplicidade (já declarada na linha 545)
// ruleAcceptsAccessRoute já está declarada no início do arquivo para evitar conflitos de redeclaração.

export function selectWinningRule(
  item: ItemInput,
  rules: RuleInput[],
  ctx?: PaymentContext,
  opts?: { collectTrace?: boolean },
): SelectionOutcome | null {
  const itemSector = inferItemSector(item, ctx);
  const isHemo = itemSector === "hemodinamica";
  const trace: SelectionTrace | undefined = opts?.collectTrace
    ? { item_sector: itemSector, is_hemo: isHemo, levels: [], winner_rule_id: null, winner_priority: "sem_regra" }
    : undefined;

  // Especialidade NÃO filtra mais regras (campo é só relatório). Mantemos
  // a função wrapper para preservar a forma do código e facilitar
  // comparação com versões anteriores.
  const filterBySpecialty = (bucket: RuleInput[], _levelLabel: RuleMatchPriority): RuleInput[] => bucket;

  const doctorRules  = filterBySpecialty(rules.filter((r) => targetsDoctor(r, item)), "medico");
  const companyRules = filterBySpecialty(rules.filter((r) => targetsCompany(r, item)), "empresa");
  const groupRules   = filterBySpecialty(rules.filter((r) => targetsGroup(r, item)), "grupo");
    const sectorRules  = [];
    const hemoMaster   = [];
    const generalMaster = filterBySpecialty(rules.filter((r) => r.scope === "master"), "setor_master_geral");

  const levels: Array<{
    bucket: RuleInput[];
    withCodePriority: RuleMatchPriority;
    withoutCodePriority: RuleMatchPriority;
    enabled?: boolean;
  }> = [
    { bucket: doctorRules,    withCodePriority: "medico_codigo",  withoutCodePriority: "medico" },
    { bucket: companyRules,   withCodePriority: "empresa_codigo", withoutCodePriority: "empresa" },
    { bucket: groupRules,     withCodePriority: "grupo_codigo",   withoutCodePriority: "grupo" },
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

  const bucketProcessed = new Set<string>();

  for (const lvl of levels) {
    if (lvl.enabled === false) continue;
    
    // Filtramos o bucket por regras que casam com o item (código e via)
    const candidates = lvl.bucket.filter((r) => {
      // 1) Se a regra tem restrição de código, ela deve casar com o código do item
      if (hasCodeRestriction(r) && !matchesProcedureCode(r, item)) return false;
      
      // 2) A via de acesso deve ser aceita pela regra
      if (!ruleAcceptsAccessRoute(r, item)) return false;
      
      return true;
    });

    if (candidates.length === 0) continue;

    // Dentro do nível, priorizamos regras com código específico
    const withCode = candidates.filter(hasCodeRestriction);
    
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

    // Se não houver regra com código, tentamos as sem código (gerais do nível)
    const withoutCode = candidates.filter((r) => !hasCodeRestriction(r));
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
  const t = normAccessRoute(raw);
  if (!t) return 1;
  if (t === "unica_principal") return 1;
  if (t === "mesma_via") return 0.5;
  if (t === "outra_via") return 0.7;
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
// ExpectedCalc interface moved to export section to avoid duplication and conflicts.

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
    alerts: [], // Removido alerta informativo de exclusão
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

export type ReferenceTableLookup = (referenceTableId: string, procedureCode: string, role?: string | null, forceSpecific?: boolean) => number | null;

/**
 * Camada 2: dado um id de tabela de exceção (sem_acordo/exclusao) e um código
 * TUSS, retorna metadados se o código está nessa tabela; null caso contrário.
 */
export type ExceptionTableLookup = (
  referenceTableId: string,
  procedureCode: string,
) => { table_name: string; purpose: "sem_acordo" | "exclusao"; reason: string | null } | null;

export interface EngineCtx extends PaymentContext {
  appliedAttendancesByRule: Map<string, Set<string>>;
  referenceLookup?: ReferenceTableLookup;
  exceptionLookup?: ExceptionTableLookup;
  tolerance_pct?: number; // Tolerância customizada (ex.: 0.05 para 5%)
  globalThresholds?: {
    limiar_alerta_tipo: "percentual" | "absoluto";
    limiar_alerta_valor: number;
    limiar_bloqueio_tipo: "percentual" | "absoluto";
    limiar_bloqueio_valor: number;
  };
}

/**
 * Verifica se um item de cálculo se aplica ao item, considerando as condições
 * vinculadas (período/dia/horário/eletivo). Quando uma condição não está
 * configurada (modo "qualquer"/vazio), ela é considerada satisfeita.
 */
export function calcItemMatches(c: RuleCalculationItem, item: ItemInput): { ok: true } | { ok: false; reason: string } {
  // ---- Filtros restritivos por cálculo ----
  // Códigos de procedimento (whitelist/blacklist/any)
  // Convenção pós-refactor: lista vazia = sem filtro de código (fallback).
  // Quando o usuário quer restringir, a UI grava `code_match_mode = "whitelist"`
  // E preenche `procedure_codes`. A UI normaliza para "any" quando a lista está vazia,
  // garantindo que não exista whitelist sem códigos.
  const codes = Array.isArray(c.procedure_codes) ? c.procedure_codes.filter(Boolean) : [];
  const codeMode = (c.code_match_mode ?? "any") as "whitelist" | "blacklist" | "any";
  if (codeMode !== "any" && codes.length > 0) {
    const ic = (item.procedure_code ?? "").trim();
    const inList = !!ic && codes.includes(ic);
    if (codeMode === "whitelist" && !inList) return { ok: false, reason: "codigo_nao_listado" };
    if (codeMode === "blacklist" && inList) return { ok: false, reason: "codigo_excluido" };
  }
  // Convênios
  const ags = Array.isArray(c.agreement_aliases) ? c.agreement_aliases.filter(Boolean) : [];
  if (ags.length > 0) {
    const mode = c.agreement_match_mode === "blacklist" ? "blacklist" : "whitelist";
    const itemAg = normAgreement(item.agreement_name);
    const norm = ags.map(normAgreement).filter(Boolean);
    if (mode === "whitelist") {
      if (!itemAg || !norm.includes(itemAg)) return { ok: false, reason: "convenio_nao_listado" };
    } else {
      if (itemAg && norm.includes(itemAg)) return { ok: false, reason: "convenio_bloqueado" };
    }
  }
  // Função do médico
  const roles = Array.isArray(c.doctor_roles) ? c.doctor_roles.filter(Boolean) : [];
  if (roles.length > 0) {
    const itemRole = classifyDoctorRole(item.doctor_role);
    if (!roles.includes(itemRole)) return { ok: false, reason: "funcao_medico" };
  }
  // Setores
  const cSectors = Array.isArray(c.sectors) ? c.sectors.filter(Boolean) : [];
  if (cSectors.length > 0) {
    const itemSector = (item as any).sector ?? null;
    if (!itemSector || !cSectors.map((s) => normName(s)).includes(normName(itemSector))) {
      return { ok: false, reason: "setor" };
    }
  }
  // Via de acesso
  if (!ruleAcceptsAccessRoute(c, item)) {
    return { ok: false, reason: "via_de_acesso" };
  }
  // Dia da semana — preferimos o array `weekdays` (modo personalizado) e,
  // quando vazio, derivamos do `time_mode` (fim_de_semana / comercial / fora_comercial).
  const tm = (c.time_mode ?? "qualquer") as string;
  let effectiveWeekdays: number[] | null = Array.isArray(c.weekdays) && c.weekdays.length > 0
    ? c.weekdays
    : null;
  if (!effectiveWeekdays) {
    if (tm === "fim_de_semana") effectiveWeekdays = [0, 6];
    else if (tm === "comercial" || tm === "fora_comercial") effectiveWeekdays = [1, 2, 3, 4, 5];
  }
  if (effectiveWeekdays && item.procedure_date) {
    const d = new Date(item.procedure_date);
    if (!Number.isNaN(d.getTime())) {
      // Para fim_de_semana: usamos a DATA do procedimento (sem carry-over de sexta→sábado).
      // Pegamos sempre o dia exato registrado em procedure_date.
      const day = item.procedure_date.includes('T') ? d.getDay() : new Date(item.procedure_date + 'T12:00:00').getDay();
      const inSet = effectiveWeekdays.includes(day);
      if (tm === "fora_comercial") {
        // Fora comercial = (sáb/dom) OU (seg-sex fora 07-19h). Aqui validamos só o dia
        // quando não há janela horária; o filtro de horário restante cai no bloco abaixo.
        if (inSet && !c.time_start && !c.time_end) return { ok: false, reason: "fora_comercial_dia_util" };
      } else if (!inSet) {
        return { ok: false, reason: tm === "fim_de_semana" ? "fim_de_semana" : "dia_da_semana" };
      }
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
  // Eletivo vs Urgência
  if (c.elective_mode && c.elective_mode !== "qualquer") {
    const isUrgencia = /urgencia|emergencia|pronto/i.test(item.description ?? "");
    if (c.elective_mode === "eletivo" && isUrgencia) return { ok: false, reason: "eletivo_urgencia" };
    if (c.elective_mode === "urgencia" && !isUrgencia) return { ok: false, reason: "eletivo_urgencia" };
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
    // Filtros restritivos vivem APENAS no item de Cálculo. Não herda da Regra
    // — se o cálculo não declarou, o filtro não se aplica (vazio = qualquer).
    procedure_codes: Array.isArray(c.procedure_codes) ? c.procedure_codes : [],
    sectors: Array.isArray(c.sectors) ? c.sectors : [],
    specialties: [],
    agreement_aliases: Array.isArray(c.agreement_aliases) ? c.agreement_aliases : [],
    agreement_match_mode: (c.agreement_match_mode ?? "whitelist") as any,
    allowed_access_routes: Array.isArray(c.allowed_access_routes) ? c.allowed_access_routes : [],
    // Propaga unidade de aplicação para uso na pós-análise (dedup de bônus).
    application_unit: c.application_unit ?? rule.application_unit ?? null,
  } as RuleInput & { application_unit?: string | null };
}

/**
 * Validador: garante que filtros restritivos vivem apenas dentro de Cálculos.
 * Retorna lista de avisos quando a Regra ainda carrega filtros no nível raiz
 * (legado pré-refactor). Use em ferramentas de diagnóstico/import.
 */
export function validateCalcOnlyFilters(
  rule: RuleInput & { calculations?: RuleCalculationItem[] | null },
): string[] {
  const warnings: string[] = [];
  const has = (v: unknown) => Array.isArray(v) && v.length > 0;
  if (has(rule.procedure_codes)) warnings.push("procedure_codes no nível Regra (mover para Cálculo)");
  if (has(rule.sectors)) warnings.push("sectors no nível Regra (mover para Cálculo)");
  if (has(rule.specialties)) warnings.push("specialties no nível Regra (informativo apenas)");
  if (has(rule.agreement_aliases)) warnings.push("agreement_aliases no nível Regra (mover para Cálculo)");
  if (has(rule.allowed_access_routes)) warnings.push("allowed_access_routes no nível Regra (mover para Cálculo)");
  return warnings;
}



export interface ExpectedCalc {
  expected: number | null;
  explanation: string;
  alerts: string[];
  breakdown?: CalculationBreakdownEntry[];
  force_totalized?: boolean;
  application_unit?: "por_item" | "por_atendimento" | "por_paciente_dia" | null;
  /** Onda 1 — Tabela diferenciada já multiplica por quantidade internamente,
   *  então finalizeAnalysis NÃO deve multiplicar de novo. */
  qty_already_applied?: boolean;
  /** Onda 1 — Trace passo-a-passo do cálculo (com arredondamento por etapa). */
  steps?: { label: string; value: number }[];
}

export function applyCalculation(
  rule: RuleInput,
  item: ItemInput,
  ctx?: EngineCtx,
): ExpectedCalc {
  // ---- NOVO: itens de cálculo (1:N) ----
  const rawList = Array.isArray(rule.calculations) ? rule.calculations : [];
  // Defensivo: garante a sequência (sort_order ASC) mesmo que a fonte tenha
  // entregue fora de ordem. Itens sem sort_order vão para o fim, preservando
  // a ordem original entre si (sort estável).
  const list = rawList
    .map((c, i) => ({ c, i, so: c.sort_order ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.so - b.so || a.i - b.i)
    .map((x) => x.c);
  if (list.length > 0) {
    const breakdown: CalculationBreakdownEntry[] = [];
    let winnerCalc: { expected: number | null; explanation: string; alerts: string[]; label: string; id: string | null; force_totalized?: boolean; application_unit?: string | null } | null = null;
    let anyMatched = false;

    for (const c of list) {
      const label = (c.label && c.label.trim()) || c.calculation_type;
      const m = calcItemMatches(c, item);
      
      if (!m.ok) {
        const reason = (m as any).reason || "condicao_nao_satisfeita";
        breakdown.push({
          calc_id: c.id ?? null,
          label,
          calculation_type: c.calculation_type,
          matched: false,
          skip_reason: reason,
          expected: null,
          explanation: `Não aplicado — condição "${reason}" não satisfeita.`,
          alerts: [],
        });
        continue;
      }

      anyMatched = true;
      const eff = ruleFromCalcItem(rule, c);
      const r = applyCalculationSingle(eff, item, ctx);
      
      // REGRA DE PROJETO: "Exclusividade de Item de Cálculo". 
      // Em vez de somar (comportamento de pacote), o motor agora usa o PRIMEIRO 
      // item de cálculo que der match e RESULTAR EM VALOR (expected != null)
      // como a regra definitiva para este item. Se o primeiro der match mas 
      // falhar no cálculo (ex: código não encontrado na tabela), ele tenta o próximo.
      if (!winnerCalc && r.expected !== null) {
        winnerCalc = { 
          ...r, 
          label, 
          id: c.id ?? null,
          force_totalized: c.force_totalized ?? false,
          application_unit: c.application_unit ?? rule.application_unit ?? "por_item",
        };
        
        breakdown.push({
          calc_id: c.id ?? null,
          label,
          calculation_type: c.calculation_type,
          matched: true,
          expected: r.expected,
          explanation: r.explanation,
          alerts: r.alerts.map((a) => `[${label}] ${a}`),
        });
      } else if (!winnerCalc && r.expected === null) {
        // Deu match na condição (ex: via), mas falhou no cálculo interno (ex: tabela).
        // Registramos como match=false (falha técnica) para permitir que o próximo item de cálculo tente.
        breakdown.push({
          calc_id: c.id ?? null,
          label,
          calculation_type: c.calculation_type,
          matched: false,
          skip_reason: "calculo_sem_resultado",
          expected: null,
          explanation: `Tentativa falhou: ${r.explanation}. Seguindo para próximo cálculo disponível.`,
          alerts: r.alerts.map((a) => `[${label}] ${a}`),
        });
        // anyMatched = false; // Removido para manter anyMatched=true se houve match de condição
      } else if (winnerCalc) {
        // Itens de cálculo posteriores que também dariam match são ignorados (exclusividade)
        breakdown.push({
          calc_id: c.id ?? null,
          label,
          calculation_type: c.calculation_type,
          matched: false,
          skip_reason: "item_calculo_ja_atendido",
          expected: null,
          explanation: `Ignorado — o item já foi atendido pelo cálculo anterior "${winnerCalc.label}".`,
          alerts: [],
        });
      }
    }

    if (!anyMatched || !winnerCalc) {
      return {
        expected: null,
        explanation: `Regra "${rule.name}" possui ${list.length} cálculo(s), mas nenhum satisfez as condições deste item.`,
        alerts: ["Nenhum item de cálculo da regra se aplica a este item."],
        breakdown,
      };
    }

    const expected = winnerCalc.expected != null ? Number(winnerCalc.expected.toFixed(2)) : null;
    
    // Propaga a flag force_totalized do item de cálculo ou da regra pai
    const finalForceTotalized = winnerCalc.force_totalized ?? rule.force_totalized ?? false;

    return {
      expected,
      explanation: `[${winnerCalc.label}] ${winnerCalc.explanation}`,
      alerts: winnerCalc.alerts.map((a) => `[${winnerCalc.label}] ${a}`),
      breakdown,
      force_totalized: finalForceTotalized,
      application_unit: (winnerCalc.application_unit as any) ?? rule.application_unit ?? "por_item",
    };
  }
  // ---- LEGADO: campos diretos na regra ----
  const res = applyCalculationSingle(rule, item, ctx);
  if (res) {
    res.force_totalized = rule.force_totalized ?? false;
  }
  return res;
}

function applyCalculationSingle(
  rule: RuleInput,
  item: ItemInput,
  ctx?: EngineCtx,
): ExpectedCalc {
  // HIERARQUIA: se a regra tem tabela de referência vinculada E o tipo de cálculo
  // não é um que explicitamente a ignore ou se o tipo for tabela_diferenciada/referencia,
  // ela TEM precedência.
  if (rule.reference_table_id && (rule.calculation_type === "tabela_diferenciada" || rule.calculation_type === "tabela_referencia")) {
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
  const hasFixed = rule.bonus_amount != null;
  const hasPct = rule.bonus_pct != null;
  if (!hasFixed && !hasPct) {
    return {
      expected: null,
      explanation: "Bônus mal configurado: nenhum valor (bonus_amount) nem percentual (bonus_pct) definido no cálculo.",
      alerts: ["Cálculo de bônus sem bonus_amount e sem bonus_pct — regra ignorada."],
    };
  }
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
    const v = lookup(rule.reference_table_id, code, item.doctor_role);
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
    // Sem tabela vinculada: a regra de tabela diferenciada exige tabela.
    return {
      expected: null,
      explanation: "Tabela diferenciada — regra sem tabela de referência vinculada. A tabela é obrigatória neste tipo de cálculo.",
      alerts: ["Regra de tabela diferenciada sem tabela de referência vinculada — configure a tabela na regra."],
    };
  }

  const mult = rule.multiplier ?? 1;
  const defl = rule.deflator_pct ?? 0;
  const rep  = rule.repasse_pct ?? 100;

  // Onda 1 — Ordem fiscal da Tabela Diferenciada (com arredondamento por etapa):
  //   1) base
  //   2) × multiplicador
  //   3) × repasse
  //   4) × via de acesso
  //   5) × função (auxiliares/instrumentador)
  //   6) × quantidade
  //   7) × (1 − deflator)
  // IMPORTANTE: Se o valor da tabela já for específico para o papel (ex: valor
  // para 1º Auxiliar), NÃO aplicamos novamente o percentual de auxiliar.
  const roleInTableMatchesRoleInItem = !!(lookup && rule.reference_table_id && item.doctor_role
    && lookup(rule.reference_table_id, (item.procedure_code ?? "").toString().trim(), item.doctor_role, true) !== null);

  const round2 = (n: number) => Number(n.toFixed(2));
  const steps: { label: string; value: number }[] = [];
  const parts: string[] = [];

  // 1) base
  let value = round2(base);
  steps.push({ label: "base", value });
  parts.push(`${baseLabel} R$ ${value.toFixed(2)}${baseSource}`);

  // 2) × multiplicador
  value = round2(value * (mult ?? 1));
  steps.push({ label: "multiplicador", value });
  parts.push(`× mult ${mult} = R$ ${value.toFixed(2)}`);

  // 3) × repasse
  value = round2(value * ((rep ?? 100) / 100));
  steps.push({ label: "repasse", value });
  if (rep !== 100) parts.push(`× repasse ${rep}% = R$ ${value.toFixed(2)}`);

  // 4) × via de acesso
  let viaFactor = 1;
  if (rule.apply_access_route) viaFactor = accessRouteFactor(item.access_route);
  value = round2(value * viaFactor);
  steps.push({ label: "via_acesso", value });
  if (rule.apply_access_route) parts.push(`× via(${(viaFactor * 100).toFixed(0)}%) = R$ ${value.toFixed(2)}`);

  // 5) × função
  let funcFactor = 1;
  let funcLabel = "";
  if (rule.include_auxiliaries && !roleInTableMatchesRoleInItem) {
    const role = classifyDoctorRole(item.doctor_role);
    if (role === "instrumentador") {
      funcFactor = (rule.instrumentador_pct ?? 10) / 100;
      funcLabel = `× instrumentador ${(funcFactor * 100).toFixed(0)}%`;
    } else if (role === "primeiro_aux") {
      funcFactor = (rule.aux_first_pct ?? 30) / 100;
      funcLabel = `× 1º aux ${(funcFactor * 100).toFixed(0)}%`;
    } else if (role === "demais_aux") {
      funcFactor = (rule.aux_second_pct ?? 20) / 100;
      funcLabel = `× aux 2+ ${(funcFactor * 100).toFixed(0)}%`;
    }
  } else if (roleInTableMatchesRoleInItem) {
    parts.push(`(valor específico para papel "${item.doctor_role}")`);
  }
  value = round2(value * funcFactor);
  steps.push({ label: "funcao", value });
  if (funcLabel) parts.push(`${funcLabel} = R$ ${value.toFixed(2)}`);

  // 6) × quantidade (Onda 1: quantidade entra DENTRO da Tabela Diferenciada)
  const qtyRaw = Number(item.quantity ?? 1);
  const qtyValid = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  const isTotalized = item.convenio_value_totalized === true;
  const qtyToApply = isTotalized ? 1 : qtyValid;
  value = round2(value * qtyToApply);
  steps.push({ label: "quantidade", value });
  if (qtyToApply !== 1) parts.push(`× qtd ${qtyToApply} = R$ ${value.toFixed(2)}`);

  // 7) × (1 − deflator)
  value = round2(value * (1 - (defl ?? 0) / 100));
  steps.push({ label: "deflator", value });
  if (defl !== 0) parts.push(`× (1 − deflator ${defl}%) = R$ ${value.toFixed(2)}`);

  return {
    expected: value,
    explanation: parts.join(" "),
    alerts: [],
    steps,
    qty_already_applied: true,
  };
}

function classifyDiff(
  expected: number | null, 
  gross: number, 
  rule: RuleInput | null,
  ctx?: EngineCtx
): { status: ItemAiStatus; diff_pct: number | null; diff_abs: number | null } {
  if (expected == null) return { status: "alerta", diff_pct: null, diff_abs: null };
  
  // Se o esperado é 0 (exclusão) e o pago é 0, está perfeitamente correto (aprovado).
  if (expected === 0 && gross === 0) return { status: "aprovado", diff_pct: 0, diff_abs: 0 };
  
  // Para outros casos onde gross é 0 mas expected > 0 (item não pago mas deveria ser).
  if (gross <= 0) return { status: "alerta", diff_pct: null, diff_abs: Math.abs(expected) };
  
  const diff_abs = Math.abs(expected - gross);
  const diff_pct = diff_abs / Math.max(Math.abs(expected), 0.01);
  
  // Limiares de alerta e bloqueio (prioriza regra, fallback global)
  const g = ctx?.globalThresholds || {
    limiar_alerta_tipo: "percentual",
    limiar_alerta_valor: 1.0,
    limiar_bloqueio_tipo: "percentual",
    limiar_bloqueio_valor: 5.0
  };

  const alertType = rule?.limiar_alerta_tipo || g.limiar_alerta_tipo;
  const alertVal = rule?.limiar_alerta_valor ?? g.limiar_alerta_valor;
  const blockType = rule?.limiar_bloqueio_tipo || g.limiar_bloqueio_tipo;
  const blockVal = rule?.limiar_bloqueio_valor ?? g.limiar_bloqueio_valor;

  const currentAlertDiff = alertType === "percentual" ? diff_pct * 100 : diff_abs;
  const currentBlockDiff = blockType === "percentual" ? diff_pct * 100 : diff_abs;

  // Regra de projeto: se o valor bate com a regra (divergência < tolerância global de reanálise se ativa), o item é aprovado.
  const tolerance = ctx?.tolerance_pct ? ctx.tolerance_pct * 100 : null;
  if (tolerance !== null && (diff_pct * 100) <= tolerance) {
    return { status: "aprovado", diff_pct, diff_abs };
  }

  if (currentBlockDiff >= blockVal) return { status: "reprovado", diff_pct, diff_abs };
  if (currentAlertDiff >= alertVal) return { status: "alerta",   diff_pct, diff_abs };
  
  return { status: "aprovado", diff_pct, diff_abs };
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
  ctx?: EngineCtx,
): { rule: RuleInput; priority: RuleMatchPriority } | null {
  const remaining = rules.filter(
    (r) =>
      r.id !== excludeId &&
      r.calculation_type !== "exclusao" &&
      r.calculation_type !== "informativo",
  );
  const out = selectWinningRule(item, remaining, ctx);
  if (out && out.rule) return { rule: out.rule, priority: out.priority };
  return null;
}

/**
 * Busca uma regra master (geral) que possa servir de fallback quando 
 * regras específicas falham. Prioriza regras que não tenham restrições 
 * (como código, médico ou via de acesso).
 */
function findFallbackGeneralRule(
  item: ItemInput,
  rules: RuleInput[],
  ctx?: EngineCtx,
): { rule: RuleInput; priority: RuleMatchPriority } | null {
  // Filtra apenas regras master (gerais)
  const masterRules = rules.filter(r => r.scope === "master" && r.calculation_type !== "exclusao");
  
  // Tenta encontrar uma regra master que não tenha nenhuma restrição de via
  // e que aceite o convênio do item.
  const genericMaster = masterRules.find(r => 
    (!r.allowed_access_routes || r.allowed_access_routes.length === 0) &&
    ruleAcceptsItemAgreement(r, item)
  );

  if (genericMaster) {
    return { rule: genericMaster, priority: "setor_master_geral" };
  }

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

  // REGRA DE COMPETÊNCIA (Onda 1): a vigência é checada contra a data do
  // procedimento do item, NÃO contra ctx.reference_date (data do lote).
  // Se procedure_date estiver ausente/ inválida, nenhuma regra é considerada
  // (item segue para `sem_regra` -> alerta no fluxo existente).
  const procDateRaw = item.procedure_date;
  const procDateValid = !!procDateRaw && !Number.isNaN(Date.parse(procDateRaw));
  const rulesForItem = procDateValid
    ? preFilteredRules.filter((r) => isInValidity(r, procDateRaw!))
    : [];
  const outcome = selectWinningRule(item, rulesForItem, ctx, { collectTrace: true });
  let winner: RuleInput | null = null;
  let calc: ExpectedCalc = { expected: null, explanation: "", alerts: [] };
  let priority: RuleMatchPriority = "sem_regra";
  let calculation_type_used: AnalysisResult["calculation_type_used"] = "informativo";
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
    winner = outcome.rule;
    let winnerPriority = outcome.priority;
    calc = applyCalculation(winner, item, ctx);

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
        matched_priority: "regra_bloqueio",
        calculation_type_used: "informativo",
        calculation_explanation:
          `Bloqueado pela Camada 1 (${motivo}) — sem acordo para esta combinação. ` +
          `Sistema não tem acesso à tabela interna do convênio; aceita o valor pago como esperado (R$ ${paid.toFixed(2)}).`,
        alerts: [], // Removido alerta de bloqueio de convênio (comportamento esperado)
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
            matched_priority: "regra_bloqueio",
            calculation_type_used: "informativo",
            calculation_explanation:
              `Bloqueado pela Camada 2 — código TUSS ${code} consta na tabela "${hit.table_name}" ` +
              `(${purposeLabel.toLowerCase()}) vinculada à regra "${winner.name}"${motivo}. ` +
              `Regra de cálculo ignorada — esperado = valor pago pelo convênio (R$ ${paid.toFixed(2)}).`,
            alerts: [], // Removido alerta de tabela de exceção (comportamento esperado)
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
      const fallback = findNextCalculableRule(item, preFilteredRules, winner.id, ctx);
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
  }

  // REGRA DE PROJETO: "Fallback Master — Apenas após exaustão"
  // Só executamos o fallback geral se:
  // 1. Nenhuma regra (medico/empresa/grupo/master) deu match
  // 2. OU se a regra vencedora acima não resultou em cálculo válido (calc.expected === null)
  //    APÓS percorrer todos os seus itens de cálculo internos.
  const needsFallback = !winner || (calc && calc.expected === null);

  if (needsFallback) {
    // --- Camada 3: Verificação global de tabelas de "sem acordo" ou "exclusão" ---
    const code = (item.procedure_code ?? "").trim();
    if (code && ctx?.globalExceptionTableIds?.length && ctx?.exceptionLookup) {
      for (const tid of ctx.globalExceptionTableIds) {
        const h = ctx.exceptionLookup(tid, code);
        if (h) {
          const paid = Number(item.gross_amount ?? 0);
          return {
            item_id: item.id,
            status: "aprovado",
            expected_amount: paid,
            diff_pct: 0,
            matched_rule_id: null,
            matched_rule_name: `Camada 3 (Global) — ${h.table_name}`,
            matched_priority: "regra_bloqueio",
            calculation_type_used: "informativo",
            calculation_explanation: 
              `Bloqueado pela Camada 3 (Global) — código TUSS ${code} consta na tabela "${h.table_name}" ` +
              `(${h.purpose === "sem_acordo" ? "sem acordo" : "exclusão"}). Sistema aceita o valor pago (R$ ${paid.toFixed(2)}).`,
            alerts: [],
            needs_ai_review: false,
            needs_human_review: false,
          };
        }
      }
    }

    // --- Camada 4: Fallback Determinístico para Regra Geral ---
    const fallbackResult = findFallbackGeneralRule(item, preFilteredRules, ctx);
    if (fallbackResult) {
      const { rule: fRule, priority: fPriority } = fallbackResult;
      const fCalc = applyCalculation(fRule, item, ctx);
      
      if (fCalc.expected !== null) {
        const oldExplanation = calc?.explanation || "";
        const oldBreakdown = (calc?.breakdown ?? []).map((b) => ({
          ...b,
          label: winner ? `[${winner.name}] ${b.label}` : b.label,
        }));
        calc = fCalc;
        // Preserva o breakdown da regra específica que falhou para diagnóstico
        if (oldBreakdown.length > 0) {
          calc.breakdown = [...oldBreakdown, ...(calc.breakdown ?? [])];
        }
        priority = fPriority;
        calculation_type_used = fRule.calculation_type;
        matched_rule_id = fRule.id;
        matched_rule_name = fRule.name;

        calc.explanation = winner
          ? `Regra específica "${winner.name}" falhou em todos os cálculos (${oldExplanation}). Aplicado fallback geral "${fRule.name}". ${calc.explanation}`
          : `Nenhuma regra específica satisfeita. Aplicada regra geral "${fRule.name}". ${calc.explanation}`;
          
        const res = finalizeAnalysis(item, calc, fRule, fPriority, ctx);
        if (outcome?.trace) res.selection_trace = outcome.trace;
        return res;
      }
    }
  }

  if (!calc || calc.expected === null) {
    // Sem regra cadastrada (nem específica, nem geral por setor)
    const sector = inferItemSector(item, ctx);
    calc = {
      expected: null,
      explanation: `Sem regra cadastrada para este item (setor: ${sector}). Cadastre a regra correspondente em Regras de Repasse.`,
      alerts: [`Sem regra aplicável (setor: ${sector}) — cadastre uma regra específica ou geral para este caso.`],
    };
    priority = "sem_regra";
    calculation_type_used = "informativo";
  }

  const res = finalizeAnalysis(item, calc, winner, priority, ctx, conflict);
  if (outcome?.trace) res.selection_trace = outcome.trace;
  return res;
}





function finalizeAnalysis(
  item: ItemInput,
  calc: ExpectedCalc,
  rule: RuleInput | null,
  priority: RuleMatchPriority,
  ctx?: EngineCtx,
  conflict?: AnalysisResult["conflict"]
): AnalysisResult {
  // Multiplicação final pela quantidade do item (coluna "Quantidade" da base).
  // Aplica a TODOS os tipos de cálculo: o esperado é por unidade × qtd.
  // PULA se o item já veio com valor totalizado (convenio_value_totalized) OU se a regra forçar totalização.
  const qty = Number(item.quantity ?? 1);
  const isTotalized = item.convenio_value_totalized === true || calc.force_totalized === true;
  // Onda 1 — Tabela Diferenciada já aplica quantidade internamente; pula aqui.
  if (calc.qty_already_applied === true) {
    // no-op: não multiplica de novo
  } else if (isTotalized) {
    if (qty > 1 && calc.explanation) {
      const reason = item.convenio_value_totalized === true ? "importação" : "regra";
      calc.explanation = `${calc.explanation} (qtd ${qty} ignorada no cálculo pois valor já é totalizado via ${reason})`;
    }
  } else if (calc.expected != null && Number.isFinite(qty) && qty > 0 && qty !== 1) {
    const before = calc.expected;
    calc.expected = Number((before * qty).toFixed(2));
    calc.explanation = `${calc.explanation} × qtd ${qty} = R$ ${calc.expected.toFixed(2)}`;
  }

  let { status, diff_pct } = classifyDiff(calc.expected, item.gross_amount, rule, ctx);
  if (priority === "conflito") status = "alerta";
  if (priority === "sem_regra") status = "alerta";
  // Exceção autorizada que caiu sem regra calculável => alerta de validação manual.
  if (
    item.authorized_exception === true &&
    calc.expected == null &&
    rule != null
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
    matched_rule_id: rule?.id ?? null,
    matched_rule_name: rule?.name ?? null,
    matched_priority: priority,
    calculation_type_used: rule?.calculation_type ?? "informativo",
    calculation_explanation: calc.explanation,
    alerts,
    needs_ai_review: status !== "aprovado",
    needs_human_review: priority === "sem_regra" || priority === "conflito",
    ...(conflict ? { conflict } : {}),
    ...(calc.breakdown ? { calculation_breakdown: calc.breakdown } : {}),
    ...(calc.application_unit ? { application_unit_used: calc.application_unit } : {}),
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
    ...ctx,
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
      // Alerta mantido apenas como informativo técnico, mas não bloqueia a aprovação se o valor bater.
      r.alerts = [...r.alerts, "Procedimento principal ambíguo: o motor não conseguiu desempatar de forma determinística."];
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

  // === Dedup de bônus por atendimento/paciente-dia ===
  // Quando o cálculo aplicado tem application_unit != "por_item", o bônus deve
  // contar 1× por grupo (anchor = procedimento principal). Os demais itens do
  // mesmo grupo que casaram com a mesma regra-bônus têm o bônus suprimido:
  // - expected_amount = gross_amount (aceita o valor pago, geralmente 0/sem bônus)
  // - status = aprovado, com nota explicando que já foi contabilizado no anchor.
  // Isso aplica tanto para "por_atendimento" quanto para "por_paciente_dia"
  // (o group key já inclui paciente+data quando attendance_number está vazio).
  const bonusGroupsSeen = new Map<string, string>(); // chave: ruleId|groupKey -> item_id anchor
  for (const r of out) {
    if (!r.application_unit_used || r.application_unit_used === "por_item") continue;
    if (r.calculation_type_used !== "bonus") continue;
    if (!r.matched_rule_id || !r.attendance_group_key) continue;
    const key = `${r.matched_rule_id}|${r.attendance_group_key}`;
    const existingAnchor = bonusGroupsSeen.get(key);
    if (existingAnchor) continue; // outro item do grupo já é o anchor
    // Anchor preferencial: item marcado como principal; senão, este mesmo.
    bonusGroupsSeen.set(key, r.is_main_procedure ? r.item_id : r.item_id);
  }
  // Segunda passada: suprimir bônus duplicados.
  for (const r of out) {
    if (!r.application_unit_used || r.application_unit_used === "por_item") continue;
    if (r.calculation_type_used !== "bonus") continue;
    if (!r.matched_rule_id || !r.attendance_group_key) continue;
    const key = `${r.matched_rule_id}|${r.attendance_group_key}`;
    const anchor = bonusGroupsSeen.get(key);
    if (anchor && anchor !== r.item_id) {
      const it = items.find((x) => x.id === r.item_id);
      const paid = Number(it?.gross_amount ?? 0);
      r.suppressed_by_dedup = true;
      r.expected_amount = paid;
      r.diff_pct = 0;
      r.status = "aprovado";
      r.calculation_explanation =
        `Bônus já contabilizado 1× no atendimento (anchor item ${anchor}). ` +
        `Aplicação configurada como "${r.application_unit_used}".`;
      r.alerts = [...r.alerts, "Bônus suprimido neste item — já aplicado uma vez no atendimento."];
      r.needs_ai_review = false;
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

/**
 * Exportado para testes: permite validar a normalização e classificação de papéis médicos.
 */
export const _test_only = {
  classifyDoctorRole,
  normAgreement,
  normName,
  normAccessRoute,
  onlyDigits,
  calcTabelaDiferenciada,
};
export const calcTabelaDiferenciadaForTest = calcTabelaDiferenciada;

