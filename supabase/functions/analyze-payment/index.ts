// analyze-payment — Fase 3
// Motor determinístico (TS puro) decide regra vencedora e calcula expected.
// IA roda apenas em itens marcados como `needs_ai_review` (alerta/reprovado)
// e SÓ produz justificativa textual — não muda status, regra ou valor.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  analyzePaymentItems,
  extendSectorMap,
  normName,
  type ItemInput,
  type RuleInput,
  type PaymentContext,
  type AnalysisResult,
} from "../_shared/rulesEngine.ts";
import {
  mapCalculationTypeToMethod,
  type AppliedCalcMethod,
} from "../_shared/calcMethodMapping.ts";
import { classifyDuplicateMatch, evaluateDuplicate, type DuplicateOverridePayload } from "../_shared/itemHash.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentRow {
  sectors: string[] | null;
  specialties: string[] | null;
  payment_type: string | null;
  payment_due_date: string | null;
  competence_month: string | null;
  analysis_mode: "padrao" | "empresa_prioritaria" | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  let diagnostics = {
    total_items: 0,
    ai_processed_items: 0,
    chunk_size: 100, // Limite configurado
    execution_time_ms: 0,
    status: "processing"
  };

  try {
    const { payment_id, company_name, ai_statuses, tolerance_pct, is_dry_run, _job_id, _company_label } = await req.json();
    // [TIMING] prefixo curto p/ diferenciar workers concorrentes nos logs
    const __t = `[T:${(_company_label ?? company_name ?? "all").toString().slice(0, 24)}]`;
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // Hidrata aliases de setor a partir do cadastro (tabela `sectors`)
    try {
      const { data: secs } = await supabase.from("sectors").select("slug,name,aliases").eq("active", true);
      if (secs?.length) extendSectorMap(secs as Array<{ slug: string; name: string; aliases: string[] }>);
    } catch (_e) { /* fallback ao SECTOR_MAP estático */ }

    // ---------- 1. carrega payment ----------
    const { data: payment } = await supabase
      .from("payments")
      .select("sectors,specialties,payment_type,payment_due_date,competence_month,analysis_mode")
      .eq("id", payment_id)
      .maybeSingle<PaymentRow>();

    const ctx: PaymentContext = {
      sectors: payment?.sectors ?? [],
      specialties: payment?.specialties ?? [],
      payment_type: payment?.payment_type ?? null,
      // Onda 1 — Regra de competência: a vigência é determinada pela
      // `procedure_date` de CADA item dentro do motor (analyzeItem).
      // `reference_date` aqui é apenas informativo e NÃO é usado para
      // selecionar regra. Mantido por compat com o tipo PaymentContext.
      reference_date: payment?.payment_due_date
        ?? payment?.competence_month
        ?? new Date().toISOString().slice(0, 10),
      tolerance_pct: typeof tolerance_pct === "number" ? tolerance_pct : undefined,
    };
    const isEmpresaPrioritaria = payment?.analysis_mode === "empresa_prioritaria";

    // ---------- 2. carrega configurações globais e regras ----------
    console.time(`${__t} carregar_regras`);
    const [configRes, rulesRes] = await Promise.all([
      supabase.from("system_configurations").select("key,value").in("key", ["divergence_thresholds", "medical_role_aliases"]),
      supabase.from("rules").select(`
        id,name,rule_text,description,active,severity,scope,
        target_type,target_identifier,target_name,target_company_id,
        valid_from,valid_until,
        calculation_type,convenio_percentage,fixed_amount,package_amount,extras_codes,
        package_main_code,package_included_codes,package_visits_count,package_opinions_count,package_auxiliaries_included,package_subtype,
        reference_table_id,multiplier,deflator_pct,repasse_pct,
        apply_access_route,include_auxiliaries,auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
        exclusion_reason,allows_authorized_exception,
        agreement_name,agreement_match_mode,
        exception_table_ids,
        group_company_links,group_doctors,
        bonus_amount,bonus_pct,target_amount,
        limiar_alerta_tipo, limiar_alerta_valor, limiar_bloqueio_tipo, limiar_bloqueio_valor,
        force_totalized
      `).eq("active", true)
    ]);

    const configs = (configRes.data ?? []) as any[];
    if (rulesRes.error) {
      console.error("[analyze-payment] rules query error:", rulesRes.error);
      throw new Error(`Falha ao carregar regras ativas: ${rulesRes.error.message}`);
    }
    if (configRes.error) {
      console.warn("[analyze-payment] system_configurations query warning:", configRes.error);
    }
    const rules: RuleInput[] = (rulesRes.data ?? []) as unknown as RuleInput[];

    const divergenceConfig = configs.find(c => c.key === "divergence_thresholds");
    const roleAliasesConfig = configs.find(c => c.key === "medical_role_aliases");

    const globalThresholds = divergenceConfig?.value as any || {
      limiar_alerta_tipo: "percentual",
      limiar_alerta_valor: 1.0,
      limiar_bloqueio_tipo: "percentual",
      limiar_bloqueio_valor: 5.0
    };

    const roleAliases = (roleAliasesConfig?.value as Record<string, string[]>) || {};


    (ctx as any).globalThresholds = globalThresholds;

    // 2.1 Carrega itens de cálculo (1:N) e anexa em cada regra
    if (rules.length > 0) {
      const ruleIds = rules.map((r) => r.id);
      const { data: calcRows, error: calcRowsErr } = await supabase
        .from("rule_calculations")
        .select(`
          id,rule_id,label,sort_order,calculation_type,
          time_mode,time_start,time_end,weekdays,includes_holidays,elective_mode,
          convenio_percentage,fixed_amount,
          package_amount,package_main_code,package_included_codes,package_visits_count,
          package_opinions_count,package_auxiliaries_included,package_subtype,extras_codes,
          reference_table_id,multiplier,deflator_pct,repasse_pct,acrescimo_pct,
          apply_access_route,include_auxiliaries,
          auxiliary_pct,aux_first_pct,aux_second_pct,instrumentador_pct,
          bonus_amount,bonus_pct,target_amount,allowed_access_routes,
          force_totalized,application_unit,sectors,specialties,
          procedure_codes,code_match_mode,doctor_roles,
          agreement_match_mode,agreement_aliases,procedure_keywords,context_conditions
        `)
        .in("rule_id", ruleIds)
        .order("sort_order", { ascending: true });
      if (calcRowsErr) {
        console.error("[analyze-payment] rule_calculations query error:", calcRowsErr);
        throw new Error(`Falha ao carregar cálculos das regras: ${calcRowsErr.message}`);
      }
      if (calcRows == null) {
        console.warn("[analyze-payment] nenhum cálculo retornado para regras ativas; verifique rule_calculations se todas as regras ficarem sem cálculo.");
      }
      const byRule: Record<string, any[]> = {};
      for (const c of (calcRows ?? []) as any[]) {
        (byRule[c.rule_id as string] ||= []).push(c);
      }
      for (const r of rules) {
        const list = byRule[r.id] ?? [];
        if (list.length > 0) (r as any).calculations = list;
      }
      // Coleta reference_table_ids dos itens de cálculo p/ pré-carregamento adiante
      // (já tratado em refTableIds via filter sobre rules — atualizamos abaixo)
    }
    console.timeEnd(`${__t} carregar_regras`);

    // ---------- 3. carrega itens (filtra por empresa se aplicável) ----------
    console.time(`${__t} carregar_itens`);
    const itemsQuery = supabase
      .from("payment_items")
      .select(`
        id,doctor_name,doctor_document,company_name,company_id,
        procedure_code,procedure_name,description,access_route,doctor_role,
        procedure_amount,gross_amount,attendance_number,patient_name,procedure_date,quantity,
        authorized_exception,exception_reason,exception_authorizer,exception_note,
        tipo_linha,complement_reason,
        agreement_text,specialty,tipo_item,sector,attendance_character,
        convenio_value_totalized,
        ai_status,
        item_hash,
        ai_findings
      `)
      .eq("payment_id", payment_id);
    if (company_name && typeof company_name === "string") {
      itemsQuery.eq("company_name", company_name);
    }
    // IMPORTANTE: Se estamos analisando uma empresa específica, processamos TODOS os itens dela
    // para garantir que a visão do usuário reflita a planilha original.
    // O filtro ai_statuses só deve ser aplicado na reanálise global filtrada.
    if (!company_name && Array.isArray(ai_statuses) && ai_statuses.length > 0) {
      itemsQuery.in("ai_status", ai_statuses);
    }
    const { data: itemsRaw } = await itemsQuery.limit(20000);

    // Quando há filtro por ai_statuses, o subset acima não inclui todos os itens
    // do atendimento. Carregamos uma visão slim de TODOS os itens do payment
    // exclusivamente para construir o índice de siblings (condições de contexto).
    const filterApplied = !company_name && Array.isArray(ai_statuses) && ai_statuses.length > 0;
    let siblingsRaw: Array<{ id: string; attendance_number: string | null; procedure_code: string | null }> | null = null;
    if (filterApplied) {
      const { data: allForSiblings } = await supabase
        .from("payment_items")
        .select("id, attendance_number, procedure_code")
        .eq("payment_id", payment_id)
        .limit(50000);
      siblingsRaw = allForSiblings ?? [];
    }
    console.timeEnd(`${__t} carregar_itens`);

    // ---------- 3.1 Classificação determinística por código TUSS ----------
    // Roda ANTES da seleção de regras de pagamento.
    const codes = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => (it.procedure_code ?? "").toString().trim()).filter(Boolean),
    ));
    const classificationByCode: Record<string, { sector: string; source: string; confidence: string }> = {};
    if (codes.length > 0) {
      const { data: classRows } = await supabase
        .from("procedure_classifications")
        .select("code_tuss,sector_classified,confidence,active")
        .in("code_tuss", codes)
        .eq("active", true);
      for (const c of (classRows ?? []) as any[]) {
        // primeira classificação ativa por código vence (índice único garante 1 por setor)
        if (!classificationByCode[c.code_tuss]) {
          classificationByCode[c.code_tuss] = {
            sector: c.sector_classified,
            source: c.sector_classified === "hemodinamica"
              ? "tabela_procedimentos_hemodinamica"
              : `tabela_procedimentos_${c.sector_classified}`,
            confidence: c.confidence ?? "alta",
          };
        }
      }
    }

    // Carrega CNPJ das empresas referenciadas (para casamento de regras por empresa)
    const companyIds = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => it.company_id).filter(Boolean),
    )) as string[];
    let companyDocs: Record<string, string | null> = {};
    if (companyIds.length > 0) {
      const { data: cs } = await supabase
        .from("companies")
        .select("id,document")
        .in("id", companyIds);
      for (const c of cs ?? []) companyDocs[c.id as string] = (c.document as string | null) ?? null;
    }

    // ---------- 3.15 Resolução de ESPECIALIDADE MÉDICA ----------
    // O campo `specialty` em payment_items representa especialidade médica
    // (Urologia, Ortopedia, ...). O `tipo_item` representa o ato (Cirurgia,
    // Anestesia, ...) e NÃO é usado como especialidade.
    // Resolvemos a especialidade médica de cada item em runtime via:
    //   1) procedure_specialty_map (status=aprovado) pelo procedure_code
    //   2) doctors.specialties (intersect com #1 quando ambos disponíveis)
    //   3) doctors.specialties[0] quando o médico tem só uma
    //   4) null → regras com whitelist de especialidade são puladas
    const specMap: Record<string, string> = {};
    if (codes.length > 0) {
      const { data: smRows } = await supabase
        .from("procedure_specialty_map")
        .select("procedure_code,medical_specialty,status")
        .eq("status", "aprovado")
        .in("procedure_code", codes);
      for (const r of (smRows ?? []) as any[]) {
        specMap[String(r.procedure_code)] = String(r.medical_specialty);
      }
    }

    // Cache de especialidades por médico (via doctors.full_name normalizado)
    const doctorNamesNorm = Array.from(new Set(
      (itemsRaw ?? [])
        .map((it: any) => String(it.doctor_name ?? "").trim())
        .filter(Boolean),
    ));
    const doctorSpecsByName: Record<string, string[]> = {};
    if (doctorNamesNorm.length > 0) {
      const { data: docs } = await supabase
        .from("doctors")
        .select("full_name,specialties,active")
        .in("full_name", doctorNamesNorm);
      for (const d of (docs ?? []) as any[]) {
        if (d.active === false) continue;
        doctorSpecsByName[String(d.full_name)] = Array.isArray(d.specialties) ? d.specialties : [];
      }
    }

    const normSpec = (s: string) => s.trim().toLowerCase();

    // ---------- 3.16 Especialidade DOMINANTE do lote/empresa ----------
    // Conta a especialidade resolvida (via procedure_specialty_map) de cada
    // item. Se uma concentra > 51% dos itens com especialidade conhecida,
    // ela é a "especialidade do lote" — usada como fallback para itens cujo
    // código não está mapeado, e persistida em payments.specialties para
    // rastreabilidade e indicador.
    const specCounts: Record<string, { label: string; count: number }> = {};
    let withSpec = 0;
    for (const it of (itemsRaw ?? []) as any[]) {
      const code = (it.procedure_code ?? "").toString().trim();
      const sp = code ? specMap[code] : null;
      if (!sp) continue;
      const k = normSpec(sp);
      (specCounts[k] ||= { label: sp, count: 0 }).count++;
      withSpec++;
    }
    let dominantSpecialty: string | null = null;
    if (withSpec > 0) {
      const sorted = Object.values(specCounts).sort((a, b) => b.count - a.count);
      const top = sorted[0];
      if (top && top.count / withSpec > 0.51) dominantSpecialty = top.label;
    }

    const resolveMedicalSpecialty = (it: any): { value: string | null; source: string } => {
      const code = (it.procedure_code ?? "").toString().trim();
      const fromMap = code ? specMap[code] ?? null : null;
      const docList = doctorSpecsByName[String(it.doctor_name ?? "").trim()] ?? [];
      // 1) mapa + médico → interseção
      if (fromMap && docList.length > 1) {
        const inter = docList.find((s) => normSpec(s) === normSpec(fromMap));
        if (inter) return { value: inter, source: "map+doctor" };
      }
      // 2) só mapa
      if (fromMap) return { value: fromMap, source: "map" };
      // 3) médico tem só uma especialidade
      if (docList.length === 1) return { value: docList[0], source: "doctor" };
      // 4) fallback: especialidade dominante do lote/empresa (>51%)
      if (dominantSpecialty) return { value: dominantSpecialty, source: "lote_dominante" };
      // 5) nada
      return { value: null, source: "none" };
    };

    const items: ItemInput[] = (itemsRaw ?? []).map((it: any) => {
      const code = (it.procedure_code ?? "").toString().trim();
      const cls = code ? classificationByCode[code] : undefined;
      const resolved = resolveMedicalSpecialty(it);
      // Anota fonte para persistir em ai_findings depois
      (it as any).__resolved_specialty = resolved;
      return ({
      id: it.id,
      doctor_name: it.doctor_name,
      doctor_document: it.doctor_document,
      company_name: it.company_name,
      company_id: it.company_id,
      company_document: it.company_id ? (companyDocs[it.company_id] ?? null) : null,
      procedure_code: it.procedure_code,
      procedure_name: it.procedure_name,
      description: it.description,
      access_route: it.access_route,
      doctor_role: it.doctor_role,
      procedure_amount: it.procedure_amount != null ? Number(it.procedure_amount) : null,
      gross_amount: Number(it.gross_amount),
      attendance_number: it.attendance_number,
      patient_name: it.patient_name,
      procedure_date: it.procedure_date,
      quantity: it.quantity != null ? Number(it.quantity) : null,
      authorized_exception: it.authorized_exception ?? false,
      exception_reason: it.exception_reason ?? null,
      exception_authorizer: it.exception_authorizer ?? null,
      exception_note: it.exception_note ?? null,
      classification_sector: cls?.sector ?? null,
      classification_source: cls?.source ?? null,
      classification_confidence: cls?.confidence ?? null,
      tipo_linha: it.tipo_linha ?? null,
      complement_reason: it.complement_reason ?? null,
      agreement_name: it.agreement_text ?? null,
      // Especialidade MÉDICA resolvida (NÃO é o tipo_item).
      specialty: resolved.value,
      sector: it.sector ?? null,
      attendance_character: it.attendance_character ?? null,
      convenio_value_totalized: it.convenio_value_totalized ?? false,
      // Sub-Onda 2C — passa resolução prévia (se houver) para o motor.
      calc_duplicity_resolution: it.ai_findings?.calc_duplicity?.resolution?.chosen_calc_id
        ? { chosen_calc_id: String(it.ai_findings.calc_duplicity.resolution.chosen_calc_id) }
        : null,
    });
    });

    // ---------- 3.2 Tabelas de EXCEÇÃO vinculadas às regras (Camada 2) ----------
    // Princípio: tabelas de referência são entidades dormentes — só atuam
    // quando uma regra ATIVA as declara em `exception_table_ids`. O motor
    // recebe um lookup (tableId+code → metadados) e consulta apenas as
    // tabelas vinculadas à regra vencedora de cada item. Não há varredura
    // global — tabelas sem vínculo declarado não influenciam o cálculo.
    // Camada 2 & 3 — Tabelas de exceção.
    // 1. Tabelas explicitamente vinculadas às regras (Camada 2)
    const linkedTableIds = Array.from(new Set(
      rules.flatMap((r) => Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []),
    ));
    
    // 2. Tabelas globais (Camada 3) — todas que são 'sem_acordo' ou 'exclusao' e estão ativas
    const { data: allExcTables } = await supabase
      .from("reference_tables")
      .select("id,name,purpose,description,active,valid_from,valid_until")
      .in("purpose", ["sem_acordo", "exclusao"])
      .eq("active", true);

    const today = (ctx.reference_date ?? new Date().toISOString().slice(0, 10));
    const validGlobalIds: string[] = [];
    const exceptionTablesById: Record<string, { name: string; purpose: "sem_acordo" | "exclusao"; description: string | null }> = {};

    for (const t of (allExcTables ?? []) as any[]) {
      if (t.valid_from && t.valid_from > today) continue;
      if (t.valid_until && t.valid_until < today) continue;
      
      exceptionTablesById[t.id] = {
        name: t.name,
        purpose: t.purpose,
        description: t.description ?? null,
      };
      
      // Se a tabela é 'sem_acordo' ou 'exclusao', ela atua como fallback global
      if (t.purpose === "sem_acordo" || t.purpose === "exclusao") {
        validGlobalIds.push(t.id);
      }
    }

    ctx.globalExceptionTableIds = validGlobalIds;
    const allRelevantTableIds = Array.from(new Set([...linkedTableIds, ...validGlobalIds]));

    const exceptionItemsByTable: Record<string, Record<string, { description: string | null }>> = {};
    if (allRelevantTableIds.length > 0 && codes.length > 0) {
      const { data: excItems } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,description")
        .in("reference_table_id", allRelevantTableIds)
        .in("code", codes);
      for (const it of (excItems ?? []) as any[]) {
        const tid = it.reference_table_id as string;
        const code = String(it.code ?? "").trim();
        if (!tid || !code) continue;
        (exceptionItemsByTable[tid] ||= {})[code] = { description: it.description ?? null };
      }
    }
    const exceptionLookup = (tableId: string, code: string) => {
      const t = exceptionTablesById[tableId];
      if (!t) return null;
      const items = exceptionItemsByTable[tableId];
      const hit = items?.[String(code).trim()];
      if (!hit) return null;
      return {
        table_name: t.name,
        purpose: t.purpose,
        reason: hit.description ?? t.description ?? null,
      };
    };

    // ---------- 3.3 Tabelas de referência vinculadas a regras "tabela_diferenciada" ----------
    // Carrega valores (code → amount) de cada reference_table_id usado por regras
    // que calculam por tabela diferenciada/referência. O motor consulta esse
    // lookup; NÃO usamos `procedure_amount` quando a regra tem tabela vinculada.
    const refTableIds = Array.from(new Set([
      ...rules
        .filter((r) =>
          r.reference_table_id && (
            r.calculation_type === "tabela_diferenciada" ||
            r.calculation_type === "tabela_referencia"
          ),
        )
        .map((r) => r.reference_table_id as string),
      // Também: reference_table_id usado por itens de cálculo (1:N)
      ...rules.flatMap((r) =>
        (Array.isArray((r as any).calculations) ? (r as any).calculations : [])
          .filter((c: any) => c.reference_table_id)
          .map((c: any) => c.reference_table_id as string),
      ),
    ]));
    const refValues: Record<string, Record<string, number>> = {};
    if (refTableIds.length > 0 && codes.length > 0) {
      const { data: refRows } = await supabase
        .from("reference_table_items")
        .select("reference_table_id,code,amount,port,package_amount,role")
        .in("reference_table_id", refTableIds)
        .in("code", codes);
      for (const row of (refRows ?? []) as any[]) {
        const tid = row.reference_table_id as string;
        const code = String(row.code ?? "").trim();
        const role = row.role ? row.role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : null;
        if (!tid || !code) continue;
        const amt = row.amount != null ? Number(row.amount) : (row.package_amount != null ? Number(row.package_amount) : null);
        if (amt == null || Number.isNaN(amt)) continue;
        const key = role ? `${code}|${role}` : code;
        (refValues[tid] ||= {})[key] = amt;
      }
    }
    const referenceLookup: ReferenceTableLookup = (tableId: string, code: string, role?: string | null, forceSpecific?: boolean): number | null => {
      const t = refValues[tableId];
      if (!t) return null;
      const c = String(code).trim();

      if (role) {
        const rolesToTry: string[] = [role.toString().trim()];
        
        // Tenta encontrar o papel canônico via aliases
        const roleNorm = role.toString().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        for (const [canonical, aliases] of Object.entries(roleAliases)) {
          const normAliases = aliases.map(a => a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
          if (normAliases.includes(roleNorm)) {
            rolesToTry.push(canonical);
            break;
          }
        }

        for (const r of rolesToTry) {
          const rNorm = r.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (t[`${c}|${rNorm}`] != null) return t[`${c}|${rNorm}`];
        }
      }

      if (forceSpecific) return null;
      return t[c] ?? null;
    };

    // ---------- 4. MOTOR: decisão + cálculo determinístico ----------
    console.time(`${__t} motor_analise`);
    const siblingsSource = siblingsRaw
      ? siblingsRaw.map((r) => ({
          id: r.id,
          attendance_number: r.attendance_number ?? undefined,
          procedure_code: r.procedure_code ?? undefined,
        }) as any)
      : undefined;
    const results: AnalysisResult[] = analyzePaymentItems(items, rules, ctx, { referenceLookup, exceptionLookup, siblingsSource });
    console.timeEnd(`${__t} motor_analise`);

    // CAMADAS 1 e 2 — Gating por-regra (convênio whitelist/blacklist e
    // tabelas de exceção vinculadas) são aplicadas DENTRO do motor
    // (`analyzeItem`), sobre a regra vencedora de cada item. Cada regra é
    // uma unidade autocontida; tabelas só atuam quando vinculadas via
    // `exception_table_ids`. Não há varredura ou override global.


    const resultById: Record<string, AnalysisResult> = {};
    for (const r of results) resultById[r.item_id] = r;

    // ---------- 4.2 PACOTES FIXOS por combinação de códigos ----------
    // Tabelas reference_tables.kind = 'pacote_combinacao' SÓ atuam quando
    // estiverem vinculadas a alguma regra ativa (via reference_table_id da
    // regra, reference_table_id de um cálculo, ou exception_table_ids).
    // Tabela sem regra vinculada não tem poder algum — a regra manda.
    try {
      const today = (ctx.reference_date ?? new Date().toISOString().slice(0, 10));
      const ruleLinkedTableIds = new Set<string>([
        ...rules.filter((r) => r.reference_table_id).map((r) => r.reference_table_id as string),
        ...rules.flatMap((r) =>
          (Array.isArray((r as any).calculations) ? (r as any).calculations : [])
            .filter((c: any) => c.reference_table_id)
            .map((c: any) => c.reference_table_id as string),
        ),
        ...rules.flatMap((r) => Array.isArray(r.exception_table_ids) ? r.exception_table_ids : []),
      ]);
      if (ruleLinkedTableIds.size === 0) {
        // Nenhuma regra ativa referencia tabela alguma → não há pacote a aplicar.
        // (early-out evita query desnecessária)
      }
      const { data: pkgTablesAll } = ruleLinkedTableIds.size === 0 ? { data: [] as any[] } : await supabase
        .from("reference_tables")
        .select("id,name,active,valid_from,valid_until,package_only_main_surgeon,package_apply_auxiliaries,package_apply_particular,package_apply_intl_insurance")
        .eq("kind", "pacote_combinacao")
        .eq("active", true)
        .in("id", Array.from(ruleLinkedTableIds));
      const pkgTables = (pkgTablesAll ?? []).filter((t: any) =>
        (!t.valid_from || t.valid_from <= today) && (!t.valid_until || t.valid_until >= today),
      );
      if (pkgTables.length > 0) {
        const pkgIds = pkgTables.map((t: any) => t.id);
        const { data: pkgItems } = await supabase
          .from("reference_table_items")
          .select("id,reference_table_id,package_id,tuss_codes,package_amount,description")
          .in("reference_table_id", pkgIds);

        const byAttendance: Record<string, typeof items> = {};
        for (const it of items) {
          const k = (it.attendance_number ?? "").toString().trim() || `__no_att__${it.id}`;
          (byAttendance[k] ||= []).push(it);
        }
        const tableById: Record<string, any> = {};
        for (const t of pkgTables) tableById[(t as any).id] = t;

        const isAuxRole = (role: string | null | undefined) => {
          const s = (role ?? "").toLowerCase();
          return s.includes("aux") || s.includes("instrument");
        };

        for (const attItems of Object.values(byAttendance)) {
          const codeSet = new Set(
            attItems.map((i) => (i.procedure_code ?? "").toString().trim()).filter(Boolean),
          );
          if (codeSet.size === 0) continue;

          for (const pkg of (pkgItems ?? []) as any[]) {
            const required: string[] = (pkg.tuss_codes ?? []).map((c: string) => String(c).trim()).filter(Boolean);
            if (required.length === 0) continue;
            if (!required.every((c) => codeSet.has(c))) continue;

            const cfg = tableById[pkg.reference_table_id];
            const eligible = attItems.filter((i) => {
              const code = (i.procedure_code ?? "").toString().trim();
              if (!required.includes(code)) return false;
              const role = i.doctor_role ?? "";
              if (cfg?.package_only_main_surgeon && isAuxRole(role)) return false;
              if (!cfg?.package_apply_auxiliaries && isAuxRole(role)) return false;
              return true;
            });
            if (eligible.length === 0) continue;

            const pkgAmount = Number(pkg.package_amount ?? 0);
            const perItem = pkgAmount / eligible.length;

            for (const it of eligible) {
              const r = resultById[it.id];
              if (!r || r.calculation_type_used === "exclusao") continue;
              r.expected_amount = perItem;
              r.diff_pct = perItem ? ((it.gross_amount - perItem) / perItem) * 100 : null;
              r.matched_rule_id = null;
              r.matched_rule_name = `Pacote: ${cfg?.name ?? "—"} · ${pkg.package_id ?? ""}`;
              r.matched_priority = "conflito";
              r.calculation_type_used = "pacote_fixo";
              r.calculation_explanation =
                `Combinação ${required.join(" + ")} corresponde ao pacote "${pkg.package_id ?? ""}" ` +
                `da tabela "${cfg?.name ?? ""}". Valor fixo R$ ${pkgAmount.toFixed(2)} ` +
                `rateado entre ${eligible.length} item(ns) = R$ ${perItem.toFixed(2)} cada.`;
              const diff = it.gross_amount - perItem;
              if (Math.abs(diff) <= 0.01) {
                r.status = "aprovado" as any;
                r.needs_ai_review = false;
              } else {
                r.status = "alerta" as any;
                r.needs_ai_review = true;
                r.alerts = [
                  `Pacote fixo "${pkg.package_id ?? ""}": esperado R$ ${perItem.toFixed(2)}, pago R$ ${it.gross_amount.toFixed(2)}.`,
                  ...r.alerts,
                ];
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[pacote_combinacao] falha:", e);
    }

    // ---------- 5. IA SÓ JUSTIFICA itens com needs_ai_review ----------
    // Em modo empresa_prioritaria, ignoramos histórico de outros pagamentos.
    const itemsToReview = is_dry_run ? [] : results.filter((r) => r.needs_ai_review).slice(0, 200);
    let aiJustifications: Record<string, { extra_alerts: string[]; ai_note: string }> = {};

    console.time(`${__t} chamada_ia`);
    if (itemsToReview.length > 0 && LOVABLE_API_KEY) {
      const itemsForAi = itemsToReview.map((r) => {
        const it = items.find((i) => i.id === r.item_id)!;
        return {
          id: r.item_id,
          empresa: it.company_name,
          atendimento: it.attendance_number,
          paciente: it.patient_name,
          medico: it.doctor_name,
          funcao: it.doctor_role,
          codigo: it.procedure_code,
          procedimento: it.procedure_name ?? it.description,
          via_acesso: it.access_route,
          valor_convenio: it.procedure_amount,
          valor_pago: it.gross_amount,
          motor: {
            status: r.status,
            valor_esperado: r.expected_amount,
            diff_pct: r.diff_pct,
            regra_vencedora: r.matched_rule_name,
            tipo_calculo: r.calculation_type_used,
            prioridade: r.matched_priority,
            explicacao: r.calculation_explanation,
            alertas_motor: r.alerts,
            grupo_atendimento: r.attendance_group_key,
            procedimento_principal: r.is_main_procedure,
            motivo_principal: r.main_reason,
            principal_ambiguo: r.main_ambiguous,
          },
        };
      });

      const historyText = isEmpresaPrioritaria ? "" : await (async () => {
        const { data: history } = await supabase
          .from("payment_observations")
          .select("author_type, message")
          .in("author_type", ["validador", "diretor"])
          .order("created_at", { ascending: false })
          .limit(20);
        if (!history?.length) return "";
        return "\n\nObservações recentes de validadores/diretor (contexto):\n" +
          history.map((h: any) => `- (${h.author_type}) ${h.message}`).join("\n");
      })();

      const systemPrompt = `Você é um auditor de pagamentos médicos. 
MOTOR DETERMINÍSTICO já decidiu a regra e o valor. Sua missão é APONTAR FALHAS DE LÓGICA ou VÍNCULOS DIVERGENTES.
- O médico pertence à empresa? 
- O procedimento faz sentido para o contexto?
- Identifique duplicidades de cobrança no mesmo atendimento.
- Setor é filtro OPCIONAL. Nunca peça para cadastrar setor se a regra não o exige.
NUNCA mude status ou valores. Sua saída auxilia a decisão humana.
${isEmpresaPrioritaria ? "MODO EMPRESA_PRIORITÁRIA: analise cada item ISOLADAMENTE." : ""}${historyText}`;

      // A IA é apenas justificativa textual; o motor determinístico já decidiu.
      // Mantemos timeout curto para nunca prender a consolidação da empresa.
      const aiAbort = new AbortController();
      const aiTimer = setTimeout(() => aiAbort.abort(), 35_000);
      let aiResp: Response | null = null;
      try {
        aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: aiAbort.signal,
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Itens marcados pelo motor (JSON):\n${JSON.stringify(itemsForAi, null, 2)}` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "report_justifications",
              description: "Justifica cada item já analisado pelo motor",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string", description: "Resumo OBJETIVO em pt-BR, máx. 2 frases, focado no que o gestor precisa decidir." },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        ai_note: { type: "string", description: "Justificativa curta do alerta/reprovação." },
                        extra_alerts: { type: "array", items: { type: "string" }, description: "Alertas EXTRAS que o motor não capturou. Vazio se nada a acrescentar." },
                      },
                      required: ["id", "ai_note", "extra_alerts"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["summary", "items"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "report_justifications" } },
        }),
      });

      if (aiResp && aiResp.ok) {
        const aiData = await aiResp.json();
        const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (tc) {
          const parsed = JSON.parse(tc.function.arguments);
          for (const it of parsed.items ?? []) {
            aiJustifications[it.id] = {
              extra_alerts: Array.isArray(it.extra_alerts) ? it.extra_alerts : [],
              ai_note: typeof it.ai_note === "string" ? it.ai_note : "",
            };
          }
          (aiJustifications as any).__summary = parsed.summary ?? "";
        }
      } else if (aiResp) {
        const txt = await aiResp.text();
        console.error("AI justification error", aiResp.status, txt);
        // Falha de IA não derruba a análise — motor já decidiu tudo.
      }
      } catch (aiErr: any) {
        // Timeout/abort ou erro de rede — segue só com o motor determinístico.
        console.error(`${__t} chamada_ia falhou:`, aiErr?.message ?? aiErr);
      } finally {
        clearTimeout(aiTimer);
      }
    }
    console.timeEnd(`${__t} chamada_ia`);

    // ---------- 6. Caller (para snapshots) ----------
    let triggeredBy: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const jwt = authHeader.replace("Bearer ", "");
        const { data: u } = await supabase.auth.getUser(jwt);
        triggeredBy = u?.user?.id ?? null;
      }
    } catch (_) { /* opcional */ }

    // ---------- 7. Snapshots prévios para diff ----------
    const itemIds = results.map((r) => r.item_id);
    const { data: prevVersions } = await supabase
      .from("ai_analysis_versions")
      .select("item_id, version, ai_status, expected_amount, alerts, matched_rules")
      .in("item_id", itemIds);
    const prevByItem: Record<string, { version: number; ai_status: string; expected_amount: number | null; alerts: string[]; matched_rules: string[] }> = {};
    for (const v of prevVersions ?? []) {
      const cur = prevByItem[v.item_id as string];
      if (!cur || (v.version as number) > cur.version) {
        prevByItem[v.item_id as string] = {
          version: v.version as number,
          ai_status: v.ai_status as string,
          expected_amount: (v.expected_amount as number | null) ?? null,
          alerts: (v.alerts as string[]) ?? [],
          matched_rules: (v.matched_rules as string[]) ?? [],
        };
      }
    }

    // ---------- 8. Persiste resultados (em lote / paralelizado) ----------
    if (is_dry_run) {
      console.log(`[DRY RUN] Analysis completed for ${results.length} items. Skipping persistence.`);
      return new Response(
        JSON.stringify({ 
          ok: true, 
          is_dry_run: true,
          total: results.length,
          results: results.map(r => ({
            item_id: r.item_id,
            status: r.status,
            expected_amount: r.expected_amount,
            matched_rule_name: r.matched_rule_name,
            calculation_explanation: r.calculation_explanation,
            breakdown: r.calculation_breakdown
          }))
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Antes: cada item fazia UPDATE + INSERT + (talvez) INSERT em sequência
    // dentro de um for..await, o que estourava o timeout de 150s da edge
    // function quando o lote tinha muitos itens. Agora preparamos as linhas
    // sincronamente e disparamos as escritas em paralelo (updates em chunks,
    // inserts em bulk).
    let alerts = 0, blocks = 0;
    const itemDiffSummaries: { item_id: string; doctor: string; diff: string }[] = [];
    const itemsById: Record<string, ItemInput> = {};
    for (const it of items) itemsById[it.id] = it;
    const itemsRawById: Record<string, any> = {};
    for (const it of (itemsRaw ?? []) as any[]) itemsRawById[it.id] = it;

    // ===== Sub-Onda 2B — Detecção de duplicidade entre lotes =====
    // Busca itens com o MESMO item_hash em OUTROS pagamentos e classifica
    // por status do lote-fonte (block / warn / none). Override prévio
    // (ai_findings.duplicate_detection.override) é respeitado.
    type DupMatch = {
      other_item_id: string;
      other_payment_id: string;
      other_payment_reference: string;
      other_payment_status: string;
      other_attendance_number: string | null;
      other_patient_name: string | null;
      other_procedure_date: string | null;
      other_doctor_name: string | null;
      other_doctor_role: string | null;
      other_expected_amount: number | null;
      severity: "block" | "warn";
    };
    const dupByItemId: Record<string, {
      severity: "block" | "warn" | "override";
      matches: DupMatch[];
      uncovered: DupMatch[];
      override: DuplicateOverridePayload | null;
    }> = {};

    const hashesPresent = Array.from(new Set(
      (itemsRaw ?? []).map((it: any) => it.item_hash).filter(Boolean) as string[],
    ));
    if (hashesPresent.length > 0) {
      const { data: dupRows } = await supabase
        .from("payment_items")
        .select(`
          id,payment_id,item_hash,attendance_number,patient_name,procedure_date,
          doctor_name,doctor_role,expected_amount,
          payment:payments!inner(id,reference,status)
        `)
        .in("item_hash", hashesPresent)
        .neq("payment_id", payment_id);

      const byHash: Record<string, any[]> = {};
      for (const row of (dupRows ?? []) as any[]) {
        (byHash[row.item_hash as string] ||= []).push(row);
      }

      for (const it of (itemsRaw ?? []) as any[]) {
        const hash = it.item_hash as string | null;
        if (!hash) continue;
        const candidates = byHash[hash] ?? [];
        if (candidates.length === 0) continue;

        const matches: DupMatch[] = [];
        for (const c of candidates) {
          const st = String(c.payment?.status ?? "");
          const sev = classifyDuplicateMatch(st);
          if (sev === "none") continue;
          matches.push({
            other_item_id: c.id,
            other_payment_id: c.payment_id,
            other_payment_reference: String(c.payment?.reference ?? ""),
            other_payment_status: st,
            other_attendance_number: c.attendance_number ?? null,
            other_patient_name: c.patient_name ?? null,
            other_procedure_date: c.procedure_date ?? null,
            other_doctor_name: c.doctor_name ?? null,
            other_doctor_role: c.doctor_role ?? null,
            other_expected_amount: c.expected_amount != null ? Number(c.expected_amount) : null,
            severity: sev,
          });
        }
        if (matches.length === 0) continue;

        const existingOverride =
          (it.ai_findings?.duplicate_detection?.override ?? null) as DuplicateOverridePayload | null;
        // BUGFIX 2B — escopo restrito: cada colisão precisa estar individualmente
        // coberta pelo paired_with_*; matches novos NÃO são liberados pelo override antigo.
        const evaluated = evaluateDuplicate(matches, existingOverride);
        const finalSev: "block" | "warn" | "override" =
          evaluated.severity === "none" ? "warn" : evaluated.severity;
        dupByItemId[it.id] = {
          severity: finalSev,
          matches,
          uncovered: evaluated.uncovered,
          override: existingOverride,
        };
      }
    }
    // ===== fim 2B =====


    type ItemUpdate = {
      id: string;
      ai_status: string;
      ai_findings: any;
      attendance_group_key: string | null;
      specialty: string | null;
      sector: string | null;
      // Sub-Onda 2A — colunas SQL nativas espelhando o motor de regras.
      applied_rule_id: string | null;
      applied_rule_label: string | null;
      applied_calc_id: string | null;
      applied_calc_method: AppliedCalcMethod | null;
      expected_amount: number | null;
      applied_at: string | null;
    };
    type VersionRow = Record<string, unknown>;
    type ObsRow = Record<string, unknown>;

    const itemUpdates: ItemUpdate[] = [];
    const versionRows: VersionRow[] = [];
    const obsRows: ObsRow[] = [];

    for (const r of results) {
      const it = itemsById[r.item_id];
      const aiJ = aiJustifications[r.item_id];
      const finalAlerts = [...r.alerts, ...(aiJ?.extra_alerts ?? [])];
      const matchedRules = r.matched_rule_name ? [r.matched_rule_name] : [];
      const matchedRuleIds = r.matched_rule_id ? [r.matched_rule_id] : [];

      const itRaw = itemsRawById[r.item_id];
      const resolvedSpec = itRaw?.__resolved_specialty as { value: string | null; source: string } | undefined;
      const decisionFields = {
        used: {
          sector: it?.classification_sector ?? null,
          procedure_code: it?.procedure_code ?? null,
          doctor_document: it?.doctor_document ?? null,
          doctor_name: it?.doctor_name ?? null,
          company_id: it?.company_id ?? null,
          company_document: it?.company_document ?? null,
          agreement_name: it?.agreement_name ?? null,
          access_route: it?.access_route ?? null,
          doctor_role: it?.doctor_role ?? null,
          procedure_date: it?.procedure_date ?? null,
        },
        ignored: {
          specialty: {
            used: false,
            value: resolvedSpec?.value ?? it?.specialty ?? null,
            reason: "Especialidade é metadado de relatório/filtro e nunca entra na seleção de regra (regra de projeto).",
          },
          patient_name: { used: false, reason: "Apenas informacional." },
          procedure_name: { used: false, reason: "Apenas informacional; matching é por procedure_code." },
        },
      };
      const findings = {
        alerts: finalAlerts,
        matched_rules: matchedRules,
        matched_rule_ids: matchedRuleIds,
        expected_amount: r.expected_amount,
        calculation_explanation: r.calculation_explanation,
        medical_specialty_resolved: resolvedSpec
          ? { value: resolvedSpec.value, source: resolvedSpec.source }
          : null,
        engine: {
          calculation_type_used: r.calculation_type_used,
          matched_priority: r.matched_priority,
          diff_pct: r.diff_pct,
          ai_note: aiJ?.ai_note ?? null,
        },
        calculation_breakdown: r.calculation_breakdown ?? null,
        selection_trace: r.selection_trace ?? null,
        decision_fields: decisionFields,
      } as any;

      // Sub-Onda 2B — aplica duplicate_detection com escopo restrito do override.
      // BUGFIX: matches não cobertos pelo paired_with_* derrubam o override
      // e voltam a bloquear/alertar. matched_items mostra TODAS as colisões
      // (cobertas e não-cobertas) para visibilidade; uncovered_matches lista
      // exatamente as que ainda exigem decisão.
      const dup = dupByItemId[r.item_id];
      let finalStatus = r.status;
      if (dup) {
        if (dup.severity === "override") {
          findings.duplicate_detection = {
            status: "override_applied",
            matched_items: dup.matches,
            uncovered_matches: [],
            override: dup.override,
          };
        } else if (dup.severity === "block") {
          const head = dup.uncovered[0];
          findings.duplicate_detection = {
            status: "blocked",
            matched_items: dup.matches,
            uncovered_matches: dup.uncovered,
            override: dup.override, // mantém override prévio para auditoria
          };
          finalStatus = "erro_duplicidade_pagamento";
          findings.alerts = [
            ...findings.alerts,
            `Duplicidade de pagamento bloqueada: item já registrado em lote ${head.other_payment_reference} (status ${head.other_payment_status})${dup.override ? " — override prévio não cobre esta colisão" : ""}.`,
          ];
        } else {
          const head = dup.uncovered[0];
          findings.duplicate_detection = {
            status: "warned",
            matched_items: dup.matches,
            uncovered_matches: dup.uncovered,
            override: dup.override,
          };
          findings.alerts = [
            ...findings.alerts,
            `Possível duplicidade: item também consta no lote ${head.other_payment_reference} (status ${head.other_payment_status}).`,
          ];
          if (finalStatus === "aprovado") finalStatus = "alerta";
        }
      }

      // ===== Sub-Onda 2C — duplicidade entre cálculos da mesma regra =====
      const priorCalcDup = itRaw?.ai_findings?.calc_duplicity ?? null;
      const priorResolution = priorCalcDup?.resolution ?? null;
      const isCalcDuplicityBlock = !!(r.calc_duplicity && r.expected_amount === null);
      const isResolutionStaleSingle = !!(r.calc_duplicity?.resolution_stale && r.expected_amount !== null);

      if (isCalcDuplicityBlock) {
        finalStatus = "erro_duplicidade_calculo" as any;
        findings.calc_duplicity = {
          rule_id: r.calc_duplicity!.rule_id,
          rule_name: r.calc_duplicity!.rule_name,
          matched_calculations: r.calc_duplicity!.matched_calculations,
          ...(priorResolution ? { resolution: priorResolution } : {}),
          ...(r.calc_duplicity!.resolution_stale ? { resolution_stale: true } : {}),
        };
        findings.alerts = [
          ...findings.alerts,
          `Cadastro com ambiguidade: a regra "${r.calc_duplicity!.rule_name}" possui ${r.calc_duplicity!.matched_calculations.length} cálculos válidos para este item. Defina manualmente qual aplicar.`,
        ];
      } else if (isResolutionStaleSingle) {
        // Resolveu para um único cálculo válido, mas a escolha anterior do analista
        // referenciava um calc removido — preserva resolution para auditoria mas marca stale.
        findings.calc_duplicity = {
          rule_id: r.calc_duplicity!.rule_id,
          rule_name: r.calc_duplicity!.rule_name,
          matched_calculations: r.calc_duplicity!.matched_calculations,
          resolution_stale: true,
          ...(priorResolution ? { resolution: priorResolution } : {}),
        };
      } else if (priorResolution) {
        // Aplicou normalmente um cálculo cuja escolha continua válida — preserva resolution.
        findings.calc_duplicity = {
          ...(priorCalcDup ?? {}),
          resolution: priorResolution,
        };
      }
      // ===== fim 2C =====

      const appliedCalcMethod = isCalcDuplicityBlock
        ? null
        : mapCalculationTypeToMethod(r.calculation_type_used);
      const appliedCalcId = isCalcDuplicityBlock
        ? null
        : ((r.calculation_breakdown ?? []).find((b) => b.matched && b.calc_id)?.calc_id ?? null);

      itemUpdates.push({
        id: r.item_id,
        ai_status: finalStatus,
        ai_findings: {
          ...findings,
          engine: {
            ...(findings.engine || {}),
            inferred_sector: (r as any).inferred_sector ?? r.selection_trace?.item_sector ?? null,
          }
        },
        attendance_group_key: r.attendance_group_key ?? null,
        specialty: resolvedSpec?.value ?? null,
        sector: (r as any).inferred_sector ?? r.selection_trace?.item_sector ?? null,
        applied_rule_id: r.matched_rule_id ?? null,
        applied_rule_label: r.matched_rule_name ?? null,
        applied_calc_id: appliedCalcId,
        applied_calc_method: appliedCalcMethod,
        expected_amount: isCalcDuplicityBlock ? null : (r.expected_amount ?? null),
        applied_at: isCalcDuplicityBlock ? null : new Date().toISOString(),
      });

      if (finalStatus === "alerta") alerts++;
      if (
        finalStatus === "reprovado" ||
        finalStatus === "erro_duplicidade_pagamento" ||
        finalStatus === "erro_duplicidade_calculo"
      ) blocks++;

      const prev = prevByItem[r.item_id];
      const nextVersion = (prev?.version ?? 0) + 1;
      versionRows.push({
        payment_id,
        item_id: r.item_id,
        version: nextVersion,
        ai_status: r.status,
        alerts: finalAlerts,
        matched_rules: matchedRules,
        matched_rule_ids: matchedRuleIds,
        expected_amount: r.expected_amount,
        calculation_explanation: r.calculation_explanation,
        gross_amount_at_time: it ? it.gross_amount : null,
        model: aiJ ? "engine+gemini-2.5-pro" : "engine",
        triggered_by: triggeredBy,
      });

      if (prev) {
        const diffParts: string[] = [];
        if (prev.ai_status !== r.status) diffParts.push(`status: ${prev.ai_status} → ${r.status}`);
        if ((prev.expected_amount ?? null) !== (r.expected_amount ?? null)) {
          diffParts.push(`valor esperado: ${prev.expected_amount ?? "—"} → ${r.expected_amount ?? "—"}`);
        }
        const prevA = new Set(prev.alerts ?? []);
        const newA = new Set(finalAlerts);
        const added = [...newA].filter((a) => !prevA.has(a));
        const removed = [...prevA].filter((a) => !newA.has(a));
        if (added.length) diffParts.push(`+ ${added.length} alerta(s): ${added.slice(0, 2).join("; ")}${added.length > 2 ? "…" : ""}`);
        if (removed.length) diffParts.push(`- ${removed.length} alerta(s) resolvido(s)`);
        const prevR = new Set(prev.matched_rules ?? []);
        const newR = new Set(matchedRules);
        const addedR = [...newR].filter((x) => !prevR.has(x));
        if (addedR.length) diffParts.push(`nova regra: ${addedR.join("; ")}`);
        if (diffParts.length) {
          itemDiffSummaries.push({ item_id: r.item_id, doctor: it?.doctor_name ?? "item", diff: diffParts.join(" · ") });
          obsRows.push({
            payment_id,
            item_id: r.item_id,
            author_type: "ia",
            message: `Reanálise v${nextVersion}: ${diffParts.join(" · ")}`,
          });
        }
      } else {
        const parts: string[] = [`Análise inicial v1 — ${r.status} (${r.matched_priority})`];
        if (r.expected_amount != null) parts.push(`esperado R$ ${r.expected_amount.toFixed(2)}`);
        if (finalAlerts.length) parts.push(`${finalAlerts.length} alerta(s)`);
        obsRows.push({
          payment_id,
          item_id: r.item_id,
          author_type: "ia",
          message: parts.join(" · ") + ` — ${r.calculation_explanation}` + (aiJ?.ai_note ? ` | IA: ${aiJ.ai_note}` : ""),
        });
      }
    }

    // Helper: executa promessas em chunks paralelos (limita conexões simultâneas).
    const runChunked = async <T,>(arr: T[], size: number, fn: (x: T) => Promise<unknown>) => {
      for (let i = 0; i < arr.length; i += size) {
        await Promise.all(arr.slice(i, i + size).map(fn));
      }
    };

    // Updates por id em paralelo (chunks de 50). Não dá para fazer um único
    // UPDATE porque cada item tem um ai_findings diferente.
    console.time(`${__t} writes_payment_items`);
    await runChunked(itemUpdates, 50, async (u) => {
      await supabase.from("payment_items").update({
        ai_status: u.ai_status,
        ai_findings: u.ai_findings,
        attendance_group_key: u.attendance_group_key,
        specialty: u.specialty,
        sector: u.sector,
        // Sub-Onda 2A — colunas SQL nativas (espelham ai_findings)
        applied_rule_id: u.applied_rule_id,
        applied_rule_label: u.applied_rule_label,
        applied_calc_id: u.applied_calc_id,
        applied_calc_method: u.applied_calc_method,
        expected_amount: u.expected_amount,
        applied_at: u.applied_at,
      }).eq("id", u.id);
    });
    console.timeEnd(`${__t} writes_payment_items`);

    // Inserts em bulk (uma chamada por tabela; chunked por segurança em lotes grandes).
    if (versionRows.length) {
      for (let i = 0; i < versionRows.length; i += 200) {
        await supabase.from("ai_analysis_versions").insert(versionRows.slice(i, i + 200));
      }
    }
    if (obsRows.length) {
      for (let i = 0; i < obsRows.length; i += 200) {
        await supabase.from("payment_observations").insert(obsRows.slice(i, i + 200));
      }
    }

    // ---------- 9. Resumo do pagamento ----------
    // Worker por empresa (company_name setado): consolida determinístico lendo
    // ai_status de TODOS os itens do lote (não só da empresa), evitando que o
    // ai_summary fique stale com dados parciais da última empresa processada.
    // Worker global (sem company_name): mantém narrativa via IA como antes.
    let summary: string;
    if (company_name) {
      const counts = { aprovado: 0, alerta: 0, reprovado: 0, pendente: 0 };
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error: cntErr } = await supabase
          .from("payment_items")
          .select("ai_status")
          .eq("payment_id", payment_id)
          .range(from, from + pageSize - 1);
        if (cntErr) {
          console.error(`${__t} consolidated_count_error`, cntErr);
          break;
        }
        for (const r of (page ?? [])) {
          const s = (r as any).ai_status as string;
          if (s in counts) (counts as any)[s] += 1;
        }
        if (!page || page.length < pageSize) break;
      }
      const total = counts.aprovado + counts.alerta + counts.reprovado + counts.pendente;
      summary = `Lote com ${total} item(ns): ${counts.aprovado} aprovado(s), ${counts.alerta} alerta(s), ${counts.reprovado} reprovado(s).`;
    } else {
      summary = (aiJustifications as any).__summary
        || `Motor analisou ${results.length} item(ns): ${results.length - alerts - blocks} aprovado(s), ${alerts} alerta(s), ${blocks} reprovado(s).`;
    }

    // IMPORTANTE: NÃO escrevemos `payments.status` aqui. O status do pagamento
    // é derivado dos statuses dos `payment_company_groups` pelo trigger
    // `recompute_payment_status_from_groups`. Tentar setar manualmente cria
    // condição de corrida: se a reanálise rodar logo depois do analista enviar
    // para validação, podemos sobrescrever `aguardando_validacao` com
    // `revisao_analista` e o lote "some" da fila do validador.
    // A reanálise apenas atualiza ai_summary/specialties; mudanças em grupos
    // (ver bloco 10) disparam o trigger que recalcula o status quando devido.
    const ANALYST_OWNED_FOR_REWRITE = new Set([
      "rascunho",
      "em_analise_ia",
      "revisao_analista",
      "devolvido_analista",
    ]);
    const { data: curPay } = await supabase
      .from("payments")
      .select("status")
      .eq("id", payment_id)
      .maybeSingle();
    const curStatus = (curPay?.status ?? "") as string;
    const paymentUpdate: Record<string, unknown> = { ai_summary: summary };
    // Persiste especialidade dominante do lote (>51%) para rastreabilidade.
    if (dominantSpecialty) paymentUpdate.specialties = [dominantSpecialty];
    await supabase.from("payments").update(paymentUpdate).eq("id", payment_id);

    const consolidatedDiff = itemDiffSummaries.length
      ? `\nMudanças nesta rodada (${itemDiffSummaries.length} item(ns)):\n` +
        itemDiffSummaries.slice(0, 8).map((d) => `• ${d.doctor}: ${d.diff}`).join("\n") +
        (itemDiffSummaries.length > 8 ? `\n…e mais ${itemDiffSummaries.length - 8} item(ns).` : "")
      : "";

    // Só registra como transição em_analise_ia → revisao_analista quando o
    // pagamento estava efetivamente com o analista. Caso contrário, registra
    // como reanálise informativa, sem mexer nos status_from/status_to (para
    // não poluir o histórico nem fazer parecer que o lote voltou ao analista).
    const obsTransition = ANALYST_OWNED_FOR_REWRITE.has(curStatus);
    await supabase.from("payment_observations").insert({
      payment_id,
      author_type: "ia",
      message: `${summary} (${alerts} alertas, ${blocks} reprovações)${consolidatedDiff}`,
      status_from: obsTransition ? "em_analise_ia" : null,
      status_to: obsTransition ? "revisao_analista" : null,
    });

    // Auditoria por lote: confirma explicitamente que `specialty` foi ignorada
    // na seleção de regras de TODOS os itens deste lote. Fica no histórico
    // (payment_observations) e pode ser auditado depois.
    const itemsWithSpecialty = (itemsRaw ?? []).filter((x: any) => {
      const v = x?.__resolved_specialty?.value ?? x?.specialty;
      return v != null && String(v).trim() !== "";
    }).length;
    await supabase.from("payment_observations").insert({
      payment_id,
      author_type: "sistema",
      message:
        `Auditoria do motor: especialidade médica IGNORADA na seleção de regras ` +
        `(regra de projeto). ${results.length} item(ns) avaliado(s); ` +
        `${itemsWithSpecialty} com especialidade resolvida (apenas para relatório/filtro). ` +
        `Eixos efetivamente usados: setor, código TUSS, médico, empresa, grupo, convênio, via de acesso, função, data. ` +
        `Detalhe por item em ai_findings.decision_fields.`,
    });

    // ---------- 10. Grupos por empresa (Consolidação via normName) ----------
    // Carrega todos os grupos atuais do lote para decidir entre UPDATE, INSERT ou DELETE (limpeza).
    console.time(`${__t} upsert_company_groups`);
    const { data: existingGroups } = await supabase
      .from("payment_company_groups")
      .select("id,company_name,status")
      .eq("payment_id", payment_id);

    const groupsMap = new Map<string, { company_id: string | null; company_name: string; items: ItemInput[] }>();
    for (const it of items) {
      const name = (it.company_name ?? "Sem empresa").trim() || "Sem empresa";
      const key = normName(name);
      const cur = groupsMap.get(key);
      if (cur) {
        cur.items.push(it);
        // Prioriza o nome que tem acentos/case original se houver diferença
        if (name !== cur.company_name && name.length > cur.company_name.length) {
           cur.company_name = name;
        }
      }
      else groupsMap.set(key, { company_id: it.company_id, company_name: name, items: [it] });
    }

    const processedGroupIds = new Set<string>();

    for (const [key, g] of groupsMap.entries()) {
      const total = g.items.reduce((s, x) => s + Number(x.gross_amount), 0);
      
      // Busca grupo existente que bata com o nome normalizado
      const existing = (existingGroups ?? []).find(eg => normName(eg.company_name) === key);

      if (existing) {
        processedGroupIds.add(existing.id);
        const groupUpd: Record<string, unknown> = {
          items_count: g.items.length,
          total_amount: total,
          company_id: g.company_id,
          // Atualiza o nome para o "mais completo/correto" encontrado nos itens
          company_name: g.company_name,
        };
        if (ANALYST_OWNED_FOR_REWRITE.has((existing as any).status as string)) {
          groupUpd.status = "revisao_analista";
        }
        await supabase.from("payment_company_groups").update(groupUpd).eq("id", existing.id);
      } else {
        const { data: newG } = await supabase.from("payment_company_groups").insert({
          payment_id,
          company_id: g.company_id,
          company_name: g.company_name,
          status: "revisao_analista",
          items_count: g.items.length,
          total_amount: total,
        }).select("id").single();
        if (newG) processedGroupIds.add(newG.id);
      }
    }

    // Limpeza: só é segura em análise global. Em análise por empresa, cada worker
    // enxerga apenas seus próprios itens; apagar os "não processados" removeria
    // grupos de empresas que já finalizaram e faria a tela mostrar só 1 empresa.
    if (!company_name) {
      const groupsToRemove = (existingGroups ?? []).filter(eg => !processedGroupIds.has(eg.id));
      if (groupsToRemove.length > 0) {
        const idsToRemove = groupsToRemove.map(eg => eg.id);
        console.log(`Limpando ${idsToRemove.length} grupos órfãos do lote ${payment_id}`);
        await supabase.from("payment_company_groups").delete().in("id", idsToRemove);
      }
    }
    console.timeEnd(`${__t} upsert_company_groups`);

    // Notifica o analista que a IA concluiu (Evento 2)
    if (obsTransition) {
      console.log(`Triggering notify-analyst-event (ia_concluded) for payment ${payment_id}`);
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-analyst-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ paymentId: payment_id, eventType: "ia_concluded" }),
      }).catch(e => console.error("Failed to notify analyst (ia_concluded):", e));
    }

    // ---------- 11. Atualiza Diagnósticos no Banco ----------
    diagnostics.execution_time_ms = Date.now() - startTime;
    diagnostics.status = "success";
    diagnostics.total_items = results.length;
    diagnostics.ai_processed_items = itemsToReview.length;

    console.time(`${__t} update_payments_diagnostics`);
    await supabase.from("payments").update({
      processing_diagnostics: diagnostics,
      processing_timeout_occurred: false
    }).eq("id", payment_id);
    console.timeEnd(`${__t} update_payments_diagnostics`);

    // Reporta progresso ao job de dispatch (se houver)
    if (_job_id) {
      try {
        console.time(`${__t} increment_progress`);
        const { data: jobStatus, error: jobErr } = await supabase.rpc("increment_processing_progress", {
          _job_id,
          _company_name: _company_label ?? company_name ?? "Sem empresa",
          _error: null,
        });
        console.timeEnd(`${__t} increment_progress`);

        if (!jobErr && jobStatus && (jobStatus.status === "concluido" || jobStatus.status === "parcial")) {
          const successCount = jobStatus.processed_companies - (jobStatus.failed_companies?.length ?? 0);
          const failCount = jobStatus.failed_companies?.length ?? 0;
          const reason = `${successCount} sucesso(s), ${failCount} falha(s).`;
          
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-analyst-event`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ 
              paymentId: payment_id, 
              eventType: "ia_concluded",
              reason
            }),
          }).catch(e => console.error("Failed to notify analyst (job_finished):", e));
        }
      } catch (e) {
        console.error("Falha ao reportar progresso", e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        alerts,
        blocks,
        total: results.length,
        ai_used: itemsToReview.length > 0,
        diagnostics
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("analyze-payment error", msg);

    // Registra erro de timeout ou outro
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    // Tenta extrair ID do pagamento do corpo se possível (estratégia de fallback)
    try {
      const body = await req.clone().json();
      if (body.payment_id) {
        await supabase.from("payments").update({
          processing_timeout_occurred: true,
          processing_diagnostics: {
            ...diagnostics,
            status: "error",
            error: msg,
            execution_time_ms: Date.now() - startTime
          }
        }).eq("id", body.payment_id);
      }
      // Reporta falha ao job de dispatch (se houver)
      if (body._job_id) {
        await supabase.rpc("increment_processing_progress", {
          _job_id: body._job_id,
          _company_name: body._company_label ?? body.company_name ?? "Sem empresa",
          _error: msg.slice(0, 300),
        });
      }
    } catch (_) {}

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
