// Cron worker: dispara campanhas agendadas cujo scheduled_for já passou.
// Chamado por pg_cron periodicamente. Não exige autenticação humana.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const { data: due, error } = await admin
    .from("comm_campaigns")
    .select("id,scheduled_for")
    .eq("status", "agendada")
    .lte("scheduled_for", new Date().toISOString())
    .limit(20);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const c of due ?? []) {
    try {
      const resp = await fetch(`${url}/functions/v1/dispatch-broadcast`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ campaign_id: (c as { id: string }).id }),
      });
      results.push({
        id: (c as { id: string }).id,
        ok: resp.ok,
        error: resp.ok ? undefined : await resp.text(),
      });
    } catch (e) {
      results.push({
        id: (c as { id: string }).id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
