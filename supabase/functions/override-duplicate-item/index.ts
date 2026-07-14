// Sub-Onda 2B — Override de duplicidade (apenas perfil DIRETOR).
// Wrapper fino sobre a função SQL `public.apply_duplicate_override` que já
// valida role + justificativa + grava audit_log.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = await req.json().catch(() => ({}));
    const item_id = String(body?.item_id ?? "").trim();
    const justification = String(body?.justification ?? "").trim();
    if (!item_id || !justification) {
      return new Response(JSON.stringify({ error: "item_id e justification são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cliente com JWT do usuário — has_role(auth.uid(), 'diretor') é validado dentro da função SQL.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Guard multi-tenant: resolve hospital via payment_item → payment.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: itemRow } = await admin
      .from("payment_items")
      .select("payment_id, payments!inner(hospital_id)")
      .eq("id", item_id)
      .maybeSingle();
    const targetHospitalId = (itemRow as any)?.payments?.hospital_id ?? null;
    if (!_auth.is_internal && !assertCallerHospital(_auth, targetHospitalId)) {
      return new Response(
        JSON.stringify({ error: "hospital_scope_denied", message: "Seu hospital ativo não corresponde ao hospital deste registro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await supabase.rpc("apply_duplicate_override", {
      _item_id: item_id,
      _justification: justification,
    });
    if (error) {
      // 42501 = insufficient_privilege (não é diretor) → 403
      const status = error.code === "42501" ? 403 : (error.code === "28000" ? 401 : 400);
      return new Response(JSON.stringify({ error: error.message, code: error.code }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
