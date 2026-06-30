// auto-classify-payment-types
//
// Classifica itens de um lote no novo modelo (jun/2026): atribui
// `payment_items.item_type_id` (tabela `item_types`) e, por compatibilidade
// com o motor atual, replica em `payment_items.payment_type_id` o id
// equivalente em `payment_types` (mesmo `code`).
//
// Regra (decisão do usuário, jun/2026):
//   1. Se o item tem `procedure_code` (TUSS) e ele bate com
//      item_types.tuss_default ou item_types.tuss_codes_extra → usa esse
//      item_type. source = 'auto_tuss'.
//   2. Senão → cai no item_type marcado como `is_default_when_no_tuss`
//      (Consulta). source = 'auto_default'.
//
// Nunca sobrescreve itens com source = 'manual' (override do analista) ou
// vínculos de parecer/cross-reference.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROTECTED_SOURCES = new Set([
  "manual",
  "report_cross",
  "report_cross_dedup",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
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

    // 1. Carrega item_types ativos (com TUSS) e payment_types ativos
    //    para resolver o id legacy equivalente por code.
    const [itemTypesRes, paymentTypesRes] = await Promise.all([
      supabase
        .from("item_types")
        .select("id, code, tuss_default, tuss_codes_extra, is_default_when_no_tuss, active")
        .eq("active", true),
      supabase
        .from("payment_types")
        .select("id, code, active")
        .eq("active", true),
    ]);
    if (itemTypesRes.error) throw itemTypesRes.error;
    if (paymentTypesRes.error) throw paymentTypesRes.error;

    const itemTypes = (itemTypesRes.data ?? []) as Array<{
      id: string;
      code: string;
      tuss_default: string | null;
      tuss_codes_extra: string[] | null;
      is_default_when_no_tuss: boolean;
    }>;
    const paymentTypes = (paymentTypesRes.data ?? []) as Array<{
      id: string;
      code: string;
    }>;

    const legacyByCode = new Map<string, string>();
    for (const pt of paymentTypes) legacyByCode.set(pt.code, pt.id);

    // TUSS → item_type_id (primeiro match vence; colisões viram warning).
    const tussToItemType = new Map<string, string>();
    const collisions: string[] = [];
    let defaultItemTypeId: string | null = null;
    let defaultItemTypeCode: string | null = null;

    for (const it of itemTypes) {
      const codes = new Set<string>();
      if (it.tuss_default) codes.add(String(it.tuss_default).trim());
      for (const c of it.tuss_codes_extra ?? []) {
        if (c) codes.add(String(c).trim());
      }
      for (const c of codes) {
        if (!c) continue;
        if (tussToItemType.has(c) && tussToItemType.get(c) !== it.id) {
          collisions.push(`${c}: ${tussToItemType.get(c)} vs ${it.id}`);
        } else {
          tussToItemType.set(c, it.id);
        }
      }
      if (it.is_default_when_no_tuss && !defaultItemTypeId) {
        defaultItemTypeId = it.id;
        defaultItemTypeCode = it.code;
      }
    }

    if (collisions.length) {
      console.warn(
        `[auto-classify] TUSS duplicados em item_types: ${collisions.slice(0, 5).join("; ")}`,
      );
    }
    if (!defaultItemTypeId) {
      console.warn("[auto-classify] Nenhum item_type marcado como is_default_when_no_tuss — itens sem TUSS ficarão sem item_type.");
    }

    const itemTypeCodeById = new Map<string, string>();
    for (const it of itemTypes) itemTypeCodeById.set(it.id, it.code);

    // 2. Varre itens do lote em páginas e classifica
    let totalScanned = 0;
    let autoTuss = 0;
    let autoDefault = 0;
    let unchanged = 0;
    const pageSize = 500;

    for (let from = 0; ; from += pageSize) {
      const { data: items, error: itemsErr } = await supabase
        .from("payment_items")
        .select("id, procedure_code, payment_type_id, payment_type_source, item_type_id, item_type_source")
        .eq("payment_id", payment_id)
        .range(from, from + pageSize - 1);
      if (itemsErr) throw itemsErr;
      if (!items || items.length === 0) break;
      totalScanned += items.length;

      for (const it of items as any[]) {
        const source = (it.payment_type_source ?? it.item_type_source ?? "") as string;
        if (PROTECTED_SOURCES.has(source)) continue;

        const code = String(it.procedure_code ?? "").trim();
        let nextItemTypeId: string | null = null;
        let nextSource: "auto_tuss" | "auto_default" | null = null;

        if (code && tussToItemType.has(code)) {
          nextItemTypeId = tussToItemType.get(code)!;
          nextSource = "auto_tuss";
        } else if (defaultItemTypeId) {
          nextItemTypeId = defaultItemTypeId;
          nextSource = "auto_default";
        }

        if (!nextItemTypeId || !nextSource) {
          unchanged++;
          continue;
        }

        const nextCode = itemTypeCodeById.get(nextItemTypeId) ?? null;
        const nextLegacyId = nextCode ? legacyByCode.get(nextCode) ?? null : null;

        // Sem mudança? pula
        if (
          it.item_type_id === nextItemTypeId &&
          it.item_type_source === nextSource &&
          it.payment_type_id === nextLegacyId
        ) {
          unchanged++;
          continue;
        }

        const patch: Record<string, any> = {
          item_type_id: nextItemTypeId,
          item_type_source: nextSource,
        };
        // Replica no campo legacy para o motor atual continuar funcionando
        if (nextLegacyId) {
          patch.payment_type_id = nextLegacyId;
          patch.payment_type_source = nextSource;
        }

        const { error: upErr } = await supabase
          .from("payment_items")
          .update(patch)
          .eq("id", it.id);
        if (upErr) {
          console.error(`[auto-classify] erro item ${it.id}`, upErr);
          continue;
        }
        if (nextSource === "auto_tuss") autoTuss++;
        else autoDefault++;
      }

      if (items.length < pageSize) break;
    }

    console.log(
      `[auto-classify] payment=${payment_id} scanned=${totalScanned} auto_tuss=${autoTuss} auto_default=${autoDefault} unchanged=${unchanged} default_item_type=${defaultItemTypeCode}`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        payment_id,
        scanned: totalScanned,
        auto_tuss: autoTuss,
        auto_default: autoDefault,
        unchanged,
        default_item_type: defaultItemTypeCode,
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
