/**
 * Motor de cruzamento TASY × Repasse.
 *
 * Extraído do closure `process` dentro de TasyVsRepasseView. É a peça que
 * decide, para cada procedimento, se faltou pagar, se pagou a mais, se a
 * quantidade divergiu — ou seja, o que vira dinheiro a complementar ou a
 * retirar. Antes não era alcançável por teste nenhum.
 *
 * Puro por construção: nada de React, Supabase, toast ou DOM. Todo IO fica
 * no chamador, que injeta o índice de empresas já carregado e recebe de
 * volta `diagnostics` para alimentar a UI.
 */
import { dbDateOrNull } from "@/lib/dateNormalize";
import type { PagRow, TasyRow, TvrResult, TvrStatus } from "./types";
import { num } from "./format";
import {
  dateKeyPart,
  isExcludedTvrTuss,
  isYmdWithinInclusive,
  normAtt,
  normDoctorName,
  normTuss,
  tvrMatchKey,
  tvrTussKey,
} from "./keys";
import { TVR_STATUS_ORDER } from "./status";

/** Índice de PJs cadastradas, montado pelo chamador a partir de `companies`. */
export type TvrCompanyIndex = {
  /** CNPJ (só dígitos) -> company_id */
  byDoc: Map<string, string>;
  /** razão social e aliases normalizados -> company_id */
  byName: Map<string, string>;
};

/** Recorte da apuração que o motor precisa (subconjunto de ReconRow). */
export type TvrEngineScope = {
  period_start: string;
  period_end: string;
  company_id?: string | null;
  /** "multi_pj" habilita o escopo por `multi_company_ids`. */
  scope?: unknown;
  multi_company_ids?: string[];
} | null;

export type TvrEngineInput = {
  tasyRows: TasyRow[];
  pagRows: PagRow[];
  /** Lista separada por vírgula de TUSS a ignorar dos dois lados. */
  excludeTuss?: string;
  /** Convênios a ignorar dos dois lados (comparados normalizados). */
  excludedConvenios?: string[];
  recon: TvrEngineScope;
  companyIndex?: TvrCompanyIndex;
};

export type TvrEngineDiagnostics = {
  convTasyRemoved: number;
  convPagRemoved: number;
  companyTasyRemoved: number;
  tasyOutOfPeriodRemoved: number;
  tasyMissingDateRemoved: number;
  tasyMissingCompany: number;
  tasyUnresolvedCompany: number;
  /** Valores crus da coluna Empresa/PJ que não resolveram, por frequência. */
  unresolvedPjSamples: Array<{ raw: string; count: number; missing: boolean }>;
  /** Linhas TASY que sobreviveram aos filtros de data/período/escopo. */
  effectiveTasyCount: number;
};

export type TvrEngineOutput = {
  results: TvrResult[];
  diagnostics: TvrEngineDiagnostics;
  /** key -> payment_items.applied_calc_id, para o enriquecimento pós-motor. */
  appliedCalcIdByKey: Map<string, string>;
};

