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
        .select("id, expected_amount, status, recipient_email, payment_id, company_name, received_at")
        .eq("upload_token", token)
        .maybeSingle();
      if (!invoice) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: payment } = await supabase
        .from("payments")
        .select("reference, description, sectors, specialties, competence_months, competence_month, payment_kind")
        .eq("id", invoice.payment_id)
        .single();
      // Inclui a thread de questionamentos pra renderizar no portal
      const { data: questions } = await supabase
        .from("invoice_questions")
        .select("id, author_type, author_name, message, created_at")
        .eq("invoice_id", invoice.id)
        .order("created_at", { ascending: true });
      return new Response(JSON.stringify({ invoice, payment, questions: questions ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // POST: dois modos:
    //   - 'invoice' (default, multipart/form-data) — recebedor envia a NF
    //   - 'question' (application/json) — recebedor envia uma dúvida
    const contentType = req.headers.get("content-type") ?? "";

    // -------- modo: questionamento --------
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const token = String(body?.token ?? "");
      const message = String(body?.message ?? "").trim();
      const authorName = String(body?.author_name ?? "").trim().slice(0, 120) || null;
      if (!token || !message) {
        return new Response(JSON.stringify({ error: "token e mensagem são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (message.length > 2000) {
        return new Response(JSON.stringify({ error: "Mensagem muito longa (máx. 2000 caracteres)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: invoice } = await supabase.from("invoices").select("id, payment_id, status").eq("upload_token", token).maybeSingle();
      if (!invoice) return new Response(JSON.stringify({ error: "Token inválido" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (invoice.status !== "aguardando") {
        return new Response(JSON.stringify({ error: "Esta NF já foi finalizada — não é possível enviar novas dúvidas." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: insErr } = await supabase.from("invoice_questions").insert({
        invoice_id: invoice.id,
        payment_id: invoice.payment_id,
        author_type: "recebedor",
        author_name: authorName,
        message,
      });
      if (insErr) throw insErr;

      // Move o pagamento para `nf_questionada` para o analista ser notificado.
      // Mantém histórico em payment_observations.
      await supabase.from("payments").update({ status: "nf_questionada" }).eq("id", invoice.payment_id);
      await supabase.from("payment_observations").insert({
        payment_id: invoice.payment_id,
        author_type: "sistema",
        message: `Recebedor da NF enviou um questionamento${authorName ? ` (${authorName})` : ""}: "${message.slice(0, 200)}${message.length > 200 ? "..." : ""}"`,
        status_to: "nf_questionada",
      });

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // -------- modo: envio da NF (multipart) --------
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    const invoiceNumber = String(form.get("invoice_number") ?? "").trim();
    const rawReceived = form.get("received_amount");
    const file = form.get("file") as File | null;

    if (!token || !invoiceNumber || !file) {
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

    // Recebedor não digita mais o valor — assumimos o valor esperado para fins
    // do registro. A conciliação real fica por conta da IA (valor extraído da NF).
    const expected = Number(invoice.expected_amount);
    const receivedAmount = rawReceived != null && String(rawReceived).trim() !== ""
      ? Number(rawReceived)
      : expected;

    const ext = file.name.split(".").pop() ?? "pdf";
    const path = `${invoice.payment_id}/${invoice.id}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage.from("invoices").upload(path, buf, { contentType: file.type, upsert: true });
    if (upErr) throw upErr;

    // Conciliação pelo valor (esperado/digitado) e pelo extraído pela IA.
    const tolerance = 0.01;
    const formDiff = Math.abs(expected - receivedAmount);
    const matchesByForm = formDiff <= tolerance;

    // Persiste primeiro o arquivo + valor digitado, com status provisório.
    await supabase.from("invoices").update({
      invoice_number: invoiceNumber,
      received_amount: receivedAmount,
      file_path: path,
      received_at: new Date().toISOString(),
      status: "aguardando",
      reconciliation_notes: "Validando documento...",
    }).eq("id", invoice.id);

    // Validação SÍNCRONA por IA: lê o PDF/XML, extrai valor e compara com o pedido.
    // Bloqueia o fluxo até decidir; se a IA falhar, fica em divergência por precaução.
    const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/validate-invoice-pdf`;
    let aiAmount: number | null = null;
    let aiDivergences: string[] = [];
    let aiError: string | null = null;
    try {
      const aiResp = await fetch(FN_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invoice_id: invoice.id }),
      });
      const aiJson = await aiResp.json().catch(() => ({}));
      if (!aiResp.ok) {
        aiError = aiJson?.error ?? `ai_status_${aiResp.status}`;
      } else {
        aiAmount = typeof aiJson.extracted_amount === "number" ? aiJson.extracted_amount : null;
        aiDivergences = Array.isArray(aiJson.divergences) ? aiJson.divergences : [];
      }
    } catch (e) {
      aiError = e instanceof Error ? e.message : "ai_unreachable";
    }

    // Comparação dos valores com a NF (digitado e extraído da NF pela IA).
    const aiDiff = aiAmount != null ? Math.abs(expected - aiAmount) : null;
    const matchesByAi = aiDiff != null ? aiDiff <= tolerance : null;

    // Política: precisa bater nos dois (form + NF). Se IA falhou, marcamos como
    // divergente pra forçar conferência humana — bloqueia o avanço do fluxo.
    let finalMatches = false;
    let notes = "";
    if (!matchesByForm) {
      notes = `Divergência (valor digitado): pedido ${expected.toFixed(2)} vs digitado ${receivedAmount.toFixed(2)} (Δ ${formDiff.toFixed(2)}).`;
    }
    if (matchesByAi === false) {
      notes += (notes ? " " : "") +
        `Divergência (valor na NF): pedido ${expected.toFixed(2)} vs NF ${aiAmount!.toFixed(2)} (Δ ${aiDiff!.toFixed(2)}).`;
    }
    if (aiDivergences.length > 0) {
      notes += (notes ? " " : "") + `IA: ${aiDivergences.join("; ")}`;
    }
    if (aiError) {
      notes += (notes ? " " : "") + `Falha na validação automática (${aiError}). Conferência manual obrigatória.`;
    }
    if (matchesByForm && matchesByAi === true) {
      finalMatches = true;
      notes = "Valor digitado e valor extraído da NF conferem com o pedido.";
    }

    await supabase.from("invoices").update({
      status: finalMatches ? "conciliada" : "divergente",
      reconciliation_notes: notes,
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

    return new Response(
      JSON.stringify({
        ok: true,
        matches: finalMatches,
        form_diff: formDiff,
        ai_amount: aiAmount,
        ai_diff: aiDiff,
        ai_error: aiError,
        notes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});