// ai-retry-worker
// Drena a fila ai_retry_queue e redispara a análise via dispatch-payment-analysis.
// Importante: não chama analyze-payment de forma síncrona. Empresas grandes
// ultrapassavam o tempo de vida da Edge Function; a fila ficava presa em
// `processing` e o relatório continuava exibindo falhas antigas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WORKER_FETCH_TIMEOUT_MS = 30_000;

type QueueRow = {
  id: string;
  payment_id: string;
  company_name: string;
  attempts: number;
  max_attempts: number;
  last_job_id: string | null;
};

const groupByPayment = (items: QueueRow[]) => {
  const map = new Map<string, QueueRow[]>();
  for (const item of items) {
    const list = map.get(item.payment_id) ?? [];
    list.push(item);
    map.set(item.payment_id, list);
  }
  return map;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

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

  // Observabilidade do housekeeping executado dentro do claim (TTL, gate de status final,
  // recovery de zumbis). A RPC não retorna contadores, então inspecionamos amostras
  // recentes para deixar rastro nos logs sem custo relevante.
  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: housekeeping } = await supabase
      .from("ai_retry_queue")
      .select("id, status, last_error, updated_at")
      .gte("updated_at", since)
      .in("status", ["cancelled", "failed"])
      .order("updated_at", { ascending: false })
      .limit(20);
    if (housekeeping && housekeeping.length > 0) {
      const ttl = housekeeping.filter((r) => (r.last_error ?? "").includes("TTL:")).length;
      const finalGate = housekeeping.filter((r) => (r.last_error ?? "").includes("payment em status final")).length;
      const zombieExhausted = housekeeping.filter((r) => (r.last_error ?? "").includes("processing zombie") && r.status === "failed").length;
      console.log(`[ai-retry-worker] housekeeping (últimos 60s): ttl_cancelled=${ttl} final_status_cancelled=${finalGate} zombie_exhausted=${zombieExhausted} total_amostra=${housekeeping.length}`);
    }
  } catch (e) {
    console.warn("[ai-retry-worker] housekeeping observability falhou (não bloqueante)", (e as Error)?.message);
  }

  const dispatchUrl = `${SUPABASE_URL}/functions/v1/dispatch-payment-analysis`;

  const runGroup = async (paymentId: string, paymentItems: QueueRow[]): Promise<Array<{ id: string; ok: boolean; error?: string }>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_FETCH_TIMEOUT_MS);
    try {
      const companyNames = Array.from(new Set(paymentItems.map((item) => item.company_name)));
      const resp = await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          payment_id: paymentId,
          only_companies: companyNames,
          ai_statuses: aiStatuses,
          tolerance_pct: tolerancePct,
          force_fresh_rules: true,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        const errMsg = `HTTP ${resp.status}: ${txt.slice(0, 300)}`;
        await Promise.all(paymentItems.map((item) =>
          supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: false, p_error: errMsg })
        ));
        return paymentItems.map((item) => ({ id: item.id, ok: false, error: errMsg }));
      }

      const data = await resp.json().catch(() => ({}));
      if (data?.already_running === true) {
        const msg = data?.message ?? "análise já em andamento — retry reagendado";
        await Promise.all(paymentItems.map((item) =>
          supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: false, p_error: msg })
        ));
        return paymentItems.map((item) => ({ id: item.id, ok: false, error: msg }));
      }

      if (data?.ok === false || data?.blocked === true || data?.total_companies === 0) {
        const msg = data?.message ?? data?.error ?? "nenhuma empresa disponível para reprocessamento";
        await Promise.all(paymentItems.map((item) =>
          supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: false, p_error: msg })
        ));
        return paymentItems.map((item) => ({ id: item.id, ok: false, error: msg }));
      }

      await Promise.all(paymentItems.map((item) =>
        supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: true, p_error: null })
      ));
      return paymentItems.map((item) => ({ id: item.id, ok: true }));
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const msg = err?.name === "AbortError"
        ? `worker timeout após ${WORKER_FETCH_TIMEOUT_MS}ms`
        : String(err?.message ?? e);
      await Promise.all(paymentItems.map((item) =>
        supabase.rpc("finalize_ai_retry", { p_id: item.id, p_success: false, p_error: msg })
      ));
      return paymentItems.map((item) => ({ id: item.id, ok: false, error: msg }));
    } finally {
      clearTimeout(timer);
    }
  };

  const grouped = Array.from(groupByPayment(items).entries());
  const results = (await Promise.all(grouped.map(([paymentId, paymentItems]) => runGroup(paymentId, paymentItems)))).flat();
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
