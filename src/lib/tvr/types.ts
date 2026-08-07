/**
 * Tipos do domínio TASY vs Repasse (TVR).
 *
 * Extraídos de RetroactiveReconciliationsTab.tsx sem alteração de forma —
 * o componente continua sendo o único consumidor de UI, mas os tipos agora
 * podem ser importados por testes e libs sem arrastar a árvore React.
 */

/** Linha da base de faturamento hospitalar (TASY), já normalizada pelo wizard. */
export type TasyRow = {
  tasy_atendimento: string;
  tasy_tuss: string;
  tasy_qtd: string;
  tasy_valor_unit: string;
  tasy_procedimento?: string;
  tasy_paciente?: string;
  tasy_data?: string;
  tasy_convenio?: string;
  tasy_medico?: string;
  tasy_funcao?: string;
  tasy_empresa?: string;
  tasy_resolved_company_id?: string | null;
};

/** Linha do lado Repasse (payment_items do lote já pago). */
export type PagRow = {
  pag_atendimento: string;
  pag_tuss: string;
  pag_qtd: string;
  pag_valor_base: string;
  pag_valor_com_acordo?: string;
  pag_funcao?: string;
  pag_medico?: string;
  pag_data?: string;
  pag_paciente?: string;
  pag_convenio?: string;
  pag_procedimento?: string;
  pag_lote?: string;
  pag_payment_item_id?: string;
  pag_payment_id?: string;
  pag_doctor_id?: string;
  pag_company_id?: string;
  pag_applied_rule_id?: string;
  pag_applied_rule_label?: string;
  pag_applied_calc_id?: string;
  pag_applied_calc_method?: string;
};

export type TvrStatus = "nao_pago" | "div_qtd_valor" | "div_valor" | "pago_a_mais" | "ausente_tasy" | "ok";

export type TvrResult = {
  key: string;
  atendimento: string;
  tuss: string;
  procedimento: string;
  paciente: string;
  data: string;
  convenio: string;
  medico: string;
  funcao: string;
  qtd_tasy: number;
  valor_unit_tasy: number;
  valor_total_tasy: number;
  qtd_por_func: number;
  n_funcs: number;
  funcoes_pagas: string;
  lotes: string;
  valor_pago_base: number;
  valor_com_acordo: number;
  dif_qtd: number;
  dif_valor: number;
  valor_recuperar_acordo: number; // legado: max(0, ajuste_acordo)
  // Valor que a regra pagaria HOJE aplicando o mesmo % de acordo sobre a base TASY.
  valor_com_acordo_recalc: number;
  // valor_com_acordo (histórico) − valor_com_acordo_recalc.
  // Positivo = a recuperar (paguei a mais). Negativo = a complementar (paguei a menos).
  ajuste_acordo: number;
  // "valor" = regra é % sobre convênio (TASY e Exacta compartilham base) → compara R$.
  // "quantidade" = regra usa tabela própria (valor_fixo/pacote/tabela_diferenciada/bonus)
  //   → TASY não é base de valor; compara só presença e quantidade.
  tipo_analise: "valor" | "quantidade";
  // Apenas para tipo_analise="quantidade" + status="ausente_tasy": marca "sem lastro TASY"
  // sem calcular R$ (pacote fechado pode não faturar itens individualmente).
  sem_lastro_tasy?: boolean;
  matched_payment_item_id?: string;
  matched_payment_id?: string;
  matched_doctor_id?: string;
  matched_doctor_ids?: string[];
  matched_company_id?: string;
  tasy_empresa?: string;
  tasy_resolved_company_id?: string | null;
  pj_conciliada?: string;
  regra_aplicada?: string;
  calculo_aplicado?: string;
  // IDs opcionais usados apenas em rastreio/export — payment_items.applied_rule_id
  // e payment_items.applied_calc_id da regra que gerou o cálculo no lote.
  applied_rule_id?: string;
  applied_calc_id?: string;
  // ==== Inferência para itens "Faltou pagar" (sem lastro no lote) ====
  // Regra do sistema: 1 PJ por médico por hospital → resolvemos via doctor_companies
  // (vínculo ativo). Se o médico tiver múltiplas ativas, marcamos ambíguo e não sugerimos.
  pj_provavel?: string;
  pj_provavel_id?: string;
  // Regra "provável" = última regra já aplicada para (médico + procedure_code) neste
  // hospital. Heurística — não invoca o motor, respeita "nunca inferir valor".
  regra_prevista?: string;
  regra_prevista_id?: string;
  calculo_previsto?: string;
  calculo_previsto_id?: string;
  // Valor que a regra prevista pagaria hoje sobre este item (nao_pago).
  // undefined = não conseguimos estimar → consumidor cai para valor_total_tasy.
  valor_previsto_regra?: number;
  tipo_analise_previsto?: "valor" | "quantidade";
  // Origem do valor previsto exibido ao analista, por ordem de confiança:
  //  "simulacao" = motor real rodou (simulate-rule-batch) e devolveu valor esperado
  //  "regra"     = preview local a partir do calc_raw do histórico (percentual/valor_fixo/exclusao)
  //  "historico" = regra veio do histórico, sem valor calculado localmente (ex.: pacote)
  //  "bruto"     = tipo não coberto e sem simulação → fallback exibindo bruto TASY
  //  "sem_regra" = motor real rodou e não achou regra aplicável
  previsto_source?: "simulacao" | "regra" | "historico" | "bruto" | "sem_regra";

  // Auditoria da chave canônica (Atend + Data + TUSS8 + Médico).
  key_audit?: {
    att: string;
    date: string;
    tuss8: string;
    doctor: {
      // 'repasse_id' = doctor_id veio direto do payment_items.
      // 'name_to_id' = TASY só tinha nome, resolveu para id via índice do Repasse.
      // 'name_only'  = casou por nome normalizado dos dois lados (sem id).
      // 'missing'    = não foi possível compor a parte do médico.
      source: "repasse_id" | "name_to_id" | "name_only" | "missing";
      id?: string;
      name_raw?: string;
      name_norm?: string;
    };
  };
  status: TvrStatus;
  // Tópico 2 (opt-out do encaminhamento): campos vindos das colunas
  // adicionadas em retroactive_reconciliation_items no Tópico 1.
  // Undefined em resultados recém-calculados que ainda não foram persistidos.
  excluir_do_encaminhamento?: boolean;
  exclusion_reason?:
    | "mudanca_data_administrativa"
    | "cancelamento_externo"
    | "duplicidade_ja_resolvida"
    | "acordo_diferenciado"
    | "outro"
    | null;
  exclusion_note?: string | null;
  // T3: id da linha em retroactive_reconciliation_items (necessário
  // p/ UPDATEs de exclusão — matched_payment_item_id NÃO serve como PK).
  _retroReconRowId?: string;
  // Preenchido quando este item já foi materializado em um ajuste financeiro
  // (encaminhamento anterior). Serve para bloquear novo envio e sinalizar na UI.
  _generatedAdjustmentId?: string | null;
  // Override manual: PJ escolhida pelo analista quando o vínculo médico→PJ
  // mudou desde o lote original. Quando null, `buildGlosaGroups` cai para
  // a PJ ativa via doctor_companies. Grava em retroactive_reconciliation_items.
  retroactive_target_company_id?: string | null;
  target_reassign_reason?: string | null;
};

export type TvrAcao = {
  kind: "recuperar" | "complementar" | "validar" | "ok";
  valor: number;
  label: string;
  hint: string;
};
