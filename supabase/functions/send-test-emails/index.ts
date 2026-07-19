// Envia um e-mail de teste para cada um dos 11 templates transacionais.
// Uso: POST { to: "email@dominio", only?: ["a1","e1"] }
// Requer role interno (admin/diretor/analista/validador/gestao_medica) ou service-role.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { requireInternalOrRole, unauthorizedResponse } from "../_shared/requireInternalRole.ts";
import {
  a1_sendInvoiceRequest,
  a2_nfReceived,
  b1_validatorAssignment,
  b2_iaConcluded,
  b3_returned,
  b5_internalQuestion,
  b6_questionReply,
  c1_passwordRecovery,
  c2_newUserInvite,
  d2_campaignBroadcast,
  e1_productionValidation,
  type Rendered,
} from "../_shared/emailTemplates/templates.ts";

const BodySchema = z.object({
  to: z.string().email(),
  only: z.array(z.string()).optional(),
});

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const APP_URL = "https://exactarededor.lovable.app";

function buildSamples(): Record<string, Rendered> {
  return {
    a1: a1_sendInvoiceRequest({
      recipient_label: "CLÍNICA EXEMPLO LTDA",
      total_formatted: "R$ 48.320,50",
      upload_url: `${APP_URL}/portal-empresa/invoice/exemplo`,
      setores: "Endoscopia, Colonoscopia",
      competencia: "Maio/2026",
      prazo_envio: "25/06/2026",
      hospital_name: "DF Star",
      hospital_contact_email: "faturamento@dfstar.com.br",
      hospital_contact_phone: "(61) 3319-3000",
      hospital_dados_cadastrais: "Rede D'Or DF Star\nSHIS QI 07 conj F\nCNPJ 06.047.087/0007-59",
    }),
    a2: a2_nfReceived({
      analyst_name: "Ana (analista)",
      company_name: "CLÍNICA EXEMPLO LTDA",
      company_cnpj: "12.345.678/0001-99",
      invoice_value: "R$ 48.320,50",
      competence_month: "Maio/2026",
      payment_reference: "Lote DF Star — Maio/2026",
      invoice_link: `${APP_URL}/payments/00000000-0000-0000-0000-000000000000`,
    }),
    b1: b1_validatorAssignment({
      validator_name: "Bruno (validador)",
      payment_reference: "Lote DF Star — Maio/2026",
      payment_type: "Cirurgia",
      competence_month: "Maio/2026",
      hospital_name: "DF Star",
      company_count: 18,
      payment_link: `${APP_URL}/payments/00000000-0000-0000-0000-000000000000`,
    }),
    b2: b2_iaConcluded({
      analyst_name: "Ana (analista)",
      payment_reference: "Lote DF Star — Maio/2026",
      items_count: 1247,
      alerts_count: 12,
      divergences_count: 4,
      analysis_duration: "3m 12s",
      payment_link: `${APP_URL}/payments/00000000-0000-0000-0000-000000000000`,
    }),
    b3: b3_returned({
      analyst_name: "Ana (analista)",
      payment_reference: "Lote DF Star — Maio/2026",
      returned_by: "Bruno (validador)",
      returned_at: "18/06/2026 14:22",
      return_reason: "Faltam justificativas nas glosas do Dr. Mateus Saldanha. Reenviar com anexo.",
      payment_link: `${APP_URL}/payments/00000000-0000-0000-0000-000000000000`,
    }),
    b5: b5_internalQuestion({
      analyst_name: "Ana (analista)",
      payment_reference: "Lote DF Star — Maio/2026",
      question_by: "Dra. Carla (diretora)",
      question_preview: "O item 9044275 está com repasse de 100% em vez de 50%. Pode confirmar a regra aplicada?",
      thread_link: `${APP_URL}/payments/00000000-0000-0000-0000-000000000000?thread=exemplo`,
    }),
    b6: b6_questionReply({
      recipient_name: "Dra. Carla",
      payment_reference: "Lote DF Star — Maio/2026",
      replied_by: "Ana (analista)",
      reply_preview: "Confirmado: o TUSS 4100* está no grupo com repasse de 50%. Já corrigido.",
      thread_link: `${APP_URL}/payments/00000000-0000-0000-0000-000000000000?thread=exemplo`,
    }),
    c1: c1_passwordRecovery({
      user_name: "Usuário Exemplo",
      reset_link: `${APP_URL}/auth/reset?token=EXEMPLO_TESTE`,
      expiry_hours: 24,
    }),
    c2: c2_newUserInvite({
      user_name: "Novo Usuário",
      user_email: "novo.usuario@exemplo.com",
      hospital_name: "DF Star",
      activation_link: `${APP_URL}/auth/activate?token=EXEMPLO_TESTE`,
    }),
    d2: d2_campaignBroadcast({
      campaign_title: "Alteração no calendário de pagamentos — Junho/2026",
      campaign_message:
        "Informamos que o cronograma de pagamentos de junho foi antecipado em 2 dias úteis. O prazo para envio de NFs passa a ser 20/06.\n\nQualquer dúvida, responder este e-mail.",
      hospital_name: "DF Star",
      recipient_name: "Empresa Parceira",
      reply_link: `${APP_URL}/portal-empresa/campaigns/exemplo`,
      allow_reply: true,
    }),
    e1: e1_productionValidation({
      director_name: "Dra. Carla (diretora)",
      payment_reference: "Lote DF Star — Maio/2026",
      payment_type: "Cirurgia",
      competence_month: "Maio/2026",
      hospital_name: "DF Star",
      company_count: 18,
      total_value: "R$ 3.428.912,40",
      approve_link: `${APP_URL}/approvals/exemplo?action=approve`,
      reject_link: `${APP_URL}/approvals/exemplo?action=reject`,
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireInternalOrRole(req);
  if (!auth.ok) return unauthorizedResponse(auth, corsHeaders);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { to, only } = parsed.data;
  const samples = buildSamples();
  const keys = only?.length ? only.filter((k) => k in samples) : Object.keys(samples);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const results: Array<{ template: string; subject: string; ok: boolean; error?: string }> = [];

  for (const key of keys) {
    const t = samples[key];
    const subject = `[TESTE ${key.toUpperCase()}] ${t.subject}`;
    try {
      const r = await fetch(`${PROJECT_URL}/functions/v1/send-email-corporate`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          subject,
          html: t.html,
          text: t.text,
          event_key: `test_email_${key}`,
          template_key: key,
        }),
      });
      const body = await r.text();
      results.push({ template: key, subject, ok: r.ok, error: r.ok ? undefined : `${r.status}: ${body.slice(0, 300)}` });
    } catch (e) {
      results.push({ template: key, subject, ok: false, error: (e as Error).message });
    }
    // pequeno intervalo para não saturar o connector
    await new Promise((res) => setTimeout(res, 400));
  }

  const okCount = results.filter((r) => r.ok).length;
  return new Response(JSON.stringify({ to, sent: okCount, total: results.length, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
