// Edge function: engine-suggest-link
// Recebe um par (origem -> candidato) para uma entidade (doctor/company/convenio/sector),
// calcula similaridade fuzzy e grava uma sugestão pendente para aprovação humana.
// Nunca decide sozinho: só registra um "pending" para a fila existente.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { entityNameSimilarity, classifySimilarity } from "../_shared/fuzzy.ts";

type EntityType = "doctor" | "company" | "convenio" | "sector";

interface Payload {
  entity_type: EntityType;
  detected_value: string;          // valor cru vindo da planilha/payment
  candidate_value: string;         // nome do candidato cadastrado mais próximo
  // identificadores opcionais — usados pra preencher FK na sugestão
  doctor_id?: string;
  company_id?: string;             // entity owner para doctor/company
  matched_company_id?: string;
  matched_convenio_slug?: string;
  matched_sector_slug?: string;
  convenio_slug?: string;
  sector_slug?: string;
  source_field?: string;           // ex: "payment_items.company_name"
  raw_snippet?: string;
  payment_item_id?: string;
  rule_id?: string;
  context_jsonb?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ error: "missing service role" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(url, key);

    // feature flag
    const { data: flag } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "engine_fuzzy_suggestions_enabled")
      .maybeSingle();
    if (flag && flag.enabled === false) {
      return new Response(JSON.stringify({ skipped: true, reason: "feature_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Payload;
    if (!body?.entity_type || !body?.detected_value || !body?.candidate_value) {
      return new Response(JSON.stringify({ error: "entity_type, detected_value, candidate_value são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const score = entityNameSimilarity(body.detected_value, body.candidate_value);
    const cls = classifySimilarity(score);

    // só registramos sugestão para "high" (>=0.92) ou "low" (>=0.80).
    if (cls === "none" || cls === "exact") {
      return new Response(JSON.stringify({ skipped: true, score, class: cls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confidence = cls === "high" ? "high" : "low";
    const base = {
      source: "engine_fuzzy" as const,
      score,
      confidence,
      detected_value: body.detected_value,
      detected_value_normalized: body.detected_value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      raw_snippet: body.raw_snippet ?? null,
      source_field: body.source_field ?? null,
      context_jsonb: body.context_jsonb ?? null,
      status: "pending" as const,
    };

    let table: string;
    let row: Record<string, unknown>;
    let dedupeFilter: Record<string, unknown>;

    switch (body.entity_type) {
      case "company":
        table = "company_link_suggestions";
        row = { ...base, company_id: body.company_id ?? null, matched_company_id: body.matched_company_id ?? null };
        dedupeFilter = {
          detected_value_normalized: base.detected_value_normalized,
          matched_company_id: body.matched_company_id ?? null,
          status: "pending",
        };
        break;
      case "convenio":
        table = "convenio_link_suggestions";
        row = { ...base, convenio_slug: body.convenio_slug ?? null, matched_convenio_slug: body.matched_convenio_slug ?? null };
        dedupeFilter = {
          detected_value_normalized: base.detected_value_normalized,
          matched_convenio_slug: body.matched_convenio_slug ?? null,
          status: "pending",
        };
        break;
      case "sector":
        table = "sector_link_suggestions";
        row = { ...base, sector_slug: body.sector_slug ?? null, matched_sector_slug: body.matched_sector_slug ?? null };
        dedupeFilter = {
          detected_value_normalized: base.detected_value_normalized,
          matched_sector_slug: body.matched_sector_slug ?? null,
          status: "pending",
        };
        break;
      case "doctor":
        table = "doctor_link_suggestions";
        row = {
          ...base,
          doctor_id: body.doctor_id ?? null,
          matched_company_id: body.matched_company_id ?? null,
          detected_kind: "fuzzy_name",
        };
        dedupeFilter = {
          detected_value_normalized: base.detected_value_normalized,
          doctor_id: body.doctor_id ?? null,
          status: "pending",
        };
        break;
      default:
        return new Response(JSON.stringify({ error: "entity_type inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // dedupe: se já existe sugestão pendente igual, só atualiza score
    let q = supabase.from(table).select("id, score").limit(1);
    for (const [k, v] of Object.entries(dedupeFilter)) {
      q = v === null ? q.is(k as never, null) : q.eq(k as never, v as never);
    }
    const { data: dup } = await q.maybeSingle();

    if (dup?.id) {
      await supabase.from(table).update({ score, confidence }).eq("id", dup.id);
      // telemetry
      await supabase.from("match_telemetry").insert({
        entity_type: body.entity_type,
        suggestion_id: dup.id,
        payment_item_id: body.payment_item_id ?? null,
        rule_id: body.rule_id ?? null,
        candidate_a: body.detected_value,
        candidate_b: body.candidate_value,
        fuzzy_score: score,
      });
      return new Response(JSON.stringify({ suggestion_id: dup.id, score, class: cls, deduped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error } = await supabase.from(table).insert(row).select("id").single();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await supabase.from("match_telemetry").insert({
      entity_type: body.entity_type,
      suggestion_id: inserted.id,
      payment_item_id: body.payment_item_id ?? null,
      rule_id: body.rule_id ?? null,
      candidate_a: body.detected_value,
      candidate_b: body.candidate_value,
      fuzzy_score: score,
    });

    return new Response(JSON.stringify({ suggestion_id: inserted.id, score, class: cls, created: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
