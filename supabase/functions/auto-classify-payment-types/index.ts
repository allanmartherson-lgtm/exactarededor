// auto-classify-payment-types
//
// Classifica itens de um lote no modelo novo (jun/2026): atribui
// `payment_items.item_type_id` (tabela `item_types`). A coluna legacy
// `payment_type_id` foi removida na Fase D2.
//
// Regra (decisão do usuário, jun/2026):
//   1. Se o item tem `procedure_code` (TUSS) e ele bate com
//      item_types.tuss_default ou item_types.tuss_codes_extra → usa esse
//      item_type. source = 'auto_tuss'.
//   2. Se o item tem `procedure_code` mas ele NÃO bate com nenhum TUSS
//      cadastrado → usa o tipo dinâmico "Procedimento". source = 'auto_heuristic'.
//   3. Só quando NÃO há TUSS → cai no item_type marcado como
//      `is_default_when_no_tuss` (Consulta). source = 'auto_default'.
//
// Nunca sobrescreve itens com source = 'manual' (override do analista) ou
// vínculos de parecer/cross-reference.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Fontes cuja classificação é intocável pelo auto-classify. Espelha
// `cross-reference-parecer` (que já respeita 'company_override' e 'base_tipo')
// e cobre overrides manuais + cross-reference. 'company_override' e 'base_tipo'
// ainda não são emitidos por esta função — estão aqui como blindagem futura.
const PROTECTED_SOURCES = new Set([
  "manual",
  "report_cross",
  "report_cross_dedup",
  "company_override",
  "base_tipo",
]);


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);
  try {
    const { payment_id } = await req.json();
    if (!payment_id || typeof payment_id !== "string") {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Guard multi-tenant: só chama quem tem vínculo com o hospital do pagamento.
    const { data: __payRow } = await supabase
      .from("payments")
      .select("hospital_id")
      .eq("id", payment_id)
      .maybeSingle();
    const __payHospitalId = (__payRow as any)?.hospital_id ?? null;
    if (!auth.is_internal && !assertCallerHospital(auth, __payHospitalId)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Carrega item_types ativos (com TUSS).
    const { data: itemTypesData, error: itemTypesErr } = await supabase
      .from("item_types")
      .select("id, code, tuss_default, tuss_codes_extra, is_default_when_no_tuss, active")
      .eq("active", true);
    if (itemTypesErr) throw itemTypesErr;

    const itemTypes = (itemTypesData ?? []) as Array<{
      id: string;
      code: string;
      tuss_default: string | null;
      tuss_codes_extra: string[] | null;
      is_default_when_no_tuss: boolean;
    }>;

    // TUSS → Set<item_type_id> — acumula TODOS os tipos ativos que reivindicam
    // o código (via tuss_default ou tuss_codes_extra). Quando o set tem >1
    // entrada, o TUSS é ambíguo (ex.: parecer_adulto e visita compartilham
    // 10102019) e não pode ser classificado automaticamente. A decisão fica
    // para `cross-reference-parecer` ou override manual.
    const tussToItemTypes = new Map<string, Set<string>>();
    let defaultItemTypeId: string | null = null;
    let defaultItemTypeCode: string | null = null;
    // Mapa code → id para tipos dinâmicos usados pela heurística por prefixo TUSS.
    // TUSS/AMB agrupa por 1º dígito: 2 = SADT, 3 = cirúrgicos/invasivos, 4 = procedimentos clínicos.
    const dynamicByCode: Record<string, { id: string; code: string }> = {};

    for (const it of itemTypes) {
      const codes = new Set<string>();
      if (it.tuss_default) codes.add(String(it.tuss_default).trim());
      for (const c of it.tuss_codes_extra ?? []) {
        if (c) codes.add(String(c).trim());
      }
      for (const c of codes) {
        if (!c) continue;
        const bucket = tussToItemTypes.get(c);
        if (bucket) bucket.add(it.id);
        else tussToItemTypes.set(c, new Set([it.id]));
      }
      if (it.is_default_when_no_tuss && !defaultItemTypeId) {
        defaultItemTypeId = it.id;
        defaultItemTypeCode = it.code;
      }
      if (["procedimento", "cirurgia", "sadt"].includes(it.code)) {
        dynamicByCode[it.code] = { id: it.id, code: it.code };
      }
    }

    // Fallback final quando o prefixo TUSS não bate em cadastro — mantém compat: usa "procedimento".
    const dynamicFallbackItemTypeId = dynamicByCode["procedimento"]?.id ?? null;
    const dynamicFallbackItemTypeCode = dynamicByCode["procedimento"]?.code ?? null;

    // Heurística por prefixo TUSS/AMB. Retorna item_type dinâmico ou null quando o
    // prefixo não tem tipo cadastrado (aí cai no fallback "procedimento").
    const classifyByTussPrefix = (code: string): { id: string; code: string } | null => {
      const first = code.charAt(0);
      if (first === "3") return dynamicByCode["cirurgia"] ?? null;
      if (first === "4") return dynamicByCode["procedimento"] ?? null;
      if (first === "2") return dynamicByCode["sadt"] ?? null;
      return null;
    };

    const ambiguousTussCodes: string[] = [];
    for (const [code, set] of tussToItemTypes) {
      if (set.size > 1) ambiguousTussCodes.push(code);
    }
    if (ambiguousTussCodes.length) {
      console.log(
        `[auto-classify] TUSS ambíguos: ${ambiguousTussCodes.length} códigos [${ambiguousTussCodes.slice(0, 5).join(", ")}]`,
      );
    }
    if (!defaultItemTypeId) {
      console.warn("[auto-classify] Nenhum item_type marcado como is_default_when_no_tuss — itens sem TUSS ficarão sem item_type.");
    }
    if (!dynamicFallbackItemTypeId) {
      console.warn("[auto-classify] Nenhum item_type code=procedimento — TUSS sem match não será reclassificado dinamicamente.");
    }


    // 2. Varre itens do lote em páginas e classifica AGRUPANDO por destino.
    //    Antes: 1 UPDATE por item (3k+ round-trips → 504 IDLE_TIMEOUT).
    //    Agora: agrupa ids por (item_type_id, source) e faz UPDATE em lote
    //    via `.in('id', chunk)` — poucas queries independente do volume.
    let totalScanned = 0;
    let autoTuss = 0;
    let autoHeuristic = 0;
    let autoDefault = 0;
    let ambiguousTuss = 0;
    let unchanged = 0;
    const pageSize = 1000;

    // Sentinela para representar item_type_id=null na chave do bucket
    // (Map<string,…> não aceita null como parte da chave composta).
    const NULL_SENTINEL = "__NULL__";
    // key = `${nextItemTypeId | NULL_SENTINEL}::${nextSource}` → lista de ids
    const buckets = new Map<string, string[]>();

    for (let from = 0; ; from += pageSize) {
      const { data: items, error: itemsErr } = await supabase
        .from("payment_items")
        .select("id, procedure_code, item_type_id, item_type_source")
        .eq("payment_id", payment_id)
        .range(from, from + pageSize - 1);
      if (itemsErr) throw itemsErr;
      if (!items || items.length === 0) break;
      totalScanned += items.length;

      for (const it of items as any[]) {
        const source = (it.item_type_source ?? "") as string;
        if (PROTECTED_SOURCES.has(source)) {
          unchanged++;
          continue;
        }

        const code = String(it.procedure_code ?? "").trim();
        let nextItemTypeId: string | null = null;
        let nextSource:
          | "auto_tuss"
          | "auto_heuristic"
          | "auto_default"
          | "ambiguous_tuss"
          | null = null;

        if (code && tussToItemTypes.has(code)) {
          const set = tussToItemTypes.get(code)!;
          if (set.size === 1) {
            nextItemTypeId = set.values().next().value as string;
            nextSource = "auto_tuss";
          } else {
            // TUSS reivindicado por 2+ tipos ativos → deixa null e marca
            // ambíguo. Decisão será do cross-reference-parecer ou manual.
            nextItemTypeId = null;
            nextSource = "ambiguous_tuss";
          }
        } else if (code && dynamicFallbackItemTypeId) {
          nextItemTypeId = dynamicFallbackItemTypeId;
          nextSource = "auto_heuristic";
        } else if (defaultItemTypeId) {
          nextItemTypeId = defaultItemTypeId;
          nextSource = "auto_default";
        }

        if (!nextSource) {
          unchanged++;
          continue;
        }

        // Sem mudança? pula (não gera UPDATE). Trata ambíguo->ambíguo também.
        if (
          it.item_type_id === nextItemTypeId &&
          it.item_type_source === nextSource
        ) {
          unchanged++;
          continue;
        }

        const bucketKey = `${nextItemTypeId ?? NULL_SENTINEL}::${nextSource}`;
        const arr = buckets.get(bucketKey);
        if (arr) arr.push(it.id);
        else buckets.set(bucketKey, [it.id]);
      }

      if (items.length < pageSize) break;
    }

    // 3. Executa UPDATEs em lote por bucket. Chunks de 500 ids para manter a
    //    URL do PostgREST dentro do limite seguro.
    const CHUNK = 500;
    for (const [key, ids] of buckets) {
      const [rawTypeId, nextSource] = key.split("::") as [
        string,
        "auto_tuss" | "auto_heuristic" | "auto_default" | "ambiguous_tuss",
      ];
      const nextItemTypeId = rawTypeId === NULL_SENTINEL ? null : rawTypeId;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error: upErr } = await supabase
          .from("payment_items")
          .update({
            item_type_id: nextItemTypeId,
            item_type_source: nextSource,
          })
          .in("id", chunk);
        if (upErr) {
          console.error(
            `[auto-classify] erro update lote source=${nextSource} chunk=${chunk.length}`,
            upErr,
          );
          continue;
        }
        if (nextSource === "auto_tuss") autoTuss += chunk.length;
        else if (nextSource === "auto_heuristic") autoHeuristic += chunk.length;
        else if (nextSource === "ambiguous_tuss") ambiguousTuss += chunk.length;
        else autoDefault += chunk.length;
      }
    }

    console.log(
      `[auto-classify] payment=${payment_id} scanned=${totalScanned} auto_tuss=${autoTuss} auto_heuristic=${autoHeuristic} auto_default=${autoDefault} ambiguous_tuss=${ambiguousTuss} unchanged=${unchanged} default_item_type=${defaultItemTypeCode} dynamic_fallback=${dynamicFallbackItemTypeCode}`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        payment_id,
        scanned: totalScanned,
        auto_tuss: autoTuss,
        auto_heuristic: autoHeuristic,
        auto_default: autoDefault,
        ambiguous_tuss: ambiguousTuss,
        unchanged,
        default_item_type: defaultItemTypeCode,
        dynamic_fallback_item_type: dynamicFallbackItemTypeCode,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },

    );
  } catch (e: any) {
    console.error("[auto-classify-payment-types] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
