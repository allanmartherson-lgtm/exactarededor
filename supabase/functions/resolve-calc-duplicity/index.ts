// Sub-Onda 2C — Resolução manual de duplicidade entre cálculos da mesma regra.
// Wrapper fino sobre a função SQL `public.apply_calc_duplicity_resolution`,
// que valida role + justificativa + chosen_calc_id e grava audit_log.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const item_id = String(body?.item_id ?? "").trim();
    const chosen_calc_id = String(body?.chosen_calc_id ?? "").trim();
    const justification = String(body?.justification ?? "").trim();
    if (!item_id || !chosen_calc_id || !justification) {
      return new Response(
        JSON.stringify({ error: "item_id, chosen_calc_id e justification são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await supabase.rpc("apply_calc_duplicity_resolution", {
      _item_id: item_id,
      _chosen_calc_id: chosen_calc_id,
      _justification: justification,
    });

    if (error) {
      const status =
        error.code === "42501" ? 403 :
        error.code === "28000" ? 401 :
        error.code === "P0002" ? 404 :
        error.code === "22023" ? 400 :
        400;
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
