// Dispara uma campanha de comunicação em massa (comm_campaigns).
//
// Fluxo:
//  1. Carrega a campanha e valida estado (rascunho/agendada/enviando).
//  2. Resolve audiência:
//     - audience.mode = 'or'  -> união de empresas + médicos por especialidade + médicos diretos
//     - audience.mode = 'and' -> interseção (médicos que estejam em todas as listas; empresas só se também listadas)
//  3. Cria/UPSERT em comm_campaign_recipients (com snapshot de email/phone).
//  4. Para cada destinatário, dispara nos canais escolhidos:
//     - portal: sempre fica registrado na própria linha de recipient (basta inserir).
//     - email: invoca send-email-corporate.
//     - whatsapp: invoca send-whatsapp-twilio se audience.whatsapp_template_key existir.
//  5. Atualiza totals + status da campanha.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { requireInternalOrRole, unauthorizedResponse, assertCallerHospital } from "../_shared/requireInternalRole.ts";

const BodySchema = z.object({
  campaign_id: z.string().uuid(),
});

type Audience = {
  mode?: "and" | "or";
  companies?: string[];
  specialties?: string[];
  doctors?: string[];
  whatsapp_template_key?: string;
  whatsapp_variables?: Record<string, string>;
};

type Recipient = {
  target_type: "empresa" | "medico";
  target_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: só aceita service-role JWT / x-cron-secret (internal) ou usuário
  // autenticado com role interna (admin/diretor/analista/validador). A anon key
  // é pública e NÃO pode disparar campanhas reais.
  const auth = await requireInternalOrRole(req, [
    "admin",
    "diretor",
    "analista",
    "validador",
  ]);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);
  const isInternal = !!auth.is_internal;
  const actorId: string | null = auth.user_id ?? null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.flatten().fieldErrors }, 400);
  }
  const { campaign_id } = parsed.data;

  // Service-role client para escrita ampla (RLS bypass).
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: campaign, error: cErr } = await admin
    .from("comm_campaigns")
    .select("*")
    .eq("id", campaign_id)
    .maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);
  if (!campaign) return json({ error: "Campanha não encontrada" }, 404);
  if (campaign.hospital_id && !assertCallerHospital(auth, campaign.hospital_id)) {
    return json({ error: "Campanha pertence a outro hospital" }, 403);
  }
  if (!["rascunho", "agendada", "enviando", "falhou"].includes(campaign.status)) {
    return json({ error: `Status inválido para envio: ${campaign.status}` }, 400);
  }
  if (campaign.approval_status !== "approved") {
    return json({
      error:
        campaign.approval_status === "pending"
          ? "Campanha aguarda aprovação do supervisor antes do disparo."
          : "Campanha rejeitada — não pode ser disparada.",
    }, 403);
  }

  await admin
    .from("comm_campaigns")
    .update({ status: "enviando" })
    .eq("id", campaign_id);

  try {
    const audience = (campaign.audience ?? {}) as Audience;
    const channels: string[] = campaign.channels ?? ["portal"];
    const wantEmail = channels.includes("email");
    const wantWhats = channels.includes("whatsapp");

    const recipients = await resolveAudience(admin, audience);

    // Upsert recipients (snapshot)
    if (recipients.length > 0) {
      const rows = recipients.map((r) => ({
        campaign_id,
        target_type: r.target_type,
        target_id: r.target_id,
        name_snapshot: r.name,
        email_snapshot: r.email,
        phone_snapshot: r.phone,
        email_status: wantEmail ? "pending" : "skipped",
        whatsapp_status: wantWhats ? "pending" : "skipped",
      }));
      const { error: upErr } = await admin
        .from("comm_campaign_recipients")
        .upsert(rows, { onConflict: "campaign_id,target_type,target_id" });
      if (upErr) throw new Error(`Falha ao gravar destinatários: ${upErr.message}`);
    }

    let emailOk = 0, emailFail = 0, waOk = 0, waFail = 0;

    // Disparo por canal
    for (const r of recipients) {
      // Email
      if (wantEmail) {
        if (!r.email) {
          await admin.from("comm_campaign_recipients").update({
            email_status: "skipped",
            email_error: "Sem e-mail cadastrado",
          }).eq("campaign_id", campaign_id)
            .eq("target_type", r.target_type)
            .eq("target_id", r.target_id);
        } else {
          const html = renderHtml(campaign.title, campaign.message, r.name);
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-email-corporate`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: r.email,
              subject: campaign.title.slice(0, 200),
              html,
              event_key: `broadcast.${campaign_id}`,
            }),
          });
          if (resp.ok) {
            emailOk++;
            await admin.from("comm_campaign_recipients").update({
              email_status: "sent",
              email_sent_at: new Date().toISOString(),
              email_error: null,
            }).eq("campaign_id", campaign_id)
              .eq("target_type", r.target_type)
              .eq("target_id", r.target_id);
          } else {
            emailFail++;
            const errTxt = await resp.text().catch(() => "");
            await admin.from("comm_campaign_recipients").update({
              email_status: "failed",
              email_error: errTxt.slice(0, 500),
            }).eq("campaign_id", campaign_id)
              .eq("target_type", r.target_type)
              .eq("target_id", r.target_id);
          }
        }
      }

      // WhatsApp (requer template_key na audiência)
      if (wantWhats) {
        const tpl = audience.whatsapp_template_key;
        if (!tpl) {
          await admin.from("comm_campaign_recipients").update({
            whatsapp_status: "skipped",
            whatsapp_error: "Campanha sem whatsapp_template_key",
          }).eq("campaign_id", campaign_id)
            .eq("target_type", r.target_type)
            .eq("target_id", r.target_id);
        } else if (!r.phone) {
          await admin.from("comm_campaign_recipients").update({
            whatsapp_status: "skipped",
            whatsapp_error: "Sem telefone cadastrado",
          }).eq("campaign_id", campaign_id)
            .eq("target_type", r.target_type)
            .eq("target_id", r.target_id);
        } else {
          const phone = normalizePhone(r.phone);
          const vars = {
            nome: r.name ?? "",
            titulo: campaign.title,
            mensagem: campaign.message,
            ...(audience.whatsapp_variables ?? {}),
          };
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-twilio`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to_phone_e164: phone,
              template_key: tpl,
              variables: vars,
              event_key: `broadcast.${campaign_id}`,
            }),
          });
          if (resp.ok) {
            waOk++;
            await admin.from("comm_campaign_recipients").update({
              whatsapp_status: "sent",
              whatsapp_sent_at: new Date().toISOString(),
              whatsapp_error: null,
            }).eq("campaign_id", campaign_id)
              .eq("target_type", r.target_type)
              .eq("target_id", r.target_id);
          } else {
            waFail++;
            const errTxt = await resp.text().catch(() => "");
            await admin.from("comm_campaign_recipients").update({
              whatsapp_status: "failed",
              whatsapp_error: errTxt.slice(0, 500),
            }).eq("campaign_id", campaign_id)
              .eq("target_type", r.target_type)
              .eq("target_id", r.target_id);
          }
        }
      }
    }

    const totals = {
      recipients: recipients.length,
      empresas: recipients.filter((r) => r.target_type === "empresa").length,
      medicos: recipients.filter((r) => r.target_type === "medico").length,
      email_sent: emailOk,
      email_failed: emailFail,
      whatsapp_sent: waOk,
      whatsapp_failed: waFail,
      actor_id: actorId,
    };

    await admin.from("comm_campaigns").update({
      status: "concluida",
      dispatched_at: new Date().toISOString(),
      totals,
    }).eq("id", campaign_id);

    return json({ ok: true, totals });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("comm_campaigns").update({
      status: "falhou",
      totals: { error: msg },
    }).eq("id", campaign_id);
    return json({ error: msg }, 500);
  }
});

