// finalize-payment-engine
// =============================================================================
// Pipeline único de finalização do motor. Garante que TODAS as fontes que
// afetam o líquido do lote sejam lidas em ordem determinística, de forma
// idempotente. Substitui a colcha de retalhos onde cada UI disparava uma
// fonte diferente. Atualiza payment_engine_sources ao final de cada etapa.
//
// Fontes (na ordem):
//   PARA CADA PJ do lote:
//     1. apply-company-deductions   → company_adjustments + glosa_debts
//     2. apply-minimum-guarantee    → minimum_guarantee
//     3. compute-company-financials → snapshot por PJ
//   AO FIM:
//     4. recalc-payment-pools       → pool_deductions
//     5. run-retroactive-reconciliation (se houver item pendente)
//
// rules / payout_model são marcados pelo analyze-payment (já no fluxo).
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { callFn as callFnBase, type CallFnResult } from "./callFn.ts";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// 2026-07-02: Runtime do Supabase começou a lançar `RateLimitError` do próprio
// `fetch` interno quando o finalize dispara muitas chamadas em cascata (uma
// reimportação de PJ grande como INSTITUTO SALUTAIRE reentra no finalize e
// estoura o limite). Retentamos respeitando o `retryAfterMs` sugerido — mas
// com teto — e nunca quebramos o pipeline: em último caso devolvemos 429 no
// corpo para o chamador seguir marcando as demais fontes.
// 2026-07-04 (v3): pipeline agora roda em background (EdgeRuntime.waitUntil →
// 202 imediato), então backoff longo não trava mais a UI. Elevado teto para
// honrar o Retry-After sugerido pelo gateway (chegava a ~27s nos logs) e
// passamos a tratar 429 vindo como RESPOSTA HTTP (não só exceção lançada) —
// antes o Response 429 era considerado sucesso e o pipeline seguia com
// resultado falso. Também injetamos jitter entre PJs para dessincronizar a
// "trace" que o AI Gateway usa para rate-limit. Lógica extraída para
// ./callFn.ts (coberta por callFn.test.ts).
const INTER_PJ_JITTER_MS = 250;

function callFn(name: string, body: unknown): Promise<CallFnResult> {
  return callFnBase(name, body, { baseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY });
}

async function markSource(
  payment_id: string,
  source: string,
  applied_count: number,
  total_value: number,
  details: Record<string, unknown> = {},
) {
  await supabase.rpc("mark_engine_source", {
    _payment_id: payment_id,
    _source: source,
    _applied_count: applied_count,
    _total_value: total_value,
    _job_id: null,
    _details: details as never,
  });
}

