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
 *
 * Última correção: Camada 2 sem_acordo usa procedure_amount como base (não gross_amount).
 */

import { applyConvenioStems, recordLearnedAlias } from "./convenioStems.ts";
import { isBrazilianNationalHoliday } from "./brHolidays.ts";
import { applySectorStems } from "./sectorStems.ts";

/** Arredonda para 2 casas decimais. */
const round2 = (n: number) => Number(n.toFixed(2));

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
  /** @deprecated alias futuro — não é usado pelo motor neste nível (filtro por tipo vive em `rule_calculations.item_type_id`). */
  item_type_id?: string | null;
  sectors: string[] | null;
  specialties: string[] | null;
  target_type: "medico" | "empresa" | null;
  target_identifier: string | null;
  target_name: string | null;
  target_company_id: string | null;
  target_doctor_id?: string | null;
  procedure_codes: string[] | null;
  valid_from: string | null;
  valid_until: string | null;
  calculation_type: CalculationType;
  convenio_percentage: number | null;
  fixed_amount: number | null;
  /** Valor fixo por função médica — usado por calcValorFixo via ruleFromCalcItem. */
  fixed_amount_by_role?: Record<string, number | null> | null;
  package_amount: number | null;
  extras_codes: string[] | null;
  /** Condições de contexto (lookup em outros itens do mesmo atendimento) — usado em valor_fixo. */
  context_conditions?: ContextCondition[] | null;
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
  /** Acréscimo aditivo aplicado no final da tabela diferenciada, ANTES do deflator. Ex.: 20 = +20%. */
  acrescimo_pct?: number | null;
  apply_access_route?: boolean | null;
  include_auxiliaries?: boolean | null;
  auxiliary_pct?: number | null;
  aux_first_pct?: number | null;
  aux_second_pct?: number | null;
  instrumentador_pct?: number | null;
  /**
   * Vínculos por empresa (escopo "grupo"). Cada item: empresa + (opcional) lista de médicos.
   * Se `doctors` estiver vazio → aplica a todos médicos daquela empresa.
   * Se preenchido → aplica aos médicos listados E (por padrão) a novos médicos
   * que entrarem na empresa depois, exceto os que estiverem em `excluded_doctors`.
   * Defina `auto_include_new_doctors: false` para voltar ao modo allowlist estrita.
   */
  group_company_links?: {
    company_id: string;
    doctors?: { id?: string | null; name?: string; crm?: string }[];
    excluded_doctors?: { id?: string | null; name?: string; crm?: string }[];
    auto_include_new_doctors?: boolean;
    /**
     * Médicos automaticamente expurgados deste vínculo porque possuem uma regra
     * mais específica (target_type='medico' ou group_doctors). Mantido em sync
     * pelo trigger `sync_doctor_specific_exclusions` no banco. Aceita IDs de médico.
     */
    auto_excluded_doctor_ids?: string[] | null;
  }[] | null;

  /**
   * Médicos específicos da regra. Casa por nome+CRM em qualquer empresa do item.
   * Útil para acordos pessoais que seguem o médico independente do CNPJ que
   * faturar. O motor promove regras desse tipo a um nível de prioridade
   * (`grupo_doctor`) acima das regras de PJ inteira (`grupo`), de modo que o
   * médico fica automaticamente "expurgado" de regras amplas da PJ dele.
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
  /**
   * Quando true, se esta regra vence a seleção mas nenhum dos seus cálculos
   * (incluindo catch-all) bater, o item vai para `sem_regra` com alerta —
   * NÃO cai para a regra geral master. Recomendado: true para regras
   * específicas (com setor/convênio/empresa/médico/grupo); false para a master.
   */
  prevent_external_fallback?: boolean | null;
  /**
   * Filtro de caso especial (oncológico, pediátrico, etc.).
   * - null/vazio  → regra padrão: só se aplica a itens SEM caso especial aprovado.
   * - ['*']       → aplica a qualquer caso especial aprovado.
   * - ['oncologico'] → aplica apenas quando o item tem esse code aprovado.
   * Itens com caso especial aprovado preferem regras filtradas; quando nenhuma
   * filtrada se aplica, caem para as regras padrão (null/vazio).
   */
  special_case_filter?: string[] | null;
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
  /**
   * Valor fixo por função médica. Chaves: cirurgiao | primeiro_aux | demais_aux | instrumentador | outro.
   * Quando a função do item bate uma chave preenchida, esse valor sobrescreve `fixed_amount`.
   * Vazio/nulo = usa `fixed_amount` global.
   */
  fixed_amount_by_role?: Record<string, number | null> | null;
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
  /** Acréscimo aditivo (override por cálculo) aplicado antes do deflator. */
  acrescimo_pct?: number | null;
  apply_access_route?: boolean | null;
  include_auxiliaries?: boolean | null;
  auxiliary_pct?: number | null;
  aux_first_pct?: number | null;
  aux_second_pct?: number | null;
  instrumentador_pct?: number | null;
  bonus_amount?: number | null;
  bonus_pct?: number | null;
  target_amount?: number | null;
  // ---- Adicionais temporais (aplicados após o cálculo base) ----
  /** % adicional sobre o valor calculado se atendimento for sábado/domingo. */
  adicional_fds_pct?: number | null;
  /** % adicional se data for feriado nacional (brHolidays). */
  adicional_feriado_pct?: number | null;
  /** % adicional se hora cair na janela noturna. */
  adicional_noturno_pct?: number | null;
  /** % adicional se atendimento for urgência OU emergência (independe de dia/horário). Entra no mesmo pool "só o maior". */
  adicional_urgencia_pct?: number | null;
  /** Início janela noturna (HH:MM). */
  noturno_inicio?: string | null;
  /** Fim janela noturna (HH:MM). Cruza meia-noite quando fim < início. */
  noturno_fim?: string | null;
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
  /** Especialidades aplicáveis (vazio = qualquer). Só filtra quando match_by_specialty=true. */
  specialties?: string[] | null;
  /** Toggle explícito do filtro por especialidade. Default false = ignora specialties[] (comportamento histórico). */
  match_by_specialty?: boolean | null;
  /** Caso especial aplicável neste cálculo. Vazio = padrão; códigos ou '*' exigem caso especial aprovado. */
  special_case_filter?: string[] | null;
  /** Tipo do item aplicável neste cálculo (Parecer, Visita, Consulta, etc.).
   *  NULL = vale para qualquer tipo. Quando setado, só casa se o item
   *  tiver o mesmo `item_type_id`. */
  item_type_id?: string | null;
  /** Palavras-chave para matching por texto no nome/descrição do procedimento. */
  procedure_keywords?: string[] | null;
  /** Condições de contexto (lookup em outros itens do mesmo atendimento) — usado em valor_fixo. */
  context_conditions?: ContextCondition[] | null;
  /**
   * Cálculo "piso" da regra: avaliado por último, ignora whitelist/blacklist
   * de `procedure_codes` e `procedure_keywords`. Demais filtros (convênio,
   * setor, função, via de acesso, horário, etc.) continuam valendo. Máximo
   * 1 por regra (garantido por índice único parcial em rule_calculations).
   */
  is_catch_all?: boolean | null;
  /**
   * Piso por procedimento (mínimo garantido). Quando ligado e o cálculo é
   * `percentual_sobre_convenio`, o esperado do item passa a ser
   *   MAX(percentual × base_convenio × fator_função, piso_para_a_função)
   * O piso preserva o pagamento maior — se o convênio pagar mais que o piso,
   * o esperado permanece no percentual. Escopo:
   *   - `por_item`: piso é o mínimo de CADA linha (padrão).
   *   - `por_atendimento`: piso é o mínimo da SOMA das linhas do atendimento
   *     (ainda não implementado no motor — cai em `por_item` com alerta).
   */
  piso_habilitado?: boolean | null;
  piso_escopo?: "por_item" | "por_atendimento" | null;
  piso_valor_padrao?: number | null;
  /** Lista `[{ role: "cirurgiao"|"primeiro_aux"|..., valor: number, label?: string }]`.
   *  Se a função do item bate uma entrada, o valor vence `piso_valor_padrao`. */
  piso_por_funcao?: Array<{ role: string; valor: number; label?: string | null }> | null;
}

/** Condição de contexto: substitui o valor padrão quando outros itens do
 *  mesmo atendimento contêm determinados códigos. Avaliadas em ordem;
 *  a primeira que bater vence. */
export interface ContextCondition {
  trigger_codes: string[];
  match_mode: "any" | "all";
  value: number;
  /** Valor esperado do código complementar quando detectado no atendimento. Informativo. */
  complement_value?: number | null;
}

export interface ItemInput {
  id: string;
  doctor_name: string | null;
  doctor_document: string | null;
  /** Vínculo direto com o cadastro de médicos (preferencial para matching de regras). */
  doctor_id?: string | null;
  company_name: string | null;
  company_id: string | null;
  company_document: string | null;
  /**
   * Pool soberano: itens coletivos têm `company_id = null`. Para que regras de
   * grupo (group_company_links) ou específicas de empresa consigam casar nesses
   * itens, anexamos aqui os IDs das PJs participantes do pool. O motor aceita
   * o match se `link.company_id` ∈ `pool_company_ids`. Em itens não-pool fica null.
   */
  pool_company_ids?: string[] | null;
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
  /** true se a hora veio explícita na base hospitalar. Sem hora real, adicional noturno NÃO é aplicado. */
  procedure_date_has_time?: boolean | null;
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
  /** Caráter do atendimento lido da planilha ("ELETIVO" | "URGENCIA" | "EMERGENCIA"). */
  attendance_character?: string | null;
  /** Sub-Onda 2C — resolução manual de duplicidade entre cálculos da mesma regra (analista escolheu qual cálculo aplicar). */
  calc_duplicity_resolution?: { chosen_calc_id: string } | null;
  /** Código do caso especial (oncologico, pediatrico, etc.) — preenchido pela marcação. */
  special_case_code?: string | null;
  /** Status da marcação: 'pending' | 'approved' | 'rejected' | 'revoked' | null. */
  special_case_status?: string | null;
  /** item_type_id do item (Parecer, Visita, Consulta, etc.) — usado pelo filtro
   *  de tipo no nível do cálculo (`rule_calculations.item_type_id`). */
  item_type_id?: string | null;
  /** @deprecated — substituído por manual_intervention_reason_id. Mantido para
   *  itens ainda não migrados. */
  calc_exception_skip?: boolean | null;
  /** @deprecated */
  calc_exception_skipped_calc_id?: string | null;
  /** Tratamento manual aplicado pelo analista. Quando setado, o motor pula
   *  toda a aplicação de regras e aceita `procedure_amount` como valor
   *  esperado (= valor do convênio). diff fica zerado, status = aprovado,
   *  calculation_type_used = 'tratamento_manual'. */
  manual_intervention_reason_id?: string | null;
  /** code do motivo (ex.: 'visita_sequencial_parecer') — informativo para
   *  trace/relatórios; o efeito no cálculo é o mesmo para qualquer code. */
  manual_intervention_reason_code?: string | null;
  /** Categoria do motivo: 'reclassificacao_clinica' | 'aceite_financeiro'. */
  manual_intervention_reason_category?: string | null;
  /** Origem: 'manual' (analista) | 'auto_parecer_report' (Fase 2). */
  manual_intervention_source?: string | null;
  /** Estratégia de valor escolhida explicitamente pelo analista no acate em
   *  massa: 'procedure' (valor do convênio) | 'expected' (mantém o valor da
   *  regra) | 'custom' (valor já gravado no item). Quando preenchida, vence a
   *  inferência por categoria do motivo — sem isso a reanálise sobrescrevia a
   *  decisão humana adotando o valor pago. */
  manual_value_strategy?: "procedure" | "expected" | "custom" | string | null;
  /** expected_amount atual do item no banco — usado apenas para preservar o
   *  valor quando manual_value_strategy = 'expected' | 'custom'. */
  current_expected_amount?: number | null;
}

export interface PaymentContext {
  sectors: string[];
  specialties: string[];
  /** @deprecated — preservado durante a transição. Em Fase D o motor não filtra por este campo. */
  payment_type: string | null;
  /** Modelo do lote (producao/remessa/parecer histórico) — informativo no contexto. */
  payment_model?: string | null;
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
  | "grupo_doctor_codigo"
  | "grupo_doctor"
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
  calculation_type_used: CalculationType | "default_geral" | "default_hemodinamica" | "exclusao" | "pacote_fixo" | "tratamento_manual" | "exige_motivo_intervencao";
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
  /** Sub-Onda 2C — quando preenchido, a regra vencedora tem 2+ cálculos válidos para este item. */
  calc_duplicity?: {
    rule_id: string;
    rule_name: string;
    matched_calculations: Array<{
      calc_id: string | null;
      label: string;
      calculation_type: CalculationType;
      expected: number;
    }>;
    resolution_stale?: boolean;
  };
  /**
   * Base de cálculo detectada stateless quando qty>1:
   * - 'unit'      : valor convênio é unitário; esperado = base × qty
   * - 'total'     : valor convênio já vem totalizado; esperado = base
   * - 'ambiguous' : ambas hipóteses casam com o pago dentro da tolerância
   * - 'na'        : qty=1, sem regra calculável, ou tabela diferenciada (qty_already_applied)
   */
  convenio_basis_detected?: "unit" | "total" | "ambiguous" | "na";
  /** Desvio percentual da hipótese escolhida vs valor pago (0 = casa exato). */
  basis_confidence?: number | null;
  /** Piso por procedimento — valor do piso vigente aplicado ao item (R$). null = piso não configurado. */
  piso_aplicado_valor?: number | null;
  /** Método vencedor do MAX(convenio, piso). null = pendente de agregação por atendimento (post-pass). */
  piso_metodo_vencedor?: "convenio" | "piso" | null;
  /** Escopo declarado do piso (por_item | por_atendimento). Usado pelo post-pass. */
  piso_escopo?: "por_item" | "por_atendimento" | null;
}


export interface CalculationBreakdownEntry {
  calc_id?: string | null;
  label: string;
  calculation_type: CalculationType;
  matched: boolean;
  /** Quando matched=false, motivo curto: 'dia_da_semana'|'horario'|'condicoes'. */
  skip_reason?: string | null;
  /** Quando matched=false, motivo em linguagem clara para o analista. */
  skip_reason_label?: string | null;
  expected: number | null;
  explanation: string;
  alerts: string[];
}

/** Motivo de rejeição de um cálculo, em linguagem de analista (ai_findings.calc_rejections). */
export interface CalcRejection {
  calc_id: string | null;
  calc_label: string;
  reason_code: string;
  motivo: string;
  /** true quando o bloqueio é a ausência de marcação de caso especial. */
  needs_special_case?: boolean;
}


export type MainReason =
  | "codigo_principal_pacote"
  | "maior_valor_tabela"
  | "via_principal_unica"
  | "maior_quantidade_ou_bruto"
  | "ambiguo";

