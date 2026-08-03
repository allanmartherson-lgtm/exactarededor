// delete-parecer-report
// Remove um payment_parecer_reports + suas linhas via RPC (service role, para
// elevar o statement_timeout em relatórios com milhares de linhas).
//
// Autorização espelha a RLS das tabelas payment_parecer_reports /
// payment_parecer_report_rows:
//   DELETE => has_role(auth.uid(), 'admin') AND hospital_scope_allows(hospital_id)
// Identidade vem SEMPRE do JWT da sessão — nada enviado pelo client é usado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import {
  requireInternalOrRole,
  unauthorizedResponse,
  assertCallerHospital,
} from "../_shared/requireInternalRole.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-active-hospital",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // (a) exige caller autenticado; só papel admin (mesma regra da RLS).
  const _auth = await requireInternalOrRole(req, ["admin"]);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { report_id } = await req.json();
    if (!report_id || typeof report_id !== "string") {
      return json({ error: "report_id required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // (c) escopo de hospital: hospital_id vem do próprio registro, nunca do body.
    const { data: report, error: loadErr } = await admin
      .from("payment_parecer_reports")
      .select("id, hospital_id")
      .eq("id", report_id)
      .maybeSingle();
    if (loadErr) return json({ error: loadErr.message }, 500);
    if (!report) return json({ error: "not_found" }, 404);

    const hospitalId = (report as { hospital_id: string | null }).hospital_id;
    // hospital_id NULL = registro global (a RLS permite); demais validam vínculo.
    if (hospitalId && !assertCallerHospital(_auth, hospitalId)) {
      return json(
        {
          error: "hospital_scope_denied",
          message:
            "Seu hospital ativo não corresponde ao hospital deste relatório.",
        },
        403,
      );
    }

    const { error: rpcErr } = await admin.rpc("delete_parecer_report", {
      p_report_id: report_id,
    });
    if (rpcErr) throw rpcErr;

    return json({ ok: true });
  } catch (e) {
    console.error("[delete-parecer-report]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
