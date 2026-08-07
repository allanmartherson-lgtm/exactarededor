// Edge function: analista solicita correção da NF à empresa.
// - versiona o arquivo atual (nunca deleta),
// - reseta a invoice para 'aguardando' (limpando campos de recebimento),
// - envia e-mail à empresa com o motivo escrito pelo analista + link canônico.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  requireInternalOrRole,
  unauthorizedResponse,
} from "../_shared/requireInternalRole.ts";
import { assertHospitalAccess } from "../_shared/hospitalAccessGuard.ts";
import { archiveInvoiceFileVersion } from "../_shared/invoiceVersioning.ts";
import { sendCorporateEmail } from "../_shared/sendCorporateEmail.ts";
import { APP_URL } from "../_shared/appUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ALLOWED_STATUSES = new Set(["divergente", "recebida", "conciliada"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req, ["analista", "admin"]);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const invoiceId = String(body?.invoice_id ?? "").trim();
    const motivo = String(body?.motivo ?? "").trim().slice(0, 2000);
    if (!invoiceId || !motivo) {
      return json({ error: "invoice_id e motivo são obrigatórios" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select(
        "id, payment_id, hospital_id, status, file_path, invoice_number, received_amount, ai_validation, ai_extracted_amount, ai_extracted_number, ai_extracted_cnpj, upload_token, recipient_email, recipient_cc, company_name, expected_amount",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return json({ error: "Nota fiscal não encontrada" }, 404);

    const access = await assertHospitalAccess(auth, invoice.hospital_id);
    if (!access.ok) return json({ error: access.error }, access.status ?? 403);

    if (!ALLOWED_STATUSES.has(String(invoice.status))) {
      return json(
        { error: `Não é possível solicitar correção para uma NF com status '${invoice.status}'.` },
        409,
      );
    }

    // 1) Versiona o arquivo atual — nunca deletar.
    const versionRes = await archiveInvoiceFileVersion(supabase, invoice as never, {
      source: "correcao_solicitada",
      reason: motivo,
      hospitalId: invoice.hospital_id,
    });
    if (!versionRes.ok) {
      return json({ error: `Falha ao versionar o arquivo atual: ${versionRes.error}` }, 500);
    }

    // 2) Reseta a invoice para aguardando novo envio.
    const { error: updErr } = await supabase.from("invoices").update({
      status: "aguardando",
      invoice_number: null,
      received_amount: null,
      file_path: null,
      received_at: null,
      reconciliation_notes: `Correção solicitada pelo analista: ${motivo}`,
      ai_validation: null,
      ai_validated_at: null,
      ai_extracted_amount: null,
      ai_extracted_number: null,
      ai_extracted_cnpj: null,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id);
    if (updErr) return json({ error: `Falha ao reabrir a NF: ${updErr.message}` }, 500);

    // 3) Observação no lote.
    let actorName: string | null = null;
    if (auth.user_id) {
      const { data: prof } = await supabase
        .from("profiles").select("full_name, email").eq("id", auth.user_id).maybeSingle();
      actorName = prof?.full_name ?? prof?.email ?? null;
    }
    const { error: obsErr } = await supabase.from("payment_observations").insert({
      payment_id: invoice.payment_id,
      hospital_id: invoice.hospital_id,
      author_type: "sistema",
      author_id: auth.user_id ?? null,
      message:
        `Correção de NF solicitada${actorName ? ` por ${actorName}` : ""} para ${invoice.company_name ?? "a empresa"}` +
        ` (NF #${invoice.invoice_number ?? "—"}, versão ${versionRes.version} arquivada). Motivo: ${motivo}`,
      observation_type: "impacta_aprovacao",
    });
    if (obsErr) console.error("[request-invoice-correction] observação não gravada", obsErr);

    // 4) E-mail para a empresa com o motivo + link canônico de upload.
    const uploadUrl = `${APP_URL}/portal/nota/${invoice.upload_token}`;
    const subject = `Correção necessária na sua nota fiscal${invoice.invoice_number ? ` (NF ${invoice.invoice_number})` : ""}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.6;">
        <div style="background:#002855;color:#ffffff;padding:16px 20px;font-size:18px;font-weight:600;">
          Correção de nota fiscal
        </div>
        <div style="padding:20px;">
          <p>Olá${invoice.company_name ? `, ${escapeHtml(invoice.company_name)}` : ""},</p>
          <p>Precisamos de um ajuste na nota fiscal enviada. O envio anterior foi arquivado e o portal
             está liberado novamente para o reenvio.</p>
          <p style="margin:16px 0;padding:12px;border-left:4px solid #C6A27C;background:#FAF6F0;">
            <strong>Motivo informado pelo analista:</strong><br/>${escapeHtml(motivo).replace(/\n/g, "<br/>")}
          </p>
          <p><a href="${uploadUrl}"
                style="display:inline-block;background:#003DA5;color:#ffffff;text-decoration:none;
                       padding:12px 20px;border-radius:6px;font-weight:600;">Enviar nota corrigida</a></p>
          <p style="font-size:12px;color:#6b7280;">Se o botão não funcionar, copie e cole este endereço no navegador:<br/>${uploadUrl}</p>
        </div>
      </div>`;
    const text =
      `Correção de nota fiscal\n\n` +
      `Precisamos de um ajuste na nota fiscal enviada. O envio anterior foi arquivado e o portal está liberado para reenvio.\n\n` +
      `Motivo informado pelo analista: ${motivo}\n\n` +
      `Enviar nota corrigida: ${uploadUrl}\n`;

    let emailResult: unknown = null;
    if (invoice.recipient_email) {
      const res = await sendCorporateEmail({
        to: invoice.recipient_email,
        cc: Array.isArray(invoice.recipient_cc) ? invoice.recipient_cc : undefined,
        subject,
        html,
        text,
        payment_id: invoice.payment_id,
        event_key: "invoice_correction_request",
        template_key: "invoice_correction_request",
      });
      emailResult = { ok: res.ok, status: res.status, error: res.error };
      if (!res.ok) console.error("[request-invoice-correction] falha no e-mail", res.error);
    }

    return json({
      ok: true,
      version: versionRes.version,
      archived_path: versionRes.archived_path,
      email: emailResult,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[request-invoice-correction] erro", msg);
    return json({ error: msg }, 500);
  }
});
