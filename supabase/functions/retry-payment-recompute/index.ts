// retry-payment-recompute
// Drena a fila `payment_recompute_failures` chamando o RPC
// `retry_payment_recompute_failures`. Pode ser invocado por cron ou manualmente
// pelo painel para reprocessar pagamentos cujo recálculo de status foi
// bloqueado por uma guarda (ex.: pagamento histórico recusando 'lancado').
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Fila global (multi-hospital) sem parâmetro de escopo: só cron/service_role
  // ou papéis globais (admin/diretor) podem drenar. Analista/validador de um
  // hospital não pode disparar recálculo em lotes de outras unidades.
  const _auth = await requireInternalOrRole(req, ["admin", "diretor"]);

  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = 50;
  try {
    if (req.method !== "GET") {
      const body = await req.json().catch(() => ({}));
      if (Number.isFinite(body?.limit)) limit = Number(body.limit);
    }
  } catch { /* noop */ }

  const { data, error } = await supabase.rpc("retry_payment_recompute_failures", { _limit: limit });

  if (error) {
    console.error("[retry-payment-recompute] erro", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = (data ?? []) as Array<{ payment_id: string; succeeded: boolean; error_message: string | null }>;
  const succeeded = results.filter((r) => r.succeeded).length;

  return new Response(JSON.stringify({
    ok: true,
    picked: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
