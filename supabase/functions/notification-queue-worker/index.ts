// Notification queue worker.
// Acordado por cron a cada 30s. Processa filas pendentes cujo debounce já passou
// e dispara o handler do `kind` correspondente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { processValidatorAssignment } from "./handlers/validatorAssignment.ts";
import { processDirectorApproval } from "./handlers/directorApproval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;

// Registry de handlers por kind. Para adicionar novo tipo no futuro:
// 1. Cria handler em ./handlers/{nome}.ts exportando processX(supabase, row): Promise<{ok, meta}>
// 2. Registra abaixo.
// deno-lint-ignore no-explicit-any
const HANDLERS: Record<string, (supabase: any, row: any) => Promise<{ ok: boolean; meta: unknown }>> = {
  validator_assignment: processValidatorAssignment,
  director_approval: processDirectorApproval,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: rows, error } = await supabase
      .from("notification_queue")
      .select("*")
      .is("sent_at", null)
      .order("first_event_at", { ascending: true })
      .limit(50);
    if (error) throw error;

    const now = Date.now();
    const ready = (rows ?? []).filter((r: { last_event_at: string; debounce_seconds: number }) => {
      const lastMs = new Date(r.last_event_at).getTime();
      const debounceMs = (r.debounce_seconds ?? 60) * 1000;
      return now - lastMs >= debounceMs;
    });

    // deno-lint-ignore no-explicit-any
    const results: any[] = [];
    for (const row of ready) {
      const handler = HANDLERS[row.kind];
      if (!handler) {
        await supabase.from("notification_queue")
          .update({ sent_at: new Date().toISOString(), sent_meta: { error: "no_handler" }, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        results.push({ id: row.id, kind: row.kind, ok: false, error: "no_handler" });
        continue;
      }

      try {
        const { ok, meta } = await handler(supabase, row);
        await supabase.from("notification_queue")
          .update({
            sent_at: new Date().toISOString(),
            sent_meta: meta as unknown,
            attempts: (row.attempts ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        results.push({ id: row.id, kind: row.kind, ok, meta });
      } catch (e) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const giveUp = nextAttempts >= MAX_ATTEMPTS;
        await supabase.from("notification_queue")
          .update({
            attempts: nextAttempts,
            sent_at: giveUp ? new Date().toISOString() : null,
            sent_meta: giveUp ? { error: String(e), gave_up: true } : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        results.push({ id: row.id, kind: row.kind, ok: false, error: String(e), attempts: nextAttempts, gave_up: giveUp });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scanned: rows?.length ?? 0, processed: ready.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notification-queue-worker error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