async function resolveAudience(
  admin: ReturnType<typeof createClient>,
  audience: Audience,
): Promise<Recipient[]> {
  const mode = audience.mode === "and" ? "and" : "or";
  const compIds = audience.companies ?? [];
  const docIds = audience.doctors ?? [];
  const specs = audience.specialties ?? [];

  const empresas = new Map<string, Recipient>();
  const medicos = new Map<string, Recipient>();

  // ----- Empresas -----
  if (compIds.length > 0) {
    const { data } = await admin
      .from("companies")
      .select("id,name,invoice_emails")
      .in("id", compIds);
    for (const c of (data ?? []) as Array<{ id: string; name: string | null; invoice_emails: string[] | null }>) {
      empresas.set(c.id, {
        target_type: "empresa",
        target_id: c.id,
        name: c.name,
        email: (c.invoice_emails && c.invoice_emails[0]) || null,
        phone: null,
      });
    }
  }

  // ----- Médicos -----
  // OR: união de doctors selecionados + doctors por especialidade
  // AND: interseção
  let medicoIds = new Set<string>();
  if (mode === "or") {
    docIds.forEach((d) => medicoIds.add(d));
    if (specs.length > 0) {
      const { data } = await admin
        .from("doctors")
        .select("id")
        .overlaps("specialties", specs);
      for (const d of (data ?? []) as Array<{ id: string }>) medicoIds.add(d.id);
    }
  } else {
    // AND: precisa estar nas duas listas (se ambas foram fornecidas)
    let pool: Set<string> | null = null;
    if (docIds.length > 0) pool = new Set(docIds);
    if (specs.length > 0) {
      const { data } = await admin
        .from("doctors")
        .select("id")
        .overlaps("specialties", specs);
      const ids = new Set((data ?? []).map((d) => (d as { id: string }).id));
      pool = pool ? new Set([...pool].filter((x) => ids.has(x))) : ids;
    }
    medicoIds = pool ?? new Set<string>();
  }

  if (medicoIds.size > 0) {
    const { data } = await admin
      .from("doctors")
      .select("id,full_name,email,phone,active")
      .in("id", Array.from(medicoIds));
    for (const d of (data ?? []) as Array<{
      id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      active: boolean;
    }>) {
      if (!d.active) continue;
      medicos.set(d.id, {
        target_type: "medico",
        target_id: d.id,
        name: d.full_name,
        email: d.email,
        phone: d.phone,
      });
    }
  }

  // No modo AND, se empresas foram listadas, também restringe médicos a vinculados a essas empresas
  if (mode === "and" && compIds.length > 0 && medicos.size > 0) {
    const { data } = await admin
      .from("doctor_companies")
      .select("doctor_id,company_id")
      .in("doctor_id", Array.from(medicos.keys()))
      .in("company_id", compIds);
    const keep = new Set((data ?? []).map((r) => (r as { doctor_id: string }).doctor_id));
    for (const id of Array.from(medicos.keys())) {
      if (!keep.has(id)) medicos.delete(id);
    }
  }

  return [...empresas.values(), ...medicos.values()];
}

function renderHtml(title: string, message: string, name: string | null) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const greeting = name ? `Olá, ${esc(name)}` : "Olá";
  const body = esc(message).replace(/\n/g, "<br/>");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111">
  <h2 style="margin:0 0 12px">${esc(title)}</h2>
  <p>${greeting},</p>
  <div>${body}</div>
  <hr style="margin-top:24px;border:none;border-top:1px solid #eee"/>
  <p style="color:#888;font-size:12px">Mensagem enviada pelo sistema Exacta.</p>
  </body></html>`;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length >= 10 && !digits.startsWith("55")) return `+55${digits}`;
  return `+${digits}`;
}