/** Normaliza convênio para comparação (sem acento, sem pontuação, minúsculo). */
export function normConvenio(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Mesma normalização usada para casar razão social e aliases de PJ. */
export function normCompanyName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const EMPTY_INDEX: TvrCompanyIndex = { byDoc: new Map(), byName: new Map() };

export function computeTvrResults(input: TvrEngineInput): TvrEngineOutput {
  const {
    tasyRows,
    pagRows,
    excludeTuss = "",
    excludedConvenios = [],
    recon,
    companyIndex = EMPTY_INDEX,
  } = input;

  const excluded = new Set(
    excludeTuss.split(",").flatMap((s) => {
      const full = normTuss(s.trim());
      const key = tvrTussKey(full);
      return [full, key].filter(Boolean);
    }),
  );
  const excludedConvSet = new Set(excludedConvenios.map((k) => normConvenio(k)).filter(Boolean));
  const isExcludedConv = (raw: unknown) => excludedConvSet.size > 0 && excludedConvSet.has(normConvenio(raw));
  let convTasyRemoved = 0;
  let convPagRemoved = 0;
  let companyTasyRemoved = 0;

  // Índice nome→doctor_id extraído do lado Repasse. Permite ao lado TASY
  // (que só tem o nome) cair em `d:<id>` e casar com o Repasse.
  const nameToDoctorId = new Map<string, string>();
  // Índice `${company_id}|${nomeNorm}` → doctor_id. Serve pra desambiguar
  // médicos homônimos que atendem por PJs diferentes — quando a linha TASY
  // trouxer a empresa, priorizamos o doctor_id daquela PJ.
  const nameByCompanyToDoctor = new Map<string, string>();
  for (const r of pagRows) {
    const did = (r.pag_doctor_id ?? "").trim();
    const nn = normDoctorName(r.pag_medico);
    const cid = (r.pag_company_id ?? "").trim();
    if (did && nn && !nameToDoctorId.has(nn)) nameToDoctorId.set(nn, did);
    if (did && nn && cid) {
      const k = `${cid}|${nn}`;
      if (!nameByCompanyToDoctor.has(k)) nameByCompanyToDoctor.set(k, did);
    }
  }

  // Resolver PJ (Terceiro) do TASY → company_id. Aceita vínculo manual do
  // wizard, CNPJ (dígitos), razão social ou alias do cadastro estadual.
  const resolveTasyCompany = (row: TasyRow): string | null => {
    const manualId = String(row.tasy_resolved_company_id ?? "").trim();
    if (manualId) return manualId;
    const raw = row.tasy_empresa;
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const digits = s.replace(/\D+/g, "");
    if (digits.length >= 11) {
      const hit =
        companyIndex.byDoc.get(digits) ||
        (digits.length > 14 ? companyIndex.byDoc.get(digits.slice(-14)) : undefined);
      if (hit) return hit;
    }
    const nn = normCompanyName(s);
    return companyIndex.byName.get(nn) ?? null;
  };

  // Escopo de PJs da apuração — usado pra filtrar linhas TASY que sejam de
  // empresas fora do escopo. Em TVR com lote fixado, linha TASY sem PJ
  // resolvida não pode virar "Não Pago", porque não há como provar que
  // pertence ao universo do lote escolhido.
  const scopedCompanyIds = new Set<string>();
  const reconMultiCompanyIds = (recon?.multi_company_ids ?? []).filter(Boolean);
  const reconIsMulti = recon?.scope === "multi_pj" && reconMultiCompanyIds.length > 0;
  if (reconIsMulti) {
    for (const cid of reconMultiCompanyIds) if (cid) scopedCompanyIds.add(String(cid));
  } else if (recon?.company_id) {
    scopedCompanyIds.add(String(recon.company_id));
  } else {
    for (const r of pagRows) if (r.pag_company_id) scopedCompanyIds.add(r.pag_company_id);
  }

  const tasyCompanyByRow = new Map<TasyRow, string | null>();
  const effectiveTasyRows: TasyRow[] = [];
  let tasyOutOfPeriodRemoved = 0;
  let tasyMissingDateRemoved = 0;
  let tasyMissingCompany = 0;
  let tasyUnresolvedCompany = 0;
  // Amostragem por valor cru da coluna Empresa/PJ — alimenta o painel de
  // mapeamento inline sem bloquear o processamento do lote.
  const unresolvedByRaw = new Map<string, { count: number; missing: boolean }>();
  for (const r of tasyRows) {
    const ymd = dbDateOrNull(r.tasy_data);
    if (!ymd) {
      tasyMissingDateRemoved++;
      continue;
    }
    if (recon && !isYmdWithinInclusive(ymd, recon.period_start, recon.period_end)) {
      tasyOutOfPeriodRemoved++;
      continue;
    }
    const cid = resolveTasyCompany(r);
    tasyCompanyByRow.set(r, cid);
    if (scopedCompanyIds.size > 0) {
      const rawEmpresa = String(r.tasy_empresa ?? "").trim();
      if (!rawEmpresa) {
        // Linha TASY sem PJ na origem: não pode ser atribuída ao lote,
        // então é tratada como fora de escopo (não bloqueia processamento).
        tasyMissingCompany++;
        const key = "(vazio)";
        const cur = unresolvedByRaw.get(key) ?? { count: 0, missing: true };
        unresolvedByRaw.set(key, { count: cur.count + 1, missing: true });
        companyTasyRemoved++;
        continue;
      }
      if (!cid) {
        // PJ não cadastrada/sem alias: se não está no escopo do lote de
        // pagamento, não faz sentido bloquear — apenas apontar no painel
        // para o analista mapear se quiser incluir no cruzamento.
        tasyUnresolvedCompany++;
        const cur = unresolvedByRaw.get(rawEmpresa) ?? { count: 0, missing: false };
        unresolvedByRaw.set(rawEmpresa, { count: cur.count + 1, missing: false });
        companyTasyRemoved++;
        continue;
      }
      if (!scopedCompanyIds.has(cid)) {
        companyTasyRemoved++;
        continue;
      }
    }
    effectiveTasyRows.push(r);
  }

  // Resolve doctor_id da linha TASY: PJ+nome tem prioridade sobre só-nome.
  const resolveTasyDoctorId = (row: TasyRow): string | undefined => {
    const nn = normDoctorName(row.tasy_medico);
    if (!nn) return undefined;
    const cid = tasyCompanyByRow.get(row);
    if (cid) {
      const v = nameByCompanyToDoctor.get(`${cid}|${nn}`);
      if (v) return v;
    }
    return nameToDoctorId.get(nn);
  };

  // Aggregate Repasse by (atendimento, data, tuss8, médico)
  type PAgg = {
    atendimento: string;
    tuss: string;
    qtd_total: number;
    funcs: Set<string>;
    lotes: Set<string>;
    valor_base: number;
    valor_com_acordo: number;
    payment_item_id_first: string;
    payment_id_first: string;
    sample: PagRow;
    doctor_ids_order: string[];
    doctor_principal_id: string | null;
  };
  const pMap = new Map<string, PAgg>();
  const isPrincipal = (fn: string) => /cirurgi[aã]o\s*principal/i.test(fn);
  for (const r of pagRows) {
    if (isExcludedTvrTuss(r.pag_tuss, excluded)) continue;
    if (isExcludedConv(r.pag_convenio)) { convPagRemoved++; continue; }
    if (!dbDateOrNull(r.pag_data)) continue;
    const key = tvrMatchKey(r.pag_atendimento, r.pag_data, r.pag_tuss, r.pag_doctor_id, r.pag_medico, nameToDoctorId);
    const q = num(r.pag_qtd) || 1;
    const vb = num(r.pag_valor_base);
    const va = num(r.pag_valor_com_acordo);
    const fn = (r.pag_funcao ?? "").trim();
    const lote = (r.pag_lote ?? "").trim();
    const did = (r.pag_doctor_id ?? "").trim();
    const cur = pMap.get(key);
    if (cur) {
      cur.qtd_total += q;
      cur.valor_base += vb;
      cur.valor_com_acordo += va;
      if (fn) cur.funcs.add(fn);
      if (lote) cur.lotes.add(lote);
      if (!cur.payment_item_id_first && r.pag_payment_item_id) cur.payment_item_id_first = r.pag_payment_item_id;
      if (!cur.payment_id_first && r.pag_payment_id) cur.payment_id_first = r.pag_payment_id;
      if (did && !cur.doctor_ids_order.includes(did)) cur.doctor_ids_order.push(did);
      if (did && !cur.doctor_principal_id && isPrincipal(fn)) cur.doctor_principal_id = did;
      // enrich sample with non-empty fields from later rows
      const s = cur.sample;
      if (!s.pag_medico && r.pag_medico) s.pag_medico = r.pag_medico;
      if (!s.pag_paciente && r.pag_paciente) s.pag_paciente = r.pag_paciente;
      if (!s.pag_convenio && r.pag_convenio) s.pag_convenio = r.pag_convenio;
      if (!s.pag_procedimento && r.pag_procedimento) s.pag_procedimento = r.pag_procedimento;
      if (!s.pag_data && r.pag_data) s.pag_data = r.pag_data;
      if (!s.pag_funcao && r.pag_funcao) s.pag_funcao = r.pag_funcao;
      if (!s.pag_company_id && r.pag_company_id) s.pag_company_id = r.pag_company_id;
      if (!s.pag_applied_rule_id && r.pag_applied_rule_id) s.pag_applied_rule_id = r.pag_applied_rule_id;
      if (!s.pag_applied_rule_label && r.pag_applied_rule_label) s.pag_applied_rule_label = r.pag_applied_rule_label;
      if (!s.pag_applied_calc_id && r.pag_applied_calc_id) s.pag_applied_calc_id = r.pag_applied_calc_id;
      if (!s.pag_applied_calc_method && r.pag_applied_calc_method) s.pag_applied_calc_method = r.pag_applied_calc_method;
    } else {
      const funcs = new Set<string>();
      const lotes = new Set<string>();
      if (fn) funcs.add(fn);
      if (lote) lotes.add(lote);
      pMap.set(key, {
        atendimento: r.pag_atendimento,
        tuss: r.pag_tuss,
        qtd_total: q,
        funcs,
        lotes,
        valor_base: vb,
        valor_com_acordo: va,
        payment_item_id_first: r.pag_payment_item_id ?? "",
        payment_id_first: r.pag_payment_id ?? "",
        sample: { ...r },
        doctor_ids_order: did ? [did] : [],
        doctor_principal_id: did && isPrincipal(fn) ? did : null,
      });
    }
  }

  // Aggregate TASY by (atendimento, tuss).
  type TAgg = {
    atendimento: string;
    tuss: string;
    qtd: number;
    valor_total: number;
    valor_unit_first: number;
    sample: TasyRow;
  };
  // Coluna "Valor" do relatório TASY é o TOTAL da linha (já multiplicado por qtd).
  // Nunca multiplicar novamente por quantidade — inflacionaria totais e complementos.
  const tasyValueIsLineTotal = true;

  const tMap = new Map<string, TAgg>();
  for (const r of effectiveTasyRows) {
    if (isExcludedTvrTuss(r.tasy_tuss, excluded)) continue;
    if (isExcludedConv(r.tasy_convenio)) { convTasyRemoved++; continue; }
    const key = tvrMatchKey(r.tasy_atendimento, r.tasy_data, r.tasy_tuss, resolveTasyDoctorId(r), r.tasy_medico, nameToDoctorId);
    const q = num(r.tasy_qtd) || 1;
    const v = num(r.tasy_valor_unit);
    const lineTotal = tasyValueIsLineTotal ? v : v * q;
    const unitValue = tasyValueIsLineTotal && q > 0 ? v / q : v;
    const cur = tMap.get(key);
    if (cur) {
      cur.qtd += q;
      cur.valor_total += lineTotal;
    } else {
      tMap.set(key, { atendimento: r.tasy_atendimento, tuss: r.tasy_tuss, qtd: q, valor_total: lineTotal, valor_unit_first: unitValue, sample: r });
    }
  }

  const allKeys = new Set<string>([...tMap.keys(), ...pMap.keys()]);
  const out: TvrResult[] = [];

  for (const key of allKeys) {
    const t = tMap.get(key);
    const p = pMap.get(key);

    const atendimento = t?.atendimento ?? p?.atendimento ?? "";
    const tuss = t?.tuss ?? p?.tuss ?? "";

    const qtd_tasy = t?.qtd ?? 0;
    const valor_total_tasy = t?.valor_total ?? 0;
    const valor_unit_tasy = t ? (t.qtd > 0 ? t.valor_total / t.qtd : t.valor_unit_first) : 0;

    const n_funcs = p ? Math.max(p.funcs.size, p.qtd_total > 0 ? 1 : 0) : 0;
    const qtd_por_func = p && n_funcs > 0 ? p.qtd_total / n_funcs : (p ? p.qtd_total : 0);
    const valor_pago_base = p?.valor_base ?? 0;
    const valor_com_acordo = p?.valor_com_acordo ?? 0;
    const funcoes_pagas = p ? Array.from(p.funcs).join(", ") : "";
    const lotes = p ? Array.from(p.lotes).join(", ") : "";

    const dif_qtd = qtd_tasy - qtd_por_func;
    const dif_valor = valor_total_tasy - valor_pago_base;

    // Determina o tipo de análise a partir do método de cálculo aplicado.
    // Grupo "valor": regras que usam o valor do convênio como base (TASY e Exacta
    //   partem da mesma tabela) → comparar valores em R$ faz sentido. Inclui
    //   também `bonus`, que por definição é aditivo sobre uma base faturada —
    //   se o TASY não faturou a base, o bônus não deveria existir e precisa
    //   entrar como glosa financeira normal.
    // Grupo "quantidade": tabela própria (valor_fixo, pacote, tabela diferenciada)
    //   → valor TASY não é comparável; só quantidade e presença.
    const rawMethod = (p?.sample.pag_applied_calc_method ?? "").trim().toLowerCase();
    const isFixedMethod =
      rawMethod === "valor_fixo" ||
      rawMethod === "tabela_diferenciada" ||
      rawMethod.startsWith("pacote");

    const tipo_analise: "valor" | "quantidade" = isFixedMethod ? "quantidade" : "valor";

    // Status deriva do tipo de análise: em "quantidade" nunca consideramos
    // diferenças de R$ (TASY não é base), só presença e quantidade — assim o
    // badge e a coluna de ação sempre concordam.
    let status: TvrStatus;
    if (!p && t) status = "nao_pago";
    else if (!t && p) status = "ausente_tasy";
    else if (tipo_analise === "quantidade") {
      if (dif_qtd < -0.5) status = "pago_a_mais";
      else if (dif_qtd > 0.5) status = "div_qtd_valor";
      else status = "ok";
    }
    else if (dif_valor < -0.5) status = "pago_a_mais";
    else if (Math.abs(dif_qtd) >= 0.5 && Math.abs(dif_valor) > 0.5) status = "div_qtd_valor";
    else if (Math.abs(dif_valor) > 0.5) status = "div_valor";
    else status = "ok";

    // Comparação: valor com acordo pago no histórico (Exacta) vs
    // valor que o mesmo acordo pagaria HOJE se aplicado sobre a base TASY.
    // fator_acordo é o % de acordo que a regra praticou no lote
    // (ex.: 100%, 88% para hemo, 27,51% para valor_fixo etc.).
    const fator_acordo = valor_pago_base > 0 ? valor_com_acordo / valor_pago_base : 0;
    const valor_com_acordo_recalc = valor_total_tasy * fator_acordo;
    // Positivo => paguei a mais (a recuperar).
    // Negativo => paguei a menos (a complementar).
    let ajuste_acordo = 0;
    let sem_lastro_tasy = false;
    const valor_pago_operacional = valor_com_acordo && valor_com_acordo > 0.5 ? valor_com_acordo : valor_pago_base;
    if (tipo_analise === "quantidade") {
      // Grupo B: só compara quantidade. Divergência de valor TASY não é erro.
      if (status === "ausente_tasy") {
        // Sem presença na auditoria hospitalar: desconta o valor pago total
        // (pós-regra quando disponível). O flag segue como alerta qualitativo:
        // pacote/valor_fixo pode não faturar item individualmente no TASY,
        // mas não bloqueia glosa quando há pagamento no lote.
        sem_lastro_tasy = true;
        ajuste_acordo = valor_pago_operacional;
      } else if (status === "nao_pago") {
        ajuste_acordo = 0;
      } else if (qtd_por_func > 0 && qtd_tasy + 0.0001 < qtd_por_func) {
        // Proporcional: pagou N, TASY comprova M<N → recupera (N−M)/N do pago.
        const deficit = (qtd_por_func - qtd_tasy) / qtd_por_func;
        ajuste_acordo = valor_pago_operacional * deficit;
      }
    } else {
      // Grupo A: regra % sobre convênio → compara valor com acordo recalculado.
      if (status === "ausente_tasy") {
        // TASY zerado/inexistente => item não deveria ter sido pago.
        ajuste_acordo = valor_pago_base;
      } else if (status === "nao_pago") {
        ajuste_acordo = 0; // sem base de acordo — tratado na tela de confecção
      } else if (valor_pago_base > 0) {
        ajuste_acordo = valor_com_acordo - valor_com_acordo_recalc;
      }
    }
    const valor_recuperar_acordo = Math.max(0, ajuste_acordo);

    // ---- Auditoria da chave ----
    const auditAtt = normAtt(t?.atendimento ?? p?.atendimento ?? "");
    const auditDate = dateKeyPart(t?.sample.tasy_data || p?.sample.pag_data || "");
    const auditTuss8 = tvrTussKey(t?.tuss ?? p?.tuss ?? "");
    const pagDoctorIdRaw = (p?.sample.pag_doctor_id ?? "").trim();
    const tasyName = t?.sample.tasy_medico ?? "";
    const pagName = p?.sample.pag_medico ?? "";
    const nameRawForAudit = tasyName || pagName;
    const nameNormForAudit = normDoctorName(nameRawForAudit);
    let doctorSource: "repasse_id" | "name_to_id" | "name_only" | "missing";
    let doctorIdForAudit: string | undefined;
    if (pagDoctorIdRaw) {
      doctorSource = "repasse_id";
      doctorIdForAudit = pagDoctorIdRaw;
    } else if (nameNormForAudit && nameToDoctorId.get(nameNormForAudit)) {
      doctorSource = "name_to_id";
      doctorIdForAudit = nameToDoctorId.get(nameNormForAudit);
    } else if (nameNormForAudit) {
      doctorSource = "name_only";
    } else {
      doctorSource = "missing";
    }

    out.push({
      key,
      atendimento,
      tuss,
      procedimento: t?.sample.tasy_procedimento || p?.sample.pag_procedimento || "",
      paciente: t?.sample.tasy_paciente || p?.sample.pag_paciente || "",
      data: t?.sample.tasy_data || p?.sample.pag_data || "",
      convenio: t?.sample.tasy_convenio || p?.sample.pag_convenio || "",
      medico: t?.sample.tasy_medico || p?.sample.pag_medico || "",
      funcao: t?.sample.tasy_funcao || p?.sample.pag_funcao || "",

      qtd_tasy,
      valor_unit_tasy,
      valor_total_tasy,
      qtd_por_func,
      n_funcs,
      funcoes_pagas,
      lotes,
      valor_pago_base,
      valor_com_acordo,
      dif_qtd,
      dif_valor,
      valor_recuperar_acordo,
      valor_com_acordo_recalc,
      ajuste_acordo,
      tipo_analise,
      sem_lastro_tasy,
      matched_payment_item_id: p?.payment_item_id_first || undefined,
      matched_payment_id: p?.payment_id_first || undefined,
      matched_doctor_id: p ? (p.doctor_principal_id || p.doctor_ids_order[0] || undefined) : undefined,
      matched_doctor_ids: p && p.doctor_ids_order.length > 0 ? [...p.doctor_ids_order] : undefined,
      matched_company_id: p?.sample.pag_company_id || undefined,
      tasy_empresa: t?.sample.tasy_empresa || undefined,
      tasy_resolved_company_id: t ? tasyCompanyByRow.get(t.sample) ?? null : null,
      regra_aplicada: p?.sample.pag_applied_rule_label || undefined,
      calculo_aplicado: undefined, // preenchido depois via lookup em rule_calculations
      key_audit: {
        att: auditAtt,
        date: auditDate,
        tuss8: auditTuss8,
        doctor: {
          source: doctorSource,
          id: doctorIdForAudit,
          name_raw: nameRawForAudit || undefined,
          name_norm: nameNormForAudit || undefined,
        },
      },
      status,
    });
  }

  out.sort((a, b) => {
    const oa = TVR_STATUS_ORDER.indexOf(a.status);
    const ob = TVR_STATUS_ORDER.indexOf(b.status);
    if (oa !== ob) return oa - ob;
    if (a.atendimento !== b.atendimento) return a.atendimento.localeCompare(b.atendimento);
    return a.tuss.localeCompare(b.tuss);
  });

  const appliedCalcIdByKey = new Map<string, string>();
  for (const [key, agg] of pMap) {
    const cid = agg.sample.pag_applied_calc_id;
    if (cid) appliedCalcIdByKey.set(key, cid);
  }

  return {
    results: out,
    appliedCalcIdByKey,
    diagnostics: {
      convTasyRemoved,
      convPagRemoved,
      companyTasyRemoved,
      tasyOutOfPeriodRemoved,
      tasyMissingDateRemoved,
      tasyMissingCompany,
      tasyUnresolvedCompany,
      unresolvedPjSamples: Array.from(unresolvedByRaw.entries())
        .map(([raw, v]) => ({ raw, count: v.count, missing: v.missing }))
        .sort((a, b) => b.count - a.count),
      effectiveTasyCount: effectiveTasyRows.length,
    },
  };
}
