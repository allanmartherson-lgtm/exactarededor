import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return new Response(JSON.stringify({ error: "token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: invoice } = await supabase
        .from("invoices")
        .select("id, expected_amount, status, recipient_email, payment_id")
        .eq("upload_token", token)
        .maybeSingle();
      if (!invoice) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: payment } = await supabase.from("payments").select("reference").eq("id", invoice.payment_id).single();
      return new Response(JSON.stringify({ invoice, payment }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST: receber NF (multipart/form-data)
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    const invoiceNumber = String(form.get("invoice_number") ?? "").trim();
    const receivedAmount = Number(form.get("received_amount"));
    const file = form.get("file") as File | null;

    if (!token || !invoiceNumber || !file || isNaN(receivedAmount)) {
      return new Response(JSON.stringify({ error: "Dados inválidos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Arquivo maior que 10MB" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: invoice } = await supabase.from("invoices").select("*").eq("upload_token", token).maybeSingle();
    if (!invoice) return new Response(JSON.stringify({ error: "Token inválido" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (invoice.status !== "aguardando") {
      return new Response(JSON.stringify({ error: "Esta NF já foi enviada" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ext = file.name.split(".").pop() ?? "pdf";
    const path = `${invoice.payment_id}/${invoice.id}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage.from("invoices").upload(path, buf, { contentType: file.type, upsert: true });
    if (upErr) throw upErr;

    // Conciliação automática
    const expected = Number(invoice.expected_amount);
    const diff = Math.abs(expected - receivedAmount);
    const tolerance = 0.01;
    const matches = diff <= tolerance;

    await supabase.from("invoices").update({
      invoice_number: invoiceNumber,
      received_amount: receivedAmount,
      file_path: path,
      received_at: new Date().toISOString(),
      status: matches ? "conciliada" : "divergente",
      reconciliation_notes: matches
        ? "Valor confere com o pedido."
        : `Divergência: pedido R$ ${expected.toFixed(2)} vs nota R$ ${receivedAmount.toFixed(2)} (diferença R$ ${diff.toFixed(2)}).`,
    }).eq("id", invoice.id);

    // Verifica se todas as NF do pagamento foram recebidas
    const { data: allInv } = await supabase.from("invoices").select("status").eq("payment_id", invoice.payment_id);
    const allDone = allInv?.every((i) => i.status === "conciliada" || i.status === "divergente");
    const anyDiverg = allInv?.some((i) => i.status === "divergente");
    if (allDone) {
      await supabase.from("payments").update({ status: anyDiverg ? "nf_divergente" : "nf_conciliada" }).eq("id", invoice.payment_id);
      await supabase.from("payment_observations").insert({
        payment_id: invoice.payment_id,
        author_type: "sistema",
        message: anyDiverg ? "Todas as NF recebidas, mas há divergência de valor." : "Todas as NF recebidas e conciliadas com sucesso.",
        status_to: anyDiverg ? "nf_divergente" : "nf_conciliada",
      });
    } else {
      await supabase.from("payments").update({ status: "nf_recebida" }).eq("id", invoice.payment_id);
    }

    return new Response(JSON.stringify({ ok: true, matches, diff }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});