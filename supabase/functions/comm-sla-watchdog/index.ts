import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WORK_START = 8, WORK_END = 18;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

function diffBusinessHours(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    if (!isWeekend(cursor)) {
      const dayStart = new Date(cursor); dayStart.setHours(WORK_START, 0, 0, 0);
      const dayEnd = new Date(cursor); dayEnd.setHours(WORK_END, 0, 0, 0);
      const lo = cursor < dayStart ? dayStart : cursor;
      const hi = to < dayEnd ? to : dayEnd;
      if (hi > lo) total += (hi.getTime() - lo.getTime()) / 3600_000;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(WORK_START, 0, 0, 0);
  }
  return total;
}

interface Thread {
  channel: "doctor" | "company_payment" | "company_invoice";
  thread_id: string;
  hospital_id: string | null;
  status: string;
  opened_at: string;
  first_response_at: string | null;
  sla_alerted_at: string | null;
  assigned_to: string | null;
}

const TABLE_BY_CHANNEL: Record<Thread["channel"], string> = {
  doctor: "doctor_messages",
  company_payment: "payment_questions",
  company_invoice: "invoice_questions",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: threads, error: tErr } = await supa
    .from("communication_threads_v")
    .select("*")
    .neq("status", "encerrada")
    .is("sla_alerted_at", null);
  if (tErr) return new Response(JSON.stringify({ error: tErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: settings } = await supa
    .from("communication_sla_settings")
    .select("*")
    .is("hospital_id", null);

  const settingByChannel = new Map<string, any>();
  (settings ?? []).forEach((s: any) => settingByChannel.set(s.channel, s));

  const now = new Date();
  let alerted = 0;

  for (const t of (threads ?? []) as Thread[]) {
    const s = settingByChannel.get(t.channel);
    if (!s || !s.active) continue;
    const budget = t.first_response_at ? Number(s.resolution_hours) : Number(s.first_response_hours);
    const elapsed = diffBusinessHours(new Date(t.opened_at), now);
    if (elapsed >= budget) {
      const tbl = TABLE_BY_CHANNEL[t.channel];
      await supa.from(tbl).update({ sla_alerted_at: now.toISOString() }).eq("id", t.thread_id);
      await supa.from("notification_queue").insert({
        kind: "comm_sla_breached",
        target_user_id: t.assigned_to,
        hospital_id: t.hospital_id,
        payload: {
          channel: t.channel,
          thread_id: t.thread_id,
          elapsed_hours: Number(elapsed.toFixed(2)),
          budget_hours: budget,
        },
      });
      alerted += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: threads?.length ?? 0, alerted }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