// Pipeline pesado extraído para poder rodar em background (EdgeRuntime.waitUntil).
// 2026-07-03: com lotes grandes (INSTITUTO SALUTAIRE + muitas PJs), o loop
// per-PJ (deductions + minimum-guarantee + snapshot) + recalc de pools ultrapassa
// os 150s de wall-time do edge runtime → 504 gateway timeout no cliente, mesmo
// com todo o pipeline eventualmente concluindo. A UI já poleia
// `payment_engine_sources.updated_at` (waitForFinalizeStability em CompanyAnalysis,
// e EngineSourcesCard recarrega manualmente), então devolvemos 202 imediatamente
// e deixamos o pipeline seguir em background.
async function runPipeline(
  payment_id: string,
  requestedSources: string[] | undefined,
  force: boolean | undefined,
) {
  // Inicializa/atualiza quais fontes são aplicáveis a este lote
  await supabase.rpc("init_engine_sources_for_payment", { _payment_id: payment_id });

  const { data: srcs } = await supabase
    .from("payment_engine_sources")
    .select("source, read_at, applicable")
    .eq("payment_id", payment_id);

  const want = (s: string): boolean => {
    if (Array.isArray(requestedSources) && requestedSources.length > 0) {
      return requestedSources.includes(s);
    }
    const row = (srcs ?? []).find((r: any) => r.source === s);
    if (!row || !row.applicable) return false;
    if (force) return true;
    return row.read_at == null;
  };

  const { data: groups } = await supabase
    .from("payment_company_groups")
    .select("company_id")
    .eq("payment_id", payment_id)
    .not("company_id", "is", null);

  const companyIds = Array.from(new Set((groups ?? []).map((g: any) => g.company_id as string).filter(Boolean)));

  if (companyIds.length > 0) {
    const CONCURRENCY = 1;
    const runForCompany = async (cid: string) => {
      if (want("company_adjustments") || want("glosa_debts")) {
        await callFn("apply-company-deductions", { payment_id, company_id: cid });
      }
      if (want("minimum_guarantee")) {
        await callFn("apply-minimum-guarantee", { payment_id, company_id: cid });
      }
      await callFn("compute-company-financials", { payment_id, company_id: cid });
    };
    for (let i = 0; i < companyIds.length; i += CONCURRENCY) {
      const batch = companyIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(runForCompany));
      // Dessincroniza a "trace" que o AI Gateway usa para rate-limit entre PJs.
      if (i + CONCURRENCY < companyIds.length) {
        await new Promise((res) => setTimeout(res, Math.floor(Math.random() * INTER_PJ_JITTER_MS)));
      }
    }

    if (want("company_adjustments") || want("glosa_debts")) {
      const { data: caa } = await supabase
        .from("company_adjustment_applications")
        .select("valor_aplicado, status, adjustment_id")
        .eq("payment_id", payment_id)
        .neq("status", "revertido");
      const totalCaa = (caa ?? []).reduce((s: number, r: any) => s + Number(r.valor_aplicado ?? 0), 0);
      await markSource(payment_id, "company_adjustments", (caa ?? []).length, totalCaa, {
        ajustes: Array.from(new Set((caa ?? []).map((r: any) => r.adjustment_id))).length,
      });

      const { data: gpa } = await supabase
        .from("glosa_payment_applications")
        .select("valor_aplicado, status, glosa_debt_id")
        .eq("payment_id", payment_id)
        .neq("status", "revertido");
      const totalGpa = (gpa ?? []).reduce((s: number, r: any) => s + Number(r.valor_aplicado ?? 0), 0);
      await markSource(payment_id, "glosa_debts", (gpa ?? []).length, totalGpa, {
        debitos: Array.from(new Set((gpa ?? []).map((r: any) => r.glosa_debt_id))).length,
      });
    }

    if (want("minimum_guarantee")) {
      const { data: mga } = await supabase
        .from("minimum_guarantee_applications")
        .select("complemento_valor, status")
        .eq("payment_id", payment_id);
      const totalMg = (mga ?? []).reduce((s: number, r: any) => s + Number(r.complemento_valor ?? 0), 0);
      await markSource(payment_id, "minimum_guarantee", (mga ?? []).length, totalMg);
    }
  }

  if (want("pool_deductions")) {
    // Aqui o pipeline precisa ser determinístico: aguarda o cálculo real do
    // pool. Chamar com `_background:false` só enfileira e retorna 202, deixando
    // a fonte marcada antes de ler plantões/valores mensais.
    await callFn("recalc-payment-pools", { payment_id, _background: true });
    const { data: runs } = await supabase
      .from("pool_calculation_runs")
      .select("id, base_amount, deductions_applied, bolo_liquido, status")
      .eq("payment_id", payment_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const run = runs?.[0] as any;
    const dedArr = Array.isArray(run?.deductions_applied) ? run.deductions_applied : [];
    const totalDeducoes = dedArr.reduce((s: number, d: any) => s + Number(d?.valor ?? 0), 0);
    await markSource(payment_id, "pool_deductions",
      run ? 1 : 0,
      totalDeducoes,
      run ? { run_id: run.id, base: run.base_amount, liquido: run.bolo_liquido, status: run.status } : {});
  }

  if (want("retroactive_reconciliation")) {
    const { data: items } = await supabase
      .from("retroactive_reconciliation_items")
      .select("status, valor")
      .eq("payment_id", payment_id);
    const pendentes = (items ?? []).filter((r: any) => r.status === "pendente").length;
    const totalVal = (items ?? []).reduce((s: number, r: any) => s + Number(r.valor ?? 0), 0);
    await markSource(payment_id, "retroactive_reconciliation", (items ?? []).length, totalVal, {
      pendentes,
    });
  }

  if (want("special_case_marks")) {
    const { data: marks } = await supabase
      .from("special_case_marks")
      .select("status")
      .eq("payment_id", payment_id)
      .eq("status", "approved");
    await markSource(payment_id, "special_case_marks", (marks ?? []).length, 0);
  }
}

// @ts-ignore -- EdgeRuntime é injetado pelo runtime do Supabase
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {
    const { payment_id, sources: requestedSources, force } = await req.json();

    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const task = runPipeline(payment_id, requestedSources, force).catch((e) => {
      console.error("[finalize-payment-engine] pipeline erro", e);
    });

    // Roda em background quando disponível para evitar 504 no cliente.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
    } else {
      // Fallback (dev/local sem EdgeRuntime): não bloqueia a resposta.
      void task;
    }

    return new Response(JSON.stringify({
      ok: true,
      payment_id,
      accepted: true,
      background: true,
      message: "Pipeline iniciado em background. Poleie payment_engine_sources para status.",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[finalize-payment-engine] erro", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
