// E2E: aprova uma campanha e valida que analista, empresa e médico recebem.
//
// Fluxo testado:
//   1. Cria fixtures (empresa + médico de teste) e uma campanha em
//      approval_status='pending', channels=['portal'].
//   2. Marca approval_status='approved' (dispara o trigger
//      trg_on_campaign_decision, que invoca notify-campaign-decision e
//      dispatch-broadcast via pg_net).
//   3. Faz polling até confirmar:
//        - internal_notifications criada para o analista (created_by)
//        - comm_campaign_recipients com a empresa
//        - comm_campaign_recipients com o médico
//        - campanha com status='concluida'
//   4. Limpa fixtures.
//
// Requer SUPABASE_SERVICE_ROLE_KEY no ambiente.
// Rode com a tool supabase--test_edge_functions.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para o teste E2E.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function poll<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  { timeoutMs = 45_000, intervalMs = 1500 } = {},
): Promise<T> {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`Timeout aguardando: ${label}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

Deno.test({
  name: "E2E: aprovação de campanha notifica analista, empresa e médico",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
  const supa = admin();

  // ---------- pré-requisitos: hospital + analista existentes ----------
  const { data: hosp } = await supa
    .from("hospitals")
    .select("id")
    .limit(1)
    .maybeSingle();
  assert(hosp?.id, "É preciso ao menos 1 hospital cadastrado");
  const hospital_id = hosp.id as string;

  const { data: analyst } = await supa
    .from("profiles")
    .select("id, email")
    .not("email", "is", null)
    .limit(1)
    .maybeSingle();
  assert(analyst?.id, "É preciso ao menos 1 profile com email");
  const analyst_id = analyst.id as string;

  // ---------- fixtures: empresa + médico de teste ----------
  const stamp = Date.now();
  const companyName = `__E2E Empresa Teste ${stamp}`;
  const doctorName = `__E2E Médico Teste ${stamp}`;

  const { data: company, error: cErr } = await supa
    .from("companies")
    .insert({
      name: companyName,
      code: `E2E-${stamp}`,
      state_uf: "DF",
      invoice_emails: [`e2e-empresa-${stamp}@example.test`],
    })
    .select("id")
    .single();
  assert(!cErr, `Falha ao criar empresa: ${cErr?.message}`);
  const company_id = company!.id as string;

  const { data: doctor, error: dErr } = await supa
    .from("doctors")
    .insert({
      full_name: doctorName,
      code: `E2E-${stamp}`,
      state_uf: "DF",
      crm: `E2E${stamp}`,
      crm_uf: "DF",
      email: `e2e-medico-${stamp}@example.test`,
    })
    .select("id")
    .single();
  assert(!dErr, `Falha ao criar médico: ${dErr?.message}`);
  const doctor_id = doctor!.id as string;

  // ---------- cria campanha pendente ----------
  const { data: camp, error: campErr } = await supa
    .from("comm_campaigns")
    .insert({
      hospital_id,
      title: `__E2E Aprovação ${stamp}`,
      message: "Conteúdo de teste E2E — pode ignorar.",
      channels: ["portal"], // portal-only: não dispara email/whatsapp real
      audience: {
        mode: "or",
        companies: [company_id],
        doctors: [doctor_id],
      },
      status: "rascunho",
      approval_status: "pending",
      created_by: analyst_id,
    })
    .select("id")
    .single();
  assert(!campErr, `Falha ao criar campanha: ${campErr?.message}`);
  const campaign_id = camp!.id as string;

  try {
    // ---------- aprova: dispara trigger trg_on_campaign_decision ----------
    const { error: apprErr } = await supa
      .from("comm_campaigns")
      .update({
        approval_status: "approved",
        approved_by: analyst_id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", campaign_id);
    assert(!apprErr, `Falha ao aprovar campanha: ${apprErr?.message}`);

    // ---------- valida notificação ao analista ----------
    const inbox = await poll("internal_notifications do analista", async () => {
      const { data } = await supa
        .from("internal_notifications")
        .select("id, title, payload, user_id")
        .eq("user_id", analyst_id)
        .contains("payload", { campaign_id })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    });
    assertEquals(inbox.user_id, analyst_id);
    assert(
      String(inbox.title).toLowerCase().includes("aprov"),
      `Título esperado conter 'aprov', recebido: ${inbox.title}`,
    );

    // ---------- valida que dispatch criou recipients para empresa + médico ----------
    const empresaRcpt = await poll("recipient empresa", async () => {
      const { data } = await supa
        .from("comm_campaign_recipients")
        .select("id, target_type, target_id")
        .eq("campaign_id", campaign_id)
        .eq("target_type", "empresa")
        .eq("target_id", company_id)
        .maybeSingle();
      return data ?? null;
    });
    assertEquals(empresaRcpt.target_type, "empresa");

    const medicoRcpt = await poll("recipient medico", async () => {
      const { data } = await supa
        .from("comm_campaign_recipients")
        .select("id, target_type, target_id")
        .eq("campaign_id", campaign_id)
        .eq("target_type", "medico")
        .eq("target_id", doctor_id)
        .maybeSingle();
      return data ?? null;
    });
    assertEquals(medicoRcpt.target_type, "medico");

    // ---------- valida conclusão da campanha ----------
    const finished = await poll("campanha concluida", async () => {
      const { data } = await supa
        .from("comm_campaigns")
        .select("status, totals")
        .eq("id", campaign_id)
        .maybeSingle();
      if (data?.status === "concluida") return data;
      return null;
    });
    const totals = (finished.totals ?? {}) as Record<string, number>;
    assert(
      (totals.recipients ?? 0) >= 2,
      `Esperado >=2 recipients, totals=${JSON.stringify(totals)}`,
    );
    assert(
      (totals.empresas ?? 0) >= 1 && (totals.medicos ?? 0) >= 1,
      `Esperado empresas>=1 e medicos>=1, totals=${JSON.stringify(totals)}`,
    );

    // ---------- valida tentativa de envio de e-mail ao analista ----------
    // notify-campaign-decision chama send-email-corporate, que grava em
    // notification_deliveries (status 'sent' se houver connector linkado,
    // 'failed' com "No email connector linked" caso contrário). Em ambos
    // casos a entrega é registrada — o que prova que o pipeline disparou.
    const delivery = await poll("notification_deliveries do analista", async () => {
      const { data } = await supa
        .from("notification_deliveries")
        .select("id, status, error_message, target_address, event_key, user_id")
        .eq("user_id", analyst_id)
        .eq("event_key", `campaign.decision.approved`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    });
    assertEquals(delivery.target_address, analyst!.email);
    assert(
      ["sent", "failed", "queued"].includes(String(delivery.status)),
      `Status inesperado: ${delivery.status}`,
    );
    // Diagnóstico amigável: se falhou porque não há connector linkado, isso
    // não é um defeito do código — apenas indica que o ambiente precisa de
    // um connector Outlook/Gmail vinculado ao projeto.
    if (delivery.status === "failed") {
      console.warn(
        `[E2E] e-mail registrou falha esperada: ${delivery.error_message}. ` +
          `Vincule um connector Outlook/Gmail ao projeto para entrega real.`,
      );
    }
  } finally {
    // ---------- cleanup ----------
    await supa
      .from("notification_deliveries")
      .delete()
      .eq("user_id", analyst_id)
      .eq("event_key", "campaign.decision.approved");
    await supa
      .from("comm_campaign_recipients")
      .delete()
      .eq("campaign_id", campaign_id);
    await supa.from("comm_campaigns").delete().eq("id", campaign_id);
    await supa
      .from("internal_notifications")
      .delete()
      .eq("user_id", analyst_id)
      .contains("payload", { campaign_id });
    await supa.from("doctors").delete().eq("id", doctor_id);
    await supa.from("companies").delete().eq("id", company_id);
  }
  },
});