// ---------- helpers ----------
export const onlyDigits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");
export const normName = (s: string | null | undefined): string =>
  (String(s ?? "")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Mapeamento estático de fallback. Fonte de verdade real é a tabela `public.sectors`
// (slug + aliases) — quando o motor é chamado pelo edge function, a normalização
// já vem feita via `normalize_sector()` no banco. Este map serve como rede de segurança
// para casos sem cadastro e para os testes unitários.
export const SECTOR_MAP: Record<string, string> = {};

/** Mescla aliases dinâmicos vindos do banco (tabela `sectors`). Chamado pelo analyze-payment. */
export function extendSectorMap(entries: Array<{ slug: string; aliases: string[]; name?: string }>) {
  for (const e of entries) {
    const slug = (e.slug || "").trim();
    if (!slug) continue;
    // Quando a tabela `sectors` usa slug numérico (ex.: 1574), o motor não pode
    // comparar esse número diretamente com as categorias de regra. Se o nome ou
    // algum alias revela uma categoria conhecida, gravamos o mapa para a
    // categoria canônica do engine (`hemodinamica`, `centro_cirurgico`, ...).
    const canonical = [e.name, ...(e.aliases || []), slug]
      .map((v) => applySectorStems(v))
      .find(Boolean) || slug;

    SECTOR_MAP[normName(slug)] = canonical;
    if (e.name) SECTOR_MAP[normName(e.name)] = canonical;
    for (const a of e.aliases || []) {
      const k = normName(a);
      if (k) SECTOR_MAP[k] = canonical;
    }
  }
}

export function inferItemSector(item: ItemInput, ctx?: PaymentContext): string {
  // 1. Prioridade máxima: setor informado na planilha (se for um valor útil).
  //
  //    REGRA DE OURO: o setor declarado pelo analista na coluna "Setor" é
  //    fonte de verdade. NUNCA pode ser sobrescrito por inferência baseada
  //    no procedimento (procedure_classifications), que só atua quando a
  //    planilha NÃO traz setor (caso legado).
  if (item.sector) {
    // 1a. Stems determinísticos primeiro — garantem que termos canônicos
    //     ("Hemodinâmica", "Centro Cirúrgico", "UTI", "Parecer", "RPA", ...)
    //     resolvam para a CATEGORIA canônica do motor, mesmo quando a tabela
    //     `sectors` usa slug numérico (ex.: "1574" para Hemodinâmica DFStar)
    //     ou está vazia/desatualizada. Sem isso, planilhas com "Hemodinâmica"
    //     caíam erroneamente no bucket de Centro Cirúrgico.
    const stem = applySectorStems(item.sector);
    if (stem) return stem;

    const s = normName(item.sector);
    if (s !== "outro" && s !== "outros") {
      const resolved = SECTOR_MAP[s];
      if (resolved) return resolved;

      const parts = s.split(/[\s,/;]+/).filter(Boolean);
      for (const p of parts) {
        if (SECTOR_MAP[p]) return SECTOR_MAP[p];
      }
      
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

  // 3. Classificação determinística pré-aplicada (procedure_classifications)
  if (item.classification_sector) return item.classification_sector;

  // 4. Fallback final: se o pagamento tem múltiplos setores, usa o primeiro como palpite
  //    Heurísticas hardcoded por nome foram removidas — a classificação correta
  //    deve vir do cadastro `procedure_classifications` (motor cruza no banco).
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

/** Coleta de códigos e palavras-chave a partir dos cálculos da regra.
 *  - hasAnyCodes: existe pelo menos um cálculo com whitelist/blacklist de códigos
 *  - hasAnyKeywords: existe pelo menos um cálculo com palavras-chave
 *  - hasFallback: existe pelo menos um cálculo SEM restrição (aceita qualquer)
 *  - allCodes/allKeywords: união dos códigos/palavras declarados nos cálculos
 */
function collectCalcCodes(r: RuleInput): { 
  hasAnyCodes: boolean; 
  hasAnyKeywords: boolean;
  hasFallback: boolean; 
  allCodes: string[];
  allKeywords: string[];
} {
  const calcs = (Array.isArray((r as any).calculations) ? (r as any).calculations : []) as RuleCalculationItem[];
  let hasAnyCodes = false;
  let hasAnyKeywords = false;
  let hasFallback = false;
  const allCodes = new Set<string>();
  const allKeywords = new Set<string>();

  // Legado nível raiz (mantido por defesa)
  if (Array.isArray(r.procedure_codes) && r.procedure_codes.length > 0) {
    hasAnyCodes = true;
    r.procedure_codes.forEach((c) => allCodes.add(c));
  }

  if (calcs.length === 0) {
    if (!hasAnyCodes) hasFallback = true;
    return { hasAnyCodes, hasAnyKeywords, hasFallback, allCodes: Array.from(allCodes), allKeywords: [] };
  }

  for (const c of calcs) {
    const codes = Array.isArray(c.procedure_codes) ? c.procedure_codes : [];
    const keywords: string[] = Array.isArray((c as any).procedure_keywords) ? (c as any).procedure_keywords.map(String) : [];
    const mode = c.code_match_mode ?? "whitelist";

    if (mode === "any" || (codes.length === 0 && keywords.length === 0)) {
      hasFallback = true;
    } else if (mode === "blacklist") {
      // Cálculo em blacklist é semanticamente catch-all: aceita QUALQUER código,
      // exceto os listados. No nível da regra, isso significa que a regra
      // continua candidata mesmo para códigos fora das whitelists dos outros
      // cálculos. O filtro real da blacklist é aplicado por-cálculo depois.
      hasFallback = true;
      // Marcamos hasAnyCodes só para rastreio, mas NÃO incluímos os códigos
      // da blacklist em allCodes — isso evita matches espúrios em matchesProcedureCode.
      if (codes.length > 0) hasAnyCodes = true;
    } else {
      if (codes.length > 0) {
        hasAnyCodes = true;
        codes.forEach((x) => allCodes.add(x));
      }
      if (keywords.length > 0) {
        hasAnyKeywords = true;
        keywords.forEach((x) => allKeywords.add(x));
      }
    }
  }

  return { 
    hasAnyCodes, 
    hasAnyKeywords,
    hasFallback, 
    allCodes: Array.from(allCodes), 
    allKeywords: Array.from(allKeywords) 
  };
}

function matchesProcedureCode(r: RuleInput, item: ItemInput): boolean {
  const info = collectCalcCodes(r);
  if (info.hasFallback) return true;
  if (!info.hasAnyCodes && !info.hasAnyKeywords) return true;

  const itemCode = item.procedure_code;
  const itemText = normName(`${item.procedure_name ?? ""} ${item.description ?? ""}`);

  // 1) Match por código
  if (info.hasAnyCodes && itemCode && info.allCodes.some(pattern => {
    if (pattern.endsWith("*")) return itemCode.startsWith(pattern.slice(0, -1));
    return itemCode === pattern;
  })) return true;

  // 2) Match por palavra-chave
  if (info.hasAnyKeywords) {
    for (const kw of info.allKeywords) {
      if (itemText.includes(normName(kw))) return true;
    }
  }

  return false;
}

function hasCodeRestriction(r: RuleInput): boolean {
  const info = collectCalcCodes(r);
  return (info.hasAnyCodes || info.hasAnyKeywords) && !info.hasFallback;
}

function targetsDoctor(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "especifica" || r.target_type !== "medico") return false;
  // 1) Match por ID do cadastro (preferencial — não quebra por variação de nome)
  if (r.target_doctor_id && item.doctor_id && r.target_doctor_id === item.doctor_id) return true;
  // 2) Match por CRM (digits-only)
  const ruleDoc = onlyDigits(r.target_identifier);
  const itemDoc = onlyDigits(item.doctor_document);
  if (ruleDoc && itemDoc && ruleDoc === itemDoc) return true;
  // 3) Fallback por nome — EXATO normalizado apenas.
  //    Heurística de "prefixo de tokens" foi removida intencionalmente:
  //    causa vazamento de escopo (regra específica casando médico errado).
  //    Vínculo deve ser garantido por ID/CRM no cadastro da regra; falhas
  //    de nome devem cair na regra geral, nunca inferir match.
  if (r.target_name && item.doctor_name) {
    if (normName(r.target_name) === normName(item.doctor_name)) return true;
  }
  return false;
}


function targetsCompany(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "especifica" || r.target_type !== "empresa") return false;
  // 1) Match por ID do cadastro (preferencial)
  if (r.target_company_id && item.company_id && r.target_company_id === item.company_id) return true;
  // 1.b) Item de pool (company_id=null): aceita se a regra alvo é uma PJ participante.
  if (r.target_company_id && !item.company_id && Array.isArray(item.pool_company_ids)
      && item.pool_company_ids.includes(r.target_company_id)) return true;
  // 2) Match por CNPJ (digits-only)
  const ruleDoc = onlyDigits(r.target_identifier);
  const itemDoc = onlyDigits(item.company_document);
  if (ruleDoc && itemDoc && ruleDoc === itemDoc) return true;
  // 3) Fallback por nome
  if (r.target_name && item.company_name && normName(r.target_name) === normName(item.company_name)) return true;
  return false;
}

type DoctorRole = "cirurgiao" | "primeiro_aux" | "demais_aux" | "instrumentador" | "outro";
function classifyDoctorRole(role: string | null | undefined): DoctorRole {
  const s = (role ?? "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!s) return "outro";

  // 0) Chaves canônicas usadas internamente (rule_calculations.doctor_roles, configs).
  //    Aceita formas curtas/canonical para que normalizar("demais_aux") → "demais_aux"
  //    em vez de cair no fallback de includes("aux") → "primeiro_aux".
  //    BUG histórico: "demais_aux" caía em "primeiro_aux" porque o regex de
  //    2º/segundo não cobre "demais", e o fallback abaixo trata qualquer "aux"
  //    como 1º. Isso fazia regras com doctor_roles=["...","demais_aux"]
  //    rejeitarem itens classificados como demais_aux.
  if (s === "cirurgiao" || s === "cirurgiao_principal" || s === "principal" || s === "operador") return "cirurgiao";
  if (s === "instrumentador") return "instrumentador";
  if (
    s === "demais_aux" || s === "demais_auxiliares" || s === "demais" ||
    s === "aux2" || s === "segundo_aux" || s === "segundo_auxiliar" ||
    s === "aux3" || s === "terceiro_aux" || s === "terceiro_auxiliar"
  ) return "demais_aux";
  if (
    s === "primeiro_aux" || s === "primeiro_auxiliar" || s === "aux1" ||
    s === "auxiliar" || s === "aux"
  ) return "primeiro_aux";

  if (s.includes("instrument")) return "instrumentador";
  if (s.includes("cirurgi") || s.includes("operador")) return "cirurgiao";

  // "demais auxiliares" em texto livre → 2º+
  if (s.includes("demais") && (s.includes("aux") || s.includes("ajudante"))) {
    return "demais_aux";
  }

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

/** Match um médico do item contra uma lista que pode trazer { id, name, crm }. */
function matchDoctorInList(
  doctors: { id?: string | null; name?: string; crm?: string }[] | undefined,
  item: ItemInput,
): boolean {
  if (!doctors?.length) return false;
  const itemNm = item.doctor_name ? normName(item.doctor_name) : "";

  const itemCrm = onlyDigits(item.doctor_document);
  const itemId = item.doctor_id ? String(item.doctor_id) : "";
  for (const d of doctors) {
    // 1) ID do cadastro (preferencial)
    if (d?.id && itemId && String(d.id) === itemId) return true;
    // 2) CRM digits
    if (d?.crm && itemCrm && onlyDigits(d.crm) === itemCrm) return true;
    // 3) Nome normalizado (EXATO apenas).
    //    Heurística de "prefixo de tokens" foi removida — causava vazamento
    //    de escopo (médico errado entrando em regra específica). Garanta o
    //    vínculo via ID/CRM no cadastro; sem match → cai na regra geral.
    if (d?.name && itemNm && normName(d.name) === itemNm) return true;

  }
  return false;
}

function targetsGroup(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "grupo") return false;
  const links = r.group_company_links ?? [];
  const looseDoctors = r.group_doctors ?? [];

  // Match por médico específico (independente da PJ): segue o médico em qualquer empresa.
  if (looseDoctors.length > 0 && matchDoctorInList(looseDoctors as any, item)) return true;

  // Vínculos por empresa: empresa do item precisa estar na lista; se a lista de
  // médicos do link estiver vazia, vale para toda a equipe da PJ. Se a lista tem
  // médicos, novos médicos da PJ entram automaticamente (auto-include) — exceto
  // quando explicitamente listados em excluded_doctors, ou quando o link tiver
  // auto_include_new_doctors === false (modo allowlist estrita legado).
  // Pool soberano: item coletivo tem company_id=null; consideramos como
  // "pertencente" a qualquer PJ participante listada em pool_company_ids.
  const poolIds = Array.isArray(item.pool_company_ids) ? item.pool_company_ids : null;
  const itemCompanyId = item.company_id ? String(item.company_id) : null;
  for (const link of links) {
    if (!link?.company_id) continue;
    const linkCompanyId = String(link.company_id);
    const matchesByItem = itemCompanyId !== null && itemCompanyId === linkCompanyId;
    const matchesByPool = itemCompanyId === null && poolIds !== null && poolIds.includes(linkCompanyId);
    if (!matchesByItem && !matchesByPool) continue;
    const ds = (link.doctors ?? []) as any;
    // Auto-exclusão: médico tem regra específica própria → não casa nesta regra de PJ.
    const autoExcludedIds = (link.auto_excluded_doctor_ids ?? []) as string[];
    const itemDoctorId = item.doctor_id ? String(item.doctor_id) : null;
    if (itemDoctorId && autoExcludedIds.some((x) => String(x) === itemDoctorId)) continue;
    // Exclusão manual (via UI): respeitada em QUALQUER modo — inclusive quando
    // o link vale para toda a equipe (doctors=[]). Antes ficava só no branch
    // de auto_include e o médico continuava caindo na regra da PJ mesmo após
    // ser removido explicitamente. Fix: 22/07/2026.
    const excluded = (link.excluded_doctors ?? []) as any;
    if (excluded.length > 0 && matchDoctorInList(excluded, item)) continue;
    if (ds.length === 0) return true;
    if (matchDoctorInList(ds, item)) return true;
    // Lista de médicos preenchida = allowlist por padrão.
    // auto_include_new_doctors deve ser explicitamente true para incluir quem não está na lista.
    if (link.auto_include_new_doctors !== true) continue;
    // Auto-include explícito: exclusão já foi checada acima.

    return true;
  }

  return false;
}


/**
 * Subconjunto de `targetsGroup`: retorna true SOMENTE quando o match ocorreu
 * por médico específico (group_doctors OU link.doctors com id/CRM/nome listado).
 */
function targetsGroupByDoctor(r: RuleInput, item: ItemInput): boolean {
  if (r.scope !== "grupo") return false;
  if (!item.doctor_id && !item.doctor_name) return false;

  if (matchDoctorInList((r.group_doctors ?? []) as any, item)) return true;

  const poolIds = Array.isArray(item.pool_company_ids) ? item.pool_company_ids : null;
  const itemCompanyId = item.company_id ? String(item.company_id) : null;
  for (const link of r.group_company_links ?? []) {
    if (!link?.company_id) continue;
    const linkCompanyId = String(link.company_id);
    const matchesByItem = itemCompanyId !== null && itemCompanyId === linkCompanyId;
    const matchesByPool = itemCompanyId === null && poolIds !== null && poolIds.includes(linkCompanyId);
    if (!matchesByItem && !matchesByPool) continue;
    if (matchDoctorInList((link.doctors ?? []) as any, item)) return true;
  }
  return false;
}



// ---------- match por convênio ----------
/**
 * Mapa dinâmico de aliases de convênio. Fonte de verdade: tabela `public.convenios`.
 * Hidratado por `extendConvenioMap` (chamado pelo analyze-payment no boot).
 * Chave: forma normalizada (sem acentos/espaços/pontuação). Valor: slug canônico.
 */
export const CONVENIO_MAP: Record<string, string> = {};

export function extendConvenioMap(entries: Array<{ slug: string; aliases: string[]; name?: string }>) {
  for (const e of entries) {
    const slug = (e.slug || "").trim();
    if (!slug) continue;
    const normKey = (s: string) =>
      (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[\s_\-./()]+/g, "");
    CONVENIO_MAP[normKey(slug)] = slug;
    if (e.name) CONVENIO_MAP[normKey(e.name)] = slug;
    for (const a of e.aliases || []) {
      const k = normKey(a);
      if (k) CONVENIO_MAP[k] = slug;
    }
  }
}



/** Normaliza convênio em 3 camadas, da mais específica para a mais permissiva:
 *  1) Match exato via CONVENIO_MAP (aliases do cadastro `convenios`).
 *  2) Regras de stem hardcoded (rede de segurança — não depende do banco).
 *  3) Fallback startsWith sobre CONVENIO_MAP (sufixos como "empresarial").
 *  Camadas (2) e (3) registram o raw como alias aprendido, para enriquecimento futuro. */
const normAgreement = (s: string | null | undefined): string => {
  const raw = (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const base = raw.replace(/[\s_\-./()]+/g, "");
  if (!base) return "";

  // 1) match exato (cadastro)
  if (CONVENIO_MAP[base]) return CONVENIO_MAP[base];

  // 2) stems hardcoded — opera sobre a forma com espaços para precisão dos regex
  const stem = applyConvenioStems(raw);
  if (stem) {
    if (s) recordLearnedAlias(stem, s);
    return stem;
  }

  // 3) fallback startsWith — tolera sufixos ("bradescosegurempresarial" → "bradesco_segur")
  for (const [k, v] of Object.entries(CONVENIO_MAP)) {
    if (k.length >= 4 && base.startsWith(k)) {
      if (s) recordLearnedAlias(v, s);
      return v;
    }
  }
  return base;
};

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
  // Match exato (já normalizado via CONVENIO_MAP — cadastro oficial cobre aliases).
  // Removido o fallback startsWith por gerar falsos positivos (ex.: "bradesco"
  // batendo com "bradesco_segur").
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

    // TIPO DE ITEM: o filtro foi MOVIDO para o nível do cálculo
    // (`rule_calculations.item_type_id`). A coluna `rules.payment_type_id`
    // foi descontinuada (Fase D) — a UI não grava mais nela e o motor não
    // filtra regras inteiras por tipo. Cada cálculo individualmente decide
    // via `calcItemMatches` se aplica ao item.

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
  const itemSectorNorm = SECTOR_MAP[normName(itemSector)] || normName(itemSector);
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
  // Bucket "grupo" dividido em dois níveis:
  //  - groupDoctorRules: regra de grupo que cita ESTE médico (group_doctors ou link.doctors).
  //    Vence o nível "grupo amplo" porque a regra é exclusiva do médico,
  //    independente da PJ pela qual ele esteja faturando no momento.
  //  - groupCompanyRules: regra de grupo que cobre a PJ inteira (link SEM doctors).
  //    Só é avaliada se o item não bateu antes em uma regra médico-específica
  //    — isso "expurga" automaticamente médicos com regra própria.
  const allGroup     = rules.filter((r) => targetsGroup(r, item));
  const groupDoctorRules  = filterBySpecialty(allGroup.filter((r) => targetsGroupByDoctor(r, item)), "grupo_doctor");
  const groupCompanyRules = filterBySpecialty(allGroup.filter((r) => !targetsGroupByDoctor(r, item)), "grupo");
  const sectorRules   = filterBySpecialty(rules.filter((r) => r.scope === "master" && ruleSectors(r).length > 0 && intersectsAll(ruleSectors(r).map(s => SECTOR_MAP[normName(s)] || normName(s)), [itemSectorNorm])), "setor");
  const hemoMaster    = isHemo ? filterBySpecialty(rules.filter((r) => r.scope === "master" && ruleSectors(r).includes("hemodinamica")), "setor_hemodinamica_master") : [];
  const generalMaster = filterBySpecialty(rules.filter((r) => r.scope === "master" && ruleSectors(r).length === 0), "setor_master_geral");

  const levels: Array<{
    bucket: RuleInput[];
    withCodePriority: RuleMatchPriority;
    withoutCodePriority: RuleMatchPriority;
    enabled?: boolean;
  }> = [
    { bucket: doctorRules,       withCodePriority: "medico_codigo",        withoutCodePriority: "medico" },
    // Regra de grupo que cita o médico é um acordo pessoal: segue o médico em
    // qualquer PJ e deve vencer regra específica da empresa/PJ. Regressão real:
    // Dr. Pablo tinha group_doctors, mas a regra específica da PJ venceu antes.
    { bucket: groupDoctorRules,  withCodePriority: "grupo_doctor_codigo",  withoutCodePriority: "grupo_doctor" },
    { bucket: companyRules,      withCodePriority: "empresa_codigo",       withoutCodePriority: "empresa" },
    { bucket: groupCompanyRules, withCodePriority: "grupo_codigo",         withoutCodePriority: "grupo" },
    { bucket: sectorRules,       withCodePriority: "setor_codigo",         withoutCodePriority: "setor" },
    { bucket: hemoMaster,        withCodePriority: "setor_codigo",         withoutCodePriority: "setor_hemodinamica_master", enabled: isHemo },
    { bucket: generalMaster,     withCodePriority: "setor_codigo",         withoutCodePriority: "setor_master_geral" },
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

/**
 * Fator de função do médico baseado EXCLUSIVAMENTE nos percentuais cadastrados
 * na regra. NUNCA aplica defaults hardcoded — se a regra não definir o
 * percentual da função (mesmo com include_auxiliaries=true), retorna 1
 * (100%, sem desconto inferido). Memória de projeto:
 * "Motor nunca aplica default hardcoded — sem regra cadastrada = sem regra,
 *  jamais valor inferido."
 *
 * O caller (calcPercentual / calcRegraVias / calcTabelaDiferenciada) é
 * responsável por emitir alerta quando include_auxiliaries=true mas o pct
 * específico não foi cadastrado.
 */
export function doctorRoleFactor(
  raw: string | null | undefined,
  rule?: { instrumentador_pct?: number | null; aux_first_pct?: number | null; aux_second_pct?: number | null; include_auxiliaries?: boolean | null } | null,
): number {
  const t = normName(raw);
  if (!t) return 1;
  if (!rule) return 1;
  if (/(instrumentador)/.test(t)) {
    return rule.instrumentador_pct != null ? rule.instrumentador_pct / 100 : 1;
  }
  if (/(2.*auxili|segundo auxili)/.test(t)) {
    return rule.aux_second_pct != null ? rule.aux_second_pct / 100 : 1;
  }
  if (/(1.*auxili|primeiro auxili|auxili)/.test(t)) {
    return rule.aux_first_pct != null ? rule.aux_first_pct / 100 : 1;
  }
  return 1;
}

// ---------- calculadores ----------
// ExpectedCalc interface moved to export section to avoid duplication and conflicts.

/**
 * Resolve o valor do piso (mínimo garantido por procedimento) para a função
 * do médico neste item. Consulta `piso_por_funcao` (chaves canônicas
 * cirurgiao/primeiro_aux/demais_aux/instrumentador/outro); se não achar,
 * cai em `piso_valor_padrao`. Retorna null quando piso não está configurado.
 */
export function resolvePisoForRole(
  c: {
    piso_habilitado?: boolean | null;
    piso_valor_padrao?: number | null;
    piso_por_funcao?: Array<{ role: string; valor: number; label?: string | null }> | null;
  },
  doctorRole: string | null | undefined,
): number | null {
  if (c.piso_habilitado !== true) return null;
  const roleKey = classifyDoctorRole(doctorRole);
  const list = Array.isArray(c.piso_por_funcao) ? c.piso_por_funcao : [];
  for (const entry of list) {
    if (!entry || typeof entry.valor !== "number") continue;
    const entryKey = classifyDoctorRole(String(entry.role ?? ""));
    if (entryKey === roleKey && entry.valor > 0) return entry.valor;
  }
  const fallback = c.piso_valor_padrao;
  return typeof fallback === "number" && fallback > 0 ? fallback : null;
}



function calcPercentual(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const pct = rule.convenio_percentage ?? 100;
  const factor = doctorRoleFactor(item.doctor_role, rule);
  const base = item.procedure_amount;
  if (base == null) return { expected: null, explanation: `${pct}% do convênio — valor base ausente.`, alerts: ["procedure_amount ausente."] };
  
  const unitValue = round2(base * (pct / 100));
  const expected = round2(unitValue * factor);
  
  let explanation = `${pct}% × R$ ${base.toFixed(2)}`;
  if (factor !== 1) {
    explanation += ` × fator função(${(factor * 100).toFixed(0)}%) = R$ ${expected.toFixed(2)}`;
  } else {
    explanation += ` = R$ ${expected.toFixed(2)}`;
  }
  
  return { expected, explanation, alerts: [] };
}

function calcRegraVias(rule: RuleInput, item: ItemInput): ExpectedCalc {
  const viaFactor = accessRouteFactor(item.access_route);
  const funcFactor = doctorRoleFactor(item.doctor_role, rule);
  const base = item.procedure_amount;
  if (base == null) return { expected: null, explanation: "regra_vias: valor base ausente.", alerts: ["procedure_amount ausente."] };
  
  const expected = round2(base * viaFactor * funcFactor);
  let explanation = `Via "${item.access_route ?? "—"}" → fator ${viaFactor}`;
  if (funcFactor !== 1) explanation += ` × fator função ${funcFactor}`;
  explanation += ` × R$ ${base.toFixed(2)} = R$ ${expected.toFixed(2)}`;
  
  return { expected, explanation, alerts: [] };
}

const isVisita  = (it: ItemInput) => /visita/.test(normName(`${it.procedure_name ?? ""} ${it.description ?? ""}`));
const isParecer = (it: ItemInput) => /parecer/.test(normName(`${it.procedure_name ?? ""} ${it.description ?? ""}`));
const isAuxiliar = (it: ItemInput) => /auxili|instrumentador/.test(normName(it.doctor_role ?? ""));

/** Aceita main_code como string única OU lista separada por vírgula/espaço/ponto-e-vírgula. */
function splitMainCodes(raw: string | null | undefined): string[] {
  return String(raw ?? "").split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);
}

function isMainPackageCode(rule: RuleInput, item: ItemInput): boolean {
  if (!item.procedure_code) return false;
  const codes = splitMainCodes(rule.package_main_code);
  if (codes.length > 0) return codes.includes(item.procedure_code);
  // fallback: se não houver main_code definido, qualquer item é considerado principal
  return true;
}

function packageMainPresentInAttendance(rule: RuleInput, item: ItemInput, ctx?: EngineCtx): boolean {
  const mainCodes = splitMainCodes(rule.package_main_code);
  if (mainCodes.length === 0) return true;
  const key = (item as any).attendance_group_key ?? item.attendance_number ?? "";
  const siblings = ctx?.attendanceSiblingCodes?.get(key) ?? new Set<string>();
  const currentCode = String(item.procedure_code ?? "").trim();
  return mainCodes.some((c) => siblings.has(c) || currentCode === c);
}


function isIncludedInPackage(rule: RuleInput, item: ItemInput): boolean {
  const inc = rule.package_included_codes ?? [];
  if (item.procedure_code && inc.includes(item.procedure_code)) return true;
  if (rule.package_visits_count && isVisita(item)) return true;
  if (rule.package_opinions_count && isParecer(item)) return true;
  if (rule.package_auxiliaries_included && isAuxiliar(item)) return true;
  return false;
}

function packageMatchScore(rule: RuleInput, item: ItemInput, ctx?: EngineCtx): number {
  // Só pontua se o código principal está presente
  if (!isMainPackageCode(rule, item)) return -1;

  const included = (rule.package_included_codes ?? [])
    .map((c: string) => String(c).trim())
    .filter(Boolean);

  if (included.length === 0) return 0; // sem incluídos → score 0 (pacote simples)

  const key = (item as any).attendance_group_key ?? item.attendance_number ?? "";
  const siblings = ctx?.attendanceSiblingCodes?.get(key) ?? new Set<string>();

  const matches = included.filter((c) => siblings.has(c)).length;
  if (matches === 0) return -1; // precisa de ao menos 1 incluído presente

  return matches / included.length; // 0.0 a 1.0
}

function calcPacoteFechado(rule: RuleInput, item: ItemInput, ctx?: EngineCtx): ExpectedCalc {
  if (rule.package_amount == null) {
    return { expected: null, explanation: "pacote_fechado sem package_amount.", alerts: ["Pacote sem valor."] };
  }
  if (!packageMainPresentInAttendance(rule, item, ctx)) {
    return { expected: null, explanation: `Pacote sem código principal presente no atendimento — segue próximo cálculo.`, alerts: [] };
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

function calcPacoteExtras(rule: RuleInput, item: ItemInput, ctx?: EngineCtx): ExpectedCalc {
  const pkg = rule.package_amount ?? 0;
  if (!packageMainPresentInAttendance(rule, item, ctx)) {
    return { expected: null, explanation: `Pacote sem código principal presente no atendimento — segue próximo cálculo.`, alerts: [] };
  }
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
function _matchRoleKey(doctorRole: string | null | undefined, roleKey: string): boolean {
  const r = (doctorRole ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const k = (roleKey ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!k) return false;
  if (k === "cirurgiao") return r.includes("cirurgi") || r.includes("principal") || r.includes("operador");
  if (k === "aux1" || k === "primeiro_aux" || k === "primeiro_auxiliar") return r.includes("primeiro") || /\b1\b/.test(r) || /1[ºo]/.test(r);
  if (k === "aux2" || k === "segundo_aux" || k === "segundo_auxiliar" || k === "demais_aux") return r.includes("segundo") || /\b2\b/.test(r) || /2[ºo]/.test(r);
  if (k === "aux3" || k === "terceiro_aux" || k === "terceiro_auxiliar") return r.includes("terceiro") || /\b3\b/.test(r) || /3[ºo]/.test(r);
  if (k === "instrumentador") return r.includes("instrument");
  return r.includes(k);
}

function calcPacotePorAtendimento(
  rule: RuleInput,
  item: ItemInput,
  applied: Set<string>,
  ctx?: EngineCtx,
): ExpectedCalc {
  if (rule.package_amount == null) {
    return { expected: null, explanation: "pacote_por_atendimento sem package_amount.", alerts: ["Pacote sem valor."] };
  }
  if (!packageMainPresentInAttendance(rule, item, ctx)) {
    return { expected: null, explanation: `Pacote sem código principal presente no atendimento — segue próximo cálculo.`, alerts: [] };
  }
  // Lock pré-passe (Correção C) — só o calc vencedor do atendimento aplica.
  {
    const attKey = (item as any).attendance_group_key ?? item.attendance_number ?? "";
    const lockKey = `${rule.id}|${attKey}`;
    const winnerCalcId = ctx?.lockedPackageCalcByRuleAtt?.get(lockKey);
    const myCalcId = (rule as any).__calc_id ?? null;
    if (winnerCalcId !== undefined && winnerCalcId !== null && myCalcId !== null && winnerCalcId !== myCalcId) {
      return {
        expected: null,
        explanation: `Pacote não vencedor para o atendimento ${attKey} (vencedor: ${winnerCalcId}).`,
        alerts: [],
      };
    }
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

  // ---- Distribuição por função (package_roles_distribution) ----
  // Quando a regra/calc declara uma distribuição por função, cada item
  // recebe o valor da SUA função (não o pacote cheio). Isso permite que
  // cirurgião, 1º aux e 2º aux do mesmo atendimento cada um receba o
  // que lhe cabe. Para evitar duplicidade quando dois itens da mesma
  // função entram no pacote (raro: duas vias de acesso), só o primeiro
  // (att|role) carrega o valor; os demais ficam absorvidos (expected=0).
  const dist = (rule as any).package_roles_distribution as
    | Array<{ role_key: string; dist_type: "fixo" | "pct"; value: number; label?: string }>
    | null
    | undefined;
  if (Array.isArray(dist) && dist.length > 0 && item.doctor_role) {
    const match = dist.find((d) => _matchRoleKey(item.doctor_role, d.role_key));
    if (match) {
      const value = match.dist_type === "fixo"
        ? Number(match.value)
        : (Number(match.value) / 100) * Number(rule.package_amount);
      const roleKey = `${att}|${(item.doctor_role ?? "").toString().toLowerCase().trim()}`;
      if (!applied.has(roleKey)) {
        applied.add(roleKey);
        return {
          expected: Number(value.toFixed(2)),
          explanation: `Pacote ${att} — distribuição "${match.label ?? match.role_key}" para "${item.doctor_role}": R$ ${value.toFixed(2)}`,
          alerts: [],
        };
      }
      return {
        expected: 0,
        explanation: `Item adicional da função "${item.doctor_role}" no pacote ${att} — absorvido (valor já alocado a outro item da mesma função).`,
        alerts: [],
      };
    }
    // Função não consta na distribuição → item fora do pacote (cai em outro cálculo).
    return {
      expected: null,
      explanation: `Pacote ${att} — função "${item.doctor_role}" não está na distribuição configurada.`,
      alerts: [`Função "${item.doctor_role}" sem entrada em package_roles_distribution.`],
    };
  }

  // Decide qual item leva o pacote: o "principal" se houver, senão o primeiro processado
  const isMain = isMainPackageCode(rule, item);
  const score = packageMatchScore(rule, item, ctx);
  if (!applied.has(att) && isMain && score >= 0) {
    // score >= 0 significa: código principal presente + ao menos 1 incluído
    // (ou pacote sem incluídos, score = 0)
    applied.add(att);
    return {
      expected: Number(rule.package_amount),
      explanation: `Pacote por atendimento ${att} (score ${(score * 100).toFixed(0)}%) aplicado em ${item.procedure_code ?? "principal"}: R$ ${rule.package_amount.toFixed(2)}`,
      alerts: [],
    };
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

function evalContextConditions(
  conditions: ContextCondition[] | null | undefined,
  item: ItemInput,
  ctx?: EngineCtx,
): { matched: ContextCondition; index: number } | null {
  const list = Array.isArray(conditions) ? conditions : [];
  if (list.length === 0) return null;
  const key = (item as any).attendance_group_key ?? item.attendance_number ?? "";
  const siblings = ctx?.attendanceSiblingCodes?.get(key) ?? new Set<string>();
  const otherCodes = new Set(siblings);
  otherCodes.delete(String(item.procedure_code ?? "").trim());
  otherCodes.delete(String((item as any).tuss_code ?? "").trim());
  otherCodes.delete("");
  for (let i = 0; i < list.length; i++) {
    const cond = list[i];
    const triggers = (cond.trigger_codes ?? []).map((c) => String(c).trim()).filter(Boolean);
    if (triggers.length === 0) continue;
    const matched = cond.match_mode === "all"
      ? triggers.every((c) => otherCodes.has(c))
      : triggers.some((c) => otherCodes.has(c));
    if (matched) return { matched: cond, index: i };
  }
  return null;
}

function calcValorFixo(rule: RuleInput, item?: ItemInput, ctx?: EngineCtx): ExpectedCalc {
  if (item) {
    const hit = evalContextConditions(rule.context_conditions, item, ctx);
    if (hit) {
      const v = Number(hit.matched.value ?? 0);
      const trig = (hit.matched.trigger_codes ?? []).join(", ");
      return {
        expected: v,
        explanation: `Valor fixo (condição de contexto #${hit.index + 1} bateu — atendimento contém ${hit.matched.match_mode === "all" ? "todos" : "algum"} de [${trig}]): R$ ${v.toFixed(2)}`,
        alerts: [],
      };
    }
  }
  // Valor por função (override) — vence sobre o valor global se a função do item
  // estiver mapeada e tiver um valor numérico explícito.
  const byRole = rule.fixed_amount_by_role ?? null;
  if (byRole && item) {
    const roleKey = classifyDoctorRole(item.doctor_role);
    const raw = byRole[roleKey];
    if (raw != null && isFinite(Number(raw))) {
      const v = Number(raw);
      const roleLabel = roleKey === "cirurgiao" ? "Cirurgião Principal"
        : roleKey === "primeiro_aux" ? "1º Auxiliar"
        : roleKey === "demais_aux" ? "Demais Auxiliares"
        : roleKey === "instrumentador" ? "Instrumentador"
        : item.doctor_role ?? "função";
      return {
        expected: Number(v.toFixed(2)),
        explanation: `Valor fixo por função "${roleLabel}": R$ ${v.toFixed(2)}`,
        alerts: [],
      };
    }
  }
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

// calcDefault removido — o motor não aplica mais defaults por setor (88% / 100%).
// Princípio: sem regra cadastrada = "sem_regra" + alerta, jamais valor inferido.
// Os literais "default_geral" / "default_hemodinamica" permanecem no type union
// apenas para compatibilidade histórica com payment_items legados e mapeamento
// em calcMethodMapping.ts (mapeiam para null no banco).

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
  /** Índice atendimento → códigos de procedimento dos itens do mesmo atendimento. */
  attendanceSiblingCodes?: Map<string, Set<string>>;
  /** Pré-passe — para cada (rule_id|attendance_key), o calc_id do pacote
   *  que venceu pela cobertura do atendimento inteiro. Cálculos de pacote
   *  diferentes do registrado aqui NÃO devem aplicar nesse atendimento. */
  lockedPackageCalcByRuleAtt?: Map<string, string | null>;
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
  // ---- Catch-all flag ----
  // Quando `is_catch_all = true`, este cálculo é o "piso" da regra: ignora
  // qualquer whitelist/blacklist de procedure_codes e procedure_keywords.
  // Todos os demais filtros (convênio, setor, função, via, horário, etc.)
  // continuam aplicáveis — catch-all só relaxa a dimensão de código.
  const isCatchAll = c.is_catch_all === true;

  const specialCases = Array.isArray(c.special_case_filter) ? c.special_case_filter.filter(Boolean) : [];
  if (specialCases.length > 0) {
    const itemCaseCode = (item.special_case_code ?? "").trim();
    const itemCaseApproved = item.special_case_status === "approved" && !!itemCaseCode;
    if (!itemCaseApproved) return { ok: false, reason: "caso_especial_nao_aprovado" };
    if (!specialCases.includes("*") && !specialCases.includes(itemCaseCode)) {
      return { ok: false, reason: "caso_especial_nao_listado" };
    }
  }

  // ---- Tipo de item (Parecer × Visita × Consulta etc.) ----
  // Cálculo restrito a um `item_type_id` só casa se o item tiver o mesmo tipo.
  // NULL no cálculo = vale para qualquer tipo. NULL no item = sem classificação
  // → NÃO casa cálculos tipados (evita aplicar regra de Parecer em base sem
  // classificação).
  const calcItemType = c.item_type_id ?? null;
  if (calcItemType) {
    // Exceção do cálculo: analista marcou o item para pular cálculos tipados
    // desta regra. O item cai no próximo cálculo elegível por prioridade,
    // mesmo que esse próximo cálculo seja tipado de outra forma (ex.: regra
    // com Parecer + Visita, ambos tipados, sem universal → ao pular Parecer,
    // aceita o cálculo de Visita / percentual do convênio).
    if (item.calc_exception_skip === true) {
      const skippedId = (item as any).calc_exception_skipped_calc_id ?? null;
      // Pula APENAS o cálculo originalmente aplicado (registrado no flag).
      // Demais cálculos tipados da mesma regra ficam elegíveis.
      if (skippedId && c.id === skippedId) {
        return { ok: false, reason: "item_calc_exception_skip" };
      }
      // sem skippedId guardado: pula qualquer cálculo tipado igual ao do item
      if (!skippedId) {
        const itemType = item.item_type_id ?? null;
        if (itemType && itemType === calcItemType) {
          return { ok: false, reason: "item_calc_exception_skip" };
        }
      }
      // demais cálculos: aceitos (ignora restrição de tipo)
    } else {
      const itemType = item.item_type_id ?? null;
      if (!itemType || itemType !== calcItemType) {
        return { ok: false, reason: "item_type_nao_corresponde" };
      }
    }
  }





  // ---- Filtros restritivos por cálculo ----
  // Códigos de procedimento (whitelist/blacklist/any)
  // Convenção pós-refactor: lista vazia = sem filtro de código (fallback).
  const codes = Array.isArray(c.procedure_codes) 
    ? c.procedure_codes.map(c => String(c).trim()).filter(Boolean) 
    : [];
  const codeMode = (c.code_match_mode ?? "any") as "whitelist" | "blacklist" | "any";
  if (!isCatchAll && codeMode !== "any" && codes.length > 0) {
    const ic = (item.procedure_code ?? "").trim();
    const match = !!ic && codes.some(pattern => {
      if (pattern.endsWith("*")) {
        return ic.startsWith(pattern.slice(0, -1));
      }
      return ic === pattern;
    });
    
    if (codeMode === "whitelist" && !match) return { ok: false, reason: "codigo_nao_listado" };
    if (codeMode === "blacklist" && match) return { ok: false, reason: "codigo_excluido" };
  }

  // Novo: Suporte a palavras-chave no item de cálculo
  const keywords: string[] = Array.isArray((c as any).procedure_keywords) 
    ? (c as any).procedure_keywords.filter(Boolean).map(String) 
    : [];
  if (!isCatchAll && keywords.length > 0) {
    const itemText = normName(`${item.procedure_name ?? ""} ${item.description ?? ""}`);
    const match = keywords.some(kw => itemText.includes(normName(kw)));
    if (!match) return { ok: false, reason: "palavra_chave" };
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
  // Função do médico — normaliza ambos os lados via classifyDoctorRole para
  // tolerar aliases (ex.: regra cadastrada como "primeiro_auxiliar" ou "aux1"
  // bate com item classificado como "primeiro_aux"). Sem essa normalização,
  // linhas de cálculo válidas eram descartadas e o motor caía em fallback.
  const roles = Array.isArray(c.doctor_roles) ? c.doctor_roles.filter(Boolean) : [];
  if (roles.length > 0) {
    const itemRole = classifyDoctorRole(item.doctor_role);
    const normalizedRoles = roles.map((r) => classifyDoctorRole(String(r)));
    if (!normalizedRoles.includes(itemRole)) {
      return { ok: false, reason: `funcao_medico (item: ${itemRole}, esperado: ${roles.join(", ")})` };
    }
  }
  // Setores
  const cSectors = Array.isArray(c.sectors) ? c.sectors.filter(Boolean) : [];
  if (cSectors.length > 0) {
    const itemSector = inferItemSector(item);
    const normSectors = cSectors.flatMap((s) => {
      const parts = String(s).split(/[\s,/;]+/).filter(Boolean);
      return parts.map(p => {
        const n = normName(p);
        return SECTOR_MAP[n] || n;
      });
    });
    const itemSectorNorm = SECTOR_MAP[normName(itemSector)] || normName(itemSector);
    
    if (!normSectors.includes(itemSectorNorm)) {
      return { ok: false, reason: "setor" };
    }
  }
  // Especialidade — exceção à regra "especialidade é só relatório". Agora exige
  // opt-in explícito via `match_by_specialty=true` no cálculo (default false).
  // Quando ligado E specialties[] não-vazio, passa a filtrar. Sem o toggle,
  // specialties[] é apenas informativo, preservando o comportamento histórico
  // (cirurgia/hemo) mesmo se a lista estiver populada por engano.
  const cSpecs = Array.isArray(c.specialties) ? c.specialties.filter(Boolean) : [];
  if (c.match_by_specialty === true && cSpecs.length > 0) {
    const itemSpec = normName(String(item.specialty ?? ""));
    if (!itemSpec) return { ok: false, reason: "especialidade_nao_informada" };
    const normSpecs = cSpecs.map((s) => normName(String(s)));
    if (!normSpecs.includes(itemSpec)) {
      return { ok: false, reason: `especialidade (item: ${itemSpec})` };
    }
  }
  // Via de acesso
  if (!ruleAcceptsAccessRoute(c, item)) {
    return { ok: false, reason: "via_de_acesso" };
  }
  // Dia da semana — preferimos o array `weekdays` (modo personalizado) e,
  // quando vazio, derivamos do `time_mode` (fim_de_semana / comercial / fora_comercial).
  const tm = (c.time_mode ?? "qualquer") as string;
  // Preset "feriado": aceita SOMENTE se a data do procedimento for feriado nacional.
  // Não depende de weekdays; força includes_holidays semanticamente.
  if (tm === "feriado" && item.procedure_date) {
    if (!isBrazilianNationalHoliday(item.procedure_date)) {
      return { ok: false, reason: "feriado" };
    }
  }
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
      let inSet = effectiveWeekdays.includes(day);
      // Feriado nacional conta como "fim de semana" quando o cálculo declara
      // includes_holidays = true. Cobre o caso em que a regra de bônus de
      // weekend/feriado deve disparar numa terça-feira que é Tiradentes, p.ex.
      const isHoliday = c.includes_holidays === true && isBrazilianNationalHoliday(item.procedure_date);
      if (isHoliday && (tm === "fim_de_semana" || tm === "fora_comercial")) {
        inSet = true;
      }
      if (tm === "fora_comercial") {
        // Fora comercial = (sáb/dom/feriado) OU (seg-sex fora 07-19h). Aqui validamos só o dia
        // quando não há janela horária; o filtro de horário restante cai no bloco abaixo.
        if (inSet && !c.time_start && !c.time_end && !isHoliday) return { ok: false, reason: "fora_comercial_dia_util" };
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
    // 1) Fonte preferencial: campo estruturado vindo da planilha ("Tipo Entrada").
    // 2) Fallback: regex no nome do procedimento (compatibilidade com bases antigas).
    const charRaw = (item.attendance_character ?? "").toString().trim().toLowerCase();
    let isUrgencia: boolean;
    if (charRaw) {
      isUrgencia = /urg|emerg/.test(charRaw);
    } else {
      isUrgencia = /urgencia|urgência|emergencia|emergência|pronto/i.test(item.description ?? "");
    }
    // Aceita "eletiva" (valor canônico salvo pela UI) e "eletivo" (legado).
    const mode = c.elective_mode;
    if ((mode === "eletivo" || mode === "eletiva") && isUrgencia) return { ok: false, reason: "eletivo_urgencia" };
    if ((mode === "urgencia" || mode === "urgência") && !isUrgencia) return { ok: false, reason: "eletivo_urgencia" };
  }

  // ---- Escopo de códigos para cálculos do tipo PACOTE ----
  // Quando o cálculo é um pacote (pacote, pacote_por_atendimento, pacote_fechado,
  // pacote_com_extras), o conjunto de códigos aceitos é a união de
  // package_main_code + package_included_codes + extras_codes. Se o cálculo
  // declara esse conjunto (ao menos 1 código) e o item não casa, o cálculo
  // NÃO se aplica a este item. Pacotes sem nenhum desses códigos continuam
  // como catch-all (comportamento legado).
  const isPackageCalc =
    c.calculation_type === "pacote" ||
    c.calculation_type === "pacote_por_atendimento" ||
    c.calculation_type === "pacote_fechado" ||
    c.calculation_type === "pacote_com_extras";
  if (isPackageCalc) {
    const mainCodes = splitMainCodes((c as any).package_main_code);
    const included = (Array.isArray((c as any).package_included_codes)
      ? (c as any).package_included_codes
      : []
    ).map((x: any) => String(x).trim()).filter(Boolean);
    const extras = (Array.isArray((c as any).extras_codes)
      ? (c as any).extras_codes
      : []
    ).map((x: any) => String(x).trim()).filter(Boolean);
    const conjunto = new Set<string>([
      ...mainCodes,
      ...included,
      ...extras,
    ]);

    if (conjunto.size > 0) {
      const ic = String(item.procedure_code ?? "").trim();
      const matchesViaCode = !!ic && conjunto.has(ic);
      const matchesViaFlag =
        ((c as any).package_visits_count === true &&
          /visita/.test(String(item.procedure_name ?? "").toLowerCase())) ||
        ((c as any).package_opinions_count === true &&
          /parecer/.test(String(item.procedure_name ?? "").toLowerCase())) ||
        ((c as any).package_auxiliaries_included === true &&
          /auxili|instrumentador/.test(String(item.doctor_role ?? "").toLowerCase()));
      if (!matchesViaCode && !matchesViaFlag) {
        return { ok: false, reason: "codigo_fora_do_pacote" };
      }
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
    fixed_amount_by_role: (c as any).fixed_amount_by_role ?? (rule as any).fixed_amount_by_role ?? null,
    package_amount: c.package_amount ?? rule.package_amount,
    package_main_code: c.package_main_code ?? rule.package_main_code,
    package_included_codes: c.package_included_codes ?? rule.package_included_codes,
    package_visits_count: c.package_visits_count ?? rule.package_visits_count,
    package_opinions_count: c.package_opinions_count ?? rule.package_opinions_count,
    package_auxiliaries_included: c.package_auxiliaries_included ?? rule.package_auxiliaries_included,
    package_subtype: c.package_subtype ?? rule.package_subtype,
    // Distribuição por função (cirurgião / aux1 / aux2) específica do calc.
    package_roles_distribution: (c as any).package_roles_distribution
      ?? (rule as any).package_roles_distribution
      ?? null,
    extras_codes: c.extras_codes ?? rule.extras_codes,
    reference_table_id: c.reference_table_id ?? rule.reference_table_id,
    multiplier: c.multiplier ?? rule.multiplier,
    deflator_pct: c.deflator_pct ?? rule.deflator_pct,
    repasse_pct: c.repasse_pct ?? rule.repasse_pct,
    acrescimo_pct: c.acrescimo_pct ?? rule.acrescimo_pct,
    apply_access_route: c.apply_access_route ?? rule.apply_access_route,
    include_auxiliaries: c.include_auxiliaries ?? rule.include_auxiliaries,
    auxiliary_pct: c.auxiliary_pct ?? rule.auxiliary_pct,
    aux_first_pct: c.aux_first_pct ?? rule.aux_first_pct,
    aux_second_pct: c.aux_second_pct ?? rule.aux_second_pct,
    instrumentador_pct: c.instrumentador_pct ?? rule.instrumentador_pct,
    bonus_amount: c.bonus_amount ?? rule.bonus_amount,
    bonus_pct: c.bonus_pct ?? rule.bonus_pct,
    target_amount: c.target_amount ?? rule.target_amount,
    context_conditions: c.context_conditions ?? rule.context_conditions ?? null,
    // Filtros restritivos vivem APENAS no item de Cálculo. Não herda da Regra
    // — se o cálculo não declarou, o filtro não se aplica (vazio = qualquer).
    procedure_codes: Array.isArray(c.procedure_codes) ? c.procedure_codes : [],
    sectors: Array.isArray(c.sectors) ? c.sectors : [],
    specialties: [],
    special_case_filter: Array.isArray(c.special_case_filter) ? c.special_case_filter : null,
    agreement_aliases: Array.isArray(c.agreement_aliases) ? c.agreement_aliases : [],
    agreement_match_mode: (c.agreement_match_mode ?? "whitelist") as any,
    allowed_access_routes: Array.isArray(c.allowed_access_routes) ? c.allowed_access_routes : [],
    // HERANÇA CRÍTICA: se o cálculo não define doctor_roles, HERDA da regra (se houver).
    // Isso garante que se a regra 'Hemodinâmica - 88%' cadastrar Cirurgião Principal,
    // o cálculo 'Repasse 88%' também só aplique para Cirurgião Principal.
    doctor_roles: Array.isArray(c.doctor_roles) && c.doctor_roles.length > 0 
      ? c.doctor_roles 
      : (Array.isArray((rule as any).doctor_roles) ? (rule as any).doctor_roles : []),
    // Propaga unidade de aplicação para uso na pós-análise (dedup de bônus).
    application_unit: c.application_unit ?? rule.application_unit ?? null,
    // Marca auxiliar interna (Correção C) — usado pelo gating de pré-passe.
    __calc_id: c.id ?? null,
  } as RuleInput & { application_unit?: string | null; __calc_id?: string | null };
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



export interface CalcDuplicityInfo {
  rule_id: string;
  rule_name: string;
  matched_calculations: Array<{
    calc_id: string | null;
    label: string;
    calculation_type: CalculationType;
    expected: number;
  }>;
  /** Quando true: a resolução prévia referenciava um calc_id que não existe mais na regra. */
  resolution_stale?: boolean;
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
  /** Sub-Onda 2C — 2+ cálculos da mesma regra retornaram VÁLIDO. Bloqueia o item. */
  calc_duplicity?: CalcDuplicityInfo;
  inferred_sector?: string | null;
  /** Configuração de adicional temporal do cálculo vencedor — aplicado em finalizeAnalysis. */
  temporal_surcharge_config?: {
    fds_pct: number | null;
    feriado_pct: number | null;
    noturno_pct: number | null;
    urgencia_pct: number | null;
    noturno_inicio: string | null;
    noturno_fim: string | null;
  } | null;
  /** Tipo de cálculo do filho vencedor (calculations[]). Quando presente,
   *  tem precedência sobre rule.calculation_type para carimbar
   *  applied_calc_method — evita herdar o tipo "pai" da regra. */
  winner_calc_type?: CalculationType | null;
  /** Piso aplicado (mínimo garantido) — R$ do piso vigente para a função do item. */
  piso_aplicado_valor?: number | null;
  /** Qual método venceu no MAX(): "convenio" (percentual do convênio) ou "piso" (mínimo garantido). null = pendente (post-pass). */
  piso_metodo_vencedor?: "convenio" | "piso" | null;
  /** Escopo do piso (usado pelo post-pass para agregar por atendimento). */
  piso_escopo?: "por_item" | "por_atendimento" | null;
}


/**
 * Sub-Onda 2C — Rodada 3 (revisão final, Opção A uniforme).
 *
 * Um cálculo é "restritivo" iff existe pelo menos um eixo onde:
 *   (a) o próprio calc tem filtro NÃO-default nesse eixo, E
 *   (b) o valor desse eixo NÃO é compartilhado por TODOS os peers da regra.
 *
 * Filtros que TODOS os cálculos da mesma regra compartilham igualmente são
 * **contexto da regra**, não diferenciadores entre cálculos. Por isso não
 * marcam o calc como restritivo (caso contrário, padrões legítimos como
 * "regra inteira só vale no fim de semana, com 3 cálculos por código"
 * gerariam falsa duplicidade).
 *
 * Eixos avaliados (1..10):
 *   1) procedure_codes + code_match_mode
 *   2) extras_codes
 *   3) agreement_aliases (+ agreement_match_mode no comparativo, mas não
 *      conta como filtro sozinho — só restringe se houver lista)
 *   4) doctor_roles
 *   5) dia/horário (time_mode ≠ 'qualquer' | weekdays | time_start | time_end)
 *   6) elective_mode ≠ 'qualquer' (modalidade)
 *   7) vias de acesso (apply_access_route === true E lista preenchida)
 *   8) sectors
 *   9) specialties
 *   10) special_case_filter
 *
 * Casos limite:
 *  - Regra com 1 único cálculo → não há peer com quem comparar → catch-all
 *    (o loop de seleção já aplica esse cálculo: 0 restritivos + 1 catch-all).
 *  - Igualdade de arrays é por conjunto (ordem ignorada).
 *  - apply_access_route === false desliga o eixo "vias" semanticamente,
 *    independente do conteúdo de allowed_access_routes.
 */
function _arrSig(a: unknown): string {
  if (!Array.isArray(a) || a.length === 0) return "[]";
  return JSON.stringify([...a].map((x) => String(x)).sort());
}
/**
 * Para cálculos do tipo pacote, o "filtro de código" do eixo 1 inclui
 * `package_main_code`, `package_included_codes` e `extras_codes` — não
 * só `procedure_codes`. Isso garante que um pacote que lista
 * explicitamente o código do item seja tratado como RESTRITIVO no
 * desempate contra cálculos catch-all (ex.: tabela CBHPM x2+20% que
 * pega tudo).
 */
function _isPackageCalc(c: RuleCalculationItem): boolean {
  const t = (c as any).calculation_type;
  return t === "pacote" || t === "pacote_por_atendimento" ||
    t === "pacote_fechado" || t === "pacote_com_extras";
}
function _packageCodeSet(c: RuleCalculationItem): string[] {
  if (!_isPackageCalc(c)) return [];
  const out: string[] = [];
  const main = (c as any).package_main_code;
  if (typeof main === "string" && main.trim()) {
    for (const p of String(main).split(/[\s,;]+/)) {
      const v = p.trim();
      if (v) out.push(v);
    }
  } else if (Array.isArray(main)) {
    for (const p of main) {
      const v = String(p ?? "").trim();
      if (v) out.push(v);
    }
  }
  const included = (c as any).package_included_codes;
  if (Array.isArray(included)) for (const p of included) {
    const v = String(p ?? "").trim();
    if (v) out.push(v);
  }
  const extras = (c as any).extras_codes;
  if (Array.isArray(extras)) for (const p of extras) {
    const v = String(p ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}
function _axisHasFilter(c: RuleCalculationItem, axis: number): boolean {
  switch (axis) {
    case 1: {
      const hasProcCodes = (Array.isArray(c.procedure_codes) && c.procedure_codes.length > 0) ||
        (c.code_match_mode != null && c.code_match_mode !== "any");
      if (hasProcCodes) return true;
      return _packageCodeSet(c).length > 0;
    }
    case 2: return Array.isArray(c.extras_codes) && c.extras_codes.length > 0;
    case 3: return Array.isArray(c.agreement_aliases) && c.agreement_aliases.length > 0;
    case 4: return Array.isArray(c.doctor_roles) && c.doctor_roles.length > 0;
    case 5:
      return (c.time_mode != null && c.time_mode !== "qualquer") ||
        (Array.isArray(c.weekdays) && c.weekdays.length > 0) ||
        c.time_start != null || c.time_end != null;
    case 6: return c.elective_mode != null && c.elective_mode !== "qualquer";
    case 7:
      return c.apply_access_route === true &&
        Array.isArray(c.allowed_access_routes) &&
        c.allowed_access_routes.length > 0;
    case 8: return Array.isArray(c.sectors) && c.sectors.length > 0;
    case 9: return Array.isArray(c.specialties) && c.specialties.length > 0;
    case 10: return Array.isArray(c.special_case_filter) && c.special_case_filter.length > 0;
  }
  return false;
}
function _axisSig(c: RuleCalculationItem, axis: number): string {
  switch (axis) {
    case 1: {
      const pkg = _packageCodeSet(c);
      return `${_arrSig(c.procedure_codes)}|${c.code_match_mode ?? "any"}|pkg:${_arrSig(pkg)}`;
    }
    case 2: return _arrSig(c.extras_codes);
    case 3: return `${_arrSig(c.agreement_aliases)}|${c.agreement_match_mode ?? "any"}`;
    case 4: return _arrSig(c.doctor_roles);
    case 5:
      return `${c.time_mode ?? "qualquer"}|${_arrSig(c.weekdays)}|${c.time_start ?? ""}|${c.time_end ?? ""}`;
    case 6: return String(c.elective_mode ?? "qualquer");
    case 7:
      return c.apply_access_route === true
        ? `ON|${_arrSig(c.allowed_access_routes)}`
        : "OFF";
    case 8: return _arrSig(c.sectors);
    case 9: return _arrSig(c.specialties);
    case 10: return _arrSig(c.special_case_filter);
  }
  return "";
}
export function isRestrictiveCalculation(
  c: RuleCalculationItem,
  peers: RuleCalculationItem[],
): boolean {
  // Catch-all explícito declarado pelo analista → nunca é restritivo.
  // Garante que ele atue como piso da regra (avaliado por último,
  // sem competir por duplicidade com cálculos restritivos).
  if (c.is_catch_all === true) return false;
  // Único cálculo da regra → sem diferenciação possível → catch-all.
  if (!Array.isArray(peers) || peers.length <= 1) return false;
  for (let axis = 1; axis <= 10; axis++) {
    if (!_axisHasFilter(c, axis)) continue;
    const me = _axisSig(c, axis);
    // Filtro compartilhado entre TODOS os peers = contexto da regra,
    // não diferenciador entre cálculos.
    const allSame = peers.every((p) => _axisSig(p, axis) === me);
    if (!allSame) return true;
  }
  return false;
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
  // a ordem original entre si (sort estável). Catch-all explícito vai SEMPRE
  // para o fim — é o "piso" da regra, avaliado depois de todos os demais.
  const list = rawList
    .map((c, i) => ({
      c,
      i,
      so: c.sort_order ?? Number.MAX_SAFE_INTEGER,
      ca: c.is_catch_all === true ? 1 : 0,
    }))
    .sort((a, b) => a.ca - b.ca || a.so - b.so || a.i - b.i)
    .map((x) => x.c);
  if (list.length > 0) {
    const breakdown: CalculationBreakdownEntry[] = [];
    type ValidCalc = {
      expected: number;
      explanation: string;
      alerts: string[];
      label: string;
      id: string | null;
      force_totalized?: boolean;
      application_unit?: string | null;
      qty_already_applied?: boolean;
      steps?: { label: string; value: number }[];
      calculation_type: CalculationType;
      sort_order: number;
      restrictive: boolean;
      inferred_sector: string;
      temporal_surcharge_config?: ExpectedCalc["temporal_surcharge_config"];
      piso_aplicado_valor?: number | null;
      piso_metodo_vencedor?: "convenio" | "piso" | null;
      piso_escopo?: "por_item" | "por_atendimento" | null;
    };
    const validCalcs: ValidCalc[] = [];
    let anyMatched = false;

    for (const c of list) {
      const label = (c.label && c.label.trim()) || c.calculation_type;
      const m = calcItemMatches(c, item);

      if (!m.ok) {
        const reason = (m as any).reason || "condicao_nao_satisfeita";
        breakdown.push({
          calc_id: c.id ?? null, label, calculation_type: c.calculation_type,
          matched: false, skip_reason: reason, expected: null,
          explanation: `Não aplicado — condição "${reason}" não satisfeita.`,
          alerts: [],
        });
        continue;
      }

      anyMatched = true;
      const eff = ruleFromCalcItem(rule, c);
      const r = applyCalculationSingle(eff, item, ctx);

      // Piso por procedimento (mínimo garantido) — só faz sentido quando o
      // cálculo é percentual do convênio e o esperado é numérico. Aplica
      // MAX(esperado_convenio, piso_da_funcao) e carimba método vencedor.
      let pisoAplicado: number | null = null;
      let pisoVencedor: "convenio" | "piso" | null = null;
      let pisoEscopo: "por_item" | "por_atendimento" | null = null;
      if (
        r.expected !== null &&
        c.piso_habilitado === true &&
        c.calculation_type === "percentual_sobre_convenio"
      ) {
        const piso = resolvePisoForRole(c, item.doctor_role);
        if (piso !== null && piso > 0) {
          pisoAplicado = piso;
          pisoEscopo = c.piso_escopo === "por_atendimento" ? "por_atendimento" : "por_item";
          if (pisoEscopo === "por_atendimento") {
            // Agregação real acontece no post-pass em `analyzePaymentItems`.
            // Aqui deixamos o vencedor pendente (null) — o post-pass soma
            // o esperado_convenio de todas as linhas do mesmo atendimento,
            // compara com o piso e distribui o complemento pro-rata.
            pisoVencedor = null;
          } else if (piso > r.expected) {
            r.explanation = `${r.explanation} · Piso R$ ${piso.toFixed(2)} > convênio R$ ${r.expected.toFixed(2)} → piso vence.`;
            r.expected = round2(piso);
            pisoVencedor = "piso";
          } else {
            r.explanation = `${r.explanation} · Piso R$ ${piso.toFixed(2)} ≤ convênio R$ ${r.expected.toFixed(2)} → convênio vence.`;
            pisoVencedor = "convenio";
          }
        }
      }


      if (r.expected !== null) {
        validCalcs.push({
          expected: r.expected, explanation: r.explanation, alerts: r.alerts,
          label, id: c.id ?? null,
          force_totalized: c.force_totalized ?? false,
          application_unit: c.application_unit ?? rule.application_unit ?? "por_item",
          qty_already_applied: r.qty_already_applied,
          steps: r.steps,
          calculation_type: c.calculation_type,
          sort_order: c.sort_order ?? Number.MAX_SAFE_INTEGER,
          restrictive: isRestrictiveCalculation(c, list),
          inferred_sector: inferItemSector(item, ctx as any),
          temporal_surcharge_config: {
            fds_pct: c.adicional_fds_pct ?? null,
            feriado_pct: c.adicional_feriado_pct ?? null,
            noturno_pct: c.adicional_noturno_pct ?? null,
            urgencia_pct: c.adicional_urgencia_pct ?? null,
            noturno_inicio: c.noturno_inicio ?? null,
            noturno_fim: c.noturno_fim ?? null,
          },
          piso_aplicado_valor: pisoAplicado,
          piso_metodo_vencedor: pisoVencedor,
          piso_escopo: pisoEscopo,
        });
        breakdown.push({
          calc_id: c.id ?? null, label, calculation_type: c.calculation_type,
          matched: true, expected: r.expected, explanation: r.explanation,
          alerts: r.alerts.map((a) => `[${label}] ${a}`),
        });
      } else {
        breakdown.push({
          calc_id: c.id ?? null, label, calculation_type: c.calculation_type,
          matched: false, skip_reason: "calculo_sem_resultado", expected: null,
          explanation: `Tentativa falhou: ${r.explanation}. Seguindo para próximo cálculo disponível.`,
          alerts: r.alerts.map((a) => `[${label}] ${a}`),
        });
      }
    }

    if (!anyMatched || validCalcs.length === 0) {
      return {
        expected: null,
        explanation: `Regra "${rule.name}" possui ${list.length} cálculo(s), mas nenhum satisfez as condições deste item.`,
        alerts: ["Nenhum item de cálculo da regra se aplica a este item."],
        breakdown,
      };
    }

    // ---- Desempate por packageMatchScore entre cálculos de PACOTE ----
    // Se houver múltiplos cálculos do tipo pacote/pacote_por_atendimento
    // válidos para este item, escolhemos o pacote cujo conjunto de inclusos
    // tem maior sobreposição com o atendimento. Cálculos não-pacote
    // permanecem disputando normalmente.
    const isPacoteType = (t: CalculationType) =>
      t === "pacote" || t === "pacote_por_atendimento" || t === "pacote_fechado" || t === "pacote_com_extras";
    const pacoteCalcs = validCalcs.filter((v) => isPacoteType(v.calculation_type));
    if (pacoteCalcs.length >= 2) {
      const scored = pacoteCalcs.map((v) => {
        const cItem = list.find((c) => (c.id ?? null) === v.id);
        const eff = cItem ? ruleFromCalcItem(rule, cItem) : rule;
        const score = packageMatchScore(eff, item, ctx);
        return { v, score };
      });
      const eligible = scored.filter((s) => s.score >= 0);
      if (eligible.length > 0) {
        eligible.sort((a, b) =>
          b.score - a.score ||
          a.v.sort_order - b.v.sort_order ||
          0,
        );
        const winnerId = eligible[0].v.id;
        const winnerIds = new Set<string | null>([winnerId]);
        // Remove dos validCalcs todos os outros pacotes (perderam o desempate).
        for (let i = validCalcs.length - 1; i >= 0; i--) {
          const v = validCalcs[i];
          if (isPacoteType(v.calculation_type) && !winnerIds.has(v.id)) {
            validCalcs.splice(i, 1);
          }
        }
        // Marca no breakdown os pacotes perdedores.
        for (const b of breakdown) {
          if (
            b.matched &&
            (b.calculation_type === "pacote" || b.calculation_type === "pacote_por_atendimento") &&
            b.calc_id !== winnerId
          ) {
            b.matched = false;
            b.skip_reason = "pacote_perdeu_desempate_score";
          }
        }
      }
    }

    // ---- Precedência contextual: pacote absorve valor_fixo/tabela do mesmo código ----
    // Regra de negócio: se o atendimento contém o código principal do pacote,
    // todo código listado dentro desse pacote segue o pacote. Valor fixo só vale
    // quando o código aparece fora do contexto do pacote; catch-all/tabela fica
    // por último. Sem este corte, um item incluído no pacote (ex.: 30804132)
    // também bateria no valor_fixo migrado como "Excedente" e geraria duplicidade.
    {
      const itemCode = String(item.procedure_code ?? "").trim();
      const attKey = (item as any).attendance_group_key ?? item.attendance_number ?? "";
      const siblings = ctx?.attendanceSiblingCodes?.get(attKey) ?? new Set<string>(itemCode ? [itemCode] : []);
      const packageIdsInContext = new Set<string | null>();
      for (const v of validCalcs) {
        if (!isPacoteType(v.calculation_type)) continue;
        const cItem = list.find((c) => (c.id ?? null) === v.id);
        if (!cItem || !itemCode) continue;
        const mainCodes = splitMainCodes(cItem.package_main_code as any);
        if (mainCodes.length === 0 || !mainCodes.some((m) => siblings.has(m))) continue;
        const included = Array.isArray(cItem.package_included_codes)
          ? cItem.package_included_codes.map((x) => String(x).trim()).filter(Boolean)
          : [];
        const extras = Array.isArray((cItem as any).extras_codes)
          ? (cItem as any).extras_codes.map((x: any) => String(x).trim()).filter(Boolean)
          : [];
        const packageCodes = new Set([...mainCodes, ...included, ...extras]);
        if (packageCodes.has(itemCode)) packageIdsInContext.add(v.id);
      }
      if (packageIdsInContext.size > 0) {
        for (let i = validCalcs.length - 1; i >= 0; i--) {
          const v = validCalcs[i];
          if (packageIdsInContext.has(v.id)) continue;
          const dropped = validCalcs[i];
          validCalcs.splice(i, 1);
          for (const b of breakdown) {
            if (b.matched && b.calc_id === dropped.id) {
              b.matched = false;
              b.skip_reason = "preterido_por_pacote_no_atendimento";
            }
          }
        }
      }
    }

    // ---- Precedência por código EXPLÍCITO ----
    // Se algum cálculo válido lista explicitamente o código do item
    // (procedure_codes whitelist OU package_main_code/included/extras),
    // ele tem prioridade absoluta sobre cálculos catch-all que pegam o
    // código por inferência (ex.: tabela CBHPM sem procedure_codes).
    // Isso reflete a regra de negócio: ao vincular um código a um
    // pacote/valor_fixo/linha específica, o analista está dizendo
    // "para este código, aplique ESTE cálculo".
    {
      const itemCode = String(item.procedure_code ?? "").trim();
      if (itemCode && validCalcs.length > 1) {
        const explicitlyListsCode = (v: ValidCalc): boolean => {
          const cItem = list.find((c) => (c.id ?? null) === v.id);
          if (!cItem) return false;
          // Whitelist procedure_codes (modo whitelist e código presente).
          const procCodes = Array.isArray(cItem.procedure_codes)
            ? cItem.procedure_codes.map((x) => String(x).trim()).filter(Boolean)
            : [];
          const codeMode = (cItem.code_match_mode ?? "any") as string;
          if (codeMode === "whitelist" && procCodes.length > 0) {
            const matches = procCodes.some((p) =>
              p.endsWith("*") ? itemCode.startsWith(p.slice(0, -1)) : itemCode === p
            );
            if (matches) return true;
          }
          // Pacote/valor_fixo com código no conjunto (main/included/extras).
          const pkg = _packageCodeSet(cItem);
          if (pkg.includes(itemCode)) return true;
          const extras = Array.isArray((cItem as any).extras_codes)
            ? (cItem as any).extras_codes.map((x: any) => String(x).trim())
            : [];
          if (extras.includes(itemCode)) return true;
          return false;
        };
        const explicit = validCalcs.filter(explicitlyListsCode);
        if (explicit.length > 0 && explicit.length < validCalcs.length) {
          const winnerIds = new Set(explicit.map((v) => v.id));
          for (let i = validCalcs.length - 1; i >= 0; i--) {
            if (!winnerIds.has(validCalcs[i].id)) {
              const dropped = validCalcs[i];
              validCalcs.splice(i, 1);
              for (const b of breakdown) {
                if (b.matched && b.calc_id === dropped.id) {
                  b.matched = false;
                  b.skip_reason = "preterido_por_codigo_explicito";
                }
              }
            }
          }
        }
      }
    }

    // ---- Precedência por caso especial explícito ----
    // Quando o atendimento está aprovado como caso especial e algum cálculo da
    // regra declara esse filtro, ele representa a linha mais específica e vence
    // os cálculos padrão/eletivos da mesma regra.
    {
      const itemCaseCode = (item.special_case_code ?? "").trim();
      const itemCaseApproved = item.special_case_status === "approved" && !!itemCaseCode;
      if (itemCaseApproved && validCalcs.length > 1) {
        const matchesSpecialCase = (v: ValidCalc): boolean => {
          const cItem = list.find((c) => (c.id ?? null) === v.id);
          const filters = Array.isArray(cItem?.special_case_filter) ? cItem.special_case_filter.filter(Boolean) : [];
          return filters.includes("*") || filters.includes(itemCaseCode);
        };
        const specialCaseCalcs = validCalcs.filter(matchesSpecialCase);
        if (specialCaseCalcs.length > 0 && specialCaseCalcs.length < validCalcs.length) {
          const winnerIds = new Set(specialCaseCalcs.map((v) => v.id));
          for (let i = validCalcs.length - 1; i >= 0; i--) {
            if (!winnerIds.has(validCalcs[i].id)) {
              const dropped = validCalcs[i];
              validCalcs.splice(i, 1);
              for (const b of breakdown) {
                if (b.matched && b.calc_id === dropped.id) {
                  b.matched = false;
                  b.skip_reason = "preterido_por_caso_especial";
                }
              }
            }
          }
        }
      }
    }

    // Sub-Onda 2C — resolução prévia escolhe um cálculo entre TODOS os válidos
    // (restritivos ou catch-all — analista pode ter escolhido qualquer um).
    const resolutionId = item.calc_duplicity_resolution?.chosen_calc_id ?? null;
    let chosen: ValidCalc | null = null;
    let resolutionStale = false;
    if (resolutionId) {
      chosen = validCalcs.find((v) => v.id === resolutionId) ?? null;
      if (!chosen) resolutionStale = true;
    }

    // Sub-Onda 2C — Rodada 3: carve-out catch-all.
    // Cálculo restritivo (algum filtro preenchido) compete na detecção de
    // duplicidade. Cálculo catch-all (nenhum filtro) é fallback interno e
    // só vence quando NÃO há restritivo válido.
    const restritivos = validCalcs.filter((v) => v.restrictive);
    const catchAll = validCalcs.filter((v) => !v.restrictive);

    // 2+ restritivos sem resolução utilizável → bloqueio por ambiguidade.
    if (!chosen && restritivos.length >= 2) {
      return {
        expected: null,
        explanation: `Regra "${rule.name}" possui ${restritivos.length} cálculos restritivos válidos simultaneamente para este item — ambiguidade de cadastro.`,
        alerts: [`Cadastro com ambiguidade: ${restritivos.length} cálculos restritivos da regra retornaram valor para este item. Defina manualmente qual aplicar.`],
        breakdown,
        calc_duplicity: {
          rule_id: rule.id,
          rule_name: rule.name,
          matched_calculations: restritivos.map((v) => ({
            calc_id: v.id, label: v.label, calculation_type: v.calculation_type, expected: v.expected,
          })),
          ...(resolutionStale ? { resolution_stale: true } : {}),
        },
      };
    }

    // Seleção do vencedor:
    //   - Resolução prévia válida → cálculo escolhido.
    //   - Senão, se há ≥1 restritivo → primeiro restritivo (já está em sort_order).
    //   - Senão (só catch-alls) → primeiro catch-all (sort_order).
    let winnerCalc: ValidCalc;
    if (chosen) {
      winnerCalc = chosen;
    } else if (restritivos.length === 1) {
      winnerCalc = restritivos[0];
    } else {
      // 0 restritivos, ≥1 catch-all
      winnerCalc = catchAll[0];
    }

    if (chosen || restritivos.length >= 1 || catchAll.length >= 1) {
      // Marca os demais válidos como ignorados (substituídos pelo vencedor).
      for (const b of breakdown) {
        if (b.matched && b.calc_id !== winnerCalc.id) {
          b.matched = false;
          b.skip_reason = "item_calculo_ja_atendido";
        }
      }
    }

    const expected = winnerCalc.expected != null ? Number(winnerCalc.expected.toFixed(2)) : null;
    const finalForceTotalized = winnerCalc.force_totalized ?? rule.force_totalized ?? false;

    return {
      expected,
      explanation: `[${winnerCalc.label}] ${winnerCalc.explanation}`,
      alerts: winnerCalc.alerts.map((a) => `[${winnerCalc.label}] ${a}`),
      breakdown,
      force_totalized: finalForceTotalized,
      application_unit: (winnerCalc.application_unit as any) ?? rule.application_unit ?? "por_item",
      qty_already_applied: winnerCalc.qty_already_applied,
      steps: winnerCalc.steps,
      inferred_sector: (winnerCalc as any).inferred_sector,
      temporal_surcharge_config: winnerCalc.temporal_surcharge_config ?? null,
      winner_calc_type: (winnerCalc.calculation_type as CalculationType) ?? null,
      piso_aplicado_valor: winnerCalc.piso_aplicado_valor ?? null,
      piso_metodo_vencedor: winnerCalc.piso_metodo_vencedor ?? null,
      piso_escopo: winnerCalc.piso_escopo ?? null,
      ...(resolutionStale ? {
        calc_duplicity: {
          rule_id: rule.id, rule_name: rule.name,
          matched_calculations: restritivos.map((v) => ({
            calc_id: v.id, label: v.label, calculation_type: v.calculation_type, expected: v.expected,
          })),
          resolution_stale: true,
        },
      } : {}),
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
    case "pacote_fechado":            return calcPacoteFechado(rule, item, ctx);
    case "pacote_com_extras":         return calcPacoteExtras(rule, item, ctx);
    case "pacote_por_atendimento": {
      const map = ctx?.appliedAttendancesByRule ?? new Map<string, Set<string>>();
      let set = map.get(rule.id);
      if (!set) { set = new Set<string>(); map.set(rule.id, set); }
      return calcPacotePorAtendimento(rule, item, set, ctx);
    }
    case "pacote": {
      const map = ctx?.appliedAttendancesByRule ?? new Map<string, Set<string>>();
      let set = map.get(rule.id);
      if (!set) { set = new Set<string>(); map.set(rule.id, set); }
      return calcPacotePorAtendimento(rule, item, set, ctx);
    }
    case "valor_fixo":                return calcValorFixo(rule, item, ctx);
    case "exclusao":                  return calcExclusao(rule);
    case "informativo":               return calcInformativo();
    case "tabela_referencia":         return calcTabelaDiferenciada(rule, item, ctx?.referenceLookup);
    case "tabela_diferenciada":       return calcTabelaDiferenciada(rule, item, ctx?.referenceLookup);
    case "bonus":                     return calcBonus(rule, item);
    case "complemento":               return calcComplemento(rule, item);
  }
}

function calcBonus(rule: RuleInput, item: ItemInput): ExpectedCalc {
  // Bônus NUNCA compete no matching por-item (fase A) — a síntese em
  // analyze-payment/index.ts (Fase B) é o caminho de produção. Esta função
  // existe como fallback defensivo e DEVE bater com a fórmula do sintetizador:
  // expected = bonus_fixed + base * (bonus_pct/100) — ou seja, SOMENTE o bônus.
  // A base fica auditável em ai_findings/colunas bonus_*; jamais some com base
  // aqui para não gerar rótulo enganoso na tela (duplicidade de "base + bônus").
  const base = item.procedure_amount ?? 0;
  const hasFixed = rule.bonus_amount != null;
  const hasPct = rule.bonus_pct != null;
  if (!hasFixed && !hasPct) {
    return {
      expected: null,
      explanation: "Bônus mal configurado: nenhum valor (bonus_amount) nem percentual (bonus_pct) definido.",
      alerts: ["Cálculo de bônus sem bonus_amount e sem bonus_pct — regra ignorada."],
    };
  }
  const fixed = rule.bonus_amount ?? 0;
  const pct = rule.bonus_pct ?? 0;
  const pctAmt = base * (pct / 100);
  const expected = Number((fixed + pctAmt).toFixed(2));
  return {
    expected,
    explanation: `Bônus = R$ ${fixed.toFixed(2)} (fixo) + ${pct}% × R$ ${base.toFixed(2)} = R$ ${expected.toFixed(2)}`,
    alerts: [],
  };
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
  const acrescimo = rule.acrescimo_pct ?? 0;

  // Onda 1 — Ordem fiscal da Tabela Diferenciada (com arredondamento por etapa):
  //   1) base
  //   2) × multiplicador
  //   3) × repasse  (share multiplicativo, ex.: 70% = paga 70%)
  //   4) × via de acesso
  //   5) × função (auxiliares/instrumentador)
  //   6) × quantidade
  //   6.5) × (1 + acréscimo)  (aditivo, ex.: 20 = +20% sobre o calculado)
  //   7) × (1 − deflator)
  //   7) × (1 − deflator)
  // IMPORTANTE: Se o valor da tabela já for específico para o papel (ex: valor
  // para 1º Auxiliar), NÃO aplicamos novamente o percentual de auxiliar.
  const roleInTableMatchesRoleInItem = !!(lookup && rule.reference_table_id && item.doctor_role
    && lookup(rule.reference_table_id, (item.procedure_code ?? "").toString().trim(), item.doctor_role, true) !== null);

  // round2 removed - now at top of file
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
  // PRINCÍPIO: nunca aplicar percentual hardcoded. Só aplica desconto de função
  // quando a regra cadastrou o pct específico daquela função. Se include_auxiliaries
  // estiver marcado mas o pct não estiver cadastrado, mantém fator 1 e emite alerta
  // para o analista cadastrar o valor.
  let funcFactor = 1;
  let funcLabel = "";
  const tdAlerts: string[] = [];
  if (rule.include_auxiliaries && !roleInTableMatchesRoleInItem) {
    const role = classifyDoctorRole(item.doctor_role);
    if (role === "instrumentador") {
      if (rule.instrumentador_pct != null) {
        funcFactor = rule.instrumentador_pct / 100;
        funcLabel = `× instrumentador ${(funcFactor * 100).toFixed(0)}%`;
      } else {
        tdAlerts.push(`Regra "${rule.name}" inclui auxiliares mas não cadastrou instrumentador_pct — pago 100% (sem desconto inferido).`);
      }
    } else if (role === "primeiro_aux") {
      if (rule.aux_first_pct != null) {
        funcFactor = rule.aux_first_pct / 100;
        funcLabel = `× 1º aux ${(funcFactor * 100).toFixed(0)}%`;
      } else {
        tdAlerts.push(`Regra "${rule.name}" inclui auxiliares mas não cadastrou aux_first_pct — pago 100% (sem desconto inferido).`);
      }
    } else if (role === "demais_aux") {
      if (rule.aux_second_pct != null) {
        funcFactor = rule.aux_second_pct / 100;
        funcLabel = `× aux 2+ ${(funcFactor * 100).toFixed(0)}%`;
      } else {
        tdAlerts.push(`Regra "${rule.name}" inclui auxiliares mas não cadastrou aux_second_pct — pago 100% (sem desconto inferido).`);
      }
    }
  } else if (roleInTableMatchesRoleInItem) {
    parts.push(`(valor específico para papel "${item.doctor_role}")`);
  }
  value = round2(value * funcFactor);
  steps.push({ label: "funcao", value });
  if (funcLabel) parts.push(`${funcLabel} = R$ ${value.toFixed(2)}`);

  // 6) × quantidade (Onda 1: quantidade entra DENTRO da Tabela Diferenciada)
  // IMPORTANTE: `convenio_value_totalized` descreve a coluna de valor do convênio
  // importada da planilha. Tabela diferenciada usa tabela de referência vinculada,
  // então esse flag do item NÃO pode cancelar a quantidade aqui.
  const qtyRaw = Number(item.quantity ?? 1);
  const qtyValid = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  const isTotalized = rule.force_totalized === true;
  const qtyToApply = isTotalized ? 1 : qtyValid;
  value = round2(value * qtyToApply);
  steps.push({ label: "quantidade", value });
  if (qtyToApply !== 1) parts.push(`× qtd ${qtyToApply} = R$ ${value.toFixed(2)}`);
  else if (qtyValid !== 1 && isTotalized) parts.push(`(qtd ${qtyValid} ignorada por configuração da regra)`);

  // 6.5) × (1 + acréscimo) — aditivo, antes do deflator
  if (acrescimo !== 0) {
    value = round2(value * (1 + acrescimo / 100));
    steps.push({ label: "acrescimo", value });
    parts.push(`× (1 + acréscimo ${acrescimo}%) = R$ ${value.toFixed(2)}`);
  }

  // 7) × (1 − deflator)
  value = round2(value * (1 - (defl ?? 0) / 100));
  steps.push({ label: "deflator", value });
  if (defl !== 0) parts.push(`× (1 − deflator ${defl}%) = R$ ${value.toFixed(2)}`);

  return {
    expected: value,
    explanation: parts.join(" "),
    alerts: tdAlerts,
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

  const hasApplicableCalculation = (r: RuleInput): boolean => {
    const calcs = Array.isArray(r.calculations) ? r.calculations : [];
    if (calcs.length === 0) return true;
    return calcs.some((c) => calcItemMatches(c, item).ok);
  };
  
  // Tenta encontrar uma regra master que não tenha nenhuma restrição de via
  // e que aceite o convênio do item. Também respeita filtros operacionais
  // declarados no item de cálculo (setor, função, código etc.), para não usar
  // uma regra geral de um setor como fallback de outro.
  const genericMaster = masterRules.find(r => 
    (!r.allowed_access_routes || r.allowed_access_routes.length === 0) &&
    ruleAcceptsItemAgreement(r, item) &&
    hasApplicableCalculation(r)
  );

  if (genericMaster) {
    return { rule: genericMaster, priority: "setor_master_geral" };
  }

  return null;
}

export function analyzeItem(

  item: ItemInput,
  preFilteredRulesRaw: RuleInput[],
  ctx?: EngineCtx,
): AnalysisResult {
  // Regras de bônus NÃO devem competir no matching por item TUSS.
  // Elas geram uma linha sintética (tipo_linha='complemento_bonus') por
  // atendimento em fase separada de síntese (ver `analyze-payment/index.ts`).
  // Permitir que uma regra de bônus vença um TUSS aqui faria o item ser
  // rotulado como "bonus" na conciliação, sequestrando o cálculo original.
  const preFilteredRules = preFilteredRulesRaw.filter(
    (r) => (r.calculation_type ?? "") !== "bonus",
  );
  // === Tratamento Manual (Fase 1) ===
  // Quando o analista marcou o item com um motivo de intervenção manual
  // (reclassificação clínica ou aceite financeiro), o motor NÃO aplica regra:
  // aceita `procedure_amount` (valor do convênio) como esperado, diff = 0,
  // status = aprovado. Auditoria preserva o motivo via calculation_explanation.
  // IMPORTANTE: `auto_parecer_report` NÃO é valoração nem aceite financeiro.
  // O cruzamento com o relatório de parecer serve apenas para classificar o item
  // como Parecer ou Visita (`item_type_id`). O valor esperado deve SEMPRE vir
  // da regra vencedora. Portanto motivos automáticos legados dessa origem não
  // entram neste short-circuit de tratamento manual.
  const isAutoParecerClassification =
    item.manual_intervention_reason_id &&
    (item.manual_intervention_source ?? "manual") === "auto_parecer_report";

  if (item.manual_intervention_reason_id && !isAutoParecerClassification) {
    const code = item.manual_intervention_reason_code ?? "manual";
    const category = item.manual_intervention_reason_category ?? "";
    const procAmount = Number(item.procedure_amount ?? 0);
    const grossAmount = Number(item.gross_amount ?? 0);
    // Aceite financeiro = analista está aceitando o VALOR PAGO como esperado
    // (ex.: reajuste sem regra atualizada). Reclassificação clínica e demais
    // categorias mantêm o comportamento original (aceita valor do convênio).
    // A estratégia explícita escolhida no acate em massa (quando existir)
    // VENCE essa inferência — sem isso a reanálise disparada logo após o acate
    // reescrevia expected_amount = gross_amount e apagava a economia.
    const strategy = item.manual_value_strategy ?? null;
    const acceptsPaidAsExpected = strategy === null && category === "aceite_financeiro";
    let expected: number;
    let baseLabel: string;
    if (strategy === "expected" || strategy === "custom") {
      // Mantém o valor já gravado no item (regra ou customizado pelo analista).
      expected = Number(item.current_expected_amount ?? procAmount);
      baseLabel =
        strategy === "expected"
          ? `Valor mantido da regra (R$ ${expected.toFixed(2)}) por escolha do analista.`
          : `Valor customizado pelo analista (R$ ${expected.toFixed(2)}).`;
    } else if (strategy === "procedure") {
      expected = procAmount;
      baseLabel = `Valor aceito = procedure_amount (R$ ${procAmount.toFixed(2)}).`;
    } else {
      expected = acceptsPaidAsExpected ? grossAmount : procAmount;
      baseLabel = acceptsPaidAsExpected
        ? `Valor aceito = gross_amount pago (R$ ${grossAmount.toFixed(2)}).`
        : `Valor aceito = procedure_amount (R$ ${procAmount.toFixed(2)}).`;
    }

    // Mesmo em tratamento manual, queremos saber se EXISTE regra específica
    // para o médico/PJ (mesmo informativa) — para que o usuário enxergue o
    // vínculo no card e não veja "Nenhuma regra específica casou". A regra
    // não muda o valor porque o analista fez aceite/intervenção manual.
    let matchedRuleId: string | null = null;
    let matchedRuleName: string | null = null;
    let matchedPriority: RuleMatchPriority = "default_setor";
    try {
      const sel = selectWinningRule(item, preFilteredRules, ctx);
      if (sel?.rule && (sel.priority === "medico" || sel.priority === "medico_codigo" || sel.priority === "grupo_doctor" || sel.priority === "grupo_doctor_codigo")) {
        matchedRuleId = sel.rule.id;
        matchedRuleName = sel.rule.name ?? null;
        matchedPriority = sel.priority;
      }
    } catch (_e) { /* ignore: tratamento manual prossegue */ }

    const ruleLabel = matchedRuleName ? ` Regra aderente: "${matchedRuleName}".` : "";
    const explanation = `Tratamento manual — motivo "${code}"${category ? ` (${category})` : ""}. ${baseLabel}${ruleLabel}`;
    const alerts: string[] = [];
    if (Math.abs(expected - grossAmount) > 0.01) {
      alerts.push(`Pago (R$ ${grossAmount.toFixed(2)}) difere do valor aceito (R$ ${expected.toFixed(2)}) — diferença assumida pelo tratamento manual.`);
    }

    return {
      item_id: item.id,
      status: "aprovado",
      expected_amount: expected,
      diff_pct: 0,
      matched_rule_id: matchedRuleId,
      matched_rule_name: matchedRuleName,
      matched_priority: matchedPriority,
      calculation_type_used: "tratamento_manual",
      calculation_explanation: explanation,
      alerts,
      needs_ai_review: false,
    };
  }

  // === Gate: valor base ausente/zerado SEM motivo de intervenção ===
  // Item sem `procedure_amount` (valor do convênio) não tem base para
  // qualquer regra de % calcular — e, se foi pago mesmo assim, exige
  // que o analista justifique com motivo de intervenção manual
  // (ex.: visita_pos_alta, paciente_sem_internacao). Sem motivo, o motor
  // marca como ALERTA bloqueante e NÃO cai em fallback silencioso.
  {
    const procAmount = Number(item.procedure_amount ?? 0);
    const grossAmount = Number(item.gross_amount ?? 0);
    const tlSpecial = (item.tipo_linha ?? "").toLowerCase();
    const isSpecialLine =
      tlSpecial === "complemento_bonus" ||
      tlSpecial === "glosa_desconto" ||
      tlSpecial === "reprocessamento";
    // Parecer/visita podem legitimamente vir com valor 0 (Excel trata zero
    // como vazio na origem; atendimento não pago entra zerado e a justificativa
    // fica na observação do lote). Não bloqueamos por gate aqui.
    const isParecerVisitaItem =
      isVisita(item as any) || isParecer(item as any);
    // Bypass do gate: se existir regra específica/grupo com fonte de base
    // independente do procedure_amount (tabela_diferenciada com reference_table,
    // valor_fixo ou pacote), o motor deve seguir para o cálculo normal —
    // a regra fornece a própria base. Caso contrário, o gate se aplica.
    let ruleProvidesOwnBase = false;
    try {
      const sel = selectWinningRule(item, preFilteredRules, ctx);
      const rule = sel?.rule as any;
      if (rule) {
        const calcs: any[] = Array.isArray(rule.calculations) && rule.calculations.length > 0
          ? rule.calculations
          : [rule];
        ruleProvidesOwnBase = calcs.some((c) => {
          const ct = (c?.calculation_type ?? "").toString();
          if (ct === "valor_fixo" || ct === "pacote") return true;
          if (ct === "tabela_diferenciada" && (c?.reference_table_id ?? rule?.reference_table_id)) return true;
          return false;
        });
      }
    } catch (_e) { /* fallback: mantém gate */ }
    if (!isSpecialLine && !isParecerVisitaItem && !ruleProvidesOwnBase && procAmount <= 0) {
      return {
        item_id: item.id,
        status: "alerta",
        expected_amount: 0,
        diff_pct: 0,
        matched_rule_id: null,
        matched_rule_name: null,
        matched_priority: "default_setor",
        calculation_type_used: "exige_motivo_intervencao",
        calculation_explanation:
          `Item sem valor base do convênio (procedure_amount = 0/nulo). ` +
          `Pago R$ ${grossAmount.toFixed(2)}. ` +
          `Exige motivo de intervenção manual (ex.: visita após alta, paciente sem internação, ` +
          `negociação pontual) para ser aprovado.`,
        alerts: [
          "Valor zerado/ausente exige motivo de intervenção manual antes da aprovação.",
        ],
        needs_ai_review: true,
      };
    }
  }


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
  // Regras SEM datas (valid_from e valid_until ambos nulos) são "sempre vigentes"
  // — não dependem de procedure_date. Para regras com datas, procedure_date é
  // obrigatória; se ausente/inválida, a regra é descartada para este item.
  const procDateRaw = item.procedure_date;
  const procDateValid = !!procDateRaw && !Number.isNaN(Date.parse(procDateRaw));
  const rulesForItem = preFilteredRules.filter((r) => {
    const hasDates = !!r.valid_from || !!r.valid_until;
    if (!hasDates) return true;
    if (!procDateValid) return false;
    return isInValidity(r, procDateRaw!);
  });

  // === Absorção de complemento via context_conditions ===
  // Quando o código do item é `trigger_code` de algum cálculo cujo "main"
  // (procedure_codes) está presente no MESMO atendimento, este item é
  // ABSORVIDO (expected = complement_value ?? 0) — o valor do procedimento
  // principal já foi transformado pelo gatilho (ex.: Colonoscopia R$ 370 →
  // R$ 540 quando há Polipectomia 40202542). Sem essa absorção, o trigger
  // cai em regra geral e duplica o repasse.
  {
    const itemCode = String(item.procedure_code ?? "").trim();
    if (itemCode) {
      const attKey = (item as any).attendance_group_key ?? item.attendance_number ?? "";
      const sibs = ctx?.attendanceSiblingCodes?.get(attKey) ?? new Set<string>();
      for (const rule of rulesForItem) {
        // Gate de escopo do item: convênio + alvo (médico/empresa/grupo).
        // Sem isso, regras restritas a outras empresas/médicos absorviam
        // complementos indevidamente (ex.: Regra "Colonoscopia – Lobato"
        // zerando 40202542 de paciente do STJ sem vínculo com Lobato).
        if (!targetsAgreement(rule, item)) continue;
        const scope = rule.scope ?? "geral";
        if (scope === "especifica") {
          if (rule.target_type === "medico" && !targetsDoctor(rule, item)) continue;
          if (rule.target_type === "empresa" && !targetsCompany(rule, item)) continue;
        } else if (scope === "grupo") {
          if (!targetsGroup(rule, item)) continue;
        }
        // scope === "geral" → sem restrição de alvo (mantém comportamento).
        const calcs = Array.isArray(rule.calculations) ? rule.calculations : [];
        for (const c of calcs) {
          const conds = Array.isArray((c as any).context_conditions)
            ? (c as any).context_conditions
            : [];
          if (conds.length === 0) continue;
          // Gate de escopo no nível do cálculo (convênio).
          const calcAgs = Array.isArray((c as any).agreement_aliases)
            ? (c as any).agreement_aliases.filter(Boolean)
            : [];
          if (calcAgs.length > 0) {
            const mode = (c as any).agreement_match_mode === "blacklist" ? "blacklist" : "whitelist";
            const itemAg = normAgreement(item.agreement_name);
            const normCalcAgs = calcAgs.map((x: any) => normAgreement(String(x))).filter(Boolean);
            if (mode === "whitelist") {
              if (!itemAg || !normCalcAgs.includes(itemAg)) continue;
            } else {
              if (itemAg && normCalcAgs.includes(itemAg)) continue;
            }
          }
          const mainCodes = (Array.isArray((c as any).procedure_codes) ? (c as any).procedure_codes : [])
            .map((x: any) => String(x).trim()).filter(Boolean);
          // Só absorve se algum código "main" do cálculo aparece em outro
          // item do atendimento (evita absorver complemento órfão).
          const mainPresent = mainCodes.some((m: string) => m !== itemCode && sibs.has(m));
          if (!mainPresent) continue;
          for (const cond of conds) {
            const trigs = (Array.isArray((cond as any).trigger_codes) ? (cond as any).trigger_codes : [])
              .map((x: any) => String(x).trim()).filter(Boolean);
            if (!trigs.includes(itemCode)) continue;
            const absorbed = Number((cond as any).complement_value ?? 0);
            const expected = Number.isFinite(absorbed) ? Number(absorbed.toFixed(2)) : 0;
            const grossPaid = Number(item.gross_amount ?? 0);
            const diff = grossPaid - expected;
            const status: ItemAiStatus = Math.abs(diff) < 0.01 ? "aprovado" : "alerta";
            return {
              item_id: item.id,
              status,
              expected_amount: expected,
              diff_pct: expected > 0 ? (diff / expected) * 100 : (grossPaid === 0 ? 0 : 100),
              matched_rule_id: rule.id,
              matched_rule_name: rule.name,
              matched_priority: "default_setor",
              calculation_type_used: rule.calculation_type ?? "valor_fixo",
              calculation_explanation:
                `Código ${itemCode} absorvido como complemento da regra "${rule.name}"` +
                (c.label ? ` (cálculo "${c.label}")` : "") +
                ` — atendimento contém [${mainCodes.join(", ")}]; valor complemento = R$ ${expected.toFixed(2)}.`,
              alerts: status === "aprovado"
                ? []
                : [`Complemento absorvido com valor esperado R$ ${expected.toFixed(2)}, mas pago R$ ${grossPaid.toFixed(2)}.`],
              needs_ai_review: status !== "aprovado",
            };
          }
        }
      }
    }
  }

  // ===== Caso especial (oncológico, pediátrico, etc.) =====
  // O filtro foi UNIFICADO no nível do cálculo (`rule_calculations.special_case_filter`).
  // O escopo de regra (`rules.special_case_filter`) foi descontinuado — a UI não
  // grava mais e o motor não filtra mais regras inteiras por caso especial. Cada
  // cálculo individualmente decide via `calcItemMatches` se aplica ao item, e a
  // precedência de "caso especial vence cálculo padrão" da mesma regra é tratada
  // mais acima em `validCalcs`.
  const scopedRulesForItem: RuleInput[] = rulesForItem;

  // Desempate de pacotes: quando múltiplos pacotes são elegíveis para o mesmo
  // item, o de maior score (mais específico) deve ser avaliado primeiro.
  const scoredRulesForItem = scopedRulesForItem
    .map((r) => ({
      rule: r,
      score:
        r.calculation_type === "pacote" || r.calculation_type === "pacote_por_atendimento"
          ? packageMatchScore(r, item, ctx)
          : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.rule);

  const outcome = selectWinningRule(item, scoredRulesForItem, ctx, { collectTrace: true });
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
          // Sem acordo: repasse deve ser idêntico ao valor base do convênio (procedure_amount).
          // Não há cálculo de percentual/tabela — é 1:1.
          // Se procedure_amount ausente, usa o pago como fallback (sem base para comparar).
          const hasProcedureAmount = item.procedure_amount != null;
          const expectedBase = hasProcedureAmount
            ? Number(item.procedure_amount)
            : paid;
          const { status: diffStatus, diff_pct: diffPct } = classifyDiff(expectedBase, paid, winner, ctx);
          const semAcordoAlerts: string[] = [];
          if (hasProcedureAmount && diffStatus !== "aprovado") {
            semAcordoAlerts.push(
              `Sem acordo: repasse (R$ ${paid.toFixed(2)}) diverge do valor base do convênio (R$ ${expectedBase.toFixed(2)}).`,
            );
          }
          return {
            item_id: item.id,
            status: diffStatus,
            expected_amount: expectedBase,
            diff_pct: diffPct,
            matched_rule_id: winner.id,
            matched_rule_name: `Camada 2 — ${purposeLabel}: ${hit.table_name} (via regra "${winner.name}")`,
            matched_priority: "regra_bloqueio",
            calculation_type_used: "informativo",
            calculation_explanation:
              `Bloqueado pela Camada 2 — código TUSS ${code} consta na tabela "${hit.table_name}" ` +
              `(${purposeLabel.toLowerCase()}) vinculada à regra "${winner.name}"${motivo}. ` +
              `Sem acordo: esperado = valor base do convênio (R$ ${expectedBase.toFixed(2)})` +
              (!hasProcedureAmount ? ` (procedure_amount ausente — sem base para comparação).` : `.`),
            alerts: semAcordoAlerts,
            needs_ai_review: diffStatus !== "aprovado",
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
    calculation_type_used = (calc?.winner_calc_type as any) ?? winner.calculation_type;
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
  //
  // EXCEÇÃO — `prevent_external_fallback`:
  // Se a regra vencedora declarar `prevent_external_fallback = true`, o motor
  // NÃO procura fallback externo. O item vai para `sem_regra` com alerta
  // explícito, expondo a lacuna de cadastro em vez de mascarar com a master.
  const needsFallback = !winner || (calc && calc.expected === null);
  const fallbackBlocked = !!(winner && winner.prevent_external_fallback === true && calc && calc.expected === null);

  if (needsFallback && !fallbackBlocked) {
    // NOTE: A antiga "Camada 3 Global" (varredura de tabelas sem_acordo/exclusao
    // não vinculadas à regra) foi removida. Tabelas de exceção só atuam quando
    // explicitamente vinculadas a uma regra via exception_table_ids (Camada 2).

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
        calculation_type_used = (fCalc?.winner_calc_type as any) ?? fRule.calculation_type;
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
    const triedRule = winner?.name ? ` A regra "${winner.name}" foi avaliada, mas nenhum cálculo aplicável retornou valor.` : "";
    const blockedNote = fallbackBlocked
      ? ` A regra "${winner!.name}" está marcada como "não permitir fallback para a regra geral" — revise os filtros operacionais (código TUSS, função, convênio, via de acesso) ou marque um cálculo como catch-all (piso da regra).`
      : "";
    calc = {
      expected: null,
      explanation: `Sem regra calculável para este item.${triedRule}${blockedNote}${blockedNote ? "" : " Revise os filtros operacionais da regra (código TUSS, função, convênio, via de acesso ou tabela vinculada)."}`,
      alerts: fallbackBlocked
        ? [
            `Regra específica "${winner!.name}" venceu a seleção mas nenhum cálculo bateu, e o fallback para a regra geral está bloqueado por esta regra. Revise o cadastro: filtros operacionais dos cálculos ou marque um cálculo como catch-all.`,
          ]
        : ["Sem regra calculável para este item — revise os filtros operacionais da regra, não o setor."],
      breakdown: calc?.breakdown,
    };
    priority = "sem_regra";
    calculation_type_used = "informativo";
    // Mantém matched_rule_id/name quando o fallback foi bloqueado, para
    // rastreabilidade no detalhe do item ("foi essa regra que bloqueou").
    if (!fallbackBlocked) {
      winner = null;
      matched_rule_id = null;
      matched_rule_name = null;
    }
  }

  const res = finalizeAnalysis(item, calc, winner, priority, ctx, conflict);
  if (outcome?.trace) res.selection_trace = outcome.trace;
  return res;
}



/**
 * Decide qual adicional temporal aplicar (FDS / feriado / noturno) com base na
 * data/hora do atendimento. Regra: aplica APENAS O MAIOR % entre os elegíveis.
 * Retorna `null` quando nenhum adicional cabe ou está cadastrado.
 *
 * Janela noturna pode cruzar meia-noite (ex: 19:00 → 07:00 = noturno entre
 * 19:00 e 23:59 OU entre 00:00 e 06:59).
 */
export function pickTemporalSurcharge(
  cfg: NonNullable<ExpectedCalc["temporal_surcharge_config"]>,
  procedureDateIso: string,
  procedureDateHasTime: boolean = false,
  attendanceCharacter: string | null = null,
): { pct: number; reason: "fim de semana" | "feriado" | "noturno" | "urgência/emergência" } | null {
  if (!cfg || !procedureDateIso) return null;

  // Mantém o dia exato registrado (igual à lógica de calcItemMatches).
  const hasTime = procedureDateIso.includes("T");
  const dParts = hasTime
    ? new Date(procedureDateIso)
    : new Date(procedureDateIso + "T12:00:00");
  if (isNaN(dParts.getTime())) return null;
  const dayOfWeek = dParts.getDay(); // 0=Dom, 6=Sáb

  const candidates: Array<{ pct: number; reason: "fim de semana" | "feriado" | "noturno" | "urgência/emergência" }> = [];

  // Feriado (nacional BR)
  const feriadoPct = Number(cfg.feriado_pct ?? 0);
  if (feriadoPct > 0 && isBrazilianNationalHoliday(procedureDateIso)) {
    candidates.push({ pct: feriadoPct, reason: "feriado" });
  }

  // Fim de semana (Sáb=6, Dom=0)
  const fdsPct = Number(cfg.fds_pct ?? 0);
  if (fdsPct > 0 && (dayOfWeek === 0 || dayOfWeek === 6)) {
    candidates.push({ pct: fdsPct, reason: "fim de semana" });
  }

  // Noturno — só aplica quando a hora foi extraída explicitamente da base hospitalar.
  // Sem hora real (procedureDateHasTime === false), NUNCA aplica adicional noturno.
  const noturnoPct = Number(cfg.noturno_pct ?? 0);
  if (noturnoPct > 0 && cfg.noturno_inicio && cfg.noturno_fim && hasTime && procedureDateHasTime) {
    const ini = parseHHMM(cfg.noturno_inicio);
    const fim = parseHHMM(cfg.noturno_fim);
    if (ini != null && fim != null && ini !== fim) {
      const mins = dParts.getHours() * 60 + dParts.getMinutes();
      // Janela que cruza meia-noite: fim < ini → [ini, 24h) ∪ [0, fim)
      const inside = ini < fim
        ? (mins >= ini && mins < fim)
        : (mins >= ini || mins < fim);
      if (inside) candidates.push({ pct: noturnoPct, reason: "noturno" });
    }
  }

  // Urgência/Emergência — independe de dia e horário. Detecta pelo campo estruturado
  // attendance_character (normalizado: remove acentos, minúsculas). Aceita tanto
  // "urgência" quanto "emergência" (ambas caracterizam atendimento não-eletivo).
  const urgenciaPct = Number(cfg.urgencia_pct ?? 0);
  if (urgenciaPct > 0 && attendanceCharacter) {
    const norm = String(attendanceCharacter)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim();
    if (/\b(urgen|emerg)/.test(norm)) {
      candidates.push({ pct: urgenciaPct, reason: "urgência/emergência" });
    }
  }

  if (candidates.length === 0) return null;
  // "Só o maior" — empate desempata pela ordem de inserção (feriado > fds > noturno > urgência).
  candidates.sort((a, b) => b.pct - a.pct);
  return candidates[0];
}

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!isFinite(h) || !isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
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
  const qtyValid = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const flagTotalized = item.convenio_value_totalized === true || calc.force_totalized === true;

  // ─── Detecção stateless da base de cálculo (unit vs total) ───
  // Quando qty>1 e há valor esperado calculável, testa as duas hipóteses
  // contra o valor pago e escolhe a que casa melhor. Não memoriza nada
  // entre lotes/itens — decisão isolada por linha.
  let basisDetected: "unit" | "total" | "ambiguous" | "na" = "na";
  let basisConfidence: number | null = null;

  if (calc.qty_already_applied === true) {
    // Tabela Diferenciada — quantidade já foi aplicada internamente; não há ambiguidade.
    basisDetected = "na";
  } else if (calc.expected != null && qtyValid > 1) {
    // calc.expected aqui é o valor PRÉ-qty (por unidade).
    const base = calc.expected;
    const expectedUnit = round2(base * qtyValid);
    const expectedTotal = round2(base);
    const paid = Number(item.gross_amount);
    const TOL = 0.01; // 1% — alinhado ao classifyDiff
    const diff = (exp: number) =>
      paid > 0 ? Math.abs(exp - paid) / paid : (exp === paid ? 0 : 1);
    const dUnit = diff(expectedUnit);
    const dTotal = diff(expectedTotal);
    const unitOk = dUnit <= TOL;
    const totalOk = dTotal <= TOL;

    let chosen: "unit" | "total";
    if (unitOk && totalOk) {
      // Ambas casam (caso raro: base*qty ≈ base, ou paid ≈ ambos). Mantém o flag do analista.
      chosen = flagTotalized ? "total" : "unit";
      basisDetected = "ambiguous";
    } else if (unitOk && !totalOk) {
      chosen = "unit";
      basisDetected = "unit";
    } else if (totalOk && !unitOk) {
      chosen = "total";
      basisDetected = "total";
    } else {
      // Nenhuma casa — escolhe a hipótese de menor desvio e segue (vai gerar alerta normal).
      chosen = dUnit <= dTotal ? "unit" : "total";
      basisDetected = chosen;
    }
    basisConfidence = chosen === "unit" ? dUnit : dTotal;

    if (chosen === "unit") {
      calc.expected = expectedUnit;
      if (qtyValid !== 1) {
        calc.explanation = `${calc.explanation} × qtd ${qtyValid} = R$ ${expectedUnit.toFixed(2)}`;
      }
    } else {
      calc.expected = expectedTotal;
      calc.explanation = `${calc.explanation} (qtd ${qtyValid} ignorada — valor convênio detectado como já totalizado)`;
    }

    // Se a escolha do motor divergiu do flag do analista, registra observação no explain.
    if (!flagTotalized && chosen === "total") {
      calc.explanation += " [motor detectou base totalizada apesar do flag unitário]";
    } else if (flagTotalized && chosen === "unit") {
      calc.explanation += " [motor detectou base unitária apesar do flag totalizado]";
    }
  } else if (flagTotalized) {
    // qty=1 ou expected nulo, mas flag totalized estava ligado — comportamento antigo.
    if (qtyValid > 1 && calc.explanation) {
      const reason = item.convenio_value_totalized === true ? "importação" : "regra";
      calc.explanation = `${calc.explanation} (qtd ${qtyValid} ignorada no cálculo pois valor já é totalizado via ${reason})`;
    }
  } else if (calc.expected != null && qtyValid !== 1) {
    // qty=1 (sem ambiguidade) ou caminho legado.
    const before = calc.expected;
    calc.expected = Number((before * qtyValid).toFixed(2));
    calc.explanation = `${calc.explanation} × qtd ${qtyValid} = R$ ${calc.expected.toFixed(2)}`;
  }

  // ─── Adicional temporal (FDS / feriado / noturno) ───
  // Aplica APÓS multiplicação por qty. Apenas o MAIOR % entre os elegíveis é aplicado.
  // % incide sobre o valor calculado (expected) — para regras percentuais isso é
  // matematicamente equivalente a aplicar sobre a tabela base.
  if (calc.expected != null && calc.expected > 0 && calc.temporal_surcharge_config && item.procedure_date) {
    const sur = pickTemporalSurcharge(calc.temporal_surcharge_config, item.procedure_date, item.procedure_date_has_time === true, item.attendance_character ?? null);
    if (sur && sur.pct > 0) {
      const base = calc.expected;
      const addValue = round2(base * (sur.pct / 100));
      calc.expected = round2(base + addValue);
      calc.explanation = `${calc.explanation} + ${sur.pct}% adicional ${sur.reason} (R$ ${addValue.toFixed(2)}) = R$ ${calc.expected.toFixed(2)}`;
    }
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
  // Sinalização informativa de caso especial — não afeta status nem cálculo,
  // só comunica ao supervisor/diretor que aquele item teve marcação ativa.
  {
    const scCode = (item.special_case_code ?? "").trim();
    if (item.special_case_status === "approved" && scCode) {
      alerts.unshift(`ℹ️ Caso especial ativo: ${scCode}.`);
    }
  }

  return {
    item_id: item.id,
    status,
    expected_amount: calc.expected,
    diff_pct,
    matched_rule_id: rule?.id ?? null,
    matched_rule_name: rule?.name ?? null,
    matched_priority: priority,
    calculation_type_used: (calc.winner_calc_type as any) ?? rule?.calculation_type ?? "informativo",
    calculation_explanation: calc.explanation,
    alerts,
    needs_ai_review: status !== "aprovado",
    needs_human_review: priority === "sem_regra" || priority === "conflito",
    ...(conflict ? { conflict } : {}),
    ...(calc.breakdown ? { calculation_breakdown: calc.breakdown } : {}),
    ...(calc.application_unit ? { application_unit_used: calc.application_unit } : {}),
    ...(calc.calc_duplicity ? { calc_duplicity: calc.calc_duplicity } : {}),
    convenio_basis_detected: basisDetected,
    basis_confidence: basisConfidence,
    piso_aplicado_valor: calc.piso_aplicado_valor ?? null,
    piso_metodo_vencedor: calc.piso_metodo_vencedor ?? null,
    piso_escopo: calc.piso_escopo ?? null,
  };
}


/**
 * Correção C — Pré-passe por atendimento para cálculos de pacote.
 *
 * Para cada (rule.id, attendance_key) escolhe deterministicamente UM calc
 * vencedor pela maior cobertura dos códigos do atendimento (depois
 * inclusos_ratio, depois menor sort_order). O vencedor é o único calc de
 * pacote daquela regra que pode aplicar nesse atendimento.
 */
function preComputePackageWinners(
  items: ItemInput[],
  rules: RuleInput[],
  siblings: Map<string, Set<string>>,
): Map<string, string> {
  const isPacoteType = (t: CalculationType) =>
    t === "pacote" || t === "pacote_por_atendimento" || t === "pacote_fechado" || t === "pacote_com_extras";

  const winners = new Map<string, string>();
  const candidateRules = rules.filter((r) =>
    Array.isArray(r.calculations) && r.calculations.some((c) => isPacoteType(c.calculation_type))
  );
  if (candidateRules.length === 0) return winners;

  const attKeys = new Set<string>();
  for (const it of items) {
    const k = (it as any).attendance_group_key ?? it.attendance_number ?? "";
    if (k) attKeys.add(k);
  }

  for (const rule of candidateRules) {
    const pacoteCalcs = (rule.calculations ?? []).filter((c) => isPacoteType(c.calculation_type));
    for (const attKey of attKeys) {
      const siblingsOfAtt = siblings.get(attKey);
      if (!siblingsOfAtt || siblingsOfAtt.size === 0) continue;

      type Scored = { calc: RuleCalculationItem; cobertura: number; inclusosRatio: number };
      const scored: Scored[] = [];

      for (const c of pacoteCalcs) {
        const mainCodes = splitMainCodes(c.package_main_code as any);
        if (mainCodes.length > 0 && !mainCodes.some((m) => siblingsOfAtt.has(m))) continue;

        const included = (Array.isArray(c.package_included_codes) ? c.package_included_codes : [])
          .map((x) => String(x).trim()).filter(Boolean);
        const extras = (Array.isArray(c.extras_codes) ? c.extras_codes : [])
          .map((x) => String(x).trim()).filter(Boolean);

        const universo = new Set<string>([...mainCodes, ...included, ...extras]);

        let cobertura = 0;
        for (const code of siblingsOfAtt) {
          if (universo.has(code)) cobertura += 1;
        }
        const inclusosHit = included.filter((code) => siblingsOfAtt.has(code)).length;
        // Pacote que declara inclusos só é elegível como combinação quando ao
        // menos um incluso apareceu no atendimento. Sem isso, ele não pode
        // vencer um pacote/excedente simples do mesmo main_code.
        if (included.length > 0 && inclusosHit === 0) continue;
        const inclusosRatio = included.length > 0 ? inclusosHit / included.length : 1.0;

        scored.push({ calc: c, cobertura, inclusosRatio });
      }

      if (scored.length === 0) continue;
      scored.sort((a, b) => {
        // Desempate alinhado com packageMatchScore: especificidade (ratio de inclusos
        // cadastrados que estão no atendimento) tem prioridade — pacote menor com
        // todos os inclusos presentes vence pacote maior com cobertura parcial.
        if (b.inclusosRatio !== a.inclusosRatio) return b.inclusosRatio - a.inclusosRatio;
        if (b.cobertura !== a.cobertura) return b.cobertura - a.cobertura;
        return (a.calc.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.calc.sort_order ?? Number.MAX_SAFE_INTEGER);
      });
      const winner = scored[0];
      if (winner.calc.id) {
        winners.set(`${rule.id}|${attKey}`, winner.calc.id);
      }
    }
  }
  return winners;
}

/**
 * Post-pass do piso escopo "por_atendimento".
 *
 * Regra de negócio: quando o piso é configurado por atendimento (e não por
 * item), a garantia mínima vale para a SOMA do que o médico receberia pelos
 * códigos daquele atendimento — não para cada linha isoladamente. Ex.: piso
 * de R$ 1.100 para parto: se o convênio pagaria R$ 800 no principal +
 * R$ 350 no acessório (= R$ 1.150), o piso não entra. Se pagaria R$ 600 +
 * R$ 200 (= R$ 800), o piso vence e complementa até R$ 1.100.
 *
 * Grupo = (matched_rule_id, doctor_id, attendance_number).
 * Distribuição pro-rata pelo esperado_convenio original; se todos zerarem,
 * divide igualmente. Ajusta a última linha para casar centavos.
 *
 * `piso_metodo_vencedor === null` E `piso_aplicado_valor > 0` E
 * `piso_escopo === 'por_atendimento'` marca os itens pendentes deixados
 * pelo loop principal.
 */
export function applyPisoPorAtendimento(
  results: AnalysisResult[],
  items: ItemInput[],
): void {
  const itemById = new Map(items.map((it) => [it.id, it] as const));

  type Pending = { r: AnalysisResult; it: ItemInput };
  const groups = new Map<string, Pending[]>();
  for (const r of results) {
    if (r.piso_escopo !== "por_atendimento") continue;
    if (!(r.piso_aplicado_valor && r.piso_aplicado_valor > 0)) continue;
    if (r.piso_metodo_vencedor !== null) continue; // já resolvido
    const it = itemById.get(r.item_id);
    if (!it) continue;
    const key = [
      r.matched_rule_id ?? "",
      it.doctor_id ?? "",
      it.attendance_number ?? "",
    ].join("|");
    if (!key.split("|").some(Boolean)) continue; // sem chave útil → ignora
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push({ r, it });
  }

  for (const arr of groups.values()) {
    // Piso do atendimento — todos os itens do grupo compartilham o mesmo
    // valor (mesma regra + mesmo cálculo + mesma função implícita pelo médico).
    const piso = arr[0].r.piso_aplicado_valor ?? 0;
    const convenioValues = arr.map((p) => Number(p.r.expected_amount ?? 0));
    const sumConvenio = convenioValues.reduce((s, v) => s + v, 0);

    if (piso <= sumConvenio) {
      // Convênio vence — mantém expected por item, só carimba método.
      for (const p of arr) {
        p.r.piso_metodo_vencedor = "convenio";
        p.r.calculation_explanation =
          `${p.r.calculation_explanation ?? ""} · Piso atendimento R$ ${piso.toFixed(2)} ≤ soma convênio R$ ${sumConvenio.toFixed(2)} → convênio vence.`.trim();
      }
      continue;
    }

    // Piso vence — distribui o valor total do piso pelos itens do grupo.
    let newValues: number[];
    if (sumConvenio > 0) {
      newValues = convenioValues.map((v) => Math.round((v / sumConvenio) * piso * 100) / 100);
    } else {
      const share = Math.round((piso / arr.length) * 100) / 100;
      newValues = arr.map(() => share);
    }
    // Ajusta última linha para casar centavos com o piso exato.
    const distributed = newValues.reduce((s, v) => s + v, 0);
    const delta = Math.round((piso - distributed) * 100) / 100;
    if (delta !== 0 && newValues.length > 0) {
      newValues[newValues.length - 1] = Math.round((newValues[newValues.length - 1] + delta) * 100) / 100;
    }

    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const before = convenioValues[i];
      p.r.expected_amount = newValues[i];
      p.r.piso_metodo_vencedor = "piso";
      p.r.calculation_explanation =
        `${p.r.calculation_explanation ?? ""} · Piso atendimento R$ ${piso.toFixed(2)} > soma convênio R$ ${sumConvenio.toFixed(2)} → piso vence. Este item ajustado de R$ ${before.toFixed(2)} para R$ ${newValues[i].toFixed(2)} (rateio pro-rata).`.trim();
    }
  }
}



export function analyzePaymentItems(
  items: ItemInput[],

  rules: RuleInput[],
  ctx: PaymentContext,
  options?: { referenceLookup?: ReferenceTableLookup; exceptionLookup?: ExceptionTableLookup; siblingsSource?: ItemInput[] },
): AnalysisResult[] {
  const filtered = preFilterRules(rules, ctx);
  const ordered = [...items].sort((a, b) => {
    const aa = (a.attendance_number ?? "").localeCompare(b.attendance_number ?? "");
    if (aa !== 0) return aa;
    const isPkgAtt = (r: RuleInput) =>
      r.calculation_type === "pacote_por_atendimento" || r.calculation_type === "pacote";
    const aMain = filtered.some((r) => isPkgAtt(r) && splitMainCodes(r.package_main_code).includes(a.procedure_code ?? "")) ? -1 : 0;
    const bMain = filtered.some((r) => isPkgAtt(r) && splitMainCodes(r.package_main_code).includes(b.procedure_code ?? "")) ? -1 : 0;

    if (aMain !== bMain) return aMain - bMain;
    return (a.procedure_code ?? "").localeCompare(b.procedure_code ?? "");
  });
  // Índice: attendance (group_key se já marcado, senão attendance_number) →
  // conjunto de códigos de procedimento dos demais itens do mesmo atendimento.
  // Usado por condições de contexto em valor_fixo.
  const attendanceSiblingCodes = new Map<string, Set<string>>();
  const siblingsSource = options?.siblingsSource ?? items;
  for (const it of siblingsSource) {
    const key = (it as any).attendance_group_key ?? it.attendance_number ?? "";
    if (!key) continue;
    let set = attendanceSiblingCodes.get(key);
    if (!set) { set = new Set<string>(); attendanceSiblingCodes.set(key, set); }
    const pc = String(it.procedure_code ?? "").trim();
    if (pc) set.add(pc);
    const tc = String((it as any).tuss_code ?? "").trim();
    if (tc) set.add(tc);
  }
  const lockedPackageCalcByRuleAtt = preComputePackageWinners(items, filtered, attendanceSiblingCodes);
  const state: EngineCtx = {
    ...ctx,
    appliedAttendancesByRule: new Map<string, Set<string>>(),
    attendanceSiblingCodes,
    lockedPackageCalcByRuleAtt,
    referenceLookup: options?.referenceLookup,
    exceptionLookup: options?.exceptionLookup,
  };
  const resultsOrdered = ordered.map((it) => analyzeItem(it, filtered, state));
  // Reordenar resultados para a ordem original de `items`
  const byId = new Map(resultsOrdered.map((r) => [r.item_id, r] as const));
  const out = items.map((it) => byId.get(it.id)!);

  // === Piso por atendimento (mínimo garantido agregado) ===
  // Aplica MAX(sum(convenio_do_atendimento), piso) por grupo
  // (regra + cálculo + médico + atendimento). Quando o piso vence, o
  // complemento é distribuído pro-rata pelos itens do grupo (ou dividido
  // igualmente se o cálculo do convênio somou zero). Preserva o total do
  // atendimento sem alterar itens de outros escopos/regras.
  applyPisoPorAtendimento(out, items);


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

  // === Dedup de bônus por atendimento (regra de negócio) ===
  // Regra: bônus "por_atendimento" / "por_paciente_dia" é pago 1× por atendimento
  // e SEMPRE ao cirurgião principal. Auxiliares e instrumentador NÃO recebem
  // bônus automático — o cirurgião principal é o driver do pagamento.
  //
  // 1) Chave de bônus IGNORA o médico (atendimento|paciente|data|empresa),
  //    para que todos os médicos do mesmo atendimento compartilhem o grupo.
  // 2) Anchor = item cujo doctor_role classifica como "cirurgiao".
  // 3) Se o grupo só tem auxiliares/instrumentador, nenhum item recebe o bônus
  //    automaticamente; todos são suprimidos com alerta orientando inclusão manual.
  const itemById = new Map(items.map((it) => [it.id, it] as const));
  const bonusGroupKey = (it: ItemInput): string => {
    const att = (it.attendance_number ?? "").trim().toLowerCase();
    const pat = normName(it.patient_name);
    const date = (it.procedure_date ?? "").slice(0, 10);
    const comp = it.company_id ?? onlyDigits(it.company_document) ?? normName(it.company_name);
    return [att, pat, date, comp].join("|");
  };
  const bonusGroupsSeen = new Map<string, string>(); // ruleId|bonusKey -> anchor item_id (principal)
  // Passada 1: identificar anchor (apenas cirurgião principal).
  for (const r of out) {
    if (!r.application_unit_used || r.application_unit_used === "por_item") continue;
    if (r.calculation_type_used !== "bonus") continue;
    if (!r.matched_rule_id) continue;
    const it = itemById.get(r.item_id);
    if (!it) continue;
    if (classifyDoctorRole(it.doctor_role) !== "cirurgiao") continue;
    const key = `${r.matched_rule_id}|${bonusGroupKey(it)}`;
    if (bonusGroupsSeen.has(key)) continue;
    bonusGroupsSeen.set(key, r.item_id);
  }
  // Passada 2: suprimir bônus em não-anchors e em grupos sem cirurgião principal.
  for (const r of out) {
    if (!r.application_unit_used || r.application_unit_used === "por_item") continue;
    if (r.calculation_type_used !== "bonus") continue;
    if (!r.matched_rule_id) continue;
    const it = itemById.get(r.item_id);
    if (!it) continue;
    const key = `${r.matched_rule_id}|${bonusGroupKey(it)}`;
    const anchor = bonusGroupsSeen.get(key);
    // Fallback usado apenas quando o bônus é suprimido em auxiliar/sem-anchor
    // e não há outro cálculo de regra preenchendo r.expected_amount. Em
    // CONFECÇÃO o gross_amount ainda não foi produzido pelo motor neste ponto,
    // então procedure_amount (valor cru da base) é a referência mais segura.
    const paid = Number(it.gross_amount ?? it.procedure_amount ?? 0);
    if (!anchor) {
      // Grupo sem cirurgião principal — bônus pendente de inclusão manual.
      r.suppressed_by_dedup = true;
      r.expected_amount = paid;
      r.diff_pct = 0;
      r.status = "alerta";
      r.calculation_explanation =
        "Atendimento sem cirurgião principal identificado — bônus não aplicado automaticamente. " +
        "Por regra, este atendimento gera bônus; inclua manualmente o pagamento ao médico responsável.";
      r.alerts = [
        ...r.alerts,
        "Bônus pendente de inclusão manual: atendimento sem cirurgião principal.",
      ];
      r.needs_ai_review = true;
      continue;
    }
    if (anchor !== r.item_id) {
      // Auxiliar / instrumentador / outro médico — não recebe bônus automático.
      r.suppressed_by_dedup = true;
      r.expected_amount = paid;
      r.diff_pct = 0;
      r.status = "aprovado";
      r.calculation_explanation =
        `Bônus pago 1× ao cirurgião principal (anchor item ${anchor}). ` +
        `Auxiliares e demais funções não recebem bônus automático.`;
      r.alerts = [
        ...r.alerts,
        "Bônus suprimido neste item — pago integralmente ao cirurgião principal do atendimento.",
      ];
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
  const packageMainCodes = new Set<string>(
    rules
      .filter((r) => {
        const ct = r.calculation_type;
        return (ct === "pacote" || ct === "pacote_fechado" || ct === "pacote_com_extras" || ct === "pacote_por_atendimento") && !!r.package_main_code;
      })
      .flatMap((r) => splitMainCodes(r.package_main_code)),
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

// Re-export helpers de aprendizado de convênios para uso no analyze-payment.
export { drainLearnedAliases, peekLearnedAliases } from "./convenioStems.ts";

