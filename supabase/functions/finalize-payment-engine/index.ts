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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function callFn(name: string, body: unknown): Promise<{ ok: boolean; status: number; body: string }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, body: txt };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id, sources: requestedSources, force } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Inicializa/atualiza quais fontes são aplicáveis a este lote
    await supabase.rpc("init_engine_sources_for_payment", { _payment_id: payment_id });

    // Lê estado atual para decidir o que rodar
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

    const result: Record<string, unknown> = {};

    // ----- Por PJ -----
    const { data: groups } = await supabase
      .from("payment_company_groups")
      .select("company_id")
      .eq("payment_id", payment_id)
      .not("company_id", "is", null);

    const companyIds = Array.from(new Set((groups ?? []).map((g: any) => g.company_id as string).filter(Boolean)));

    const perCompany: any[] = [];
    if (companyIds.length > 0) {
      const CONCURRENCY = 4;
      const runForCompany = async (cid: string) => {
        const summary: any = { company_id: cid };
        // 1) deductions (sequencial dentro da PJ — afeta o snapshot)
        if (want("company_adjustments") || want("glosa_debts")) {
          const r = await callFn("apply-company-deductions", { payment_id, company_id: cid });
          summary.deductions = { status: r.status };
          try { summary.deductions.body = JSON.parse(r.body); } catch { summary.deductions.body = r.body.slice(0, 400); }
        }
        // 2) minimum guarantee
        if (want("minimum_guarantee")) {
          const r = await callFn("apply-minimum-guarantee", { payment_id, company_id: cid });
          summary.minimum_guarantee = { status: r.status };
          try { summary.minimum_guarantee.body = JSON.parse(r.body); } catch {}
        }
        // 3) snapshot da PJ
        const r3 = await callFn("compute-company-financials", { payment_id, company_id: cid });
        summary.snapshot = { status: r3.status };
        try { summary.snapshot.body = JSON.parse(r3.body); } catch {}
        return summary;
      };

      for (let i = 0; i < companyIds.length; i += CONCURRENCY) {
        const batch = companyIds.slice(i, i + CONCURRENCY);
        const out = await Promise.all(batch.map(runForCompany));
        perCompany.push(...out);
      }

      // Consolida marcação por fonte (uma única linha por payment)
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
          .select("valor_complemento, status")
          .eq("payment_id", payment_id);
        const totalMg = (mga ?? []).reduce((s: number, r: any) => s + Number(r.valor_complemento ?? 0), 0);
        await markSource(payment_id, "minimum_guarantee", (mga ?? []).length, totalMg);
      }
    } else {
      // Sem PJ — marca como N/A (init já cuidou de applicable=false)
    }

    result.per_company = perCompany;

    // ----- Pool -----
    if (want("pool_deductions")) {
      const r = await callFn("recalc-payment-pools", { payment_id, _background: false });
      result.pool = { status: r.status };
      try { result.pool.body = JSON.parse(r.body); } catch { result.pool.body = r.body.slice(0, 400); }

      const { data: runs } = await supabase
        .from("pool_calculation_runs")
        .select("id, base_total, valor_deducoes, valor_liquido_pool, status")
        .eq("payment_id", payment_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const run = runs?.[0] as any;
      await markSource(payment_id, "pool_deductions",
        run ? 1 : 0,
        Number(run?.valor_deducoes ?? 0),
        run ? { run_id: run.id, base: run.base_total, liquido: run.valor_liquido_pool, status: run.status } : {});
    }

    // ----- Retroativa -----
    if (want("retroactive_reconciliation")) {
      const { data: items } = await supabase
        .from("retroactive_reconciliation_items")
        .select("status, valor")
        .eq("target_payment_id", payment_id);
      const pendentes = (items ?? []).filter((r: any) => r.status === "pendente").length;
      const totalVal = (items ?? []).reduce((s: number, r: any) => s + Number(r.valor ?? 0), 0);
      await markSource(payment_id, "retroactive_reconciliation", (items ?? []).length, totalVal, {
        pendentes,
      });
    }

    // ----- Special cases -----
    if (want("special_case_marks")) {
      const { data: marks } = await supabase
        .from("special_case_marks")
        .select("status")
        .eq("payment_id", payment_id)
        .eq("status", "approved");
      await markSource(payment_id, "special_case_marks", (marks ?? []).length, 0);
    }

    // Estado final
    const { data: finalSrcs } = await supabase
      .from("payment_engine_sources")
      .select("source, read_at, applicable, applied_count, total_value")
      .eq("payment_id", payment_id);

    const { data: readyRpc } = await supabase.rpc("engine_sources_ready", { _payment_id: payment_id });

    return new Response(JSON.stringify({
      ok: true,
      payment_id,
      ready: readyRpc === true,
      sources: finalSrcs ?? [],
      detail: result,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[finalize-payment-engine] erro", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
