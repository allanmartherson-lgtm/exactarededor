// Notifica admins/diretores sobre médicos novos pendentes em regras com lista
// específica de médicos. Dois modos:
//   - daily (cron): consolida TODAS as pendências e envia 1 e-mail por supervisor.
//   - realtime: chamado quando um vínculo manual é criado; só notifica se a PJ
//     tiver alguma regra ativa com allowlist específica.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
import { sendCorporateEmail } from "../_shared/sendCorporateEmail.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://exacta-approval.lovable.app";

type PendingRow = {
  rule_id: string;
  rule_name: string;
  company_id: string;
  company_name: string;
  doctor_id: string;
  doctor_name: string;
  doctor_crm: string | null;
};

async function sendEmail(to: string, subject: string, text: string) {
  const html = `<p>${text.replace(/\n/g, "<br/>")}</p>`;
  const res = await sendCorporateEmail({
    to,
    subject,
    html,
    text,
    event_key: "rule_pending_doctors",
    template_key: "rule_pending_doctors",
  });
  if (!res.ok) {
    console.error("[notify-rule-pending-doctors] envio falhou", res.status, res.error);
    return { ok: false, status: res.status, body: res.error };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const _auth = await requireInternalOrRole(req);
  if (!_auth.ok) return unauthorizedResponse(_auth, corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode: "daily" | "realtime" = body?.mode === "realtime" ? "realtime" : "daily";

    // Carrega regras de grupo ativas com allowlist (pelo menos 1 link com doctors > 0).
    const { data: rules } = await supabase
      .from("rules")
      .select("id, name, group_company_links")
      .eq("active", true)
      .eq("scope", "grupo");

    const allPending: PendingRow[] = [];
    for (const r of rules ?? []) {
      const { data } = await supabase.rpc("rule_pending_doctors", { p_rule_id: r.id });
      for (const row of (data ?? []) as any[]) {
        allPending.push({
          rule_id: r.id,
          rule_name: r.name,
          company_id: row.company_id,
          company_name: row.company_name,
          doctor_id: row.doctor_id,
          doctor_name: row.doctor_name,
          doctor_crm: row.doctor_crm,
        });
      }
    }

    let relevant = allPending;
    if (mode === "realtime") {
      const companyId = body?.company_id;
      const doctorId = body?.doctor_id;
      if (!companyId || !doctorId) {
        return new Response(JSON.stringify({ ok: false, error: "company_id e doctor_id obrigatórios em modo realtime" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      relevant = allPending.filter((p) => p.company_id === companyId && p.doctor_id === doctorId);
      if (relevant.length === 0) {
        return new Response(JSON.stringify({ ok: true, notified: 0, reason: "nenhuma regra afetada" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (relevant.length === 0) {
      return new Response(JSON.stringify({ ok: true, notified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Destinatários: admin e diretor.
    const { data: supervisors } = await supabase
      .from("user_roles")
      .select("user_id, role, profiles!inner(email, display_name)")
      .in("role", ["admin", "diretor"]);

    const recipients = (supervisors ?? [])
      .map((s: any) => ({ email: s.profiles?.email as string | undefined, name: s.profiles?.display_name as string | undefined }))
      .filter((s) => !!s.email);

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, notified: 0, reason: "sem destinatários" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Agrupa por regra para o corpo do e-mail.
    const byRule = new Map<string, PendingRow[]>();
    for (const p of relevant) {
      const arr = byRule.get(p.rule_id) ?? [];
      arr.push(p);
      byRule.set(p.rule_id, arr);
    }

    const lines: string[] = [];
    for (const [, items] of byRule.entries()) {
      lines.push(`\n• ${items[0].rule_name}`);
      for (const it of items) {
        const crm = it.doctor_crm ? ` (CRM ${it.doctor_crm})` : "";
        lines.push(`    - ${it.doctor_name}${crm} — ${it.company_name}`);
      }
    }

    const title = mode === "realtime"
      ? `Novo médico em regra: ${relevant[0].doctor_name}`
      : `Resumo diário — ${relevant.length} médico(s) novo(s) pendente(s) em regras`;

    const intro = mode === "realtime"
      ? `Um vínculo manual acabou de incluir o médico ${relevant[0].doctor_name} em uma PJ com regra ativa. Ele já está sendo coberto automaticamente — revise para confirmar ou excluir da regra.`
      : `Há médicos novos em empresas com regras de allowlist específica. Eles já estão sendo cobertos automaticamente. Revise cada regra para confirmar a inclusão ou marcar a exclusão.`;

    const link = `${APP_BASE_URL}/regras`;
    const text = `${intro}\n${lines.join("\n")}\n\nRevisar regras: ${link}`;

    let sent = 0;
    for (const r of recipients) {
      const res = await sendEmail(r.email!, title, text);
      if ((res as any).ok || (res as any).skipped) sent++;
    }

    return new Response(JSON.stringify({ ok: true, notified: sent, total_pending: relevant.length, mode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[notify-rule-pending-doctors] error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
