// status-consistency-watchdog
// ----------------------------------------------------------------------------
// Cron a cada 10min. Detecta lotes em modo `padrao` cujo `payments.status`
// não bate com o estado calculado a partir de `payment_company_groups` e
// reaplica a recompute automaticamente. Inconsistências são esperadas em
// situações de borda (race entre RPC e realtime, falha parcial de UPDATE em
// loop, refresh-token AbortError); o watchdog garante que nenhum lote
// fique permanentemente travado entre perfis (analista vê X, validador vê Y).
//
// O trabalho real é feito pela função SQL `repair_status_inconsistencies`,
// que é idempotente, paginada e segura para rodar concorrentemente com
// outros writes (cada recompute é uma única transação curta).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_LIMIT = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Job de reparo global (varre todos os hospitais) sem parâmetro de escopo:
  // restrito a cron/service_role e papéis globais (admin/diretor).
  const _auth = await requireInternalOrRole(req, ["admin", "diretor"]);

  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  const startedAt = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data, error } = await supabase.rpc("repair_status_inconsistencies", {
      _limit: BATCH_LIMIT,
    });
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      payment_id: string;
      before_status: string;
      after_status: string;
      expected_status: string;
      total_groups: number;
      fixed: boolean;
    }>;

    const fixed = rows.filter((r) => r.fixed);
    const failed = rows.filter((r) => !r.fixed);

    // Log estruturado para inspeção via supabase--edge_function_logs.
    if (rows.length > 0) {
      console.log("[status-consistency-watchdog] inconsistencies", {
        scanned: rows.length,
        fixed: fixed.length,
        failed: failed.length,
        samples: fixed.slice(0, 10).map((r) => ({
          payment_id: r.payment_id,
          before: r.before_status,
          after: r.after_status,
          expected: r.expected_status,
          total_groups: r.total_groups,
        })),
        failures: failed.slice(0, 10).map((r) => ({
          payment_id: r.payment_id,
          current: r.before_status,
          expected: r.expected_status,
        })),
      });
    }

    // Audit log para rastreabilidade fiscal — só registra quando houve
    // correção, evitando inflar a tabela em rodadas silenciosas.
    if (fixed.length > 0) {
      const auditRows = fixed.map((r) => ({
        action: "status_consistency_repair",
        entity_type: "payment",
        entity_id: r.payment_id,
        actor_id: null,
        metadata: {
          before_status: r.before_status,
          after_status: r.after_status,
          expected_status: r.expected_status,
          total_groups: r.total_groups,
          source: "status-consistency-watchdog",
        },
      }));
      const { error: auditErr } = await supabase.from("audit_log").insert(auditRows);
      if (auditErr) {
        console.warn("[status-consistency-watchdog] audit_log insert failed", auditErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: rows.length,
        fixed: fixed.length,
        failed: failed.length,
        elapsed_ms: Date.now() - startedAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[status-consistency-watchdog] fatal", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
