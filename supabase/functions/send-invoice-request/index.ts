import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { payment_id } = await req.json();
    if (!payment_id) return new Response(JSON.stringify({ error: "payment_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: payment } = await supabase.from("payments").select("*").eq("id", payment_id).single();
    const { data: items } = await supabase.from("payment_items").select("*").eq("payment_id", payment_id);
    if (!payment || !items) throw new Error("Pagamento não encontrado");

    // Cria 1 invoice por destinatário único (agrupa por email)
    const byEmail = new Map<string, { total: number; items: typeof items }>();
    for (const it of items) {
      const email = it.doctor_email?.trim();
      if (!email) continue;
      const cur = byEmail.get(email) ?? { total: 0, items: [] as typeof items };
      cur.total += Number(it.gross_amount);
      cur.items.push(it);
      byEmail.set(email, cur);
    }

    if (byEmail.size === 0) {
      return new Response(JSON.stringify({ error: "Nenhum item com email do médico" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = req.headers.get("origin") ?? Deno.env.get("PUBLIC_APP_URL") ?? "";
    const created: string[] = [];

    for (const [email, info] of byEmail) {
      const { data: invoice } = await supabase
        .from("invoices")
        .insert({
          payment_id,
          expected_amount: info.total,
          recipient_email: email,
          status: "aguardando",
          sent_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (!invoice) continue;
      created.push(invoice.id);

      const uploadUrl = `${baseUrl}/portal/nota/${invoice.upload_token}`;
      const itemsList = info.items.map((it) => `- ${it.description ?? "Serviço"}: R$ ${Number(it.gross_amount).toFixed(2)}`).join("\n");
      const docName = info.items[0].doctor_name;

      // Tenta enviar email via send-transactional-email; se não houver infra, apenas registra log
      try {
        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "invoice-request",
            recipientEmail: email,
            idempotencyKey: `inv-${invoice.id}`,
            templateData: {
              doctorName: docName,
              totalAmount: info.total.toFixed(2),
              uploadUrl,
              itemsList,
              reference: payment.reference,
            },
          },
        });
      } catch (e) {
        console.warn("Email send failed (provider not configured?)", e);
      }
    }

    await supabase.from("payments").update({ status: "pedido_nf_enviado" }).eq("id", payment_id);
    await supabase.from("payment_observations").insert({
      payment_id,
      author_type: "sistema",
      message: `${created.length} pedido(s) de NF enviado(s).`,
      status_to: "pedido_nf_enviado",
    });

    return new Response(JSON.stringify({ ok: true, invoices_created: created.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});