// healthcheck-package-absorbed
// Health check: para um payment_id, valida que:
//   1) Reanálise preserva package_absorbed (manual ou via regra) e
//      package_absorbed_calc_id dos itens que vieram do banco com a flag setada.
//   2) bruto/líquido calculados por compute-company-financials batem com a
//      soma direta dos gross_amount (excluindo cancelled + package_absorbed).
//   3) Não há item com package_absorbed=true sem package_absorbed_calc_id.
//
// Uso: POST { payment_id, dry_run?: boolean }
//   dry_run=true (default): NÃO chama analyze-payment, só audita o estado atual.
//   dry_run=false: dispara analyze-payment antes e compara snapshot pré × pós.
//
// Resposta: { ok, checks: [...], summary }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

type Check = {
  name: string;
  ok: boolean;
  details?: unknown;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const { payment_id, dry_run = true } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const checks: Check[] = [];

    // --- Snapshot PRÉ ---
    const snapshotItems = async () => {
      const { data, error } = await supabase
        .from("payment_items")
        .select("id, company_id, gross_amount, expected_amount, is_cancelled, package_absorbed, package_absorbed_calc_id")
        .eq("payment_id", payment_id);
      if (error) throw error;
      return data ?? [];
    };

    const pre = await snapshotItems();
    const preAbsorbedMap = new Map<string, { absorbed: boolean; calcId: string | null }>(
      pre.map((it: any) => [it.id, { absorbed: !!it.package_absorbed, calcId: it.package_absorbed_calc_id ?? null }]),
    );
    const preAbsorbedCount = pre.filter((it: any) => it.package_absorbed === true).length;

    // --- (opcional) dispara reanálise ---
    let reanalyzeResult: unknown = null;
    if (!dry_run) {
      const { data, error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id, source: "healthcheck-package-absorbed" },
      });
      reanalyzeResult = error ? { error: error.message } : data;
    }

    // --- Snapshot PÓS ---
    const post = await snapshotItems();
    const postAbsorbedCount = post.filter((it: any) => it.package_absorbed === true).length;

    // CHECK 1: nenhum item perdeu package_absorbed manual
    const lostAbsorbed: any[] = [];
    const lostCalcId: any[] = [];
    for (const it of post) {
      const prev = preAbsorbedMap.get(it.id);
      if (!prev) continue;
      if (prev.absorbed && !it.package_absorbed) {
        lostAbsorbed.push({ id: it.id, before: prev, after: { absorbed: it.package_absorbed, calcId: it.package_absorbed_calc_id } });
      }
      if (prev.absorbed && it.package_absorbed && prev.calcId && it.package_absorbed_calc_id !== prev.calcId) {
        lostCalcId.push({ id: it.id, before: prev.calcId, after: it.package_absorbed_calc_id });
      }
    }
    checks.push({
      name: "preserva_package_absorbed",
      ok: lostAbsorbed.length === 0,
      details: { lost: lostAbsorbed, pre_count: preAbsorbedCount, post_count: postAbsorbedCount },
    });
    checks.push({
      name: "preserva_package_absorbed_calc_id",
      ok: lostCalcId.length === 0,
      details: { mismatches: lostCalcId },
    });

    // CHECK 2: nenhum item com absorbed=true sem calc_id
    const orphanCalcId = post.filter((it: any) => it.package_absorbed === true && !it.package_absorbed_calc_id);
    checks.push({
      name: "absorbed_sempre_tem_calc_id",
      ok: orphanCalcId.length === 0,
      details: { orphans: orphanCalcId.map((o: any) => o.id) },
    });

    // CHECK 3: bruto/líquido por empresa — snapshot vs cálculo direto
    const companyIds = Array.from(new Set(post.map((it: any) => it.company_id).filter(Boolean)));
    const financialChecks: any[] = [];
    for (const cid of companyIds) {
      // recomputa do zero para garantir consistência
      await supabase.functions.invoke("compute-company-financials", {
        body: { payment_id, company_id: cid },
      });
      const { data: snap } = await supabase
        .from("payment_company_financials")
        .select("bruto, debitos, creditos, glosas, pool, conciliacao, liquido")
        .eq("payment_id", payment_id).eq("company_id", cid).maybeSingle();

      const brutoEsperado = round2(
        post
          .filter((it: any) => it.company_id === cid && !it.is_cancelled && !it.package_absorbed)
          .reduce((s: number, it: any) => s + Number(it.gross_amount || 0), 0),
      );
      const brutoSnap = Number(snap?.bruto ?? 0);
      const liquidoEsperado = snap
        ? round2(brutoEsperado - Number(snap.debitos) + Number(snap.creditos) - Number(snap.glosas) - Number(snap.pool) + Number(snap.conciliacao))
        : 0;
      const liquidoSnap = Number(snap?.liquido ?? 0);

      const brutoOk = Math.abs(brutoEsperado - brutoSnap) < 0.01;
      const liquidoOk = Math.abs(liquidoEsperado - liquidoSnap) < 0.01;

      financialChecks.push({
        company_id: cid,
        bruto_esperado: brutoEsperado,
        bruto_snapshot: brutoSnap,
        liquido_esperado: liquidoEsperado,
        liquido_snapshot: liquidoSnap,
        ok: brutoOk && liquidoOk,
      });
    }
    checks.push({
      name: "bruto_liquido_consistentes",
      ok: financialChecks.every((c) => c.ok),
      details: financialChecks,
    });

    const ok = checks.every((c) => c.ok);
    return new Response(JSON.stringify({
      ok,
      payment_id,
      dry_run,
      reanalyze: reanalyzeResult,
      checks,
      summary: {
        items_total: post.length,
        absorbed_pre: preAbsorbedCount,
        absorbed_post: postAbsorbedCount,
        companies: companyIds.length,
        checks_pass: checks.filter((c) => c.ok).length,
        checks_fail: checks.filter((c) => !c.ok).length,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[healthcheck-package-absorbed]", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
