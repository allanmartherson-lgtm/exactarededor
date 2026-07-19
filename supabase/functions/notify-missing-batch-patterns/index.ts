// Rotina diária: varre hospitais ativos, chama get_missing_batch_patterns_for
// e cria internal_notifications para analistas/admins vinculados, deduplicando
// por (pattern_id, competence_month, dia BRT).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const todayBRT = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const dayKey = todayBRT.toISOString().slice(0, 10);

    const { data: hospitals, error: hErr } = await admin
      .from("hospitals")
      .select("id, name")
      .eq("active", true);
    if (hErr) throw hErr;

    let created = 0;
    let skipped = 0;
    const summary: Array<{ hospital: string; missing: number; notified: number }> = [];

    for (const h of hospitals ?? []) {
      const { data: missing, error: mErr } = await admin.rpc(
        "get_missing_batch_patterns_for",
        { _hospital: h.id },
      );
      if (mErr) { console.warn("missing rpc falhou", h.id, mErr.message); continue; }
      const rows = (missing ?? []) as Array<{
        pattern_id: string; label: string; competence_month: string;
        days_late: number; avg_bruto: number | null;
      }>;
      if (rows.length === 0) { summary.push({ hospital: h.name, missing: 0, notified: 0 }); continue; }

      // Recipients: users com vínculo ao hospital nos papéis operacionais.
      const { data: recipients, error: rErr } = await admin
        .from("user_hospitals")
        .select("user_id, role")
        .eq("hospital_id", h.id)
        .in("role", ["analista", "admin", "gestor"]);
      if (rErr) { console.warn("recipients falhou", h.id, rErr.message); continue; }
      const userIds = Array.from(new Set((recipients ?? []).map((r: any) => r.user_id)));
      if (userIds.length === 0) { summary.push({ hospital: h.name, missing: rows.length, notified: 0 }); continue; }

      let notifiedThisHospital = 0;
      for (const r of rows) {
        // Dedup: se já existe notificação hoje (BRT) para (pattern, competência), pula.
        const { data: exists } = await admin
          .from("internal_notifications")
          .select("id")
          .eq("kind", "batch_pattern_late")
          .filter("payload->>pattern_id", "eq", r.pattern_id)
          .filter("payload->>competence_month", "eq", r.competence_month)
          .filter("payload->>day_key", "eq", dayKey)
          .limit(1)
          .maybeSingle();
        if (exists) { skipped++; continue; }

        const compLabel = new Date(r.competence_month + "T12:00:00Z")
          .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
        const title = `Lote esperado em atraso — ${r.label}`;
        const body = `${h.name}: nenhum lote de "${r.label}" para ${compLabel} há ${r.days_late} dia(s) após o prazo.`;
        const rows2insert = userIds.map((uid) => ({
          user_id: uid,
          kind: "batch_pattern_late",
          title,
          body,
          link: `/padroes-de-lote?pattern=${r.pattern_id}`,
          payload: {
            pattern_id: r.pattern_id,
            hospital_id: h.id,
            competence_month: r.competence_month,
            days_late: r.days_late,
            day_key: dayKey,
          },
        }));
        const { error: iErr } = await admin.from("internal_notifications").insert(rows2insert);
        if (iErr) { console.warn("insert notif falhou", iErr.message); continue; }
        created += rows2insert.length;
        notifiedThisHospital += rows2insert.length;
      }
      summary.push({ hospital: h.name, missing: rows.length, notified: notifiedThisHospital });
    }

    return new Response(JSON.stringify({ ok: true, created, skipped, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
