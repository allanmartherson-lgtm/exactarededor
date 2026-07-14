// apply-minimum-guarantee
// Pass 3 do motor: aplica piso de produção (mínimo garantido) por
// (médico + PJ + competência) após o cálculo normal.
//
// Algoritmo:
//  1. Carrega payment + competence_month
//  2. Lista regras ativas com minimo_garantido_ativo=true e identifica
//     (doctor_id, company_id) elegíveis a partir dos payment_items deste payment
//  3. Para cada (regra, médico, PJ):
//     a) Soma gross_amount de TODOS os payment_items na mesma competência
//        com item_origin='producao' (não conta complementos anteriores)
//     b) Compara com piso → calcula complemento
//     c) Idempotência via minimum_guarantee_applications (UNIQUE parcial)
//     d) Cria/atualiza/reverte payment_item sintético de complemento
//
// Idempotente: rodar 2x dá o mesmo estado final.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {

    const body = await req.json().catch(() => ({}));
    const payment_id: string | undefined = body?.payment_id;
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth opcional (audit)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id ?? null;
      } catch { /* ignore */ }
    }

    // 1) Payment + competência
    const { data: payment, error: payErr } = await supabase
      .from("payments")
      .select("id, competence_month, hospital_id, status, pool_id")
      .eq("id", payment_id).single();
    if (payErr || !payment) {
      return new Response(JSON.stringify({ error: "payment não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const competence: string | null = payment.competence_month ?? null;
    if (!competence) {
      return new Response(JSON.stringify({
        ok: true, skipped: true, reason: "payment sem competence_month",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Regras ativas com piso
    const { data: rules, error: rulesErr } = await supabase
      .from("rules")
      .select("id, name, minimo_garantido_ativo, minimo_garantido_valor, " +
              "minimo_garantido_escopo, minimo_garantido_periodicidade, " +
              "minimo_garantido_base, valid_from, valid_until, " +
              "scope, target_type, target_identifier, target_name, " +
              "group_company_links, group_doctors, active")
      .eq("active", true)
      .eq("minimo_garantido_ativo", true);
    if (rulesErr) throw rulesErr;
    const ruleList = rules ?? [];

    if (ruleList.length === 0) {
      return new Response(JSON.stringify({ ok: true, rules_evaluated: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filtra regras por vigência (competence "YYYY-MM" → 1º dia do mês)
    const compDate = `${competence}-01`;
    const activeRules = ruleList.filter((r: any) => {
      if (r.valid_from && r.valid_from > compDate) return false;
      if (r.valid_until && r.valid_until < compDate) return false;
      return true;
    });

    // 3) Items deste payment → conjunto de (doctor_id, company_id) candidatos
    const { data: itemsInPayment } = await supabase
      .from("payment_items")
      .select("doctor_id, company_id")
      .eq("payment_id", payment_id)
      .eq("item_origin", "producao")
      .not("doctor_id", "is", null)
      .not("company_id", "is", null);

    const presentPairs = new Set<string>();
    for (const it of (itemsInPayment ?? [])) {
      if (it.doctor_id && it.company_id) {
        presentPairs.add(`${it.doctor_id}|${it.company_id}`);
      }
    }

    const presentCompanies = new Set<string>();
    for (const it of (itemsInPayment ?? [])) {
      if (it.company_id) presentCompanies.add(it.company_id);
    }

    // Pool soberano: itens de produção podem ser coletivos (company_id=NULL).
    // Nesse caso, as PJs presentes são as participantes do pool e a produção
    // bruta por PJ é a fatia percentual do gross total do pool na competência.
    const poolParticipantPct = new Map<string, number>();
    let poolGarantePiso = false;
    if ((payment as any).pool_id) {
      const { data: poolRow } = await supabase
        .from("pools")
        .select("garante_piso")
        .eq("id", (payment as any).pool_id)
        .maybeSingle();
      poolGarantePiso = !!(poolRow as any)?.garante_piso;

      const { data: parts } = await supabase
        .from("pool_participants")
        .select("company_id, percentual, participant_type")
        .eq("pool_id", (payment as any).pool_id);
      for (const p of (parts ?? []) as any[]) {
        if (!p.company_id || p.participant_type === "hospital_nao_paga") continue;
        // Só adiciona à lista de candidatos via pool se o pool NÃO garante piso.
        // Quando garante, o complemento é aplicado dentro do rateio pelo recalc-payment-pools.
        if (!poolGarantePiso) {
          presentCompanies.add(p.company_id);
          poolParticipantPct.set(p.company_id, Number(p.percentual ?? 0));
        }
      }
    }

    // Empresas cobertas pelo piso interno do pool (não devem receber regra externa)
    const skipCompaniesPoolPiso = new Set<string>();
    if (poolGarantePiso && (payment as any).pool_id) {
      const { data: pp } = await supabase
        .from("pool_participants")
        .select("company_id, participant_type")
        .eq("pool_id", (payment as any).pool_id);
      for (const p of (pp ?? []) as any[]) {
        if (p.company_id && p.participant_type !== "hospital_nao_paga") {
          skipCompaniesPoolPiso.add(p.company_id);
        }
      }
    }

    // Cache dos payment IDs da competência — evita join PostgREST `payments!inner`
    // que vira subquery aninhada e estoura statement_timeout (503) sob carga.
    let competencePayIdsCache: string[] | null = null;
    const getCompetencePayIds = async (): Promise<string[]> => {
      if (competencePayIdsCache) return competencePayIdsCache;
      const { data: pays } = await supabase
        .from("payments")
        .select("id")
        .eq("competence_month", competence);
      competencePayIdsCache = (pays ?? []).map((p: any) => p.id);
      return competencePayIdsCache;
    };

    const results: any[] = [];

    for (const rule of activeRules) {
      const piso = Number(rule.minimo_garantido_valor ?? 0);
      if (!(piso > 0)) continue;

      // Escopo: 'empresa' (soma todos os médicos da PJ) ou 'medico_empresa' (por par)
      const escopo: "empresa" | "medico_empresa" =
        rule.minimo_garantido_escopo === "empresa" ? "empresa" : "medico_empresa";

      // Empresas elegíveis pela regra
      const eligibleCompanies = new Set<string>();
      // Pares (doctor, company) elegíveis — só usado em escopo medico_empresa
      const eligiblePairs: Array<{ doctor_id: string; company_id: string }> = [];

      if (rule.scope === "grupo" && Array.isArray(rule.group_company_links)) {
        for (const link of rule.group_company_links) {
          if (!link?.company_id) continue;
          eligibleCompanies.add(link.company_id);
          const doctors = Array.isArray(link.doctors) ? link.doctors : [];
          for (const d of doctors) {
            if (d?.id) eligiblePairs.push({ doctor_id: d.id, company_id: link.company_id });
          }
        }
      }

      if (rule.scope === "especifica" && rule.target_type === "empresa" && rule.target_identifier) {
        eligibleCompanies.add(rule.target_identifier);
      }

      if (rule.scope === "especifica" && rule.target_type === "medico" && rule.target_identifier) {
        const { data: docs } = await supabase
          .from("doctors")
          .select("id")
          .or(`id.eq.${rule.target_identifier},crm.eq.${rule.target_identifier}`)
          .limit(1);
        const docId = docs?.[0]?.id;
        if (docId) {
          const { data: links } = await supabase
            .from("doctor_companies")
            .select("company_id")
            .eq("doctor_id", docId);
          for (const l of (links ?? [])) {
            if (l.company_id) {
              eligibleCompanies.add(l.company_id);
              eligiblePairs.push({ doctor_id: docId, company_id: l.company_id });
            }
          }
        }
      }

      // Unidade de processamento conforme escopo
      type Unit = { doctor_id: string | null; company_id: string };
      let toProcess: Unit[] = [];
      if (escopo === "empresa") {
        toProcess = Array.from(eligibleCompanies)
          .filter((cid) => presentCompanies.has(cid))
          .filter((cid) => !skipCompaniesPoolPiso.has(cid))
          .map((cid) => ({ doctor_id: null, company_id: cid }));
      } else {
        toProcess = eligiblePairs
          .filter((p) => presentPairs.has(`${p.doctor_id}|${p.company_id}`))
          .filter((p) => !skipCompaniesPoolPiso.has(p.company_id))
          .map((p) => ({ doctor_id: p.doctor_id, company_id: p.company_id }));
      }

      // Reverte aplicações existentes para PJs agora cobertas pelo piso interno do pool
      if (skipCompaniesPoolPiso.size > 0) {
        const { data: stale } = await supabase
          .from("minimum_guarantee_applications")
          .select("id, synthetic_item_id")
          .eq("rule_id", rule.id)
          .eq("competence_month", competence)
          .eq("status", "aplicado")
          .in("company_id", Array.from(skipCompaniesPoolPiso));
        for (const s of (stale ?? []) as any[]) {
          if (s.synthetic_item_id) {
            await supabase.from("payment_items").delete().eq("id", s.synthetic_item_id);
          }
          await supabase.from("minimum_guarantee_applications").update({
            status: "revertido",
            reverted_at: new Date().toISOString(),
            reverted_by: userId,
            notes: "Substituído pelo piso interno do pool (garante_piso=true)",
          }).eq("id", s.id);
        }
      }

      const baseLiquido = (rule.minimo_garantido_base ?? "bruto") === "liquido";

      for (const unit of toProcess) {
        // a) Soma produção da competência inteira para a unidade
        let producao = 0;

        if (baseLiquido && !unit.doctor_id) {
          // Base LÍQUIDO por PJ: soma payment_company_financials.liquido em todos
          // os payments da competência para esta PJ, descontando o complemento
          // mínimo já aplicado (para evitar circularidade entre rodadas).
          const { data: pays } = await supabase
            .from("payments")
            .select("id")
            .eq("competence_month", competence);
          const payIds = (pays ?? []).map((p: any) => p.id);
          let liquidoTotal = 0;
          if (payIds.length > 0) {
            const { data: pcfRows } = await supabase
              .from("payment_company_financials")
              .select("liquido, payment_id")
              .eq("company_id", unit.company_id)
              .in("payment_id", payIds);
            liquidoTotal = (pcfRows ?? []).reduce((s, r: any) => s + Number(r.liquido ?? 0), 0);

            const { data: compRows } = await supabase
              .from("payment_items")
              .select("gross_amount")
              .eq("company_id", unit.company_id)
              .eq("item_origin", "complemento_minimo")
              .in("payment_id", payIds);
            const complementoJa = (compRows ?? []).reduce((s, r: any) => s + Number(r.gross_amount ?? 0), 0);
            liquidoTotal -= complementoJa;
          }
          producao = round2(liquidoTotal);
        } else if (!unit.doctor_id && (payment as any).pool_id && poolParticipantPct.has(unit.company_id)) {
          // Pool: soma gross de itens de produção pool na competência.
          // Pré-busca IDs de payments do pool+competência e usa .in() para evitar
          // join PostgREST (que vira subquery aninhada e estoura statement_timeout).
          const { data: poolPays } = await supabase
            .from("payments")
            .select("id")
            .eq("competence_month", competence)
            .eq("pool_id", (payment as any).pool_id);
          const poolPayIds = (poolPays ?? []).map((p: any) => p.id);
          let totalPool = 0;
          if (poolPayIds.length > 0) {
            const { data: poolRows } = await supabase
              .from("payment_items")
              .select("gross_amount")
              .eq("item_origin", "producao")
              .eq("is_pool_item", true)
              .in("payment_id", poolPayIds);
            totalPool = (poolRows ?? []).reduce((s, r: any) => s + Number(r.gross_amount ?? 0), 0);
          }
          producao = round2(totalPool * (poolParticipantPct.get(unit.company_id)! / 100));
        } else {
          // Produção normal por (PJ [+ médico]) na competência inteira.
          // Pré-busca payIds da competência (cacheado) e usa .in() para evitar
          // join PostgREST payments!inner (subquery aninhada → statement_timeout → 503).
          const payIds = await getCompetencePayIds();
          if (payIds.length > 0) {
            let query = supabase
              .from("payment_items")
              .select("gross_amount")
              .eq("company_id", unit.company_id)
              .eq("item_origin", "producao")
              .in("payment_id", payIds);
            if (unit.doctor_id) query = query.eq("doctor_id", unit.doctor_id);
            const { data: prodRows } = await query;

            producao = round2(
              (prodRows ?? []).reduce((s, r: any) => s + Number(r.gross_amount ?? 0), 0)
            );
          } else {
            producao = 0;
          }
        }

        const complemento = round2(Math.max(0, piso - producao));

        // b) Aplicação existente?
        let existingQuery = supabase
          .from("minimum_guarantee_applications")
          .select("id, payment_id, synthetic_item_id, complemento_valor, status")
          .eq("rule_id", rule.id)
          .eq("company_id", unit.company_id)
          .eq("competence_month", competence)
          .eq("status", "aplicado");
        if (unit.doctor_id) existingQuery = existingQuery.eq("doctor_id", unit.doctor_id);
        else existingQuery = existingQuery.is("doctor_id", null);
        const { data: existing } = await existingQuery.maybeSingle();

        if (complemento <= 0) {
          if (existing) {
            if (existing.synthetic_item_id) {
              await supabase.from("payment_items").delete().eq("id", existing.synthetic_item_id);
            }
            await supabase
              .from("minimum_guarantee_applications")
              .update({
                status: "revertido",
                reverted_at: new Date().toISOString(),
                reverted_by: userId,
                notes: "Produção da competência atingiu o piso",
              })
              .eq("id", existing.id);
          }
          results.push({
            rule_id: rule.id, rule_name: rule.name, escopo,
            doctor_id: unit.doctor_id, company_id: unit.company_id,
            piso, producao, complemento: 0, action: existing ? "revertido" : "skip",
          });
          continue;
        }

        if (existing && Math.abs(Number(existing.complemento_valor ?? 0) - complemento) < 0.01) {
          results.push({
            rule_id: rule.id, rule_name: rule.name, escopo,
            doctor_id: unit.doctor_id, company_id: unit.company_id,
            piso, producao, complemento, action: "idempotent",
          });
          continue;
        }

        if (existing) {
          if (existing.synthetic_item_id) {
            await supabase.from("payment_items").update({
              gross_amount: complemento,
              expected_amount: complemento,
            }).eq("id", existing.synthetic_item_id);
          }
          await supabase.from("minimum_guarantee_applications").update({
            producao_calculada: producao,
            complemento_valor: complemento,
            payment_id,
            applied_at: new Date().toISOString(),
            applied_by: userId,
          }).eq("id", existing.id);
          results.push({
            rule_id: rule.id, rule_name: rule.name, escopo,
            doctor_id: unit.doctor_id, company_id: unit.company_id,
            piso, producao, complemento, action: "updated",
          });
          continue;
        }

        const { data: newItem, error: itemErr } = await supabase
          .from("payment_items")
          .insert({
            payment_id,
            doctor_id: unit.doctor_id,
            doctor_name: unit.doctor_id ? undefined : "[Complemento por PJ]",
            company_id: unit.company_id,
            gross_amount: complemento,
            expected_amount: complemento,
            procedure_amount: 0,
            procedure_name: `Complemento Mínimo Garantido — ${rule.name}`,
            description: escopo === "empresa"
              ? `Piso por PJ R$ ${piso.toFixed(2)}; produção líquida da competência ${competence}: R$ ${producao.toFixed(2)}`
              : `Piso de R$ ${piso.toFixed(2)}; produção da competência ${competence}: R$ ${producao.toFixed(2)}`,
            item_origin: "complemento_minimo",
            applied_rule_id: rule.id,
          } as any)
          .select("id").single();

        if (itemErr) {
          console.error("[apply-minimum-guarantee] falha ao criar item sintético", itemErr);
          results.push({
            rule_id: rule.id, escopo,
            doctor_id: unit.doctor_id, company_id: unit.company_id,
            piso, producao, complemento, action: "error", error: itemErr.message,
          });
          continue;
        }

        await supabase.from("minimum_guarantee_applications").insert({
          rule_id: rule.id,
          doctor_id: unit.doctor_id,
          company_id: unit.company_id,
          competence_month: competence,
          hospital_id: payment.hospital_id,
          producao_calculada: producao,
          piso_aplicado: piso,
          complemento_valor: complemento,
          payment_id,
          synthetic_item_id: newItem.id,
          status: "aplicado",
          applied_by: userId,
        } as any);

        results.push({
          rule_id: rule.id, rule_name: rule.name, escopo,
          doctor_id: unit.doctor_id, company_id: unit.company_id,
          piso, producao, complemento, action: "created",
        });
      }
    }

    // Dispara recálculo financeiro para refletir os novos itens sintéticos
    if (results.some(r => r.action === "created" || r.action === "updated" || r.action === "revertido")) {
      try {
        if ((payment as any).pool_id) {
          void supabase.functions.invoke("recalc-payment-pools", {
            body: { payment_id },
          }).catch((e) => console.warn("[apply-minimum-guarantee] recalc-pools falhou:", (e as any)?.message ?? e));
        }
        void supabase.functions.invoke("compute-company-financials", {
          body: { payment_id },
        }).catch((e) => console.warn("[apply-minimum-guarantee] recompute falhou:", (e as any)?.message ?? e));
      } catch (e) {
        console.warn("[apply-minimum-guarantee] erro ao disparar recompute:", e);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      payment_id,
      competence,
      rules_evaluated: activeRules.length,
      applications: results,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[apply-minimum-guarantee] erro", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
