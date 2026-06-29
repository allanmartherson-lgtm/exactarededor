// auto-classify-payment-types
// Phase 2 do Lote Misto: ao receber um payment_id, varre payment_items que
// ainda não têm override manual (`payment_type_source` ∈ {null, 'inherit',
// 'auto_tuss', 'auto_heuristic'}) e tenta inferir o `payment_type_id` real
// quando o item diverge do tipo do lote.
//
// Fontes da inferência, nessa ordem:
//   1. TUSS cadastrado: bate `procedure_code` do item contra
//      `payment_types.tuss_default` + `tuss_codes_extra`. Match → override
//      com source='auto_tuss'.
//   2. Heurística de texto: se o blob (procedure_name + description +
//      doctor_role) contém 'procedimento|cirurgia|exame' E o tipo do lote
//      tem categoria de consulta/parecer/visita, e existe ao menos um
//      payment_type com categoria 'procedimento' (preferindo o que casar
//      o TUSS por prefixo), aplica como source='auto_heuristic'.
//
// Nunca toca itens com source='manual' nem com vínculo de parecer
// (`report_cross*`). Não cria/edita regras. Não dispara reanálise — quem
// chama (dispatch-payment-analysis) já segue para o orquestrador.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const HEURISTIC_PROCEDURE = /\b(procedimento|cirurgia|cirurgico|cirurgica|exame|endoscopia|bi[oó]psia|puncao|drenagem)\b/i;

const PROTECTED_SOURCES = new Set(["manual", "report_cross", "report_cross_dedup"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { payment_id } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: paymentRow, error: payErr } = await supabase
      .from("payments")
      .select("id, payment_type_id, has_mixed_parecer")
      .eq("id", payment_id)
      .single();
    if (payErr) throw payErr;
    const lotePaymentTypeId = (paymentRow as any)?.payment_type_id ?? null;

    const { data: types, error: typesErr } = await supabase
      .from("payment_types")
      .select("id, code, label, category, tuss_default, tuss_codes_extra, active")
      .eq("active", true);
    if (typesErr) throw typesErr;

    // Index TUSS → payment_type_id (primeiro match vence — analista não deve
    // cadastrar o mesmo TUSS em dois tipos; se cadastrar, registramos warning).
    const tussToType = new Map<string, string>();
    const collisions: string[] = [];
    let procedureTypeId: string | null = null;
    let loteCategory: string | null = null;

    for (const t of (types ?? []) as any[]) {
      const codes = new Set<string>();
      if (t.tuss_default) codes.add(String(t.tuss_default).trim());
      for (const c of (t.tuss_codes_extra ?? []) as string[]) {
        if (c) codes.add(String(c).trim());
      }
      for (const c of codes) {
        if (!c) continue;
        if (tussToType.has(c) && tussToType.get(c) !== t.id) {
          collisions.push(`${c}: ${tussToType.get(c)} vs ${t.id}`);
        } else {
          tussToType.set(c, t.id);
        }
      }
      const cat = String(t.category ?? "").toLowerCase();
      if (cat === "procedimento" && !procedureTypeId) procedureTypeId = t.id;
      if (t.id === lotePaymentTypeId) loteCategory = cat;
    }

    if (collisions.length) {
      console.warn(`[auto-classify] TUSS duplicados em payment_types: ${collisions.slice(0, 5).join("; ")}`);
    }

    // Heurística só faz sentido quando o lote é consulta-like (consulta/parecer/visita)
    // e existe um tipo "procedimento" cadastrado para receber os ambíguos.
    const heuristicEnabled =
      !!procedureTypeId &&
      !!loteCategory &&
      /(consulta|parecer|visita)/.test(loteCategory) &&
      procedureTypeId !== lotePaymentTypeId;

    let totalScanned = 0;
    let autoTuss = 0;
    let autoHeuristic = 0;
    let cleared = 0; // voltou para inherit
    const pageSize = 500;

    for (let from = 0; ; from += pageSize) {
      const { data: items, error: itemsErr } = await supabase
        .from("payment_items")
        .select("id, procedure_code, procedure_name, description, doctor_role, payment_type_id, payment_type_source")
        .eq("payment_id", payment_id)
        .range(from, from + pageSize - 1);
      if (itemsErr) throw itemsErr;
      if (!items || items.length === 0) break;
      totalScanned += items.length;

      for (const it of items as any[]) {
        const source = (it.payment_type_source ?? "") as string;
        if (PROTECTED_SOURCES.has(source)) continue;

        const code = String(it.procedure_code ?? "").trim();
        let suggestedId: string | null = null;
        let suggestedSource: "auto_tuss" | "auto_heuristic" | null = null;

        if (code && tussToType.has(code)) {
          suggestedId = tussToType.get(code)!;
          suggestedSource = "auto_tuss";
        } else if (heuristicEnabled) {
          const blob = `${it.procedure_name ?? ""} ${it.description ?? ""} ${it.doctor_role ?? ""}`;
          if (HEURISTIC_PROCEDURE.test(blob) || (code && !/^1010/.test(code))) {
            // Code não vazio que NÃO é família 1010* (consulta TUSS) reforça a heurística.
            if (HEURISTIC_PROCEDURE.test(blob)) {
              suggestedId = procedureTypeId;
              suggestedSource = "auto_heuristic";
            }
          }
        }

        const currentId = it.payment_type_id ?? null;

        if (suggestedId && suggestedId !== lotePaymentTypeId) {
          // Override divergente do lote — patch só se ainda não está nesse estado.
          if (currentId !== suggestedId || source !== suggestedSource) {
            await supabase
              .from("payment_items")
              .update({ payment_type_id: suggestedId, payment_type_source: suggestedSource })
              .eq("id", it.id);
            if (suggestedSource === "auto_tuss") autoTuss++;
            else autoHeuristic++;
          }
        } else if (currentId && (source === "auto_tuss" || source === "auto_heuristic")) {
          // Antes inferimos override e agora a regra/cadastro mudou — limpa para inherit.
          await supabase
            .from("payment_items")
            .update({ payment_type_id: null, payment_type_source: null })
            .eq("id", it.id);
          cleared++;
        }
      }

      if (items.length < pageSize) break;
    }

    console.log(
      `[auto-classify] payment=${payment_id} scanned=${totalScanned} auto_tuss=${autoTuss} auto_heuristic=${autoHeuristic} cleared=${cleared}`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        payment_id,
        scanned: totalScanned,
        auto_tuss: autoTuss,
        auto_heuristic: autoHeuristic,
        cleared,
        lote_payment_type_id: lotePaymentTypeId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[auto-classify-payment-types] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
