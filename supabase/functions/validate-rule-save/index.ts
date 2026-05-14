/**
 * Sub-Onda 2D — Edge function de validação preventiva de regras.
 *
 * Wrapper que combina:
 *   1) RPC `validate_rule_save` (Verificações A/B/C + master_already_exists)
 *   2) Helper TS `detectCalcOverlap` (Verificação D)
 *
 * Auth: JWT do usuário no header. Defesa em profundidade: além do check feito
 * pela função SQL (security definer), também valida role aqui antes da chamada.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { detectCalcOverlap, detectCrossRuleOverlap } from "../_shared/calcOverlap.ts";
import type { RuleCalculationItem } from "../_shared/rulesEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ValidateRuleSaveRequest {
  rule_id?: string | null;
  scope: "master" | "especifica" | "grupo";
  target_type?: "medico" | "empresa" | null;
  target_identifier?: string | null;
  target_company_id?: string | null;
  group_doctors?: unknown;
  group_company_links?: unknown;
  valid_from?: string | null;
  valid_until?: string | null;
  calculations?: RuleCalculationItem[] | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  // Defesa em profundidade: confere role admin/diretor antes do RPC.
  const { data: roles, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (roleErr) {
    return new Response(JSON.stringify({ error: "Falha ao verificar permissão" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (!roleSet.has("admin") && !roleSet.has("diretor")) {
    return new Response(
      JSON.stringify({ error: "Apenas admin/diretor podem validar regras" }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let body: ValidateRuleSaveRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body || typeof body !== "object" || !body.scope) {
    return new Response(JSON.stringify({ error: "Body inválido: scope é obrigatório" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1) RPC validate_rule_save — Verificações A/B/C + master_already_exists
  const { data: sqlOut, error: rpcErr } = await supabase.rpc("validate_rule_save", {
    _rule_id: body.rule_id ?? null,
    _scope: body.scope,
    _target_type: body.target_type ?? null,
    _target_identifier: body.target_identifier ?? null,
    _target_company_id: body.target_company_id ?? null,
    _group_doctors: body.group_doctors ?? null,
    _group_company_links: body.group_company_links ?? null,
    _valid_from: body.valid_from ?? null,
    _valid_until: body.valid_until ?? null,
  });
  if (rpcErr) {
    return new Response(
      JSON.stringify({ error: "Falha em validate_rule_save", detail: rpcErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sqlProblems: unknown[] = Array.isArray((sqlOut as { problems?: unknown[] })?.problems)
    ? (sqlOut as { problems: unknown[] }).problems
    : [];

  // 2) Helper TS — Verificação D (calc_overlap)
  const calcProblems = detectCalcOverlap(body.calculations ?? []);

  const allProblems = [...sqlProblems, ...calcProblems];
  return new Response(
    JSON.stringify({ valid: allProblems.length === 0, problems: allProblems }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
