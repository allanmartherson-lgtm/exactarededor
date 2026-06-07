// ai-retry-worker
// Drena a fila ai_retry_queue: pega lote, invoca analyze-payment por empresa
// e marca cada item como done/pending(backoff)/failed via finalize_ai_retry.
// Pode ser chamada por pg_cron ou manualmente pelo painel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WORKER_FETCH_TIMEOUT_MS = 180_000;

type QueueRow = {
  id: string;
  payment_id: string;
  company_name: string;
  attempts: number;
  max_attempts: number;
  last_job_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Lote configurável (default 5; cap 20 no SQL)
  let batchSize = 5;
  let aiStatuses: string[] | undefined;
  let tolerancePct: number | undefined;
  try {
    if (req.method !== "GET") {
      const body = await req.json().catch(() => ({}));
      if (Number.isFinite(body?.batch_size)) batchSize = Number(body.batch_size);
      if (Array.isArray(body?.ai_statuses)) aiStatuses = body.ai_statuses;
      if (Number.isFinite(body?.tolerance_pct)) tolerancePct = Number(body.tolerance_pct);
    }
  } catch (_) { /* ignore */ }

  const { data: claimed, error: claimErr } = await supabase
    .rpc("claim_ai_retry_batch", { p_limit: batchSize });

  if (claimErr) {
    console.error("[ai-retry-worker] erro no claim", claimErr);
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const items = (claimed ?? []) as QueueRow[];
  if (items.length === 0) {
    return new Response(JSON.stringify({ ok: true, picked: 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[ai-retry-worker] picked ${items.length} item(s)`);

  const workerUrl = `${SUPABASE_URL}/functions/v1/analyze-payment`;

  const runOne = async (item: QueueRow): Promise<{ id: string; ok: boolean; error?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          payment_id: item.payment_id,
          company_name: item.company_name === "Sem empresa" ? null : item.company_name,
          ai_statuses: aiStatuses,
          tolerance_pct: tolerancePct,
          _job_id: item.last_job_id,
          _company_label: item.company_name,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        const errMsg = `HTTP ${resp.status}: ${txt.slice(0, 300)}`;
        await supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: false, p_error: errMsg });
        return { id: item.id, ok: false, error: errMsg };
      }

      await resp.text();
      await supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: true, p_error: null });
      return { id: item.id, ok: true };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const msg = err?.name === "AbortError"
        ? `worker timeout após ${WORKER_FETCH_TIMEOUT_MS}ms`
        : String(err?.message ?? e);
      await supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: false, p_error: msg });
      return { id: item.id, ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.all(items.map(runOne));
  const okCount = results.filter((r) => r.ok).length;

  return new Response(JSON.stringify({
    ok: true,
    picked: items.length,
    succeeded: okCount,
    failed: items.length - okCount,
    results,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
