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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      .select("id, competence_month, hospital_id, status")
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

    const results: any[] = [];

    for (const rule of activeRules) {
      const piso = Number(rule.minimo_garantido_valor ?? 0);
      if (!(piso > 0)) continue;

      // Determina (doctor, company) elegíveis pela regra
      const eligiblePairs: Array<{ doctor_id: string; company_id: string }> = [];

      // scope=grupo → usa group_company_links[].doctors[].id + company_id
      if (rule.scope === "grupo" && Array.isArray(rule.group_company_links)) {
        for (const link of rule.group_company_links) {
          if (!link?.company_id) continue;
          const doctors = Array.isArray(link.doctors) ? link.doctors : [];
          for (const d of doctors) {
            if (d?.id) {
              eligiblePairs.push({ doctor_id: d.id, company_id: link.company_id });
            }
          }
        }
      }

      // scope=especifica + target_type=medico → pega todas as PJs vinculadas via doctor_companies
      if (rule.scope === "especifica" && rule.target_type === "medico" && rule.target_identifier) {
        // target_identifier = doctor_id ou CRM; tenta resolver por id direto
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
            if (l.company_id) eligiblePairs.push({ doctor_id: docId, company_id: l.company_id });
          }
        }
      }

      // Cruza com pares presentes no payment (só processa quem aparece nesta folha)
      const toProcess = eligiblePairs.filter(p =>
        presentPairs.has(`${p.doctor_id}|${p.company_id}`)
      );

      for (const pair of toProcess) {
        // a) Soma produção da competência inteira (todos payments do mesmo mês,
        //    mesmo médico + PJ, só itens de produção real)
        const { data: prodRows } = await supabase
          .from("payment_items")
          .select("gross_amount, payments!inner(competence_month, hospital_id)")
          .eq("doctor_id", pair.doctor_id)
          .eq("company_id", pair.company_id)
          .eq("item_origin", "producao")
          .eq("payments.competence_month", competence);

        const producao = round2(
          (prodRows ?? []).reduce((s, r: any) => s + Number(r.gross_amount ?? 0), 0)
        );

        const complemento = round2(Math.max(0, piso - producao));

        // b) Aplicação existente?
        const { data: existing } = await supabase
          .from("minimum_guarantee_applications")
          .select("id, payment_id, synthetic_item_id, complemento_valor, status")
          .eq("rule_id", rule.id)
          .eq("doctor_id", pair.doctor_id)
          .eq("company_id", pair.company_id)
          .eq("competence_month", competence)
          .eq("status", "aplicado")
          .maybeSingle();

        if (complemento <= 0) {
          // Produção atingiu piso → reverte se havia aplicação
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
            rule_id: rule.id, rule_name: rule.name,
            doctor_id: pair.doctor_id, company_id: pair.company_id,
            piso, producao, complemento: 0, action: existing ? "revertido" : "skip",
          });
          continue;
        }

        // c) Aplica/atualiza
        if (existing && Math.abs(Number(existing.complemento_valor ?? 0) - complemento) < 0.01) {
          // Mesmo valor — nada a fazer
          results.push({
            rule_id: rule.id, rule_name: rule.name,
            doctor_id: pair.doctor_id, company_id: pair.company_id,
            piso, producao, complemento, action: "idempotent",
          });
          continue;
        }

        if (existing) {
          // Atualiza item sintético existente
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
            rule_id: rule.id, rule_name: rule.name,
            doctor_id: pair.doctor_id, company_id: pair.company_id,
            piso, producao, complemento, action: "updated",
          });
          continue;
        }

        // Cria item sintético novo
        const { data: newItem, error: itemErr } = await supabase
          .from("payment_items")
          .insert({
            payment_id,
            doctor_id: pair.doctor_id,
            company_id: pair.company_id,
            gross_amount: complemento,
            expected_amount: complemento,
            procedure_amount: 0,
            procedure_name: `Complemento Mínimo Garantido — ${rule.name}`,
            description: `Piso de R$ ${piso.toFixed(2)}; produção da competência ${competence}: R$ ${producao.toFixed(2)}`,
            item_origin: "complemento_minimo",
            applied_rule_id: rule.id,
          } as any)
          .select("id").single();

        if (itemErr) {
          console.error("[apply-minimum-guarantee] falha ao criar item sintético", itemErr);
          results.push({
            rule_id: rule.id, doctor_id: pair.doctor_id, company_id: pair.company_id,
            piso, producao, complemento, action: "error", error: itemErr.message,
          });
          continue;
        }

        await supabase.from("minimum_guarantee_applications").insert({
          rule_id: rule.id,
          doctor_id: pair.doctor_id,
          company_id: pair.company_id,
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
          rule_id: rule.id, rule_name: rule.name,
          doctor_id: pair.doctor_id, company_id: pair.company_id,
          piso, producao, complemento, action: "created",
        });
      }
    }

    // Dispara recálculo financeiro para refletir os novos itens sintéticos
    if (results.some(r => r.action === "created" || r.action === "updated" || r.action === "revertido")) {
      try {
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
